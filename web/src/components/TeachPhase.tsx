import { useEffect, useRef, useState } from 'react';
import type { PoseFrame } from '@taal/shared/types/pose';
import SkeletonCanvas from './SkeletonCanvas';
import { speechManager } from '@taal/shared/utils/SpeechManager';

interface TeachPhaseProps {
  keyframes: PoseFrame[];
  onComplete: () => void;
}

export function TeachPhase({ keyframes, onComplete }: TeachPhaseProps) {
  const [currentFrameIdx, setCurrentFrameIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (keyframes.length === 0) {
      onComplete();
      return;
    }

    // A simple presentation: show each keyframe for 2 seconds
    const interval = setInterval(() => {
      setCurrentFrameIdx(prev => {
        if (prev + 1 >= keyframes.length) {
          clearInterval(interval);
          setTimeout(onComplete, 1000); // Wait 1s after last frame before moving on
          return prev;
        }
        return prev + 1;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [keyframes, onComplete]);

  useEffect(() => {
    // Speak a generic instruction for each frame for now
    // In a full implementation, we'd map poses to textual descriptions 
    // or use AI to generate the description during the chunking phase.
    if (keyframes.length > 0) {
      const texts = ["First position.", "Transition through here.", "Extend fully.", "And hit the final pose."];
      const text = texts[Math.min(currentFrameIdx, texts.length - 1)];
      speechManager.speak(text, 'normal');
    }
  }, [currentFrameIdx, keyframes.length]);

  if (keyframes.length === 0) return null;

  const currentPose = keyframes[currentFrameIdx].landmarks;

  return (
    <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center z-50 p-8">
      <h2 className="text-3xl font-bold text-white mb-8">Let's look at the key moves</h2>
      
      <div 
        ref={containerRef} 
        className="relative w-full max-w-lg aspect-[9/16] bg-gray-900 rounded-lg overflow-hidden border border-gray-800"
      >
        <SkeletonCanvas
          landmarks={currentPose}
          width={containerRef.current?.clientWidth || 400}
          height={containerRef.current?.clientHeight || 700}
        />
        
        <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2">
          {keyframes.map((_, idx) => (
            <div 
              key={idx}
              className={`h-2 rounded-full transition-all duration-300 ${
                idx === currentFrameIdx ? 'w-8 bg-violet-500' : 'w-2 bg-gray-600'
              }`}
            />
          ))}
        </div>
      </div>

      <button 
        onClick={onComplete}
        className="mt-8 px-8 py-3 bg-white/10 hover:bg-white/20 text-white rounded-full font-medium transition-colors"
      >
        Skip to Practice
      </button>
    </div>
  );
}
