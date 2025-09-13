import { WebSocketServer, WebSocket } from 'ws';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { createSession, getSession, extendSession, SessionData } from './domain/sessions/sessionStore.js';
import { logAuditEvent } from './middleware/phiGuard.js';
import { createDeepgramClient, DeepgramSTTClient } from './stt/deepgram.js';
import { GeminiClient } from './llm/gemini.js';
import { createElevenLabsClient, ElevenLabsTTSClient } from './tts/elevenlabs.js';
import { DrugInfoService, DrugInfoProvider } from './domain/drugInfo/service.js';
import { MockDrugInfoProvider } from './domain/drugInfo/mockProvider.js';
import { RefillService } from './domain/refill/refillService.js';
import { BargeInDetector } from './utils/vadGate.js';
import { AudioChunker } from './utils/audioChunker.js';

// WebSocket message types
export interface WSMessage {
  type: string;
  [key: string]: any;
}

// Client session state
interface ClientSession {
  id: string;
  ws: WebSocket;
  sessionData: SessionData | null;
  deepgram: DeepgramSTTClient | null;
  gemini: GeminiClient | null;
  elevenlabs: ElevenLabsTTSClient | null;
  bargeInDetector: BargeInDetector;
  audioChunker: AudioChunker;
  isRecording: boolean;
  isTTSPlaying: boolean;
  lastActivity: number;
}

