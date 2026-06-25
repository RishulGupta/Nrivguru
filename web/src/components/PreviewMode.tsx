import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Play, Pause, RotateCcw } from 'lucide-react';

// ── PreviewMode ───────────────────────────────────────────────────────────────
// Step 2 of the 11-step class model: show the full choreography once, full
// speed, with music, before teaching any of it.
//
// Behaviour:
//   • Plays from startTimeMs to endTimeMs at 1× speed, unmuted.
//   • Single-shot — no auto-loop. A "Watch again" button replays from the top.
//   • "Start learning" fires onStartLearning after playback completes OR at any
//     point the user taps the button.
//   • No camera, no pose detection, no correction badge — pure passive watch.

interface PreviewModeProps {
  videoSrc:        string;
  startTimeMs:     number;
  endTimeMs:       number;
  title?:          string;
  onClose:         () => void;
  onStartLearning: () => void;
}

export function PreviewMode({
  videoSrc, startTimeMs, endTimeMs, title, onClose, onStartLearning,
}: PreviewModeProps) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const loadedSrcRef = useRef('');

  const [phase, setPhase]       = useState<'playing' | 'paused' | 'done'>('playing');
  const [progress, setProgress] = useState(0);

  const durationMs = endTimeMs - startTimeMs;

  // ── Seek helper — same pattern as DrillLoop ─────────────────────────────────

  const seekAndPlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted        = false;
    v.playbackRate = 1;

    const startSec = startTimeMs / 1000;
    if (Math.abs(v.currentTime - startSec) < 0.05) {
      v.play().catch(() => {});
      return;
    }
    const onSeeked = () => {
      v.removeEventListener('seeked', onSeeked);
      v.play().catch(() => {});
    };
    v.addEventListener('seeked', onSeeked);
    v.currentTime = startSec;
  }, [startTimeMs]);

  // ── Load / init ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoSrc) return;

    if (loadedSrcRef.current !== videoSrc) {
      loadedSrcRef.current = videoSrc;
      v.src = videoSrc;
      v.load();
      v.addEventListener('loadedmetadata', seekAndPlay, { once: true });
      return () => v.removeEventListener('loadedmetadata', seekAndPlay);
    } else {
      seekAndPlay();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSrc]);

  // ── End-of-range detector + progress bar ───────────────────────────────────

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTU = () => {
      const nowMs = v.currentTime * 1000;
      if (durationMs > 0) {
        setProgress(Math.min(1, Math.max(0, (nowMs - startTimeMs) / durationMs)));
      }
      if (endTimeMs > 0 && nowMs >= endTimeMs) {
        v.pause();
        setPhase('done');
      }
    };
    v.addEventListener('timeupdate', onTU);
    return () => v.removeEventListener('timeupdate', onTU);
  }, [startTimeMs, endTimeMs, durationMs]);

  // ── Pause / resume ──────────────────────────────────────────────────────────

  const handlePauseResume = () => {
    const v = videoRef.current;
    if (!v) return;
    if (phase === 'paused') {
      v.play().catch(() => {});
      setPhase('playing');
    } else if (phase === 'playing') {
      v.pause();
      setPhase('paused');
    }
  };

  const handleReplay = () => {
    setPhase('playing');
    seekAndPlay();
  };

  const isDone    = phase === 'done';
  const isPaused  = phase === 'paused';
  const isPlaying = phase === 'playing';

  const fmtMs = (ms: number) => {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col overflow-hidden">

      {/* Video — fills screen */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        playsInline
        muted={false}
        onPlay={() => { if (phase !== 'done') setPhase('playing'); }}
        onPause={() => { if (phase === 'playing') setPhase('paused'); }}
      />

      {/* Top bar */}
      <div className="relative z-20 flex items-center justify-between px-4 pt-10 pb-2">
        <button
          onClick={onClose}
          className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
          <span>🎬</span>
          <span className="text-white/70 text-xs font-semibold">PREVIEW</span>
          {title && <span className="text-white/30 text-xs">· {title}</span>}
        </div>

        <div className="w-10 h-10" />
      </div>

      {/* Progress bar */}
      <div className="relative z-20 px-4 mt-1">
        <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-violet-400 rounded-full transition-[width] duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-white/20 text-[9px]">{fmtMs(Math.round(progress * durationMs))}</span>
          <span className="text-white/20 text-[9px]">{fmtMs(durationMs)}</span>
        </div>
      </div>

      {/* Paused overlay */}
      {isPaused && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-white/10 backdrop-blur-md rounded-full w-20 h-20 flex items-center justify-center">
            <Pause className="w-8 h-8 text-white" />
          </div>
        </div>
      )}

      {/* Done overlay */}
      {isDone && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center z-20 gap-6 px-8">
          <div className="text-5xl">🎬</div>
          <div className="text-center">
            <h2 className="text-2xl font-bold text-white">Got the picture?</h2>
            <p className="text-white/40 text-sm mt-1">Watch again, or jump straight into learning</p>
          </div>
          <div className="flex flex-col gap-3 w-full max-w-sm">
            <button
              onClick={handleReplay}
              className="w-full py-4 bg-white/10 hover:bg-white/20 text-white font-bold rounded-2xl transition-all flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Watch again
            </button>
            <button
              onClick={onStartLearning}
              className="w-full py-4 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-2xl transition-all shadow-[0_0_20px_rgba(139,92,246,0.4)] flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4 fill-current" />
              Start learning
            </button>
          </div>
        </div>
      )}

      {/* Bottom controls — hidden once done */}
      {!isDone && (
        <div className="relative z-20 mt-auto pb-10 px-4 flex flex-col items-center gap-3">
          <p className="text-white/25 text-xs tracking-widest uppercase">
            {isPlaying ? 'Full speed · With music' : 'Paused'}
          </p>
          <div className="flex items-center gap-4">
            <button
              onClick={handlePauseResume}
              className="w-16 h-16 rounded-full bg-white/12 hover:bg-white/20 border border-white/15 flex items-center justify-center transition-all active:scale-95"
            >
              {isPaused
                ? <Play className="w-7 h-7 text-white ml-1" />
                : <Pause className="w-7 h-7 text-white" />}
            </button>
            <button
              onClick={onStartLearning}
              className="py-3.5 px-6 bg-violet-600/80 hover:bg-violet-600 text-white text-sm font-bold rounded-2xl transition-all border border-violet-500/30"
            >
              Start learning →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
