import { useEffect, useState } from 'react';
import { countingSystem } from '@taal/shared/utils/CountingSystem';

export function BeatIndicator({ isPlaying, playbackRate }: { isPlaying: boolean, playbackRate: number }) {
  const [beat, setBeat] = useState<number>(-1);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const handleBeat = (b: number) => {
      setBeat(b + 1);
      setPulse(true);
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
    <div className="absolute top-4 right-4 flex items-center justify-center z-20">
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-75
          ${pulse ? (isAccented ? 'bg-violet-500 scale-125 shadow-[0_0_20px_rgba(124,58,237,0.6)]' : 'bg-violet-500/70 scale-110') : 'bg-black/40'}
        `}
      >
        <span className={`text-lg font-bold ${pulse ? 'text-white' : 'text-gray-400'}`}>
          {isAccented ? '🥁' : '•'}
        </span>
      </div>
    </div>
  );
}
