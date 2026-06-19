import React from 'react';
import { Target, Activity, Flame } from 'lucide-react';

interface ScoreDisplayProps {
  score: number;
  combo: number;
  jointAccuracy: {
    upperBody: number;
    lowerBody: number;
    core: number;
  };
}

export default function ScoreDisplay({ score, combo, jointAccuracy }: ScoreDisplayProps) {
  const getScoreColor = (val: number) => {
    if (val >= 85) return 'text-green-400';
    if (val >= 70) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="glass p-4 rounded-2xl border border-white/10 flex flex-col items-center">
      <div className="relative mb-4">
        {/* Circular Progress (CSS mock) */}
        <div className="w-24 h-24 rounded-full border-4 border-white/10 flex items-center justify-center relative">
          <svg className="absolute inset-0 w-full h-full -rotate-90">
            <circle 
              cx="48" cy="48" r="44" 
              fill="none" 
              stroke="url(#gradient)" 
              strokeWidth="4" 
              strokeDasharray="276"
              strokeDashoffset={276 - (276 * score) / 100}
              className="transition-all duration-300"
            />
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#9333ea" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>
          </svg>
          <div className="flex flex-col items-center">
            <span className="text-3xl font-outfit font-bold text-white neon-text">{Math.round(score)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4 bg-primary/20 px-3 py-1 rounded-full border border-primary/30">
        <Flame className="w-4 h-4 text-primary" />
        <span className="text-primary font-bold text-sm">{combo}x Combo</span>
      </div>

      <div className="w-full space-y-2 text-sm">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground flex items-center gap-1"><Target className="w-3 h-3"/> Upper</span>
          <span className={`font-semibold ${getScoreColor(jointAccuracy.upperBody)}`}>
            {Math.round(jointAccuracy.upperBody)}%
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground flex items-center gap-1"><Activity className="w-3 h-3"/> Lower</span>
          <span className={`font-semibold ${getScoreColor(jointAccuracy.lowerBody)}`}>
            {Math.round(jointAccuracy.lowerBody)}%
          </span>
        </div>
      </div>
    </div>
  );
}
