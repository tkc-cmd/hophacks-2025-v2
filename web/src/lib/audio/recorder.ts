/**
 * Audio Recorder with VAD and Real-time Processing
 * 
 * Records audio from microphone and streams to WebSocket with voice activity detection
 */

export interface RecorderConfig {
  sampleRate: number;
  channels: number;
  bufferSize: number;
  vadThreshold: number;
  silenceTimeoutMs: number;
}

export interface AudioProcessorConfig {
  sampleRate: number;
  channels: number;
  bufferSize: number;
}

export class AudioRecorder {
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: AudioWorkletNode | null = null;
  private config: RecorderConfig;
  private isRecording = false;
  private onAudioData: ((data: ArrayBuffer) => void) | null = null;
  private onVAD: ((isVoice: boolean, energy: number) => void) | null = null;

  constructor(config: Partial<RecorderConfig> = {}) {
    this.config = {
      sampleRate: 16000,
      channels: 1,
      bufferSize: 4096,
      vadThreshold: 0.01,
      silenceTimeoutMs: 1000,
      ...config
    };
  }

  /**
   * Initialize recording with microphone access
   */
  async initialize(): Promise<void> {
    try {
      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.config.sampleRate,
          channelCount: this.config.channels,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Create audio context
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: this.config.sampleRate,
      });

      // Resume if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Create source node
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Try to use AudioWorklet for better performance
      try {
        await this.setupAudioWorklet();
      } catch (error) {
        console.warn('AudioWorklet not available, falling back to ScriptProcessorNode');
        this.setupScriptProcessor();
      }

    } catch (error) {
      throw new Error(`Failed to initialize audio recorder: ${error}`);
    }
  }

  /**
   * Set up AudioWorklet for audio processing
   */
  private async setupAudioWorklet(): Promise<void> {
    if (!this.audioContext) throw new Error('Audio context not initialized');

    // Add audio worklet module
    const workletCode = `
      class AudioProcessorWorklet extends AudioWorkletProcessor {
        constructor() {
          super();
          this.bufferSize = 4096;
          this.buffer = new Float32Array(this.bufferSize);
          this.bufferIndex = 0;
          this.vadThreshold = 0.01;
        }

        process(inputs, outputs, parameters) {
          const input = inputs[0];
          if (input.length > 0) {
            const inputChannel = input[0];
            
            for (let i = 0; i < inputChannel.length; i++) {
              this.buffer[this.bufferIndex] = inputChannel[i];
              this.bufferIndex++;
              
              if (this.bufferIndex >= this.bufferSize) {
                // Convert to 16-bit PCM
                const pcmData = new Int16Array(this.bufferSize);
                let energy = 0;
                
                for (let j = 0; j < this.bufferSize; j++) {
                  const sample = Math.max(-1, Math.min(1, this.buffer[j]));
                  pcmData[j] = sample * 0x7FFF;
                  energy += sample * sample;
                }
                
                energy = Math.sqrt(energy / this.bufferSize);
                
                // Send audio data and VAD info
                this.port.postMessage({
                  type: 'audioData',
                  data: pcmData.buffer,
                  energy: energy,
                  isVoice: energy > this.vadThreshold
                });
                
                this.bufferIndex = 0;
              }
            }
          }
          
          return true;
        }
      }

      registerProcessor('audio-processor', AudioProcessorWorklet);
    `;

    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    
    await this.audioContext.audioWorklet.addModule(workletUrl);
    
    this.processorNode = new AudioWorkletNode(this.audioContext, 'audio-processor');
    
    this.processorNode.port.onmessage = (event) => {
      if (event.data.type === 'audioData') {
        if (this.onAudioData) {
          this.onAudioData(event.data.data);
        }
        if (this.onVAD) {
          this.onVAD(event.data.isVoice, event.data.energy);
        }
      }
    };

    URL.revokeObjectURL(workletUrl);
  }

  /**
   * Fallback to ScriptProcessorNode
   */
  private setupScriptProcessor(): void {
    if (!this.audioContext) throw new Error('Audio context not initialized');

    // Use deprecated ScriptProcessorNode as fallback
    const processor = this.audioContext.createScriptProcessor(this.config.bufferSize, 1, 1);
    
    processor.onaudioprocess = (event) => {
      const inputBuffer = event.inputBuffer;
      const inputData = inputBuffer.getChannelData(0);
      
      // Convert to 16-bit PCM
      const pcmData = new Int16Array(inputData.length);
      let energy = 0;
      
      for (let i = 0; i < inputData.length; i++) {
        const sample = Math.max(-1, Math.min(1, inputData[i]));
        pcmData[i] = sample * 0x7FFF;
        energy += sample * sample;
      }
      
      energy = Math.sqrt(energy / inputData.length);
      
      if (this.onAudioData) {
        this.onAudioData(pcmData.buffer);
      }
      if (this.onVAD) {
        this.onVAD(energy > this.config.vadThreshold, energy);
      }
    };

    this.processorNode = processor as any;
  }

  /**
   * Start recording
   */
  async start(): Promise<void> {
    if (this.isRecording) return;

    if (!this.audioContext || !this.sourceNode || !this.processorNode) {
      await this.initialize();
    }

    // Connect audio nodes
    this.sourceNode!.connect(this.processorNode!);
    
    // Connect to destination to prevent garbage collection (but with zero gain)
    const gainNode = this.audioContext!.createGain();
    gainNode.gain.value = 0;
    this.processorNode!.connect(gainNode);
    gainNode.connect(this.audioContext!.destination);

    this.isRecording = true;
  }

  /**
   * Stop recording
   */
  stop(): void {
    if (!this.isRecording) return;

    if (this.sourceNode && this.processorNode) {
      this.sourceNode.disconnect();
      this.processorNode.disconnect();
    }

    this.isRecording = false;
  }

  /**
   * Set audio data callback
   */
  onAudio(callback: (data: ArrayBuffer) => void): void {
    this.onAudioData = callback;
  }

  /**
   * Set VAD callback
   */
  onVoiceActivity(callback: (isVoice: boolean, energy: number) => void): void {
    this.onVAD = callback;
  }

  /**
   * Get current recording state
   */
  get state(): {
    isRecording: boolean;
    hasPermission: boolean;
    sampleRate: number;
  } {
    return {
      isRecording: this.isRecording,
      hasPermission: this.mediaStream !== null,
      sampleRate: this.config.sampleRate
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }

    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
  }
}