export function setupWebSocketServer(wss: WebSocketServer, prisma: PrismaClient): void {
  const sessions = new Map<string, ClientSession>();
  const drugInfoService = new DrugInfoService([new MockDrugInfoProvider()]);
  const refillService = new RefillService();

  // Cleanup inactive sessions every 5 minutes
  setInterval(() => {
    const now = Date.now();
    const timeout = 10 * 60 * 1000; // 10 minutes

    for (const [sessionId, session] of sessions.entries()) {
      if (now - session.lastActivity > timeout) {
        console.log(`Cleaning up inactive session: ${sessionId}`);
        cleanupSession(sessionId, sessions);
      }
    }
  }, 5 * 60 * 1000);

  wss.on('connection', (ws: WebSocket) => {
    const sessionId = uuidv4();
    console.log(`🔌 New WebSocket connection: ${sessionId}`);

    // Initialize client session
    const clientSession: ClientSession = {
      id: sessionId,
      ws,
      sessionData: null,
      deepgram: null,
      gemini: null,
      elevenlabs: null,
      bargeInDetector: new BargeInDetector(),
      audioChunker: new AudioChunker(100, 16000, 1, 2), // 100ms chunks, 16kHz, mono, 16-bit
      isRecording: false,
      isTTSPlaying: false,
      lastActivity: Date.now()
    };

    sessions.set(sessionId, clientSession);

    // Send initial connection message
    sendMessage(ws, {
      type: 'status',
      message: 'Connected to pharmacy voice agent'
    });

    ws.on('message', async (data: Buffer) => {
      try {
        clientSession.lastActivity = Date.now();
        await handleMessage(sessionId, data, sessions, drugInfoService, refillService);
      } catch (error) {
        console.error('WebSocket message error:', error);
        sendMessage(ws, {
          type: 'error',
          code: 'MESSAGE_ERROR',
          message: 'Failed to process message'
        });
      }
    });

    ws.on('close', () => {
      console.log(`🔌 WebSocket disconnected: ${sessionId}`);
      cleanupSession(sessionId, sessions);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for session ${sessionId}:`, error);
      cleanupSession(sessionId, sessions);
    });
  });
}

async function handleMessage(
  sessionId: string,
  data: Buffer,
  sessions: Map<string, ClientSession>,
  drugInfoService: DrugInfoService,
  refillService: RefillService
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  try {
    // Try to parse as JSON first
    const message: WSMessage = JSON.parse(data.toString());
    await handleJSONMessage(session, message, drugInfoService, refillService);
  } catch {
    // If not JSON, treat as binary audio data
    if (session.isRecording && session.deepgram) {
      await handleAudioData(session, data);
    }
  }
}

async function handleJSONMessage(
  session: ClientSession,
  message: WSMessage,
  drugInfoService: DrugInfoService,
  refillService: RefillService
): Promise<void> {
  switch (message.type) {
    case 'auth':
      await handleAuth(session, message.token);
      break;

    case 'audio.start':
      await handleAudioStart(session, message);
      break;

    case 'audio.stop':
      await handleAudioStop(session);
      break;

    case 'ui.interrupt':
      await handleBargeIn(session);
      break;

    default:
      sendMessage(session.ws, {
        type: 'error',
        code: 'UNKNOWN_MESSAGE_TYPE',
        message: `Unknown message type: ${message.type}`
      });
  }
}

async function handleAuth(session: ClientSession, token?: string): Promise<void> {
  try {
    let sessionData: SessionData;

    if (token) {
      // Validate existing token
      const existing = await getSession(token);
      if (existing) {
        sessionData = await extendSession(token) || existing;
      } else {
        // Invalid token, create new session
        sessionData = await createSession();
      }
    } else {
      // Create new session
      sessionData = await createSession();
    }

    session.sessionData = sessionData;

    sendMessage(session.ws, {
      type: 'auth.success',
      token: sessionData.token,
      sessionId: sessionData.id
    });

    await logAuditEvent(sessionData.id, 'session_start', {
      clientSessionId: session.id,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Auth error:', error);
    sendMessage(session.ws, {
      type: 'error',
      code: 'AUTH_FAILED',
      message: 'Authentication failed'
    });
  }
}

async function handleAudioStart(session: ClientSession, message: any): Promise<void> {
  if (!session.sessionData) {
    sendMessage(session.ws, {
      type: 'error',
      code: 'NOT_AUTHENTICATED',
      message: 'Please authenticate first'
    });
    return;
  }

  try {
    // Initialize Deepgram if not already done
    if (!session.deepgram) {
      session.deepgram = createDeepgramClient({
        sampleRate: message.sampleRate || 16000,
        encoding: message.encoding || 'linear16'
      });

      // Set up Deepgram event handlers
      session.deepgram.on('transcript', (result) => {
        handleTranscriptResult(session, result);
      });

      session.deepgram.on('error', (error) => {
        console.error('Deepgram error:', error);
        sendMessage(session.ws, {
          type: 'error',
          code: 'STT_ERROR',
          message: 'Speech recognition error'
        });
      });

      await session.deepgram.connect();
    }

    // Initialize Gemini if not already done
    if (!session.gemini) {
      session.gemini = new GeminiClient();
      
      session.gemini.on('chunk', (chunk) => {
        handleLLMChunk(session, chunk);
      });

      session.gemini.on('functionCall', (functionCall) => {
        handleFunctionCall(session, functionCall, drugInfoService, refillService);
      });

      session.gemini.on('error', (error) => {
        console.error('Gemini error:', error);
        sendMessage(session.ws, {
          type: 'error',
          code: 'LLM_ERROR',
          message: 'AI processing error'
        });
      });

      session.gemini.startConversation();
    }

    // Initialize ElevenLabs if not already done
    if (!session.elevenlabs) {
      session.elevenlabs = createElevenLabsClient();

      session.elevenlabs.on('chunk', (chunk) => {
        handleTTSChunk(session, chunk);
      });

      session.elevenlabs.on('complete', () => {
        session.isTTSPlaying = false;
        session.bargeInDetector.setTTSPlayback(false);
        sendMessage(session.ws, { type: 'tts.end' });
      });

      session.elevenlabs.on('error', (error) => {
        console.error('ElevenLabs error:', error);
        session.isTTSPlaying = false;
        session.bargeInDetector.setTTSPlayback(false);
        sendMessage(session.ws, {
          type: 'error',
          code: 'TTS_ERROR',
          message: 'Text-to-speech error'
        });
      });
    }

    session.isRecording = true;
    session.audioChunker.reset();

    sendMessage(session.ws, {
      type: 'audio.started',
      sampleRate: message.sampleRate || 16000
    });

  } catch (error) {
    console.error('Audio start error:', error);
    sendMessage(session.ws, {
      type: 'error',
      code: 'AUDIO_START_ERROR',
      message: 'Failed to start audio processing'
    });
  }
}

async function handleAudioData(session: ClientSession, audioData: Buffer): Promise<void> {
  if (!session.deepgram || !session.isRecording) {
    return;
  }

  // Process audio chunks
  const chunks = session.audioChunker.addData(audioData);
  
  for (const chunk of chunks) {
    // Send to Deepgram
    session.deepgram.sendAudio(chunk.data);

    // Check for barge-in
    const { shouldBargeIn } = session.bargeInDetector.processAudio(chunk.data);
    
    if (shouldBargeIn && session.isTTSPlaying) {
      await handleBargeIn(session);
    }
  }
}

async function handleAudioStop(session: ClientSession): Promise<void> {
  session.isRecording = false;

  if (session.deepgram) {
    session.deepgram.finalize();
  }

  // Flush any remaining audio
  const finalChunk = session.audioChunker.flush();
  if (finalChunk && session.deepgram) {
    session.deepgram.sendAudio(finalChunk.data);
  }

  sendMessage(session.ws, { type: 'audio.stopped' });
}

async function handleBargeIn(session: ClientSession): Promise<void> {
  if (session.elevenlabs && session.isTTSPlaying) {
    session.elevenlabs.pause();
    session.isTTSPlaying = false;
    session.bargeInDetector.setTTSPlayback(false);
    
    sendMessage(session.ws, {
      type: 'status',
      message: 'Barge-in detected, pausing speech'
    });
  }
}

function handleTranscriptResult(session: ClientSession, result: any): void {
  const messageType = result.is_final ? 'stt.final' : 'stt.partial';
  
  sendMessage(session.ws, {
    type: messageType,
    text: result.transcript,
    confidence: result.confidence
  });

  // Send final transcripts to Gemini for processing
  if (result.is_final && result.transcript.trim() && session.gemini) {
    session.gemini.sendMessage(result.transcript);
  }
}

function handleLLMChunk(session: ClientSession, chunk: any): void {
  sendMessage(session.ws, {
    type: 'llm.partial',
    text: chunk.text,
    sentenceReady: chunk.isSentenceComplete
  });

  // Send complete sentences to TTS
  if (chunk.isSentenceComplete && chunk.text.trim() && session.elevenlabs) {
    session.elevenlabs.synthesize(chunk.text);
    session.isTTSPlaying = true;
    session.bargeInDetector.setTTSPlayback(true);
  }
}

async function handleFunctionCall(
  session: ClientSession,
  functionCall: any,
  drugInfoService: DrugInfoService,
  refillService: RefillService
): Promise<void> {
  if (!session.sessionData) {
    return;
  }

  try {
    let result: any;

    switch (functionCall.name) {
      case 'refill_service.placeRefill':
        result = await refillService.placeRefill(session.sessionData.id, {
          patientName: functionCall.args.name,
          dateOfBirth: functionCall.args.dob,
          phoneNumber: functionCall.args.phone,
          medicationName: functionCall.args.med,
          dosage: functionCall.args.dose,
          quantity: functionCall.args.qty,
          pharmacyLocation: functionCall.args.pharmacy
        });
        break;

      case 'drug_info.checkInteractions':
        const alerts = await drugInfoService.checkInteractions(
          functionCall.args.meds,
          functionCall.args.conditions || []
        );
        result = { alerts };
        
        // Log interaction check
        await logAuditEvent(session.sessionData.id, 'interaction_check', {
          medications: functionCall.args.meds,
          conditions: functionCall.args.conditions,
          alertCount: alerts.length
        });
        break;

      case 'drug_info.getAdministrationGuide':
        const guide = await drugInfoService.getAdministrationGuide(functionCall.args.med);
        result = guide || { error: 'No administration guide found' };
        
        await logAuditEvent(session.sessionData.id, 'admin_advice', {
          medication: functionCall.args.med
        });
        break;

      default:
        result = { error: 'Unknown function' };
    }

    // Send result back to Gemini
    if (session.gemini) {
      await session.gemini.handleFunctionResult(functionCall.name, result);
    }

  } catch (error) {
    console.error('Function call error:', error);
    if (session.gemini) {
      await session.gemini.handleFunctionResult(functionCall.name, { 
        error: 'Function execution failed' 
      });
    }
  }
}

function handleTTSChunk(session: ClientSession, chunk: any): void {
  // Convert audio to base64 for transmission
  const audioBase64 = chunk.audio.toString('base64');
  
  sendMessage(session.ws, {
    type: 'tts.chunk',
    data: audioBase64
  });
}

function sendMessage(ws: WebSocket, message: any): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function cleanupSession(sessionId: string, sessions: Map<string, ClientSession>): void {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  // Cleanup resources
  if (session.deepgram) {
    session.deepgram.disconnect();
  }

  if (session.elevenlabs) {
    session.elevenlabs.stop();
  }

  if (session.gemini) {
    session.gemini.clearHistory();
  }

  sessions.delete(sessionId);
}
