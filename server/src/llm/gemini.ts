import { GoogleGenerativeAI, GenerativeModel, ChatSession } from '@google/generative-ai';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

export interface GeminiConfig {
  apiKey: string;
  model: string;
  temperature: number;
  topP: number;
  topK: number;
  maxOutputTokens: number;
}

export interface FunctionCall {
  name: string;
  args: Record<string, any>;
}

export interface StreamChunk {
  text: string;
  isSentenceComplete: boolean;
  functionCall?: FunctionCall;
}

/**
 * Gemini LLM Client with streaming and function calling support
 */
export class GeminiClient extends EventEmitter {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;
  private chat: ChatSession | null = null;
  private config: GeminiConfig;
  private systemPrompt: string = '';
  private conversationHistory: any[] = [];

  constructor(config: Partial<GeminiConfig> = {}) {
    super();
    
    this.config = {
      apiKey: process.env.GOOGLE_API_KEY || '',
      model: 'gemini-1.5-flash',
      temperature: 0.7,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 1024,
      ...config
    };

    if (!this.config.apiKey) {
      throw new Error('Google API key is required');
    }

    this.genAI = new GoogleGenerativeAI(this.config.apiKey);
    // Initialize model asynchronously
    this.initializeModel().catch(error => {
      console.error('Failed to initialize Gemini model:', error);
    });
  }

