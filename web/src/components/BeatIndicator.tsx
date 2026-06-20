import { useEffect, useState } from 'react';
import { countingSystem } from '@taal/shared/utils/CountingSystem';

export function BeatIndicator({ isPlaying, playbackRate }: { isPlaying: boolean, playbackRate: number }) {
  const [beat, setBeat] = useState<number>(-1);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const handleBeat = (b: number) => {
      setBeat(b + 1); // 1-8 instead of 0-7
      setPulse(true);
      
      // Reset pulse quickly
      setTimeout(() => setPulse(false), 150 / playbackRate);
    };

    countingSystem.onBeat(handleBeat);
    return () => {
      countingSystem.offBeat(handleBeat);
    };
  }, [playbackRate]);

  if (!isPlaying || beat < 0) return null;

  const isAccented = beat === 1 || beat === 5;

  return (
    <div className="absolute top-4 right-4 flex items-center justify-center">
      <div 
        className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold transition-transform duration-100 ease-out
          ${pulse ? (isAccented ? 'scale-125 bg-violet-600 text-white' : 'scale-110 bg-violet-500/80 text-white') : 'scale-100 bg-black/40 text-gray-300'}
        `}
        style={{
           boxShadow: pulse && isAccented ? '0 0 20px rgba(124, 58, 237, 0.8)' : 'none'
        }}
      >
        {beat}
      </div>
    </div>
  );
}
