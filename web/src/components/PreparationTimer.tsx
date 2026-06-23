import { useEffect, useRef, useState } from 'react';
import { countingSystem } from '@taal/shared/utils/CountingSystem';
import { speechManager } from '@taal/shared/utils/SpeechManager';
import { BeatIndicator } from './BeatIndicator';

interface PreparationTimerProps {
  /** Called when the countdown finishes or user skips */
  onReady: () => void;
  /** Called if the user wants to cancel / go back */
  onCancel?: () => void;
  /** Playback rate to pass to BeatIndicator */
  playbackRate: number;
  /** Duration in seconds for the countdown (4-8) */
  duration?: number;
  /** Phase label shown above countdown */
  phaseLabel: string;
}

export function PreparationTimer({
  onReady,
  onCancel,
  playbackRate,
  duration = 6,
  phaseLabel
}: PreparationTimerProps) {
  const [countdown, setCountdown] = useState(duration);
  const [isCounting, setIsCounting] = useState(true);
  const [beatStarted, setBeatStarted] = useState(false);

  // Start counting system for "5, 6, 7, 8"
  useEffect(() => {
    const startDelay = setTimeout(() => {
      countingSystem.start(6000, playbackRate);
      setBeatStarted(true);
    }, 500);

    return () => {
      clearTimeout(startDelay);
      countingSystem.stop();
    };
  }, [playbackRate]);

  // Spoken countdown
  useEffect(() => {
    if (countdown <= 4 && countdown >= 1) {
      speechManager.speak(String(countdown), 'normal');
    }
  }, [countdown]);

  // "5, 6, 7, 8" spoken after countdown
  useEffect(() => {
    if (countdown <= 0 && !beatStarted) {
      speechManager.speak("5, 6, 7, 8", 'urgent');
      setBeatStarted(true);
    }
  }, [countdown, beatStarted]);

  // Countdown timer
  useEffect(() => {
    if (!isCounting) return;
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setIsCounting(false);
          countingSystem.stop();
          setTimeout(onReady, 800);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isCounting, onReady]);

  // Auto-proceed safety: always proceed after duration+2 seconds
  useEffect(() => {
    const safety = setTimeout(() => {
      setIsCounting(false);
      countingSystem.stop();
      onReady();
    }, (duration + 3) * 1000);
    return () => clearTimeout(safety);
  }, [duration, onReady]);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center">
      {/* Pulsating background ring */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className={`w-72 h-72 rounded-full border-4 transition-all duration-200 ${
          countdown > 0
            ? 'border-violet-500/40 scale-[0.85] animate-pulse'
            : 'border-green-500/60 scale-100'
        }`} />
      </div>

      {beatStarted && (
        <div className="absolute top-20 right-20">
          <BeatIndicator isPlaying={true} playbackRate={playbackRate} />
        </div>
      )}

      <div className="relative z-10 text-center space-y-6">
        <p className="text-white/50 text-sm uppercase tracking-[0.2em]">
          {phaseLabel}
        </p>

        {countdown > 0 ? (
          <>
            <div className="text-8xl font-outfit font-bold text-white tabular-nums">
              {countdown}
            </div>
            <p className="text-gray-400 text-lg">
              Get into position...
            </p>
          </>
        ) : (
          <div className="space-y-4 animate-in zoom-in duration-300">
            <div className="text-7xl">
              🕺
            </div>
            <p className="text-green-400 text-2xl font-bold">
              5, 6, 7, 8!
            </p>
            <p className="text-gray-400 text-base animate-pulse">
              Starting now...
            </p>
          </div>
        )}

        {/* Countdown dots */}
        <div className="flex justify-center gap-2">
          {Array.from({ length: duration }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i < duration - countdown
                  ? 'w-6 bg-violet-500'
                  : 'w-1.5 bg-gray-700'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Skip / Cancel buttons */}
      <div className="absolute bottom-16 flex gap-4 z-10">
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-6 py-3 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl font-medium transition-all text-base"
          >
            ← Back
          </button>
        )}
        <button
          onClick={() => {
            countingSystem.stop();
            onReady();
          }}
          className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition-all text-base"
        >
          ⏭️ Skip countdown
        </button>
      </div>
    </div>
  );
}
