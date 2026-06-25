import { useEffect, useRef, useState, useCallback } from 'react';
import type { PoseFrame } from '@taal/shared/types/pose';
import { speechManager } from '@taal/shared/utils/SpeechManager';
import { ChevronRight, Timer, TimerOff } from 'lucide-react';
import { StickmanCanvas } from './StickmanCanvas';

interface TeachPhaseProps {
  keyframes: PoseFrame[];
  onComplete: () => void;
  videoSrc?: string;
  startMs?: number;
  endMs?: number;
}

// ── Step content helpers ──────────────────────────────────────────────────────

function getStepTitle(idx: number, total: number): string {
  if (idx === 0) return 'Starting Position';
  if (idx === total - 1) return 'Landing Position';
  return ['First Move', 'Key Shape', 'Transition', 'The Peak'][Math.min(idx - 1, 3)];
}

function getStepCue(idx: number, total: number): string {
  if (idx === 0) return 'Memorize this before anything moves. Notice where both arms sit.';
  if (idx === total - 1) return "The move ends here. Stick this shape for a full beat.";
  return 'Hit this exact shape on the beat. Pause the clip in your mind at this frame.';
}

function getCoachTip(idx: number, total: number): string {
  if (idx === 0) return 'Shoulders relaxed, weight even. Loose, not stiff.';
  if (idx === total - 1) return 'Hold for a beat — then the next move flows naturally.';
  return 'Focus on your wrists: where the wrist goes, the whole arm follows.';
}

// ── TeachPhase ────────────────────────────────────────────────────────────────

const AUTO_ADVANCE_SEC = 3;

