/**
 * Sentence Boundary Detection Utility
 * 
 * Detects sentence boundaries in streaming text for optimal TTS chunking
 */

export interface SentenceBoundary {
  text: string;
  isComplete: boolean;
  confidence: number;
  type: 'sentence' | 'phrase' | 'clause';
}

export class SentenceBoundaryDetector {
  private buffer: string = '';
  private sentenceEndPattern: RegExp;
  private abbreviationPattern: RegExp;
  private minSentenceLength: number;

  constructor(minSentenceLength: number = 10) {
    this.minSentenceLength = minSentenceLength;
    
    // Pattern for sentence endings
    this.sentenceEndPattern = /[.!?]+\s+/g;
    
    // Common abbreviations that shouldn't end sentences
    this.abbreviationPattern = /\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|etc|Inc|Corp|Ltd|Co|St|Ave|Rd|Blvd|Apt|No|Ph\.D|M\.D|B\.A|M\.A|U\.S|U\.K|e\.g|i\.e|a\.m|p\.m)\./gi;
  }

  /**
   * Add text to buffer and extract complete sentences
   */
  addText(text: string): SentenceBoundary[] {
    this.buffer += text;
    return this.extractSentences();
  }

  /**
   * Extract complete sentences from buffer
   */
  private extractSentences(): SentenceBoundary[] {
    const sentences: SentenceBoundary[] = [];
    let workingText = this.buffer;

    // Find potential sentence boundaries
    const matches = Array.from(workingText.matchAll(this.sentenceEndPattern));
    
    for (const match of matches) {
      const endIndex = match.index! + match[0].length;
      const potentialSentence = workingText.substring(0, endIndex).trim();
      
      if (this.isValidSentence(potentialSentence)) {
        sentences.push({
          text: potentialSentence,
          isComplete: true,
          confidence: this.calculateConfidence(potentialSentence),
          type: this.classifySentence(potentialSentence)
        });
        
        workingText = workingText.substring(endIndex).trim();
      }
    }

    // Update buffer with remaining text
    this.buffer = workingText;
    
    return sentences;
  }

  /**
   * Check if a potential sentence is valid
   */
  private isValidSentence(text: string): boolean {
    // Too short
    if (text.length < this.minSentenceLength) {
      return false;
    }

    // Ends with abbreviation (likely not a sentence end)
    if (this.abbreviationPattern.test(text.trim())) {
      return false;
    }

    // Must contain at least one word character
    if (!/\w/.test(text)) {
      return false;
    }

    return true;
  }

  /**
   * Calculate confidence score for sentence boundary
   */
  private calculateConfidence(sentence: string): number {
    let confidence = 0.5; // Base confidence
    
    // Longer sentences are more likely to be complete
    if (sentence.length > 50) confidence += 0.2;
    if (sentence.length > 100) confidence += 0.1;
    
    // Sentences starting with capital letters
    if (/^[A-Z]/.test(sentence.trim())) confidence += 0.2;
    
    // Strong ending punctuation
    if (/[!?]$/.test(sentence.trim())) confidence += 0.1;
    
    // Contains subject and predicate indicators
    if (/\b(I|you|he|she|it|we|they|this|that)\b/i.test(sentence)) confidence += 0.1;
    if (/\b(is|are|was|were|have|has|had|will|would|can|could|should|must)\b/i.test(sentence)) confidence += 0.1;
    
    return Math.min(1.0, confidence);
  }

  /**
   * Classify the type of sentence/phrase
   */
  private classifySentence(text: string): 'sentence' | 'phrase' | 'clause' {
    // Question or exclamation
    if (/[!?]$/.test(text.trim())) {
      return 'sentence';
    }
    
    // Contains subject and verb
    if (this.hasSubjectAndVerb(text)) {
      return 'sentence';
    }
    
    // Contains conjunctions (likely a clause)
    if (/\b(and|but|or|because|since|although|while|if|when|where|that|which)\b/i.test(text)) {
      return 'clause';
    }
    
    // Default to phrase
    return 'phrase';
  }

  /**
   * Simple heuristic to detect subject and verb
   */
  private hasSubjectAndVerb(text: string): boolean {
    // Very basic check for common sentence patterns
    const subjectPattern = /\b(I|you|he|she|it|we|they|this|that|there|here|\w+s?)\b/i;
    const verbPattern = /\b(is|are|was|were|have|has|had|do|does|did|will|would|can|could|should|must|go|goes|went|come|comes|came|see|sees|saw|get|gets|got|take|takes|took|give|gives|gave|make|makes|made|think|thinks|thought|know|knows|knew|say|says|said|tell|tells|told|work|works|worked|play|plays|played|help|helps|helped|want|wants|wanted|need|needs|needed|like|likes|liked|love|loves|loved|try|tries|tried|use|uses|used|find|finds|found|look|looks|looked|feel|feels|felt|seem|seems|seemed|become|becomes|became|remain|remains|remained)\b/i;
    
    return subjectPattern.test(text) && verbPattern.test(text);
  }

  /**
   * Get remaining buffer text
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Flush remaining buffer as incomplete sentence
   */
  flush(): SentenceBoundary | null {
    if (this.buffer.trim().length === 0) {
      return null;
    }

    const result: SentenceBoundary = {
      text: this.buffer.trim(),
      isComplete: false,
      confidence: 0.3, // Low confidence for incomplete
      type: 'phrase'
    };

    this.buffer = '';
    return result;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer = '';
  }
}

/**
 * Utility functions for text processing
 */
export class TextProcessor {
  /**
   * Split text into optimal chunks for TTS
   */
  static chunkForTTS(text: string, maxChunkLength: number = 200): string[] {
    const detector = new SentenceBoundaryDetector();
    const sentences = detector.addText(text);
    
    // Add any remaining buffer
    const remaining = detector.flush();
    if (remaining) {
      sentences.push(remaining);
    }

    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.text.length <= maxChunkLength) {
        currentChunk += (currentChunk ? ' ' : '') + sentence.text;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        currentChunk = sentence.text;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Clean text for TTS (remove unwanted characters, normalize whitespace)
   */
  static cleanForTTS(text: string): string {
    return text
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Remove markdown formatting
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      // Remove URLs
      .replace(/https?:\/\/[^\s]+/g, '[link]')
      // Clean up punctuation spacing
      .replace(/\s+([,.!?;:])/g, '$1')
      .replace(/([.!?])\s*([A-Z])/g, '$1 $2')
      .trim();
  }

  /**
   * Estimate speaking time for text (words per minute)
   */
  static estimateSpeakingTime(text: string, wpm: number = 150): number {
    const words = text.split(/\s+/).length;
    return (words / wpm) * 60 * 1000; // Return milliseconds
  }
}
