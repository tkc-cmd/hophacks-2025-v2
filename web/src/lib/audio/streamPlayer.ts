/**
 * WebSocket Audio Stream Player with Jitter Buffer
 * 
 * Plays audio chunks received from WebSocket with buffering to handle network jitter
 */

export interface AudioChunk {
  data: ArrayBuffer;
  timestamp: number;
}

export interface StreamPlayerConfig {
  sampleRate: number;
  channels: number;
  bufferSize: number;
  minBufferMs: number;
  maxBufferMs: number;
}

export class StreamPlayer {
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private buffer: AudioChunk[] = [];
  private isPlaying = false;
  private config: StreamPlayerConfig;
  private nextPlayTime = 0;
  private volume = 1.0;

  constructor(config: Partial<StreamPlayerConfig> = {}) {
    this.config = {
      sampleRate: 24000,
      channels: 1,
      bufferSize: 4096,
      minBufferMs: 100,
      maxBufferMs: 500,
      ...config
    };
  }

  /**
   * Initialize audio context and nodes
   */
  async initialize(): Promise<void> {
    if (this.audioContext) {
      return;
    }

    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: this.config.sampleRate,
    });

    // Create gain node for volume control
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
    this.gainNode.gain.value = this.volume;

    // Resume audio context if suspended (required by browser policies)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * Add audio chunk to buffer
   */
  addChunk(audioData: string): void {
    if (!audioData) return;

    try {
      // Decode base64 audio data
      const binaryString = atob(audioData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const chunk: AudioChunk = {
        data: bytes.buffer,
        timestamp: Date.now()
      };

      this.buffer.push(chunk);

      // Start playing if we have enough buffer
      if (!this.isPlaying && this.getBufferDurationMs() >= this.config.minBufferMs) {
        this.startPlayback();
      }

      // Prevent buffer overflow
      if (this.getBufferDurationMs() > this.config.maxBufferMs) {
        this.buffer.shift(); // Remove oldest chunk
      }
    } catch (error) {
      console.error('Failed to add audio chunk:', error);
    }
  }

  /**
   * Start audio playback
   */
  private async startPlayback(): Promise<void> {
    if (!this.audioContext || !this.gainNode || this.isPlaying) {
      return;
    }

    await this.initialize();
    this.isPlaying = true;
    this.nextPlayTime = this.audioContext.currentTime;
    
    this.processBuffer();
  }

  /**
   * Process buffered audio chunks
   */
  private async processBuffer(): Promise<void> {
    if (!this.audioContext || !this.gainNode || !this.isPlaying) {
      return;
    }

    while (this.buffer.length > 0 && this.isPlaying) {
      const chunk = this.buffer.shift()!;
      
      try {
        // Decode MP3 audio data
        const audioBuffer = await this.decodeAudioData(chunk.data);
        
        // Create buffer source
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.gainNode);

        // Schedule playback
        source.start(this.nextPlayTime);
        this.nextPlayTime += audioBuffer.duration;

        // Clean up completed sources
        source.onended = () => {
          source.disconnect();
        };

      } catch (error) {
        console.error('Failed to play audio chunk:', error);
      }

      // Yield control to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Check if we need to continue processing
    if (this.buffer.length > 0) {
      setTimeout(() => this.processBuffer(), 10);
    } else if (this.isPlaying) {
      // No more chunks, but keep checking for new ones
      setTimeout(() => this.processBuffer(), 50);
    }
  }

  /**
   * Decode audio data (MP3 to AudioBuffer)
   */
  private async decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
    if (!this.audioContext) {
      throw new Error('Audio context not initialized');
    }

    try {
      return await this.audioContext.decodeAudioData(data.slice(0));
    } catch (error) {
      console.error('Audio decode error:', error);
      // Fallback: create silent buffer
      const buffer = this.audioContext.createBuffer(
        this.config.channels,
        this.config.sampleRate * 0.1, // 100ms of silence
        this.config.sampleRate
      );
      return buffer;
    }
  }

  /**
   * Pause audio playback
   */
  pause(): void {
    this.isPlaying = false;
  }

  /**
   * Resume audio playback
   */
  resume(): void {
    if (!this.isPlaying && this.buffer.length > 0) {
      this.startPlayback();
    }
  }

  /**
   * Stop audio playback and clear buffer
   */
  stop(): void {
    this.isPlaying = false;
    this.buffer = [];
    this.nextPlayTime = 0;
  }

  /**
   * Set volume (0.0 to 1.0)
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
    }
  }

  /**
   * Get current volume
   */
  getVolume(): number {
    return this.volume;
  }

  /**
   * Get buffer duration in milliseconds
   */
  private getBufferDurationMs(): number {
    if (this.buffer.length === 0) return 0;
    
    // Estimate duration based on chunk count and typical chunk duration
    // This is approximate since we don't decode chunks just to measure duration
    const avgChunkDurationMs = 100; // Assume ~100ms per chunk
    return this.buffer.length * avgChunkDurationMs;
  }

  /**
   * Get current playback state
   */
  get state(): {
    isPlaying: boolean;
    bufferLength: number;
    bufferDurationMs: number;
    volume: number;
  } {
    return {
      isPlaying: this.isPlaying,
      bufferLength: this.buffer.length,
      bufferDurationMs: this.getBufferDurationMs(),
      volume: this.volume
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    
    this.audioContext = null;
    this.gainNode = null;
  }
}
