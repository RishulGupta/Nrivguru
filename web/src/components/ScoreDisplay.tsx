interface ScoreDisplayProps {
  score: number;
  jointAccuracy: {
    upperBody: number;
    lowerBody: number;
    core: number;
  };
}

export default function ScoreDisplay({ score, jointAccuracy }: ScoreDisplayProps) {
  const getEmoji = (val: number) => {
    if (val >= 85) return '🟢';
    if (val >= 70) return '🟡';
    return '🔴';
  };

  return (
    <div className="glass px-4 py-3 rounded-2xl border border-white/10 flex items-center gap-4">
      <div className="text-center">
        <p className="text-3xl font-outfit font-bold text-white">{Math.round(score)}</p>
        <p className="text-[10px] text-white/50 uppercase tracking-wider">Score</p>
      </div>
      <div className="flex gap-3 text-xs">
        <div className="flex items-center gap-1">
          <span>{getEmoji(jointAccuracy.upperBody)}</span>
          <span className="text-white/80">{Math.round(jointAccuracy.upperBody)}%</span>
        </div>
        <div className="flex items-center gap-1">
          <span>{getEmoji(jointAccuracy.lowerBody)}</span>
          <span className="text-white/80">{Math.round(jointAccuracy.lowerBody)}%</span>
        </div>
      </div>
    </div>
  );
}
