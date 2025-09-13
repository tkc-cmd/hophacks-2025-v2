# Pharmacy Voice Agent Architecture

## System Overview

The Pharmacy Voice Agent is a real-time, streaming voice interface that enables patients to interact with pharmacy services through natural speech. The system implements a full-duplex audio pipeline with barge-in capabilities, HIPAA-aware data handling, and pluggable service providers.

## Architecture Diagram

```
┌─────────────────┐    WebSocket    ┌──────────────────┐
│   Web Client    │◄──────────────►│   Node.js Server │
│                 │                 │                  │
│ ┌─────────────┐ │                 │ ┌──────────────┐ │
│ │ Microphone  │ │                 │ │  WebSocket   │ │
│ │   Input     │ │                 │ │     Hub      │ │
│ └─────────────┘ │                 │ └──────────────┘ │
│ ┌─────────────┐ │                 │ ┌──────────────┐ │
│ │   Audio     │ │                 │ │  Deepgram    │ │
│ │  Playback   │ │                 │ │     STT      │ │
│ └─────────────┘ │                 │ └──────────────┘ │
│ ┌─────────────┐ │                 │ ┌──────────────┐ │
│ │ Transcript  │ │                 │ │   Gemini     │ │
│ │     UI      │ │                 │ │     LLM      │ │
│ └─────────────┘ │                 │ └──────────────┘ │
└─────────────────┘                 │ ┌──────────────┐ │
                                    │ │ ElevenLabs   │ │
                                    │ │     TTS      │ │
                                    │ └──────────────┘ │
                                    │ ┌──────────────┐ │
                                    │ │  Drug Info   │ │
                                    │ │   Service    │ │
                                    │ └──────────────┘ │
                                    │ ┌──────────────┐ │
                                    │ │   Refill     │ │
                                    │ │   Service    │ │
                                    │ └──────────────┘ │
                                    │ ┌──────────────┐ │
                                    │ │   SQLite     │ │
                                    │ │  Database    │ │
                                    │ └──────────────┘ │
                                    └──────────────────┘
```

## Data Flow Diagrams

### Speech-to-Text Flow

```
User Speech → Microphone → AudioRecorder → WebSocket → Deepgram API
                                                            ↓
Transcript ← WebSocket ← Server ← Interim/Final Results ←──┘
    ↓
Gemini LLM ← Function Calls ← Intent Recognition
```

### Text-to-Speech Flow

```
Gemini Response → Sentence Detection → ElevenLabs API → Audio Chunks
                                                             ↓
WebSocket → StreamPlayer → Audio Context → Speaker Output
```

### Barge-in Sequence

```
User Speaks While TTS Playing:
1. VAD detects voice activity (energy > threshold)
2. Client sends ui.interrupt message
3. Server pauses ElevenLabs synthesis
4. Audio chunks stop flowing
5. New STT session begins
6. Previous TTS content discarded or buffered
```

## Component Details

### Frontend (React + TypeScript)

**Key Components:**
- `App.tsx`: Main application orchestrator
- `TranscriptPane`: Real-time conversation display
- `AudioVisualizer`: Voice activity visualization
- `StatusToasts`: User feedback system

**Audio Processing:**
- `AudioRecorder`: Microphone capture with VAD
- `StreamPlayer`: Real-time audio playback with jitter buffering
- `WSClient`: WebSocket connection management with auto-reconnect

### Backend (Node.js + Express)

**Core Services:**
- `ws.ts`: WebSocket hub managing all client sessions
- `index.ts`: Express server with health checks and CORS

**AI Services:**
- `deepgram.ts`: Streaming STT with interim results
- `gemini.ts`: LLM with function calling and streaming responses
- `elevenlabs.ts`: Streaming TTS with pause/resume capabilities

**Business Logic:**
- `DrugInfoService`: Pluggable drug interaction checking
- `RefillService`: Prescription refill processing
- `SessionStore`: Secure session management

**Data Layer:**
- Prisma ORM with SQLite for development
- Audit logging with PHI redaction
- Mock prescription database

## Security & Privacy

### PHI Protection
- All patient data hashed before storage
- Phone numbers masked (show last 4 digits only)
- Audit logs with automatic PII redaction
- No raw audio storage (unless DEBUG_AUDIO=true)

