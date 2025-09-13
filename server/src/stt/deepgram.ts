import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface DeepgramConfig {
  apiKey: string;
  model: string;
  language: string;
  sampleRate: number;
  encoding: string;
  channels: number;
  interimResults: boolean;
  endpointing: boolean;
  punctuation: boolean;
  profanityFilter: boolean;
  redaction: string[];
}

export interface TranscriptResult {
  transcript: string;
  confidence: number;
  is_final: boolean;
  speech_final: boolean;
}

/**
 * Deepgram Streaming Speech-to-Text Client
 * 
 * Handles real-time transcription with interim results and endpointing.
 * Emits 'transcript', 'error', 'open', 'close' events.
 */
export class DeepgramSTTClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: DeepgramConfig;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 1000;

  constructor(config: Partial<DeepgramConfig> = {}) {
    super();
    
    this.config = {
      apiKey: process.env.DEEPGRAM_API_KEY || '',
      model: process.env.DEEPGRAM_MODEL || 'nova-2',
      language: process.env.DEEPGRAM_LANGUAGE || 'en-US',
      sampleRate: 16000,
      encoding: 'linear16',
      channels: 1,
      interimResults: true,
      endpointing: true,
      punctuation: true,
      profanityFilter: false,
      redaction: ['pci', 'numbers'], // Redact sensitive information
      ...config
    };

    if (!this.config.apiKey) {
      throw new Error('Deepgram API key is required');
    }
  }

  /**
   * Connect to Deepgram streaming API
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    const url = this.buildWebSocketUrl();
    
    try {
      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Token ${this.config.apiKey}`
        }
      });

      this.setupWebSocketHandlers();
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

        this.ws!.once('open', () => {
          clearTimeout(timeout);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.emit('open');
          resolve();
        });

        this.ws!.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error) {
      throw new Error(`Failed to connect to Deepgram: ${error}`);
    }
  }

  /**
   * Send audio data to Deepgram
   */
  sendAudio(audioBuffer: Buffer): void {
    if (!this.isConnected || !this.ws) {
      console.warn('Deepgram not connected, dropping audio data');
      return;
    }

    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(audioBuffer);
    }
  }

  /**
   * Send keep-alive message
   */
  sendKeepAlive(): void {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
    }
  }

  /**
   * Finalize the stream and get final results
   */
  finalize(): void {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'CloseStream' }));
    }
  }

  /**
   * Disconnect from Deepgram
   */
  disconnect(): void {
    this.isConnected = false;
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private buildWebSocketUrl(): string {
    const params = new URLSearchParams({
      model: this.config.model,
      language: this.config.language,
      sample_rate: this.config.sampleRate.toString(),
      encoding: this.config.encoding,
      channels: this.config.channels.toString(),
      interim_results: this.config.interimResults.toString(),
      endpointing: this.config.endpointing.toString(),
      punctuation: this.config.punctuation.toString(),
      profanity_filter: this.config.profanityFilter.toString(),
      redact: this.config.redaction.join(',')
    });

    return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  }

  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleDeepgramMessage(message);
      } catch (error) {
        console.error('Failed to parse Deepgram message:', error);
      }
    });

    this.ws.on('error', (error) => {
      console.error('Deepgram WebSocket error:', error);
      this.emit('error', error);
      this.handleReconnection();
    });

    this.ws.on('close', (code, reason) => {
      console.log('Deepgram WebSocket closed:', code, reason.toString());
      this.isConnected = false;
      this.emit('close', code, reason);
      
      if (code !== 1000) { // Not a normal closure
        this.handleReconnection();
      }
    });
  }

  private handleDeepgramMessage(message: any): void {
    if (message.type === 'Results') {
      const channel = message.channel;
      const alternatives = channel?.alternatives;
      
      if (alternatives && alternatives.length > 0) {
        const alternative = alternatives[0];
        const transcript = alternative.transcript;
        
        if (transcript && transcript.trim().length > 0) {
          const result: TranscriptResult = {
            transcript: transcript.trim(),
            confidence: alternative.confidence || 0,
            is_final: channel.is_final || false,
            speech_final: message.speech_final || false
          };
          
          this.emit('transcript', result);
        }
      }
    } else if (message.type === 'Metadata') {
      this.emit('metadata', message);
    } else if (message.type === 'SpeechStarted') {
      this.emit('speechStarted');
    } else if (message.type === 'UtteranceEnd') {
      this.emit('utteranceEnd');
    } else if (message.type === 'Error') {
      console.error('Deepgram error:', message);
      this.emit('error', new Error(message.description || 'Unknown Deepgram error'));
    }
  }

  private async handleReconnection(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.emit('error', new Error('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    console.log(`Attempting to reconnect to Deepgram (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(async () => {
      try {
        await this.connect();
        console.log('Successfully reconnected to Deepgram');
      } catch (error) {
        console.error('Reconnection failed:', error);
        this.handleReconnection();
      }
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  /**
   * Get connection status
   */
  get connected(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }
}

/**
 * Factory function to create a configured Deepgram client
 */
export function createDeepgramClient(config?: Partial<DeepgramConfig>): DeepgramSTTClient {
  return new DeepgramSTTClient(config);
}
