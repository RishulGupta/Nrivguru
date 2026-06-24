import { useEffect, useRef, useState } from 'react';
import { speechManager } from '@taal/shared/utils/SpeechManager';
import type { PoseLandmark } from '@taal/shared/types/pose';

interface PreparationTimerProps {
  onReady: () => void;
  onCancel?: () => void;
  playbackRate: number;
  duration?: number; // ponytail: kept for compat but ignored — always 5
  phaseLabel: string;
  /** Current user landmarks — used to gate countdown until shoulders visible */
  userLandmarks?: PoseLandmark[] | null;
  /** First-frame reference landmarks to show target arm position */
  startPoseLandmarks?: PoseLandmark[] | null;
}

const COUNTDOWN_SECS = 5;

export function PreparationTimer({
  onReady,
  onCancel,
  playbackRate: _playbackRate,
  phaseLabel,
  userLandmarks,
  startPoseLandmarks: _startPoseLandmarks,
}: PreparationTimerProps) {
  const [countdown, setCountdown] = useState(COUNTDOWN_SECS);
  const [bodyDetected, setBodyDetected] = useState(false);
  const [started, setStarted] = useState(false);
  const countRef = useRef(COUNTDOWN_SECS);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Gate: check if shoulders are visible in latest landmarks
  useEffect(() => {
    if (bodyDetected) return;
    if (!userLandmarks) return;
    const ls = userLandmarks[11], rs = userLandmarks[12];
    const visible = (ls?.visibility ?? 0) > 0.4 && (rs?.visibility ?? 0) > 0.4;
    if (visible) setBodyDetected(true);
  }, [userLandmarks, bodyDetected]);

  // Start countdown once body is detected
  useEffect(() => {
    if (!bodyDetected || started) return;
    setStarted(true);
    speechManager.speak('3', 'normal');
    setCountdown(3);
    countRef.current = 3;

    intervalRef.current = setInterval(() => {
      const next = countRef.current - 1;
      countRef.current = next;
      if (next >= 1) {
        speechManager.speak(String(next), 'normal');
        setCountdown(next);
      } else {
        clearInterval(intervalRef.current!);
        setCountdown(0);
        setTimeout(onReady, 500);
      }
    }, 1000);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyDetected]);

  // Safety: if no body detected after 8s, start anyway
  useEffect(() => {
    const t = setTimeout(() => {
      if (!bodyDetected) {
        setBodyDetected(true);
      }
    }, 8000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isArmsPhase = phaseLabel.toLowerCase().includes('upper') || phaseLabel.toLowerCase().includes('arm');

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden">
      {/* Dark overlay — camera is rendered by Practice.tsx behind this fixed overlay */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Body detection prompt */}
      {!bodyDetected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-4">
          <div className="text-white/60 text-sm uppercase tracking-widest">{phaseLabel}</div>
          <div className="text-5xl animate-bounce">👆</div>
          <p className="text-white text-xl font-bold text-center px-8">
            {isArmsPhase ? 'Show me your shoulders' : 'Step back so I can see you'}
          </p>
          <p className="text-white/50 text-sm text-center px-12">
            {isArmsPhase
              ? 'Make sure both shoulders are in frame'
              : 'Your whole body should be visible'}
          </p>
        </div>
      )}

      {/* Countdown */}
      {bodyDetected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-6">
          <p className="text-white/60 text-sm uppercase tracking-[0.2em]">{phaseLabel}</p>

          {countdown > 0 ? (
            <div className="text-9xl font-bold text-white tabular-nums drop-shadow-2xl animate-in zoom-in duration-200">
              {countdown}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 animate-in zoom-in duration-200">
              <div className="text-7xl">🕺</div>
              <p className="text-green-400 text-3xl font-bold">GO!</p>
            </div>
          )}

          <p className="text-white/40 text-sm">
            {isArmsPhase ? 'Focus on your arm positions' : 'You\'ve got this!'}
          </p>
        </div>
      )}

      {/* Back button */}
      {onCancel && (
        <button
          onClick={onCancel}
          className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition-all"
        >
          ← Back
        </button>
      )}

      {/* Skip — available once body detected */}
      {bodyDetected && countdown > 0 && (
        <button
          onClick={() => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            onReady();
          }}
          className="absolute bottom-10 right-8 z-20 px-5 py-2 bg-white/10 hover:bg-white/20 text-white/70 rounded-xl text-sm transition-all"
        >
          Skip ⏭
        </button>
      )}
    </div>
  );
}