  private async initializeModel(): Promise<void> {
    // Load system prompt
    await this.loadSystemPrompt();

    // Define function tools for pharmacy operations
    const tools = [{
      functionDeclarations: [
        {
          name: 'refill_service.placeRefill',
          description: 'Place a prescription refill order',
          parameters: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Patient full name'
              },
              dob: {
                type: 'string',
                description: 'Patient date of birth in MM/DD/YYYY format'
              },
              med: {
                type: 'string',
                description: 'Medication name'
              },
              dose: {
                type: 'string',
                description: 'Medication dosage'
              },
              qty: {
                type: 'number',
                description: 'Quantity (optional)'
              },
              pharmacy: {
                type: 'string',
                description: 'Pharmacy location'
              },
              phone: {
                type: 'string',
                description: 'Phone number (optional)'
              }
            },
            required: ['name', 'dob', 'med', 'dose', 'pharmacy']
          }
        },
        {
          name: 'drug_info.checkInteractions',
          description: 'Check for drug interactions and contraindications',
          parameters: {
            type: 'object',
            properties: {
              meds: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of current medications'
              },
              conditions: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of medical conditions (optional)'
              }
            },
            required: ['meds']
          }
        },
        {
          name: 'drug_info.getAdministrationGuide',
          description: 'Get administration guidance for a medication',
          parameters: {
            type: 'object',
            properties: {
              med: {
                type: 'string',
                description: 'Medication name'
              }
            },
            required: ['med']
          }
        }
      ]
    }];

    this.model = this.genAI.getGenerativeModel({
      model: this.config.model,
      generationConfig: {
        temperature: this.config.temperature,
        topP: this.config.topP,
        topK: this.config.topK,
        maxOutputTokens: this.config.maxOutputTokens,
      },
      tools,
      safetySettings: [
        {
          category: 'HARM_CATEGORY_MEDICAL',
          threshold: 'BLOCK_MEDIUM_AND_ABOVE',
        },
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_MEDIUM_AND_ABOVE',
        },
      ],
    });
  }

  private async loadSystemPrompt(): Promise<void> {
    try {
      // Try to load from docs directory first
      const promptPath = path.join(process.cwd(), '..', 'docs', 'SYSTEM_PROMPT.md');
      this.systemPrompt = await fs.readFile(promptPath, 'utf-8');
    } catch {
      // Fall back to embedded prompt
      this.systemPrompt = this.getDefaultSystemPrompt();
    }
  }

  /**
   * Start a new conversation session
   */
  startConversation(): void {
    if (!this.model) {
      console.warn('Gemini model not yet initialized, retrying in 1 second...');
      setTimeout(() => this.startConversation(), 1000);
      return;
    }
    
    this.chat = this.model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: this.systemPrompt }],
        },
        {
          role: 'model',
          parts: [{ text: 'I understand. I\'m ready to assist with pharmacy operations while maintaining safety and HIPAA awareness.' }],
        }
      ],
    });
    this.conversationHistory = [];
  }

  /**
   * Send a message and get streaming response
   */
  async sendMessage(message: string): Promise<void> {
    if (!this.chat) {
      this.startConversation();
    }

    try {
      // Add disclaimer to first response of each session
      const isFirstMessage = this.conversationHistory.length === 0;
      
      this.conversationHistory.push({ role: 'user', content: message });

      const result = await this.chat!.sendMessageStream(message);
      
      let fullResponse = '';
      let currentSentence = '';

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        fullResponse += chunkText;
        currentSentence += chunkText;

        // Check for function calls
        const functionCalls = chunk.functionCalls();
        if (functionCalls && functionCalls.length > 0) {
          for (const call of functionCalls) {
            this.emit('functionCall', {
              name: call.name,
              args: call.args
            });
          }
        }

        // Detect sentence boundaries for TTS chunking
        const sentenceBoundary = /[.!?]+\s+/;
        const sentences = currentSentence.split(sentenceBoundary);
        
        if (sentences.length > 1) {
          // We have at least one complete sentence
          for (let i = 0; i < sentences.length - 1; i++) {
            const sentence = sentences[i].trim();
            if (sentence) {
              // Add disclaimer to first sentence if this is the first message
              const finalSentence = (isFirstMessage && i === 0) 
                ? `I'm an automated pharmacy assistant and can't provide medical diagnoses. In emergencies call your local emergency number. ${sentence}`
                : sentence;

              this.emit('chunk', {
                text: finalSentence + '. ',
                isSentenceComplete: true
              });
            }
          }
          currentSentence = sentences[sentences.length - 1];
        } else {
          // No complete sentence yet, emit partial
          this.emit('chunk', {
            text: chunkText,
            isSentenceComplete: false
          });
        }
      }

      // Handle any remaining text
      if (currentSentence.trim()) {
        this.emit('chunk', {
          text: currentSentence.trim(),
          isSentenceComplete: true
        });
      }

      this.conversationHistory.push({ role: 'assistant', content: fullResponse });
      this.emit('complete', fullResponse);

    } catch (error) {
      console.error('Gemini API error:', error);
      this.emit('error', error);
    }
  }

  /**
   * Handle function call results
   */
  async handleFunctionResult(functionName: string, result: any): Promise<void> {
    if (!this.chat) {
      throw new Error('No active chat session');
    }

    try {
      // Send function result back to the model
      const functionResponse = [{
        functionResponse: {
          name: functionName,
          response: result
        }
      }];

      const result2 = await this.chat.sendMessageStream(functionResponse);
      
      let fullResponse = '';
      let currentSentence = '';

      for await (const chunk of result2.stream) {
        const chunkText = chunk.text();
        fullResponse += chunkText;
        currentSentence += chunkText;

        // Detect sentence boundaries
        const sentenceBoundary = /[.!?]+\s+/;
        const sentences = currentSentence.split(sentenceBoundary);
        
        if (sentences.length > 1) {
          for (let i = 0; i < sentences.length - 1; i++) {
            const sentence = sentences[i].trim();
            if (sentence) {
              this.emit('chunk', {
                text: sentence + '. ',
                isSentenceComplete: true
              });
            }
          }
          currentSentence = sentences[sentences.length - 1];
        } else {
          this.emit('chunk', {
            text: chunkText,
            isSentenceComplete: false
          });
        }
      }

      if (currentSentence.trim()) {
        this.emit('chunk', {
          text: currentSentence.trim(),
          isSentenceComplete: true
        });
      }

      this.emit('complete', fullResponse);

    } catch (error) {
      console.error('Function result error:', error);
      this.emit('error', error);
    }
  }

  /**
   * Get conversation history
   */
  getHistory(): any[] {
    return [...this.conversationHistory];
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
    this.chat = null;
  }

  private getDefaultSystemPrompt(): string {
    return `You are an automated pharmacy voice assistant for refills, interaction checks, and administration guidance. You are not a doctor or pharmacist. You must be concise, polite, and proactive about safety.

CORE RULES:
- If a user asks for diagnosis, new prescriptions, controlled substances, or anything beyond scope, decline and suggest speaking to a licensed professional
- Always verify identity before discussing PHI by asking for full name and date of birth
- For refills, gather medication name, dosage, quantity, pharmacy location, and contact info
- For interaction checks, ask for all current meds and significant conditions; surface only high-signal cautions
- Encourage speaking to a pharmacist or prescriber for clinical decisions
- In an emergency, instruct to call local emergency services immediately
- Keep responses under 120 words per turn
- Use simple, clear language

AVAILABLE TOOLS:
- refill_service.placeRefill: Place prescription refills
- drug_info.checkInteractions: Check drug interactions and contraindications  
- drug_info.getAdministrationGuide: Get medication administration guidance

SAFETY DISCLAIMERS:
- Always include safety disclaimers when providing drug information
- Remind users this is not medical advice
- Encourage consultation with healthcare professionals for clinical questions`;
  }
}
