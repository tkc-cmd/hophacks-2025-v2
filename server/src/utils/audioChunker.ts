/**
 * Audio Chunker Utility
 * 
 * Handles audio chunking and buffering for real-time streaming
 */

export interface AudioChunk {
  data: Buffer;
  timestamp: number;
  sampleRate: number;
  channels: number;
  format: 'pcm16' | 'pcm32' | 'float32';
}

export class AudioChunker {
  private buffer: Buffer = Buffer.alloc(0);
  private chunkSize: number;
  private sampleRate: number;
  private channels: number;
  private bytesPerSample: number;

  constructor(
    chunkSizeMs: number = 100, // 100ms chunks by default
    sampleRate: number = 16000,
    channels: number = 1,
    bytesPerSample: number = 2 // 16-bit = 2 bytes per sample
  ) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.bytesPerSample = bytesPerSample;
    
    // Calculate chunk size in bytes
    const samplesPerChunk = Math.floor((chunkSizeMs / 1000) * sampleRate * channels);
    this.chunkSize = samplesPerChunk * bytesPerSample;
  }

  /**
   * Add audio data to the buffer and return complete chunks
   */
  addData(data: Buffer): AudioChunk[] {
    this.buffer = Buffer.concat([this.buffer, data]);
    
    const chunks: AudioChunk[] = [];
    
    while (this.buffer.length >= this.chunkSize) {
      const chunkData = this.buffer.subarray(0, this.chunkSize);
      this.buffer = this.buffer.subarray(this.chunkSize);
      
      chunks.push({
        data: chunkData,
        timestamp: Date.now(),
        sampleRate: this.sampleRate,
        channels: this.channels,
        format: 'pcm16'
      });
    }
    
    return chunks;
  }

  /**
   * Flush remaining buffered data as a final chunk
   */
  flush(): AudioChunk | null {
    if (this.buffer.length === 0) {
      return null;
    }

    const chunk: AudioChunk = {
      data: this.buffer,
      timestamp: Date.now(),
      sampleRate: this.sampleRate,
      channels: this.channels,
      format: 'pcm16'
    };

    this.buffer = Buffer.alloc(0);
    return chunk;
  }

  /**
   * Reset the buffer
   */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Get current buffer size in bytes
   */
  get bufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Get current buffer duration in milliseconds
   */
  get bufferDurationMs(): number {
    const totalSamples = this.buffer.length / this.bytesPerSample / this.channels;
    return (totalSamples / this.sampleRate) * 1000;
  }
}

/**
 * Audio Format Converter
 */
export class AudioConverter {
  /**
   * Convert between different audio formats
   */
  static convert(
    data: Buffer,
    fromFormat: 'pcm16' | 'pcm32' | 'float32',
    toFormat: 'pcm16' | 'pcm32' | 'float32'
  ): Buffer {
    if (fromFormat === toFormat) {
      return data;
    }

    // For now, implement basic PCM16 conversions
    // TODO: Add more comprehensive format conversion
    
    if (fromFormat === 'float32' && toFormat === 'pcm16') {
      return this.float32ToPcm16(data);
    }
    
    if (fromFormat === 'pcm16' && toFormat === 'float32') {
      return this.pcm16ToFloat32(data);
    }

    // Default: return as-is
    console.warn(`Audio conversion from ${fromFormat} to ${toFormat} not implemented`);
    return data;
  }

  private static float32ToPcm16(data: Buffer): Buffer {
    const floatArray = new Float32Array(data.buffer);
    const pcmArray = new Int16Array(floatArray.length);
    
    for (let i = 0; i < floatArray.length; i++) {
      // Clamp to [-1, 1] and convert to 16-bit
      const clamped = Math.max(-1, Math.min(1, floatArray[i]));
      pcmArray[i] = Math.round(clamped * 32767);
    }
    
    return Buffer.from(pcmArray.buffer);
  }

  private static pcm16ToFloat32(data: Buffer): Buffer {
    const pcmArray = new Int16Array(data.buffer);
    const floatArray = new Float32Array(pcmArray.length);
    
    for (let i = 0; i < pcmArray.length; i++) {
      floatArray[i] = pcmArray[i] / 32767;
    }
    
    return Buffer.from(floatArray.buffer);
  }
}

/**
 * Audio Resampler (basic implementation)
 */
export class AudioResampler {
  /**
   * Resample audio to target sample rate using linear interpolation
   */
  static resample(
    data: Buffer,
    fromSampleRate: number,
    toSampleRate: number,
    channels: number = 1
  ): Buffer {
    if (fromSampleRate === toSampleRate) {
      return data;
    }

    const inputSamples = new Int16Array(data.buffer);
    const samplesPerChannel = inputSamples.length / channels;
    const ratio = fromSampleRate / toSampleRate;
    const outputSamplesPerChannel = Math.floor(samplesPerChannel / ratio);
    const outputSamples = new Int16Array(outputSamplesPerChannel * channels);

    for (let ch = 0; ch < channels; ch++) {
      for (let i = 0; i < outputSamplesPerChannel; i++) {
        const sourceIndex = i * ratio;
        const sourceIndexFloor = Math.floor(sourceIndex);
        const sourceIndexCeil = Math.min(sourceIndexFloor + 1, samplesPerChannel - 1);
        const fraction = sourceIndex - sourceIndexFloor;

        const inputIndexFloor = sourceIndexFloor * channels + ch;
        const inputIndexCeil = sourceIndexCeil * channels + ch;
        
        const sample1 = inputSamples[inputIndexFloor] || 0;
        const sample2 = inputSamples[inputIndexCeil] || 0;
        
        // Linear interpolation
        const interpolated = sample1 + (sample2 - sample1) * fraction;
        outputSamples[i * channels + ch] = Math.round(interpolated);
      }
    }

    return Buffer.from(outputSamples.buffer);
  }
}
