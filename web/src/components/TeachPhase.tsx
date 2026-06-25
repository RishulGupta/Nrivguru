import { useEffect, useRef, useState, useCallback } from 'react';
import type { PoseFrame, PoseLandmark } from '@taal/shared/types/pose';
import { speechManager } from '@taal/shared/utils/SpeechManager';
import { ChevronRight } from 'lucide-react';

// ─── Arm Map — clean SVG diagram showing only the arms ───────────────────────
// Not a skeleton or blob. Just arm lines (shoulder → elbow → wrist) with dots.
// Purple = left arm, green = right arm. Shows the pose shape at a glance.
function ArmMap({ lm }: { lm: PoseLandmark[] | undefined }) {
  if (!lm) return null;

  const W = 110, H = 90;
  const lSh = lm[11], rSh = lm[12];
  const lEl = lm[13], rEl = lm[14];
  const lWr = lm[15], rWr = lm[16];
  if (!lSh || !rSh) return null;

  const cx = (lSh.x + rSh.x) / 2;
  const cy = (lSh.y + rSh.y) / 2;
  const sw = Math.max(Math.abs(lSh.x - rSh.x), 0.12);
  const scale = (W * 0.38) / sw;

  const pt = (p: PoseLandmark | undefined): [number, number] | null => {
    if (!p || (p.visibility ?? 0) < 0.25) return null;
    return [W / 2 + (p.x - cx) * scale, H * 0.18 + (p.y - cy) * scale];
  };

  const lShP = pt(lSh), rShP = pt(rSh);
  const lElP = pt(lEl), rElP = pt(rEl);
  const lWrP = pt(lWr), rWrP = pt(rWr);

  const path = (...pts: ([number, number] | null)[]) => {
    const v = pts.filter(Boolean) as [number, number][];
    if (v.length < 2) return '';
    return `M${v[0][0]},${v[0][1]} ` + v.slice(1).map(p => `L${p[0]},${p[1]}`).join(' ');
  };

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible shrink-0">
      {/* Shoulder bar */}
      {lShP && rShP && (
        <line x1={lShP[0]} y1={lShP[1]} x2={rShP[0]} y2={rShP[1]}
          stroke="rgba(255,255,255,0.12)" strokeWidth="3" strokeLinecap="round" />
      )}
      {/* Left arm — purple */}
      <path d={path(lShP, lElP, lWrP)} fill="none" stroke="#a78bfa" strokeWidth="3.5"
        strokeLinecap="round" strokeLinejoin="round" />
      {lWrP && <circle cx={lWrP[0]} cy={lWrP[1]} r="5.5" fill="#a78bfa" />}
      {lElP && <circle cx={lElP[0]} cy={lElP[1]} r="3.5" fill="#a78bfa" opacity="0.7" />}
      {/* Right arm — green */}
      <path d={path(rShP, rElP, rWrP)} fill="none" stroke="#34d399" strokeWidth="3.5"
        strokeLinecap="round" strokeLinejoin="round" />
      {rWrP && <circle cx={rWrP[0]} cy={rWrP[1]} r="5.5" fill="#34d399" />}
      {rElP && <circle cx={rElP[0]} cy={rElP[1]} r="3.5" fill="#34d399" opacity="0.7" />}
      {/* Wrist labels */}
      {lWrP && (
        <text x={lWrP[0]} y={lWrP[1] + 14} textAnchor="middle"
          fill="#a78bfa" fontSize="8" fontWeight="bold" opacity="0.8">L</text>
      )}
      {rWrP && (
        <text x={rWrP[0]} y={rWrP[1] + 14} textAnchor="middle"
          fill="#34d399" fontSize="8" fontWeight="bold" opacity="0.8">R</text>
      )}
    </svg>
  );
}

interface TeachPhaseProps {
  keyframes: PoseFrame[];
  onComplete: () => void;
  /** Reference video URL */
  videoSrc?: string;
  /** Chunk start offset in the original full video (ms) */
  startMs?: number;
  endMs?: number;
}

// ─── Step content helpers ────────────────────────────────────────────────────

function getStepTitle(idx: number, total: number): string {
  if (idx === 0) return 'Starting Position';
  if (idx === total - 1) return 'Landing Position';
  const mid = ['First Move', 'Key Shape', 'Transition', 'The Peak', 'Follow-through'];
  return mid[Math.min(idx - 1, mid.length - 1)];
}

