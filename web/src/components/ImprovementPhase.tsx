import { useState, useMemo } from 'react';
import type { FinalScore } from '@taal/shared/types/routine';
import type { PoseFrame } from '@taal/shared/types/pose';
import SkeletonCanvas from './SkeletonCanvas';

interface ImprovementPhaseProps {
  finalScore: FinalScore;
  referencePoses: PoseFrame[];
  userPose: any;
  jointScores: any[];
  chunkIndex: number;
  totalChunks: number;
  /** Called to retry the combined phase */
  onRetry: () => void;
  /** Called to proceed to next chunk */
  onNextChunk: () => void;
  /** Called to go back to previous chunk */
  onPrevChunk?: () => void;
  /** Called to finish the session */
  onFinishSession: () => void;
}

type AdviceType = 'stiff' | 'offbeat' | 'posture' | 'asymmetric' | 'general';

function getAIAdvice(
  score: FinalScore,
  weakerSide: string | null | undefined
): { type: AdviceType; title: string; tip: string; detail: string }[] {
  const advice: { type: AdviceType; title: string; tip: string; detail: string }[] = [];

  // Timing advice
  if (score.timingScore < 70) {
    if (score.timingFeedback?.includes('dragging')) {
      advice.push({
        type: 'offbeat',
        title: '🏃 Catch the beat',
        tip: 'You are off-beat — try to move slightly faster.',
        detail: 'Focus on the downbeat. Count the rhythm in your head: "1-and-2-and-3-and-4." Let the music guide your movement rather than rushing through the steps.'
      });
    } else if (score.timingFeedback?.includes('rushing')) {
      advice.push({
        type: 'offbeat',
        title: '⏸️ Wait for the count',
        tip: 'You are rushing ahead — hold back and feel the groove.',
        detail: 'Breathe with the music and resist the urge to anticipate. Let the beat lead you rather than chasing it.'
      });
    } else {
      advice.push({
        type: 'offbeat',
        title: '🎵 Feel the rhythm',
        tip: 'Try swaying to the music before starting the steps.',
        detail: 'Bounce gently on your heels to find the tempo before launching into the choreography. Start on the strong beat.'
      });
    }
  } else {
    advice.push({
      type: 'general',
      title: '✅ Great timing',
      tip: 'Your musicality is solid — now refine the shapes.',
      detail: 'Your rhythm is locked in. Focus on making each position crisper and more intentional.'
    });
  }

  // Posture / stiffness advice
  if (score.overallScore < 60 && score.timingScore > 50) {
    advice.push({
      type: 'stiff',
      title: '💃 Loosen up',
      tip: 'You are standing too straight — drop your center of gravity.',
      detail: 'Bend your knees slightly and relax your shoulders. Dancing is about dynamic tension, not rigidity. Think of moving through water — smooth and continuous.'
    });
  }

  if (score.overallScore < 50) {
    advice.push({
      type: 'posture',
      title: '🧘 Relax your shoulders',
      tip: 'If you feel stiff, roll your shoulders back and find the groove.',
      detail: 'Tension travels from your shoulders to your arms. Shake out your hands between takes and keep your jaw relaxed. A relaxed body moves faster and more accurately.'
    });
  }

  // Asymmetric feedback
  if (weakerSide) {
    advice.push({
      type: 'asymmetric',
      title: `⚖️ Strengthen your ${weakerSide} side`,
      tip: `Your ${weakerSide} side is lagging — spend extra time mirroring the ${weakerSide === 'left' ? 'right' : 'left'} side's movements.`,
      detail: `Imbalances are normal. Watch yourself in the mirror and consciously over-exaggerate the ${weakerSide} side's movement to build muscle memory. Think of leading with the ${weakerSide} elbow/knee on every count.`
    });
  }

  // General stance
  if (advice.length < 2) {
    advice.push({
      type: 'general',
      title: '🎯 Precision matters',
      tip: 'Pay attention to the end-range of each movement.',
      detail: 'Where your limb stops is just as important as the path it takes. Try pausing briefly at the apex of each movement to lock in the position.'
    });
  }

  return advice;
}

