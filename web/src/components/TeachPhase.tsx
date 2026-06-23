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
      speechManager.speak("No keyframes available. Skipping to watch phase.", "normal");
      setTimeout(onComplete, 1500);
      return;
    }

    const interval = setInterval(() => {
      setCurrentFrameIdx(prev => {
        if (prev + 1 >= keyframes.length) {
          clearInterval(interval);
          setTimeout(onComplete, 1000);
          return prev;
        }
        return prev + 1;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [keyframes, onComplete]);

  useEffect(() => {
    if (keyframes.length > 0) {
      const texts = ["First pose.", "Now this one.", "Stretch here.", "Final pose!"];
      const text = texts[Math.min(currentFrameIdx, texts.length - 1)];
      speechManager.speak(text, 'normal');
    }
  }, [currentFrameIdx, keyframes.length]);

  if (keyframes.length === 0) {
    return (
      <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center z-50 p-8">
        <p className="text-5xl mb-4">🎬</p>
        <h2 className="text-3xl font-bold text-white mb-4">Loading moves...</h2>
        <p className="text-gray-400">Preparing your lesson</p>
      </div>
    );
  }

  const currentPose = keyframes[currentFrameIdx].landmarks;

  return (
    <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center z-50 p-8">
      <p className="text-white/60 text-sm uppercase tracking-widest mb-2">Watch the moves</p>
      <h2 className="text-3xl font-bold text-white mb-8">👀 Watch & Remember</h2>

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
        className="mt-8 px-8 py-3 bg-white/10 hover:bg-white/20 text-white rounded-full font-medium transition-colors text-lg"
      >
        ⏭️ Skip
      </button>
    </div>
  );
}