function getStepBody(lm: PoseLandmark[] | undefined, idx: number, total: number): string {
  if (idx === 0) {
    return 'Memorize this before anything moves. Notice where both arms sit and how relaxed the shoulders are.';
  }
  if (idx === total - 1) {
    return "The move ends right here. Stick this shape for a full beat — don't rush out of it.";
  }

  if (lm) {
    const lWr = lm[15], lSh = lm[11];
    const rWr = lm[16], rSh = lm[12];
    const lRaised = lWr && lSh ? lWr.y < lSh.y - 0.08 : false;
    const rRaised = rWr && rSh ? rWr.y < rSh.y - 0.08 : false;

    if (lRaised && rRaised) {
      return 'Both arms lift here. Keep your shoulders down even as the arms go up — let the elbows lead, not the shoulders.';
    }
    if (lRaised !== rRaised) {
      return 'One arm goes high, the other stays low. The contrast between them IS the shape — get both right.';
    }
  }

  return 'Pause the clip in your mind at this exact frame. Match every angle before moving on.';
}

function getStepTip(lm: PoseLandmark[] | undefined, idx: number, total: number): string {
  if (idx === 0) return 'Shoulders back, weight even on both feet. Loose, not stiff.';
  if (idx === total - 1) return 'Hold for a beat. Then the next move will feel natural.';

  if (lm) {
    const armBent = (sh?: PoseLandmark, el?: PoseLandmark, wr?: PoseLandmark) => {
      if (!sh || !el || !wr) return false;
      const dx = wr.x - sh.x, dy = wr.y - sh.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.05) return false;
      const t = ((el.x - sh.x) * dx + (el.y - sh.y) * dy) / (len * len);
      const dev = Math.sqrt((el.x - (sh.x + t * dx)) ** 2 + (el.y - (sh.y + t * dy)) ** 2);
      return dev > 0.07;
    };

    const lBent = armBent(lm[11], lm[13], lm[15]);
    const rBent = armBent(lm[12], lm[14], lm[16]);

    if (lBent && rBent) return "Both elbows are bent here — don't lock them out.";
    if (lBent || rBent) return 'One arm bends, one stays straight — that angle is the detail people miss.';
  }

  return 'Focus on your wrists — where the wrist goes, the whole arm follows.';
}

// ─── TeachPhase ─────────────────────────────────────────────────────────────

