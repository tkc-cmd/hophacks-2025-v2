# API Documentation

## WebSocket API

### Connection
Connect to: `ws://localhost:3001` (development) or `wss://yourdomain.com` (production)

### Message Format
All messages are JSON objects with a `type` field and additional properties.

## Client → Server Messages

### Authentication
```json
{
  "type": "auth",
  "token": "optional_session_token"
}
```
**Response:** `auth.success` with new token

### Audio Control

#### Start Audio Stream
```json
{
  "type": "audio.start",
  "sampleRate": 16000,
  "encoding": "pcm16"
}
```

#### Stop Audio Stream
```json
{
  "type": "audio.stop"
}
```

#### Interrupt/Barge-in
```json
{
  "type": "ui.interrupt"
}
```

### Binary Audio Data
Raw PCM audio data sent as binary WebSocket frames (not JSON).

## Server → Client Messages

### Authentication Response
```json
{
  "type": "auth.success",
  "token": "session_token_string",
  "sessionId": "uuid"
}
```

### Speech Recognition

#### Partial Transcript
```json
{
  "type": "stt.partial",
  "text": "Hello I need to refill my...",
  "confidence": 0.85
}
```

#### Final Transcript
```json
{
  "type": "stt.final",
  "text": "Hello I need to refill my medication",
  "confidence": 0.92
}
```

### LLM Response

#### Partial Response
```json
{
  "type": "llm.partial",
  "text": "I can help you with that refill.",
  "sentenceReady": true
}
```

#### Final Response
```json
{
  "type": "llm.final",
  "text": "I can help you with that refill. To verify your identity, please provide your full name and date of birth."
}
```

### Text-to-Speech

#### Audio Chunk
```json
{
  "type": "tts.chunk",
  "data": "base64_encoded_audio_data"
}
```

#### TTS Complete
```json
{
  "type": "tts.end"
}
```

### Status Messages

#### General Status
```json
{
  "type": "status",
  "message": "Connected to pharmacy voice agent"
}
```

#### Error
```json
{
  "type": "error",
  "code": "STT_ERROR",
  "message": "Speech recognition failed"
}
```

## REST API

### Health Check
```http
GET /health
```
**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "version": "1.0.0"
}
```

### Service Status
```http
GET /api/status
```
**Response:**
```json
{
  "server": "running",
  "database": "connected",
  "services": {
    "deepgram": true,
    "elevenlabs": true,
    "gemini": true
  }
}
```

## Function Calling Schema

The LLM uses these function definitions for structured interactions:

### refill_service.placeRefill
Place a prescription refill order.

**Parameters:**
```typescript
{
  name: string;        // Patient full name
  dob: string;         // Date of birth (MM/DD/YYYY)
  med: string;         // Medication name
  dose: string;        // Dosage (e.g., "20mg")
  qty?: number;        // Quantity (optional)
  pharmacy: string;    // Pharmacy location
  phone?: string;      // Phone number (optional)
}
```

**Returns:**
```typescript
{
  status: "placed" | "no_refills" | "not_found" | "needs_provider";
  message: string;
  etaMinutes?: number;
  refillsRemaining?: number;
}
```

### drug_info.checkInteractions
Check for drug interactions and contraindications.

**Parameters:**
```typescript
{
  meds: string[];         // List of medications
  conditions?: string[];  // Medical conditions (optional)
}
```

**Returns:**
```typescript
{
  alerts: Array<{
    severity: "high" | "medium" | "low";
    summary: string;
    guidance: string;
    category: "drug-drug" | "drug-condition" | "drug-food" | "duplicate-therapy";
  }>
}
```

### drug_info.getAdministrationGuide
Get medication administration guidance.

**Parameters:**
```typescript
{
  med: string;  // Medication name
}
```

**Returns:**
```typescript
{
  instructions: string;
  commonSideEffects: string[];
  whenToSeekHelp: string;
  foodInteractions?: string[];
  timingGuidance?: string;
  storageInstructions?: string;
}
```

## Error Codes

### WebSocket Errors

| Code | Description | Action |
|------|-------------|--------|
| `AUTH_FAILED` | Authentication failed | Retry with valid token |
| `NOT_AUTHENTICATED` | No valid session | Send auth message |
| `STT_ERROR` | Speech recognition failed | Check microphone, retry |
| `LLM_ERROR` | AI processing error | Retry or contact support |
| `TTS_ERROR` | Text-to-speech failed | Continue with text only |
| `AUDIO_START_ERROR` | Failed to start audio | Check permissions |
| `MESSAGE_ERROR` | Invalid message format | Check message schema |
| `UNKNOWN_MESSAGE_TYPE` | Unrecognized message type | Use valid message types |

### HTTP Errors

| Status | Description | Response |
|--------|-------------|----------|
| 404 | Endpoint not found | Check API documentation |
| 500 | Server error | Retry or contact support |
| 503 | Service unavailable | Server maintenance |

## Rate Limits

- **PHI Access**: 5 requests per 5 minutes per session
- **WebSocket Messages**: 100 per minute per connection
- **Audio Data**: No limit (streaming)

## Audio Specifications

### Input Audio
- **Format**: PCM 16-bit signed little-endian
- **Sample Rate**: 16kHz (configurable)
- **Channels**: 1 (mono)
- **Chunk Size**: ~100ms (1600 samples)

### Output Audio
- **Format**: MP3 (converted to PCM in browser)
- **Sample Rate**: 24kHz
- **Channels**: 1 (mono)
- **Bitrate**: 64kbps

## Example Usage

### JavaScript Client Example

```javascript
const ws = new WebSocket('ws://localhost:3001');

// Authentication
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'auth' }));
};

// Handle messages
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'auth.success':
      console.log('Authenticated:', message.token);
      break;
      
    case 'stt.final':
      console.log('User said:', message.text);
      break;
      
    case 'llm.partial':
      console.log('Assistant:', message.text);
      break;
      
    case 'tts.chunk':
      // Play audio chunk
      playAudioChunk(message.data);
      break;
  }
};

// Start recording
function startRecording() {
  ws.send(JSON.stringify({
    type: 'audio.start',
    sampleRate: 16000,
    encoding: 'pcm16'
  }));
}

// Send audio data
function sendAudioChunk(audioBuffer) {
  ws.send(audioBuffer);
}
```

### cURL Examples

```bash
# Health check
curl http://localhost:3001/health

# Service status
curl http://localhost:3001/api/status
```

## Security Considerations

### Data Protection
- All PHI is hashed before storage
- Audio data not persisted by default
- Session tokens expire automatically
- CORS protection enabled

### Authentication
- Session-based authentication
- No long-term user accounts
- Automatic session cleanup

### Audit Trail
- All PHI access logged
- PII automatically redacted in logs
- Timestamp and session tracking

## Testing

### WebSocket Testing with wscat
```bash
# Install wscat
npm install -g wscat

# Connect and test
wscat -c ws://localhost:3001

# Send authentication
{"type":"auth"}

# Send test message
{"type":"audio.start","sampleRate":16000,"encoding":"pcm16"}
```

### Integration Testing
See `/server/src/test/` for example test cases covering:
- Refill flow end-to-end
- Barge-in functionality
- Error handling scenarios
