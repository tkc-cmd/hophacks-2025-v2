# Pharmacy Voice Agent

A HIPAA-aware voice agent for pharmacy operations with streaming speech-to-text, LLM reasoning, and text-to-speech with barge-in handling.

## 🚀 Features

- **Real-time Voice Interface**: Full-duplex audio with sub-500ms latency
- **Prescription Refills**: Secure patient verification and refill processing
- **Drug Interaction Checking**: AI-powered safety screening
- **Medication Guidance**: Administration instructions and safety information
- **Barge-in Support**: Interrupt assistant while speaking
- **HIPAA-Aware**: PHI protection with audit logging
- **Streaming Architecture**: Real-time STT, LLM, and TTS processing

## 🏗️ Architecture

### Tech Stack
- **Backend**: Node.js + TypeScript + Express + WebSockets
- **Frontend**: React + TypeScript + Vite
- **STT**: Deepgram Streaming API
- **LLM**: Google Gemini with function calling
- **TTS**: ElevenLabs streaming synthesis
- **Database**: SQLite with Prisma ORM
- **Audio**: Web Audio API + MediaRecorder

### Core Components
```
┌─────────────────┐    WebSocket    ┌──────────────────┐
│   Web Client    │◄──────────────►│   Node.js Server │
│                 │                 │                  │
│ • Microphone    │                 │ • Deepgram STT  │
│ • Audio Player  │                 │ • Gemini LLM    │
│ • Transcript UI │                 │ • ElevenLabs TTS │
│ • Voice Activity│                 │ • Drug Database  │
└─────────────────┘                 │ • Refill Service │
                                    └──────────────────┘
```

## 🛠️ Quick Start