### Session Management
- JWT-based session tokens
- Automatic session expiration
- Rate limiting for PHI access
- CORS protection

### Data Flow Security
```
Client Audio → Base64 Encoding → WebSocket → Server Processing → External APIs
                                                   ↓
                              Audit Log ← PHI Redaction ← Business Logic
```

## Streaming Architecture

### Real-time Pipeline
1. **Audio Capture**: 100ms chunks at 16kHz
2. **Voice Activity Detection**: Energy-based VAD with adaptive thresholds
3. **Speech Recognition**: Deepgram streaming with interim results
4. **LLM Processing**: Gemini with function calling for structured responses
5. **Speech Synthesis**: ElevenLabs streaming TTS
6. **Audio Playback**: Web Audio API with jitter buffering

### Latency Optimization
- **STT Latency**: ~200-500ms for interim results
- **LLM Latency**: ~300-800ms for first token
- **TTS Latency**: ~400-700ms for first audio chunk
- **Total RTL**: ~1-2 seconds from speech end to audio start

### Barge-in Implementation
```javascript
// Simplified barge-in logic
if (vadEnergy > bargeInThreshold && isTTSPlaying) {
  ttsClient.pause();
  wsClient.send({ type: 'ui.interrupt' });
  // New STT session begins automatically
}
```

## Service Providers

### Drug Information Service
```typescript
interface DrugInfoProvider {
  checkInteractions(meds: string[], conditions: string[]): Promise<Alert[]>;
  getAdministrationGuide(med: string): Promise<Guide>;
  searchMedications(query: string): Promise<string[]>;
}
```

**Current Providers:**
- `MockProvider`: Curated dataset for demo/development
- `OpenFDAProvider`: Stub for FDA API integration (TODO)

### Future Extensibility
- RxNorm integration for drug name standardization
- Clinical decision support APIs
- Pharmacy management system integration
- Insurance verification services

## Error Handling & Resilience

### Connection Management
- Automatic WebSocket reconnection with exponential backoff
- Graceful degradation when services are unavailable
- Circuit breaker pattern for external API calls

### Audio Continuity
- Jitter buffer for smooth playback
- Audio chunk ordering and gap detection
- Fallback to text-only mode if TTS fails

### Data Consistency
- Transactional refill processing
- Audit trail for all PHI access
- Session cleanup and resource management

## Deployment Considerations

### Development Setup
```bash
# Install dependencies
pnpm install

# Set up environment
cp server/env.example server/.env
# Fill in API keys

# Initialize database
cd server && pnpm migrate && pnpm seed

# Start development servers
pnpm dev
```

### Production Requirements
- HTTPS/WSS for secure audio transmission
- Load balancing for WebSocket connections
- Database migration to PostgreSQL
- Audio CDN for TTS caching
- Monitoring and alerting

### Scalability
- Horizontal scaling of Node.js instances
- WebSocket session affinity
- Redis for session storage
- Microservice decomposition for high load

## API Reference

### WebSocket Message Schema

**Client → Server:**
```typescript
{ type: "auth", token?: string }
{ type: "audio.start", sampleRate: number, encoding: string }
{ type: "audio.chunk", data: ArrayBuffer }
{ type: "audio.stop" }
{ type: "ui.interrupt" }
```

**Server → Client:**
```typescript
{ type: "stt.partial", text: string, confidence: number }
{ type: "stt.final", text: string }
{ type: "llm.partial", text: string, sentenceReady?: boolean }
{ type: "tts.chunk", data: string } // base64 audio
{ type: "tts.end" }
{ type: "status", message: string }
{ type: "error", code: string, message: string }
```

## Performance Metrics

### Target Benchmarks
- **Connection Time**: < 2 seconds
- **First Response**: < 3 seconds from speech end
- **Audio Latency**: < 500ms for TTS start
- **Barge-in Response**: < 200ms pause time
- **Memory Usage**: < 100MB per session
- **CPU Usage**: < 50% during active conversation

### Monitoring Points
- WebSocket connection health
- API response times (Deepgram, Gemini, ElevenLabs)
- Audio buffer health (underruns, overruns)
- Session duration and cleanup
- Error rates and types
