import { useState } from 'react';

export type PracticeMode = 'full_body' | 'upper_body' | 'lower_body' | 'full_speed';

interface PracticeModeSelectorProps {
  onSelect: (mode: PracticeMode) => void;
  onCancel?: () => void;
}

const MODES: { id: PracticeMode; emoji: string; title: string; desc: string }[] = [
  { id: 'full_body',  emoji: '🕺', title: 'Full Body',     desc: 'Arms → Legs → Combine at increasing speed' },
  { id: 'upper_body', emoji: '💪', title: 'Upper Body',    desc: 'Focus on arm and shoulder movements only' },
  { id: 'lower_body', emoji: '🦵', title: 'Lower Body',    desc: 'Focus on leg and hip movements only' },
  { id: 'full_speed', emoji: '⚡', title: 'Full Speed',    desc: 'Jump straight to full-speed rehearsal' },
];

export function PracticeModeSelector({ onSelect, onCancel }: PracticeModeSelectorProps) {
  const [selected, setSelected] = useState<PracticeMode>('full_body');

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-6">
      <div className="relative z-10 text-center max-w-lg mx-auto w-full space-y-6">
        <p className="text-white/50 text-sm uppercase tracking-[0.2em]">Practice Mode</p>
        <h2 className="text-3xl font-outfit font-bold text-white">How do you want to practice?</h2>

        <div className="grid gap-3">
          {MODES.map(m => (
            <button
              key={m.id}
              onClick={() => setSelected(m.id)}
              className={`w-full text-left px-5 py-4 rounded-2xl border transition-all duration-200 flex items-center gap-4 ${
                selected === m.id
                  ? 'bg-violet-500/20 border-violet-400 text-white scale-[1.02] shadow-[0_0_20px_rgba(139,92,246,0.2)]'
                  : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="text-3xl">{m.emoji}</span>
              <div>
                <p className="font-bold text-left">{m.title}</p>
                <p className="text-xs text-white/50 mt-0.5">{m.desc}</p>
              </div>
              {selected === m.id && <span className="ml-auto text-violet-400 text-xl">✓</span>}
            </button>
          ))}
        </div>

        <button
          onClick={() => onSelect(selected)}
          className="w-full py-4 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl transition-all shadow-[0_0_25px_rgba(147,51,234,0.4)] text-lg"
        >
          ✅ Start {MODES.find(m => m.id === selected)?.title}
        </button>

        {onCancel && (
          <button onClick={onCancel} className="w-full py-3 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl font-medium transition-all text-base">
            ← Back
          </button>
        )}
      </div>
    </div>
  );
}
