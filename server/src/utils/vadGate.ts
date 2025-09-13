/**
 * Voice Activity Detection (VAD) Gate
 * 
 * Simple energy-based VAD for detecting speech activity and implementing barge-in
 */

export interface VADConfig {
  energyThreshold: number;
  silenceTimeoutMs: number;
  speechTimeoutMs: number;
  windowSizeMs: number;
  sampleRate: number;
}

export interface VADResult {
  isSpeech: boolean;
  energy: number;
  confidence: number;
  timestamp: number;
}

export class VADGate {
  private config: VADConfig;
  private energyBuffer: number[] = [];
  private lastSpeechTime: number = 0;
  private lastSilenceTime: number = 0;
  private isSpeaking: boolean = false;
  private backgroundNoise: number = 0;
  private noiseAdaptationRate: number = 0.95;

  constructor(config: Partial<VADConfig> = {}) {
    this.config = {
      energyThreshold: 0.01, // Adjust based on environment
      silenceTimeoutMs: 1000, // 1 second of silence to stop
      speechTimeoutMs: 100, // 100ms of speech to start
      windowSizeMs: 50, // 50ms analysis window
      sampleRate: 16000,
      ...config
    };
  }

  /**
   * Process audio chunk and detect voice activity
   */
  processAudio(audioData: Buffer): VADResult {
    const energy = this.calculateEnergy(audioData);
    const timestamp = Date.now();
    
    // Adapt to background noise
    if (!this.isSpeaking) {
      this.backgroundNoise = this.backgroundNoise * this.noiseAdaptationRate + 
                            energy * (1 - this.noiseAdaptationRate);
    }

    // Calculate adaptive threshold
    const adaptiveThreshold = Math.max(
      this.config.energyThreshold,
      this.backgroundNoise * 2
    );

    const isSpeech = energy > adaptiveThreshold;
    const confidence = Math.min(1, energy / (adaptiveThreshold * 2));

    // State machine for speech detection
    if (isSpeech) {
      this.lastSpeechTime = timestamp;
      
      // Start speaking if we've had enough consecutive speech
      if (!this.isSpeaking && 
          timestamp - this.lastSilenceTime > this.config.speechTimeoutMs) {
        this.isSpeaking = true;
      }
    } else {
      this.lastSilenceTime = timestamp;
      
      // Stop speaking if we've had enough consecutive silence
      if (this.isSpeaking && 
          timestamp - this.lastSpeechTime > this.config.silenceTimeoutMs) {
        this.isSpeaking = false;
      }
    }

    return {
      isSpeech: this.isSpeaking,
      energy,
      confidence,
      timestamp
    };
  }

  /**
   * Calculate RMS energy of audio data
   */
  private calculateEnergy(audioData: Buffer): number {
    const samples = new Int16Array(audioData.buffer);
    let sum = 0;
    
    for (let i = 0; i < samples.length; i++) {
      const normalized = samples[i] / 32768; // Normalize to [-1, 1]
      sum += normalized * normalized;
    }
    
    return Math.sqrt(sum / samples.length);
  }

  /**
   * Reset VAD state
   */
  reset(): void {
    this.energyBuffer = [];
    this.lastSpeechTime = 0;
    this.lastSilenceTime = 0;
    this.isSpeaking = false;
    this.backgroundNoise = 0;
  }

  /**
   * Get current VAD state
   */
  get state(): {
    isSpeaking: boolean;
    backgroundNoise: number;
    lastSpeechTime: number;
    lastSilenceTime: number;
  } {
    return {
      isSpeaking: this.isSpeaking,
      backgroundNoise: this.backgroundNoise,
      lastSpeechTime: this.lastSpeechTime,
      lastSilenceTime: this.lastSilenceTime
    };
  }

  /**
   * Update VAD configuration
   */
  updateConfig(newConfig: Partial<VADConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}

/**
 * Barge-in Detection System
 * 
 * Uses VAD to detect when user starts speaking while TTS is playing
 */
export class BargeInDetector {
  private vad: VADGate;
  private isPlayingTTS: boolean = false;
  private bargeInThreshold: number;
  private consecutiveSpeechFrames: number = 0;
  private minConsecutiveFrames: number;

  constructor(vadConfig?: Partial<VADConfig>, bargeInThreshold: number = 0.02) {
    this.vad = new VADGate(vadConfig);
    this.bargeInThreshold = bargeInThreshold;
    this.minConsecutiveFrames = 3; // Require 3 consecutive frames to trigger barge-in
  }

  /**
   * Process audio and detect barge-in events
   */
  processAudio(audioData: Buffer): {
    shouldBargeIn: boolean;
    vadResult: VADResult;
  } {
    const vadResult = this.vad.processAudio(audioData);
    
    let shouldBargeIn = false;

    if (this.isPlayingTTS) {
      if (vadResult.isSpeech && vadResult.energy > this.bargeInThreshold) {
        this.consecutiveSpeechFrames++;
        
        if (this.consecutiveSpeechFrames >= this.minConsecutiveFrames) {
          shouldBargeIn = true;
        }
      } else {
        this.consecutiveSpeechFrames = 0;
      }
    }

    return { shouldBargeIn, vadResult };
  }

  /**
   * Set TTS playback state
   */
  setTTSPlayback(isPlaying: boolean): void {
    this.isPlayingTTS = isPlaying;
    if (!isPlaying) {
      this.consecutiveSpeechFrames = 0;
    }
  }

  /**
   * Reset barge-in detector
   */
  reset(): void {
    this.vad.reset();
    this.consecutiveSpeechFrames = 0;
    this.isPlayingTTS = false;
  }

  /**
   * Get current state
   */
  get state(): {
    isPlayingTTS: boolean;
    consecutiveSpeechFrames: number;
    vadState: any;
  } {
    return {
      isPlayingTTS: this.isPlayingTTS,
      consecutiveSpeechFrames: this.consecutiveSpeechFrames,
      vadState: this.vad.state
    };
  }
}
