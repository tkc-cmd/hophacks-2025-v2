import React, { useEffect, useRef } from 'react';

export interface TranscriptMessage {
  id: string;
  type: 'user' | 'assistant';
  text: string;
  timestamp: number;
  isPartial?: boolean;
  isLoading?: boolean;
}

interface TranscriptPaneProps {
  messages: TranscriptMessage[];
  isProcessing: boolean;
}

export const TranscriptPane: React.FC<TranscriptPaneProps> = ({ messages, isProcessing }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="transcript-container">
      <div className="transcript-header">
        <span>💬</span>
        Conversation
      </div>
      
      <div className="transcript-content" ref={scrollRef}>
        {messages.length === 0 && !isProcessing && (
          <div className="transcript-message assistant">
            <p>👋 Hi! I'm your pharmacy voice assistant. I can help you with prescription refills, check for drug interactions, and provide medication guidance.</p>
            <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', opacity: 0.8 }}>
              <strong>Disclaimer:</strong> I'm an automated assistant and can't provide medical diagnoses. In emergencies, call your local emergency number.
            </p>
          </div>
        )}
        
        {messages.map((message) => (
          <div
            key={message.id}
            className={`transcript-message ${message.type} ${message.isPartial ? 'partial' : ''} ${message.isLoading ? 'loading' : ''}`}
          >
            {message.isLoading ? (
              <div className="loading-content">
                <span>Processing...</span>
                <div className="typing-indicator">
                  <div className="typing-dot"></div>
                  <div className="typing-dot"></div>
                  <div className="typing-dot"></div>
                </div>
              </div>
            ) : (
              message.text
            )}
            
            {message.isPartial && (
              <span style={{ opacity: 0.6, fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                (speaking...)
              </span>
            )}
          </div>
        ))}
        
        {isProcessing && messages[messages.length - 1]?.type !== 'assistant' && (
          <div className="transcript-message assistant loading">
            <div className="loading-content">
              <span>Thinking...</span>
              <div className="typing-indicator">
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
