import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WSClient, WSMessage } from './lib/ws';
import { AudioRecorder } from './lib/audio/recorder';
import { StreamPlayer } from './lib/audio/streamPlayer';
import { TranscriptPane, TranscriptMessage } from './components/TranscriptPane';
import { StatusToasts, ToastMessage } from './components/StatusToasts';
import { AudioVisualizer } from './components/AudioVisualizer';

interface AppState {
  isConnected: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  isTTSPlaying: boolean;
  connectionState: string;
  audioEnergy: number;
  sessionToken: string | null;
}

function App() {
  const [state, setState] = useState<AppState>({
    isConnected: false,
    isRecording: false,
    isProcessing: false,
    isTTSPlaying: false,
    connectionState: 'disconnected',
    audioEnergy: 0,
    sessionToken: null,
  });

  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  
  const wsClient = useRef<WSClient | null>(null);
  const audioRecorder = useRef<AudioRecorder | null>(null);
  const streamPlayer = useRef<StreamPlayer | null>(null);
  const currentUserMessage = useRef<TranscriptMessage | null>(null);
  const currentAssistantMessage = useRef<TranscriptMessage | null>(null);

  // Initialize WebSocket connection
  useEffect(() => {
    wsClient.current = new WSClient();
    audioRecorder.current = new AudioRecorder();
    streamPlayer.current = new StreamPlayer();

    setupWebSocketHandlers();
    setupAudioHandlers();
    connectToServer();

    return () => {
      cleanup();
    };
  }, []);

  const setupWebSocketHandlers = useCallback(() => {
    if (!wsClient.current) return;

    wsClient.current.on('connected', () => {
      setState(prev => ({ ...prev, isConnected: true, connectionState: 'connected' }));
      addToast('success', 'Connected to pharmacy voice agent');
      
      // Authenticate
      wsClient.current!.send({ type: 'auth' });
    });

    wsClient.current.on('disconnected', () => {
      setState(prev => ({ 
        ...prev, 
        isConnected: false, 
        connectionState: 'disconnected',
        isRecording: false,
        isProcessing: false 
      }));
      addToast('warning', 'Disconnected from server');
    });

    wsClient.current.on('error', (error: any) => {
      console.error('WebSocket error:', error);
      addToast('error', 'Connection error occurred');
    });

    wsClient.current.on('auth.success', (message: WSMessage) => {
      setState(prev => ({ ...prev, sessionToken: message.token }));
      addToast('success', 'Authentication successful');
    });

    wsClient.current.on('stt.partial', (message: WSMessage) => {
      updateUserMessage(message.text, true);
    });

    wsClient.current.on('stt.final', (message: WSMessage) => {
      updateUserMessage(message.text, false);
      setState(prev => ({ ...prev, isProcessing: true }));
    });

    wsClient.current.on('llm.partial', (message: WSMessage) => {
      updateAssistantMessage(message.text, !message.sentenceReady);
    });

    wsClient.current.on('llm.final', (message: WSMessage) => {
      updateAssistantMessage(message.text, false);
      setState(prev => ({ ...prev, isProcessing: false }));
    });

    wsClient.current.on('tts.chunk', (message: WSMessage) => {
      if (streamPlayer.current) {
        streamPlayer.current.addChunk(message.data);
        setState(prev => ({ ...prev, isTTSPlaying: true }));
      }
    });

    wsClient.current.on('tts.end', () => {
      setState(prev => ({ ...prev, isTTSPlaying: false }));
    });

    wsClient.current.on('status', (message: WSMessage) => {
      addToast('info', message.message);
    });

    wsClient.current.on('error', (message: WSMessage) => {
      addToast('error', message.message || 'An error occurred');
    });
  }, []);

  const setupAudioHandlers = useCallback(() => {
    if (!audioRecorder.current) return;

    audioRecorder.current.onAudio((audioData: ArrayBuffer) => {
      if (wsClient.current && state.isRecording) {
        wsClient.current.sendBinary(audioData);
      }
    });

    audioRecorder.current.onVoiceActivity((isVoice: boolean, energy: number) => {
      setState(prev => ({ ...prev, audioEnergy: energy }));
      
      // Trigger barge-in if speaking while TTS is playing
      if (isVoice && energy > 0.02 && state.isTTSPlaying) {
        wsClient.current?.send({ type: 'ui.interrupt' });
        streamPlayer.current?.pause();
      }
    });
  }, [state.isRecording, state.isTTSPlaying]);

  const connectToServer = useCallback(async () => {
    if (!wsClient.current) return;

    try {
      setState(prev => ({ ...prev, connectionState: 'connecting' }));
      await wsClient.current.connect();
    } catch (error) {
      console.error('Failed to connect:', error);
      setState(prev => ({ ...prev, connectionState: 'error' }));
      addToast('error', 'Failed to connect to server');
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!audioRecorder.current || !wsClient.current || !state.isConnected) {
      addToast('warning', 'Please wait for connection to be established');
      return;
    }

    try {
      // Initialize stream player if not already done
      if (streamPlayer.current && !streamPlayer.current.state.isPlaying) {
        await streamPlayer.current.initialize();
      }

      // Initialize and start audio recording
      await audioRecorder.current.initialize();
      await audioRecorder.current.start();

      // Notify server
      wsClient.current.send({
        type: 'audio.start',
        sampleRate: audioRecorder.current.state.sampleRate,
        encoding: 'pcm16'
      });

      setState(prev => ({ ...prev, isRecording: true }));
      
      // Clear previous user message
      currentUserMessage.current = null;

    } catch (error) {
      console.error('Failed to start recording:', error);
      addToast('error', 'Failed to start recording. Please check microphone permissions.');
    }
  }, [state.isConnected]);

  const stopRecording = useCallback(() => {
    if (!audioRecorder.current || !wsClient.current) return;

    audioRecorder.current.stop();
    wsClient.current.send({ type: 'audio.stop' });
    
    setState(prev => ({ 
      ...prev, 
      isRecording: false, 
      audioEnergy: 0 
    }));
  }, []);

  const toggleRecording = useCallback(() => {
    if (state.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [state.isRecording, startRecording, stopRecording]);

  const updateUserMessage = useCallback((text: string, isPartial: boolean) => {
    if (!text.trim()) return;

    const messageId = currentUserMessage.current?.id || `user-${Date.now()}`;
    
    const message: TranscriptMessage = {
      id: messageId,
      type: 'user',
      text: text.trim(),
      timestamp: Date.now(),
      isPartial
    };

    setMessages(prev => {
      const filtered = prev.filter(msg => msg.id !== messageId);
      return [...filtered, message];
    });

    currentUserMessage.current = message;
  }, []);

  const updateAssistantMessage = useCallback((text: string, isPartial: boolean) => {
    if (!text.trim()) return;

    const messageId = currentAssistantMessage.current?.id || `assistant-${Date.now()}`;
    
    const message: TranscriptMessage = {
      id: messageId,
      type: 'assistant',
      text: text.trim(),
      timestamp: Date.now(),
      isPartial
    };

    setMessages(prev => {
      const filtered = prev.filter(msg => msg.id !== messageId);
      return [...filtered, message];
    });

    currentAssistantMessage.current = message;
  }, []);

  const addToast = useCallback((type: ToastMessage['type'], message: string, duration?: number) => {
    const toast: ToastMessage = {
      id: `toast-${Date.now()}-${Math.random()}`,
      type,
      message,
      duration
    };
    
    setToasts(prev => [...prev, toast]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const clearTranscript = useCallback(() => {
    setMessages([]);
    currentUserMessage.current = null;
    currentAssistantMessage.current = null;
  }, []);

  const cleanup = useCallback(() => {
    if (audioRecorder.current) {
      audioRecorder.current.dispose();
    }
    if (streamPlayer.current) {
      streamPlayer.current.dispose();
    }
    if (wsClient.current) {
      wsClient.current.disconnect();
    }
  }, []);

  const getConnectionStatusIcon = () => {
    switch (state.connectionState) {
      case 'connected': return '🟢';
      case 'connecting': return '🟡';
      case 'error': return '🔴';
      default: return '⚫';
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>🏥 Pharmacy Voice Agent</h1>
        <p>Secure voice assistant for prescription refills and medication guidance</p>
      </header>

      <div className="status-bar">
        <div className="status-indicator">
          <span className={`status-dot ${state.connectionState}`}></span>
          <span>{getConnectionStatusIcon()} {state.connectionState}</span>
        </div>
        <div className="status-indicator">
          <span>🎤 {state.isRecording ? 'Recording' : 'Ready'}</span>
        </div>
        <div className="status-indicator">
          <span>🔊 {state.isTTSPlaying ? 'Speaking' : 'Silent'}</span>
        </div>
      </div>

      <div className="voice-interface">
        <div className="mic-container">
          <button
            className={`mic-button ${state.isRecording ? 'recording' : ''}`}
            onClick={toggleRecording}
            disabled={!state.isConnected}
            title={state.isRecording ? 'Stop recording' : 'Start recording'}
          >
            {state.isRecording ? '⏹️' : '🎤'}
          </button>
        </div>

        <AudioVisualizer 
          isRecording={state.isRecording}
          audioEnergy={state.audioEnergy}
        />

        <TranscriptPane 
          messages={messages}
          isProcessing={state.isProcessing}
        />

        <div className="controls">
          <button 
            className="control-button"
            onClick={clearTranscript}
            disabled={messages.length === 0}
          >
            Clear Transcript
          </button>
          
          <button 
            className="control-button"
            onClick={connectToServer}
            disabled={state.isConnected || state.connectionState === 'connecting'}
          >
            Reconnect
          </button>
        </div>
      </div>

      <StatusToasts 
        toasts={toasts}
        onDismiss={dismissToast}
      />
    </div>
  );
}

export default App;