export function TeachPhase({ keyframes, onComplete, videoSrc, startMs = 0 }: TeachPhaseProps) {
  const [currentIdx, setCurrentIdx]       = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [autoAdvance, setAutoAdvance]     = useState(false);
  const [autoCountdown, setAutoCountdown] = useState(AUTO_ADVANCE_SEC);
  const [panelSize, setPanelSize]         = useState({ w: 0, h: 0 });

  const videoRef   = useRef<HTMLVideoElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const panelRef   = useRef<HTMLDivElement>(null);

  const total  = keyframes.length;
  const isLast = currentIdx >= total - 1;
  const kf     = keyframes[currentIdx];
  const nextKf = keyframes[currentIdx + 1];

  useEffect(() => { if (!keyframes.length) onComplete(); }, []); // eslint-disable-line

  useEffect(() => {
    if (!videoSrc) return;
    const v = videoRef.current;
    if (!v) return;
    v.src = videoSrc;
    v.load();
  }, [videoSrc]); // eslint-disable-line

  // Seek video to current keyframe
  useEffect(() => {
    if (!kf) return;
    const v = videoRef.current;
    if (!v) return;
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    setIsTransitioning(false);
    const seekSec = Math.max(0, kf.timestamp_ms / 1000 - startMs / 1000);
    const doSeek = () => { v.pause(); v.currentTime = seekSec; };
    if (v.readyState >= HTMLMediaElement.HAVE_METADATA) doSeek();
    else v.addEventListener('loadedmetadata', doSeek, { once: true });
  }, [currentIdx]); // eslint-disable-line

  // Speech cue on step change
  useEffect(() => {
    if (!keyframes.length) return;
    const cue = currentIdx === 0 ? 'Starting position'
      : currentIdx === total - 1 ? 'Landing position'
      : 'Watch the arm shape';
    speechManager.speak(cue, 'normal');
  }, [currentIdx]); // eslint-disable-line

  // Measure stickman panel for canvas dimensions
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const obs = new ResizeObserver(e => {
      const r = e[0].contentRect;
      setPanelSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Auto-advance countdown
  useEffect(() => {
    if (!autoAdvance || isTransitioning) { setAutoCountdown(AUTO_ADVANCE_SEC); return; }
    if (autoCountdown <= 0) { setAutoCountdown(AUTO_ADVANCE_SEC); goNext(); return; }
    const t = setTimeout(() => setAutoCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }); // eslint-disable-line — intentionally runs every render when autoAdvance is on

  useEffect(() => { setAutoCountdown(AUTO_ADVANCE_SEC); }, [currentIdx]);

  const goNext = useCallback(() => {
    if (isLast) { onComplete(); return; }
    const v = videoRef.current;
    if (!v || !nextKf) { setCurrentIdx(i => i + 1); return; }
    const targetSec = Math.max(0, nextKf.timestamp_ms / 1000 - startMs / 1000);
    setIsTransitioning(true);
    let fired = false;
    const onTU = () => {
      if (!fired && v.currentTime >= targetSec - 0.05) {
        fired = true; v.pause(); v.removeEventListener('timeupdate', onTU);
        setIsTransitioning(false); setCurrentIdx(i => i + 1);
      }
    };
    cleanupRef.current = () => { v.removeEventListener('timeupdate', onTU); v.pause(); };
    v.addEventListener('timeupdate', onTU);
    v.play().catch(() => { v.removeEventListener('timeupdate', onTU); setIsTransitioning(false); setCurrentIdx(i => i + 1); });
  }, [isLast, nextKf, startMs, onComplete]);

  const goPrev = useCallback(() => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (currentIdx > 0) setCurrentIdx(i => i - 1);
  }, [currentIdx]);

  useEffect(() => () => { if (cleanupRef.current) cleanupRef.current(); }, []);

  if (!keyframes.length) return null;
  const lm = kf?.landmarks ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-10 pb-3 shrink-0">
        <div>
          <p className="text-white/30 text-[11px] uppercase tracking-widest">Tutorial</p>
          <p className="text-white text-lg font-bold mt-0.5">Learn the moves</p>
        </div>
        <button
          onClick={() => setAutoAdvance(a => !a)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
            autoAdvance
              ? 'bg-violet-500/20 border-violet-500/50 text-violet-300'
              : 'bg-white/5 border-white/15 text-white/40'
          }`}
        >
          {autoAdvance ? <Timer className="w-3 h-3" /> : <TimerOff className="w-3 h-3" />}
          {autoAdvance ? `Auto ${autoCountdown}s` : 'Auto'}
        </button>
        <button onClick={onComplete} className="text-white/30 hover:text-white/60 text-sm transition-colors">Skip</button>
      </div>

      {/* Step dots */}
      <div className="flex justify-center gap-2 pb-3 shrink-0">
        {Array.from({ length: total }, (_, i) => (
          <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${
            i === currentIdx ? 'w-6 bg-violet-400' : i < currentIdx ? 'w-2 bg-violet-600' : 'w-2 bg-white/15'
          }`} />
        ))}
      </div>

      {/* Split screen */}
      <div className="flex-1 min-h-0 flex gap-3 px-4 pb-3 overflow-hidden">

        {/* Left — clip paused at keyframe */}
        <div className="flex-1 relative rounded-2xl overflow-hidden bg-black">
          {videoSrc
            ? <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline preload="metadata" />
            : <div className="absolute inset-0 flex items-center justify-center"><p className="text-white/20 text-sm">No video</p></div>
          }
          <div className="absolute top-3 left-3 z-10 bg-violet-600/80 backdrop-blur-sm text-white text-xs font-bold px-2.5 py-1 rounded-full">
            {currentIdx + 1} / {total}
          </div>
          <div className="absolute bottom-3 left-3 z-10">
            {isTransitioning
              ? <span className="bg-black/70 text-white text-xs px-2.5 py-1 rounded-full animate-pulse">▶ Playing</span>
              : <span className="bg-black/70 text-white/45 text-xs px-2.5 py-1 rounded-full">⏸ Paused</span>
            }
          </div>
        </div>

        {/* Right — stickman + instructions */}
        <div className="flex-1 flex flex-col gap-2.5 py-1 overflow-hidden">

          {/* Stickman panel */}
          <div ref={panelRef} className="flex-[1.4] relative rounded-2xl overflow-hidden bg-[#0f0f14] border border-white/8 min-h-0">
            {lm.length > 0 && panelSize.w > 0 && (
              <StickmanCanvas
                landmarks={lm}
                mode="upper_body"
                smooth={false}
                width={panelSize.w}
                height={panelSize.h}
                color="rgba(255,255,255,0.9)"
              />
            )}
            <div className="absolute bottom-2 inset-x-0 flex justify-center pointer-events-none">
              <span className="text-white/20 text-[9px]">Dancer position</span>
            </div>
          </div>

          {/* Step title */}
          <div className="shrink-0">
            <p className="text-white/30 text-[10px] uppercase tracking-widest mb-0.5">Step {currentIdx + 1} of {total}</p>
            <h3 className="text-white font-bold text-[15px] leading-tight">{getStepTitle(currentIdx, total)}</h3>
          </div>

          {/* Description */}
          <p className="text-white/60 text-[12px] leading-relaxed shrink-0">{getStepCue(currentIdx, total)}</p>

          {/* Coach tip */}
          <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl px-3 py-2 shrink-0">
            <p className="text-violet-300/50 text-[9px] uppercase tracking-widest mb-0.5">Coach</p>
            <p className="text-white/65 text-[11px] leading-relaxed">{getCoachTip(currentIdx, total)}</p>
          </div>

          {/* Auto-advance progress bar */}
          {autoAdvance && !isTransitioning && (
            <div className="w-full bg-white/8 rounded-full h-1 overflow-hidden shrink-0">
              <div
                className="h-full bg-violet-400 transition-all duration-1000 ease-linear"
                style={{ width: `${((AUTO_ADVANCE_SEC - autoCountdown) / AUTO_ADVANCE_SEC) * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex gap-3 px-5 pb-10 shrink-0">
        {currentIdx > 0 && (
          <button onClick={goPrev} disabled={isTransitioning}
            className="flex-1 py-4 bg-white/8 hover:bg-white/12 text-white/60 rounded-2xl font-medium transition-all disabled:opacity-40">
            ← Back
          </button>
        )}
        <button
          onClick={isLast ? onComplete : goNext}
          disabled={isTransitioning}
          className={`${currentIdx > 0 ? 'flex-[2]' : 'flex-1'} py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
            isLast ? 'bg-primary hover:bg-primary/90 text-white shadow-[0_0_20px_rgba(147,51,234,0.3)]' : 'bg-white/12 hover:bg-white/20 text-white'
          }`}
        >
          {isTransitioning ? <span className="animate-pulse">Watching…</span>
            : isLast ? <>Let&apos;s dance! 🕺</>
            : <>Next <ChevronRight className="w-4 h-4" /></>}
        </button>
      </div>
    </div>
  );
}
