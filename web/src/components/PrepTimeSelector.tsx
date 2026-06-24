import { useState, useEffect } from 'react';
import { speechManager } from '@taal/shared/utils/SpeechManager';

interface PrepTimeSelectorProps {
  onSelect: (seconds: number) => void;
  onCancel?: () => void;
}

const OPTIONS = [4, 5, 6, 7, 8];

export function PrepTimeSelector({ onSelect, onCancel }: PrepTimeSelectorProps) {
  const [selected, setSelected] = useState(6);

  useEffect(() => {
    speechManager.speak("Get ready! How much time do you need to get into position?", "normal");
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center">
      <div className="relative z-10 text-center space-y-8 max-w-md mx-auto px-6">
        <p className="text-white/50 text-sm uppercase tracking-[0.2em]">
          💪 Upper Body — Get Ready
        </p>

        <h2 className="text-3xl font-outfit font-bold text-white">
          How much time do you<br />need to get into position?
        </h2>

        {/* Timer options */}
        <div className="grid grid-cols-5 gap-3">
          {OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setSelected(s)}
              className={`aspect-square rounded-2xl text-2xl font-bold transition-all duration-200 ${
                selected === s
                  ? 'bg-violet-500/30 border-2 border-violet-400 text-white shadow-[0_0_20px_rgba(139,92,246,0.3)] scale-105'
                  : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <p className="text-gray-500 text-sm -mt-4">seconds</p>

        {/* Confirmation */}
        <button
          onClick={() => onSelect(selected)}
          className="w-full py-4 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl transition-all shadow-[0_0_25px_rgba(147,51,234,0.4)] text-lg"
        >
          ✅ I'm ready in {selected} sec
        </button>

        {onCancel && (
          <button
            onClick={onCancel}
            className="w-full py-3 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl font-medium transition-all text-base"
          >
            ← Back to watch
          </button>
        )}
      </div>
    </div>
  );
}
