# Demo Guide

## Setup Instructions

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Configure API Keys**
   
   Copy the environment template:
   ```bash
   cp server/env.example server/.env
   ```
   
   Edit `server/.env` and add your API keys:
   ```env
   DEEPGRAM_API_KEY=your_deepgram_key_here
   GOOGLE_API_KEY=your_gemini_key_here  
   ELEVENLABS_API_KEY=your_elevenlabs_key_here
   ```

   **Getting API Keys:**
   - **Deepgram**: Sign up at [deepgram.com](https://deepgram.com) → API Keys
   - **Google Gemini**: Visit [makersuite.google.com](https://makersuite.google.com) → Get API Key
   - **ElevenLabs**: Register at [elevenlabs.io](https://elevenlabs.io) → Profile → API Keys

3. **Initialize Database**
   ```bash
   cd server
   DATABASE_URL="file:./dev.db" npx prisma db push
   pnpm seed
   cd ..
   ```

4. **Start the Application**
   ```bash
   pnpm dev
   ```
   
   This starts both the server (port 3001) and web client (port 5173).

5. **Open Browser**
   - Navigate to `http://localhost:5173`
   - Allow microphone permissions when prompted

## Demo Scenarios

### 1. Prescription Refill Flow

**Test Patient**: Jane Smith, DOB: 01/02/1975, Phone: 555-555-5678

**Script:**
1. Click the microphone button
2. Say: *"I need to refill my blood pressure medication"*
3. Wait for response, then say: *"Jane Smith, January 2nd, 1975"*
4. Say: *"Atorvastatin 20 milligrams at Main Street Pharmacy"*

**Expected Result**: Successful refill placement with ETA

### 2. Drug Interaction Check

**Script:**
1. Say: *"Is it safe to take ibuprofen with my blood pressure medication?"*
2. Say: *"I take Lisinopril 10mg and Warfarin 5mg"*

**Expected Result**: Warning about NSAID-ACE inhibitor interaction and bleeding risk with warfarin

### 3. Medication Guidance

**Script:**
1. Say: *"How should I take my cholesterol medication?"*
2. Say: *"Atorvastatin"*

**Expected Result**: Administration instructions, timing, and side effects

### 4. Barge-in Demonstration

**Script:**
1. Ask any question that generates a long response
2. While the assistant is speaking, start talking again
3. The assistant should pause and listen to your new input

### 5. Error Handling

**Script:**
1. Say: *"I need a prescription for chest pain"* (out of scope)
2. Say: *"Refill medication for John Doe, 01/01/1900"* (not found)

**Expected Result**: Appropriate error messages and guidance

## Test Data

The system includes pre-seeded test prescriptions:

| Patient | DOB | Medication | Dosage | Refills | Pharmacy |
|---------|-----|------------|---------|---------|----------|
| Jane Smith | 01/02/1975 | Atorvastatin | 20mg | 3 | Main Street Pharmacy |
| Jane Smith | 01/02/1975 | Metformin | 500mg | 5 | Main Street Pharmacy |
| John Doe | 03/15/1980 | Lisinopril | 10mg | 2 | Downtown Pharmacy |
| Mary Johnson | 12/08/1965 | Amoxicillin | 500mg | 0 | Express Pharmacy |
| Robert Wilson | 07/22/1955 | Sertraline | 50mg | 4 | Mall Pharmacy |

## Troubleshooting

### Common Issues

**"Microphone not working"**
- Ensure browser permissions are granted
- Check microphone hardware
- Try refreshing the page

**"No audio output"**
- Check speaker/headphone connection
- Verify browser audio settings
- Check ElevenLabs API key

**"Connection failed"**
- Verify server is running on port 3001
- Check API keys in .env file
- Ensure no firewall blocking

**"Speech not recognized"**
- Speak clearly and at normal pace
- Reduce background noise
- Check Deepgram API key

### Debug Mode

Enable detailed logging:
```bash
DEBUG_AUDIO=true pnpm dev
```

### Manual Testing

Test WebSocket connection manually:
```bash
npm install -g wscat
wscat -c ws://localhost:3001

# Send test messages:
{"type":"auth"}
{"type":"audio.start","sampleRate":16000,"encoding":"pcm16"}
```

## Performance Notes

- **First connection**: ~2-3 seconds (includes API initialization)
- **Response latency**: ~1-2 seconds from speech end to audio start
- **Barge-in response**: ~150ms pause time
- **Memory usage**: ~80MB per active session

## Demo Tips

1. **Speak naturally** - The system handles conversational speech
2. **Wait for responses** - Allow processing time between interactions
3. **Test barge-in** - Interrupt the assistant to show real-time capabilities
4. **Show error handling** - Demonstrate out-of-scope requests
5. **Highlight security** - Point out PHI protection and audit logging

## Architecture Highlights

- **Real-time streaming**: All audio processing is live
- **Barge-in support**: Interrupt assistant mid-sentence
- **HIPAA awareness**: PHI hashing and audit trails
- **Pluggable services**: Easy to swap AI providers
- **Responsive UI**: Works on desktop and mobile
- **Error resilience**: Graceful degradation when services fail
