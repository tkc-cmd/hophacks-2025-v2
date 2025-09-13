import { EventEmitter } from 'events';

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
  modelId: string;
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
}

export interface TTSChunk {
  audio: Buffer;
  isComplete: boolean;
}

/**
 * ElevenLabs Streaming Text-to-Speech Client
 * 
 * Handles real-time TTS with pause/resume capabilities for barge-in support.
 * Emits 'chunk', 'complete', 'error' events.
 */
export class ElevenLabsTTSClient extends EventEmitter {
  private config: ElevenLabsConfig;
  private currentStream: AbortController | null = null;
  private isPaused = false;
  private pendingText: string[] = [];

  constructor(config: Partial<ElevenLabsConfig> = {}) {
    super();
    
    this.config = {
      apiKey: process.env.ELEVENLABS_API_KEY || '',
      voiceId: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM', // Rachel voice
      modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5',
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.0,
      useSpeakerBoost: true,
      ...config
    };

    if (!this.config.apiKey) {
      throw new Error('ElevenLabs API key is required');
    }
  }

  /**
   * Convert text to speech with streaming
   */
  async synthesize(text: string): Promise<void> {
    if (!text.trim()) {
      return;
    }

    // If paused, queue the text
    if (this.isPaused) {
      this.pendingText.push(text);
      return;
    }

    try {
      await this.streamTTS(text);
    } catch (error) {
      console.error('TTS synthesis error:', error);
      this.emit('error', error);
    }
  }

  /**
   * Pause current synthesis (for barge-in)
   */
  pause(): void {
    this.isPaused = true;
    
    if (this.currentStream) {
      this.currentStream.abort();
      this.currentStream = null;
    }
  }

  /**
   * Resume synthesis with any pending text
   */
  async resume(): Promise<void> {
    this.isPaused = false;

    // Process any pending text
    while (this.pendingText.length > 0 && !this.isPaused) {
      const text = this.pendingText.shift()!;
      try {
        await this.streamTTS(text);
      } catch (error) {
        console.error('TTS resume error:', error);
        this.emit('error', error);
        break;
      }
    }
  }

  /**
   * Stop current synthesis and clear pending text
   */
  stop(): void {
    this.isPaused = true;
    this.pendingText = [];
    
    if (this.currentStream) {
      this.currentStream.abort();
      this.currentStream = null;
    }
  }

  /**
   * Clear pending text without stopping current synthesis
   */
  clearPending(): void {
    this.pendingText = [];
  }

  private async streamTTS(text: string): Promise<void> {
    this.currentStream = new AbortController();

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.config.voiceId}/stream`;
    
    const requestBody = {
      text: text.trim(),
      model_id: this.config.modelId,
      voice_settings: {
        stability: this.config.stability,
        similarity_boost: this.config.similarityBoost,
        style: this.config.style,
        use_speaker_boost: this.config.useSpeakerBoost
      }
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.config.apiKey
        },
        body: JSON.stringify(requestBody),
        signal: this.currentStream.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body from ElevenLabs API');
      }

      const reader = response.body.getReader();
      let totalBytes = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            this.emit('complete', { totalBytes });
            break;
          }

          if (this.isPaused) {
            reader.cancel();
            break;
          }

          totalBytes += value.length;
          
          this.emit('chunk', {
            audio: Buffer.from(value),
            isComplete: false
          });
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // Stream was intentionally aborted (pause/stop)
        return;
      }
      throw error;
    } finally {
      this.currentStream = null;
    }
  }

  /**
   * Get current status
   */
  get status(): { isPaused: boolean; hasPending: boolean; isActive: boolean } {
    return {
      isPaused: this.isPaused,
      hasPending: this.pendingText.length > 0,
      isActive: this.currentStream !== null
    };
  }

  /**
   * Convert MP3 audio to PCM for web audio
   */
  static async convertMp3ToPcm(mp3Buffer: Buffer): Promise<Buffer> {
    // TODO: Implement MP3 to PCM conversion
    // For now, return the buffer as-is (client will handle decoding)
    // In production, you might want to use ffmpeg or similar
    return mp3Buffer;
  }
}

/**
 * Audio crossfade utility for smooth barge-in transitions
 */
export class AudioCrossfader {
  private fadeInDuration: number;
  private fadeOutDuration: number;

  constructor(fadeInMs: number = 100, fadeOutMs: number = 200) {
    this.fadeInDuration = fadeInMs;
    this.fadeOutDuration = fadeOutMs;
  }

  /**
   * Apply fade-out to audio buffer for barge-in
   */
  fadeOut(audioBuffer: Buffer, sampleRate: number = 24000): Buffer {
    // Convert to 16-bit PCM samples
    const samples = new Int16Array(audioBuffer.buffer);
    const fadeSamples = Math.floor((this.fadeOutDuration / 1000) * sampleRate);
    
    for (let i = 0; i < Math.min(fadeSamples, samples.length); i++) {
      const fadeMultiplier = 1 - (i / fadeSamples);
      samples[i] = Math.floor(samples[i] * fadeMultiplier);
    }

    return Buffer.from(samples.buffer);
  }

  /**
   * Apply fade-in to audio buffer
   */
  fadeIn(audioBuffer: Buffer, sampleRate: number = 24000): Buffer {
    const samples = new Int16Array(audioBuffer.buffer);
    const fadeSamples = Math.floor((this.fadeInDuration / 1000) * sampleRate);
    
    for (let i = 0; i < Math.min(fadeSamples, samples.length); i++) {
      const fadeMultiplier = i / fadeSamples;
      samples[i] = Math.floor(samples[i] * fadeMultiplier);
    }

    return Buffer.from(samples.buffer);
  }
}

/**
 * Factory function to create a configured ElevenLabs client
 */
export function createElevenLabsClient(config?: Partial<ElevenLabsConfig>): ElevenLabsTTSClient {
  return new ElevenLabsTTSClient(config);
}