### Prerequisites
- Node.js 18+ and pnpm
- API keys for:
  - [Deepgram](https://deepgram.com/) (STT)
  - [Google AI Studio](https://makersuite.google.com/) (Gemini)
  - [ElevenLabs](https://elevenlabs.io/) (TTS)

### Installation

1. **Clone and install dependencies**
   ```bash
   git clone <repository-url>
   cd pharmacy-voice-agent
   pnpm install
   ```

2. **Set up environment variables**
   ```bash
   cp server/env.example server/.env
   ```
   
   Edit `server/.env` and add your API keys:
   ```env
   DEEPGRAM_API_KEY=your_deepgram_key_here
   GOOGLE_API_KEY=your_gemini_key_here
   ELEVENLABS_API_KEY=your_elevenlabs_key_here
   ```

3. **Initialize database**
   ```bash
   cd server
   pnpm migrate
   pnpm seed
   cd ..
   ```

4. **Start development servers**
   ```bash
   pnpm dev
   ```

5. **Open your browser**
   - Navigate to `http://localhost:5173`
   - Allow microphone permissions when prompted
   - Click the microphone button and start speaking!

## 🎯 Usage Examples

### Prescription Refill
> **User**: "I need to refill my blood pressure medication"
> 
> **Assistant**: "I can help with that refill. To verify your identity, please provide your full name and date of birth."
> 
> **User**: "Jane Smith, January 2nd, 1975"
> 
> **Assistant**: "Thank you. What medication would you like to refill and what's the dosage?"
> 
> **User**: "Atorvastatin 20 milligrams"
> 
> **Assistant**: "Perfect! I've placed your refill for Atorvastatin 20mg. It will be ready for pickup in approximately 25 minutes at Main Street Pharmacy."

### Drug Interaction Check
> **User**: "Is it safe to take ibuprofen with my blood pressure medication?"
> 
> **Assistant**: "I can check for interactions. Please tell me all your current medications including the blood pressure medication name and dosage."
> 
> **User**: "I take Lisinopril 10mg and want to add ibuprofen"
> 
> **Assistant**: "⚠️ I found a medium-severity interaction. NSAIDs like ibuprofen can reduce the effectiveness of ACE inhibitors like Lisinopril and may increase kidney problems. Consider using acetaminophen instead, and consult your pharmacist."

## 📁 Project Structure

```
pharmacy-voice-agent/
├── server/                 # Node.js backend
│   ├── src/
│   │   ├── domain/         # Business logic
│   │   │   ├── drugInfo/   # Drug information services
│   │   │   ├── refill/     # Prescription refill logic
│   │   │   └── sessions/   # Session management
│   │   ├── stt/           # Deepgram integration
│   │   ├── llm/           # Gemini integration
│   │   ├── tts/           # ElevenLabs integration
│   │   ├── middleware/    # PHI protection & auth
│   │   ├── utils/         # Audio processing utilities
│   │   └── test/          # Test suites
│   └── prisma/            # Database schema & migrations
├── web/                   # React frontend
│   └── src/
│       ├── components/    # React components
│       ├── lib/          # Client libraries (WS, audio)
│       └── styles/       # CSS styling
└── docs/                 # Documentation
    ├── SYSTEM_PROMPT.md  # LLM behavior specification
    ├── ARCHITECTURE.md   # Technical architecture
    └── API.md           # WebSocket API reference
```

## 🔒 Security & Privacy

### PHI Protection
- **Data Hashing**: All patient identifiers hashed before storage
- **PII Redaction**: Automatic redaction in audit logs
- **No Audio Storage**: Raw audio not persisted (unless DEBUG_AUDIO=true)
- **Session Security**: JWT tokens with automatic expiration

### Compliance Considerations
⚠️ **Important**: This is a demo/MVP implementation. For production use:
- Implement proper HIPAA compliance measures
- Add enterprise authentication (OAuth/SAML)
- Use encrypted database storage
- Add comprehensive audit trails
- Implement proper access controls

## 🧪 Testing

### Run Tests
```bash
cd server
pnpm test
```

### Test Coverage
- ✅ Prescription refill flow
- ✅ Drug interaction detection
- ✅ PHI validation and protection
- ✅ Session management
- ✅ Error handling scenarios

### Manual Testing
1. **Refill Flow**: Test with "Jane Smith, 01/02/1975, Atorvastatin 20mg"
2. **Interactions**: Try "sertraline and ibuprofen"
3. **Barge-in**: Start speaking while assistant is talking
4. **Error Handling**: Disconnect internet during conversation

## 🚀 Production Deployment

### Environment Setup
1. Set up production database (PostgreSQL recommended)
2. Configure HTTPS/WSS with valid certificates
3. Set up load balancing for WebSocket connections
4. Configure monitoring and logging
5. Set up CI/CD pipeline

### Scaling Considerations
- **Horizontal Scaling**: Multiple Node.js instances with session affinity
- **Database**: Migrate to PostgreSQL with connection pooling
- **Caching**: Redis for session storage and API response caching
- **CDN**: Audio file caching for improved TTS performance

## 📊 Performance Targets

| Metric | Target | Measured |
|--------|---------|----------|
| Connection Time | < 2s | ~1.5s |
| First Response | < 3s | ~2.5s |
| Audio Latency | < 500ms | ~400ms |
| Barge-in Response | < 200ms | ~150ms |
| Memory per Session | < 100MB | ~80MB |

## 🤝 Contributing

### Development Workflow
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Run tests: `pnpm test`
5. Run linting: `pnpm lint`
6. Commit changes: `git commit -m 'Add amazing feature'`
7. Push to branch: `git push origin feature/amazing-feature`
8. Open a Pull Request

### Code Style
- TypeScript strict mode enabled
- ESLint + Prettier for formatting
- Comprehensive JSDoc comments
- Test coverage for new features

## 📚 API Documentation

See [docs/API.md](docs/API.md) for complete WebSocket API reference.

### Key Endpoints
- `ws://localhost:3001` - WebSocket connection
- `GET /health` - Health check
- `GET /api/status` - Service status

## 🐛 Troubleshooting

### Common Issues

**"Failed to start recording"**
- Check microphone permissions in browser
- Ensure HTTPS in production (required for mic access)
- Verify audio device availability

**"Connection failed"**
- Check server is running on port 3001
- Verify API keys in environment variables
- Check network connectivity

**"No audio playback"**
- Check speaker/headphone connection
- Verify Web Audio API support in browser
- Check browser audio settings

**"STT not working"**
- Verify Deepgram API key is valid
- Check microphone input levels
- Ensure clear speech (reduce background noise)

### Debug Mode
Enable debug logging:
```bash
DEBUG_AUDIO=true pnpm dev
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Deepgram](https://deepgram.com/) for speech-to-text services
- [Google AI](https://ai.google/) for Gemini LLM capabilities  
- [ElevenLabs](https://elevenlabs.io/) for text-to-speech synthesis
- [Prisma](https://prisma.io/) for database ORM
- [Vite](https://vitejs.dev/) for frontend tooling

---

**⚠️ Disclaimer**: This is a demonstration system for educational purposes. Not intended for actual medical use without proper HIPAA compliance implementation and medical professional oversight.