export function TeachPhase({ keyframes, onComplete, videoSrc, startMs = 0 }: TeachPhaseProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const total = keyframes.length;
  const isLast = currentIdx >= total - 1;
  const kf = keyframes[currentIdx];
  const nextKf = keyframes[currentIdx + 1];

  // Skip immediately when there are no keyframes
  useEffect(() => {
    if (keyframes.length === 0) onComplete();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load video src once on mount
  useEffect(() => {
    if (!videoSrc) return;
    const v = videoRef.current;
    if (!v) return;
    v.src = videoSrc;
    v.load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSrc]);

  // Seek to current keyframe whenever step changes
  useEffect(() => {
    if (!kf) return;
    const v = videoRef.current;
    if (!v) return;

    // Cancel any in-progress transition
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    setIsTransitioning(false);

    // timestamp_ms is absolute video time; subtract chunk offset for pre-cut clips
    const seekSec = Math.max(0, kf.timestamp_ms / 1000 - startMs / 1000);

    const doSeek = () => { v.pause(); v.currentTime = seekSec; };

    if (v.readyState >= HTMLMediaElement.HAVE_METADATA) {
      doSeek();
    } else {
      v.addEventListener('loadedmetadata', doSeek, { once: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  // Speak step cue
  useEffect(() => {
    if (keyframes.length === 0) return;
    const cue = currentIdx === 0
      ? 'This is your starting position'
      : currentIdx === total - 1
        ? 'This is where the move lands'
        : 'Watch how the arms move here';
    speechManager.speak(cue, 'normal');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  const goNext = useCallback(() => {
    if (isLast) { onComplete(); return; }

    const v = videoRef.current;
    if (!v || !nextKf) { setCurrentIdx(i => i + 1); return; }

    const targetSec = Math.max(0, nextKf.timestamp_ms / 1000 - startMs / 1000);
    setIsTransitioning(true);

    let fired = false;
    const onTimeUpdate = () => {
      if (!fired && v.currentTime >= targetSec - 0.05) {
        fired = true;
        v.pause();
        v.removeEventListener('timeupdate', onTimeUpdate);
        setIsTransitioning(false);
        setCurrentIdx(i => i + 1);
      }
    };

    cleanupRef.current = () => {
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.pause();
    };

    v.addEventListener('timeupdate', onTimeUpdate);
    v.play().catch(() => {
      v.removeEventListener('timeupdate', onTimeUpdate);
      setIsTransitioning(false);
      setCurrentIdx(i => i + 1);
    });
  }, [isLast, nextKf, startMs, onComplete]);

  const goPrev = useCallback(() => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (currentIdx > 0) setCurrentIdx(i => i - 1);
  }, [currentIdx]);

  useEffect(() => () => { if (cleanupRef.current) cleanupRef.current(); }, []);

  if (keyframes.length === 0) return null;

  const lm = kf?.landmarks;

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 pt-10 pb-3 shrink-0">
        <div>
          <p className="text-white/30 text-[11px] uppercase tracking-widest">Tutorial</p>
          <p className="text-white text-lg font-bold mt-0.5">Learn the moves</p>
        </div>
        <button
          onClick={onComplete}
          className="text-white/30 hover:text-white/60 text-sm transition-colors"
        >
          Skip
        </button>
      </div>

      {/* ── Step dots ── */}
      <div className="flex justify-center gap-2 pb-3 shrink-0">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === currentIdx
                ? 'w-6 bg-violet-400'
                : i < currentIdx
                  ? 'w-2 bg-violet-600'
                  : 'w-2 bg-white/15'
            }`}
          />
        ))}
      </div>

      {/* ── Split screen: video left | instructions right ── */}
      <div className="flex-1 min-h-0 flex gap-3 px-4 pb-3 overflow-hidden">

        {/* Left — clip paused at this step's moment in time */}
        <div className="flex-1 relative rounded-2xl overflow-hidden bg-gray-950">
          {videoSrc ? (
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-white/20 text-sm">No video</p>
            </div>
          )}

          {/* Step counter badge */}
          <div className="absolute top-3 left-3 z-10 bg-violet-600/80 backdrop-blur-sm text-white text-xs font-bold px-2.5 py-1 rounded-full">
            {currentIdx + 1} / {total}
          </div>

          {/* Playback state */}
          <div className="absolute bottom-3 left-3 z-10">
            {isTransitioning ? (
              <span className="bg-black/70 text-white text-xs px-2.5 py-1 rounded-full animate-pulse">
                ▶ Playing
              </span>
            ) : (
              <span className="bg-black/70 text-white/50 text-xs px-2.5 py-1 rounded-full">
                ⏸ Paused
              </span>
            )}
          </div>
        </div>

        {/* Right — step description + arm map */}
        <div className="flex-1 flex flex-col gap-3 py-1 overflow-hidden">

          {/* Step label + title */}
          <div>
            <p className="text-white/30 text-[10px] uppercase tracking-widest mb-0.5">
              Step {currentIdx + 1} of {total}
            </p>
            <h3 className="text-white font-bold text-[16px] leading-tight">
              {getStepTitle(currentIdx, total)}
            </h3>
          </div>

          {/* Arm map diagram — shows arm positions as clean lines, not blobs */}
          {lm && (
            <div className="bg-white/4 border border-white/8 rounded-xl p-2 flex flex-col items-center gap-1">
              <ArmMap lm={lm} />
              <div className="flex gap-3 text-[9px] text-white/40">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-400 inline-block" />Left</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />Right</span>
              </div>
            </div>
          )}

          {/* Description */}
          <p className="text-white/60 text-[12px] leading-relaxed">
            {getStepBody(lm, currentIdx, total)}
          </p>

          {/* Coach tip */}
          <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-2.5">
            <p className="text-violet-300/50 text-[9px] uppercase tracking-widest mb-0.5">Coach</p>
            <p className="text-white/65 text-[11px] leading-relaxed">
              {getStepTip(lm, currentIdx, total)}
            </p>
          </div>

          {/* Nudge */}
          <p className="text-white/20 text-[10px] text-center mt-auto">
            {isTransitioning ? 'Watch closely…' : isLast ? "Ready? Let's go!" : 'Next → video plays forward'}
          </p>
        </div>
      </div>

      {/* ── Navigation ── */}
      <div className="flex gap-3 px-5 pb-10 shrink-0">
        {currentIdx > 0 && (
          <button
            onClick={goPrev}
            disabled={isTransitioning}
            className="flex-1 py-4 bg-white/8 hover:bg-white/12 text-white/60 rounded-2xl font-medium transition-all disabled:opacity-40"
          >
            ← Back
          </button>
        )}

        <button
          onClick={isLast ? onComplete : goNext}
          disabled={isTransitioning}
          className={`${currentIdx > 0 ? 'flex-[2]' : 'flex-1'} py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
            isLast
              ? 'bg-primary hover:bg-primary/90 text-white shadow-[0_0_20px_rgba(147,51,234,0.3)]'
              : 'bg-white/12 hover:bg-white/20 text-white'
          }`}
        >
          {isTransitioning ? (
            <span className="animate-pulse">Watching…</span>
          ) : isLast ? (
            <>Let&apos;s dance! 🕺</>
          ) : (
            <>Next <ChevronRight className="w-4 h-4" /></>
          )}
        </button>
      </div>
    </div>
  );
}
