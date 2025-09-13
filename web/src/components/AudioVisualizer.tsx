import React, { useEffect, useState, useRef } from 'react';

interface AudioVisualizerProps {
  isRecording: boolean;
  audioEnergy: number;
  barCount?: number;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ 
  isRecording, 
  audioEnergy, 
  barCount = 20 
}) => {
  const [bars, setBars] = useState<number[]>(new Array(barCount).fill(0));
  const animationRef = useRef<number>();

  useEffect(() => {
    if (isRecording) {
      animateViz();
    } else {
      // Fade out when not recording
      setBars(prev => prev.map(height => Math.max(0, height * 0.9)));
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isRecording, audioEnergy]);

  const animateViz = () => {
    setBars(prev => {
      const newBars = [...prev];
      
      // Update bars based on audio energy
      const targetHeight = Math.min(100, audioEnergy * 1000); // Scale energy to percentage
      
      // Create wave effect across bars
      for (let i = 0; i < barCount; i++) {
        const waveOffset = Math.sin((Date.now() / 200) + (i * 0.3)) * 10;
        const randomVariation = (Math.random() - 0.5) * 20;
        const baseHeight = targetHeight + waveOffset + randomVariation;
        
        // Smooth transition
        const currentHeight = newBars[i];
        const smoothing = 0.3;
        newBars[i] = currentHeight + (Math.max(5, baseHeight) - currentHeight) * smoothing;
      }
      
      return newBars;
    });

    if (isRecording) {
      animationRef.current = requestAnimationFrame(animateViz);
    }
  };

  if (!isRecording && bars.every(height => height < 1)) {
    return null;
  }

  return (
    <div className="audio-visualizer">
      {bars.map((height, index) => (
        <div
          key={index}
          className="visualizer-bar"
          style={{
            height: `${Math.max(2, height)}%`,
            opacity: isRecording ? 1 : 0.3,
            backgroundColor: isRecording 
              ? `hsl(${240 + height * 0.5}, 70%, ${50 + height * 0.3}%)`
              : '#cbd5e0'
          }}
        />
      ))}
    </div>
  );
};