export function ImprovementPhase({
  finalScore,
  referencePoses,
  userPose,
  jointScores,
  chunkIndex,
  totalChunks,
  onRetry,
  onNextChunk,
  onPrevChunk,
  onFinishSession
}: ImprovementPhaseProps) {
  const [proprioAnswer, setProprioAnswer] = useState<'yes' | 'no' | null>(null);
  const isLastChunk = chunkIndex >= totalChunks - 1;
  const isFrustrated = finalScore.overallScore < 40;

  const adviceList = useMemo(
    () => getAIAdvice(finalScore, finalScore.weakerSide),
    [finalScore]
  );

  const getScoreEmoji = (score: number) => {
    if (score >= 85) return '🔥';
    if (score >= 70) return '👍';
    if (score >= 50) return '💪';
    return '🌱';
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/92 backdrop-blur-sm flex flex-col overflow-y-auto">
      <div className="flex-1 w-full max-w-2xl mx-auto px-6 py-8 space-y-6">

        {/* ── Header ── */}
        <div className="text-center space-y-2">
          <p className="text-white/50 text-sm uppercase tracking-[0.2em]">
            Step 6 — AI Coach
          </p>
          <h2 className="text-3xl font-bold text-white">
            💪 Let's improve
          </h2>
          <p className="text-gray-400 text-sm">
            Chunk {chunkIndex + 1} of {totalChunks}
          </p>
        </div>

        {/* ── Final Score Breakdown ── */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center space-y-4">
          <div className="text-5xl font-bold text-white neon-text">
            {getScoreEmoji(finalScore.overallScore)} {Math.round(finalScore.overallScore)}%
          </div>
          <div className="flex justify-center gap-6 text-sm">
            <div className="text-center">
              <p className="text-2xl mb-1">💪</p>
              <p className="text-green-400 font-bold">{Math.round(finalScore.armScore)}%</p>
              <p className="text-white/40 text-[10px]">Arms</p>
            </div>
            <div className="text-center">
              <p className="text-2xl mb-1">🦵</p>
              <p className="text-green-400 font-bold">{Math.round(finalScore.legScore)}%</p>
              <p className="text-white/40 text-[10px]">Legs</p>
            </div>
            <div className="text-center">
              <p className="text-2xl mb-1">⏱️</p>
              <p className="text-green-400 font-bold">{Math.round(finalScore.timingScore)}%</p>
              <p className="text-white/40 text-[10px]">Timing</p>
            </div>
          </div>

          {finalScore.weakerSide && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2">
              <p className="text-amber-300 text-sm font-medium">
                ⚠️ Your <b>{finalScore.weakerSide}</b> side needs extra attention
              </p>
            </div>
          )}
        </div>

        {/* ── AAR Skeleton Overlay ── */}
        {referencePoses.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-white/40 text-xs uppercase tracking-wider mb-3 text-center">
              AAR — Skeleton Overlay with Directional Error Arrows
            </p>
            <div className="relative w-full max-w-xs mx-auto aspect-[3/4] bg-gray-900 rounded-lg overflow-hidden">
              {referencePoses[referencePoses.length - 1] && (
                <SkeletonCanvas
                  landmarks={referencePoses[referencePoses.length - 1].landmarks as any}
                  refLandmarks={userPose}
                  focusArea="full"
                  showArrows={true}
                  width={400}
                  height={533}
                  jointScores={jointScores.length > 0 ? Object.fromEntries(jointScores.map((j: any) => [j.name, j.score])) as any : undefined}
                />
              )}
            </div>
          </div>
        )}

        {/* ── Frustration Avoidance ── */}
        {isFrustrated && (
          <div className="bg-orange-500/15 border border-orange-500/30 rounded-2xl p-5 text-center space-y-3 animate-in fade-in">
            <p className="text-3xl">🧘</p>
            <h3 className="text-orange-300 font-bold text-lg">Take a breather</h3>
            <p className="text-orange-200/70 text-sm">
              This chunk is tough! Consider taking a short break or scaling down the difficulty.
              Remember — even small improvements count.
            </p>
            <div className="flex gap-3 justify-center pt-1">
              <button
                onClick={() => {
                  onPrevChunk?.();
                }}
                className="px-4 py-2 bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 rounded-xl text-sm font-medium transition-colors"
              >
                ⬅️ Try previous chunk
              </button>
              <button
                onClick={onRetry}
                className="px-4 py-2 bg-orange-500/30 hover:bg-orange-500/40 text-white rounded-xl text-sm font-medium transition-colors"
              >
                🔄 Try again
              </button>
            </div>
          </div>
        )}

        {/* ── AI Coaching Advice ── */}
        <div className="space-y-3">
          <p className="text-white/40 text-xs uppercase tracking-wider">AI Coach Advice</p>
          {adviceList.map((advice, i) => (
            <div
              key={i}
              className="bg-violet-500/5 border border-violet-500/15 rounded-xl p-4 space-y-2"
            >
              <div className="flex items-center gap-2">
                <p className="text-lg">{advice.title.split(' ')[0]}</p>
                <p className="text-white font-semibold text-sm">
                  {advice.title.substring(advice.title.indexOf(' ') + 1)}
                </p>
              </div>
              <p className="text-violet-200 text-sm font-medium">
                {advice.tip}
              </p>
              <p className="text-gray-400 text-xs leading-relaxed">
                {advice.detail}
              </p>
            </div>
          ))}
        </div>

        {/* ── Proprioceptive Questioning ── */}
        {proprioAnswer === null && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 text-center space-y-3 animate-in fade-in slide-in-from-bottom-4">
            <p className="text-emerald-300 font-medium text-sm">
              🧠 Did you feel your {finalScore.weakerSide || 'non-dominant'} side struggling during the faster counts?
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setProprioAnswer('no')}
                className="px-5 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-sm transition-colors"
              >
                Not really
              </button>
              <button
                onClick={() => setProprioAnswer('yes')}
                className="px-5 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-xl text-sm transition-colors"
              >
                Yes! 👍
              </button>
            </div>
          </div>
        )}

        {proprioAnswer === 'yes' && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 text-center">
            <p className="text-emerald-300 text-sm">
              Great awareness! That's the first step to fixing it. Focus on leading with that side in the next attempt.
            </p>
          </div>
        )}

        {/* ── Freeze-Frame Physical Adjustment prompt ── */}
        {finalScore.overallScore < 50 && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-center space-y-2">
            <p className="text-red-300 font-medium text-sm">
              ⏸️ Freeze-Frame Adjustment
            </p>
            <p className="text-gray-300 text-xs">
              Try this: strike the last pose from the chunk and hold it. Compare with the reference — adjust your shoulders, elbows, and hips until they match.
            </p>
          </div>
        )}

        {/* ── Navigation ── */}
        <div className="flex gap-3 pt-2 pb-8">
          {!isLastChunk && onPrevChunk && (
            <button
              onClick={onPrevChunk}
              className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-all text-base"
            >
              ← Previous chunk
            </button>
          )}
          {!isFrustrated && (
            <button
              onClick={onRetry}
              className="flex-1 bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl transition-all text-base"
            >
              🔄 Try combined again
            </button>
          )}
          <button
            onClick={isLastChunk ? onFinishSession : onNextChunk}
            className={`flex-1 font-bold py-3 rounded-xl transition-all text-base shadow-lg ${
              isLastChunk
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20'
                : 'bg-primary hover:bg-primary/90 text-white shadow-[0_0_15px_rgba(147,51,234,0.3)]'
            }`}
          >
            {isLastChunk ? '✅ Finish session' : '➡️ Next chunk'}
          </button>
        </div>
      </div>
    </div>
  );
}
