import { useEffect, useRef, useState } from 'react';
import type { PoseFrame, PoseLandmark } from '@taal/shared/types/pose';
import { speechManager } from '@taal/shared/utils/SpeechManager';
import { ChevronRight, RotateCcw } from 'lucide-react';

interface TeachPhaseProps {
  keyframes: PoseFrame[];
  onComplete: () => void;
  /** Reference video URL — used as the primary teaching tool */
  videoSrc?: string;
  /** Chunk start/end for slicing the video */
  startMs?: number;
  endMs?: number;
}

// ─── Body Diagram ─────────────────────────────────────────────────────────────
// Draws a clear cartoon-style human figure with highlighted arm positions.
// Much more recognisable than raw landmark sticks for a beginner.
function BodyDiagram({
  landmarks,
  width,
  height,
  label,
}: {
  landmarks: PoseLandmark[];
  width: number;
  height: number;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c || width === 0 || height === 0) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const px = (x: number) => x * width;
    const py = (y: number) => y * height;

    const lm = landmarks;
    const vis = (idx: number) => (lm[idx]?.visibility ?? 0) > 0.3;

    // ── Draw full body silhouette first (dark gray background figure) ──────────
    // We draw a simple cartoon body: head + torso + limbs
    // then overlay the actual landmark data on top

    // Helper: midpoint
    const mid = (a: number, b: number, dim: 'x' | 'y') =>
      ((lm[a]?.[dim] ?? 0.5) + (lm[b]?.[dim] ?? 0.5)) / 2;

    // Body reference points
    const lSh  = lm[11], rSh  = lm[12];
    const lEl  = lm[13], rEl  = lm[14];
    const lWr  = lm[15], rWr  = lm[16];
    const lHip = lm[23], rHip = lm[24];
    const lKn  = lm[25], rKn  = lm[26];
    const lAn  = lm[27], rAn  = lm[28];
    const nose = lm[0];

    const shCX = mid(11, 12, 'x');
    const shCY = mid(11, 12, 'y');
    const hipCX = mid(23, 24, 'x');
    const hipCY = mid(23, 24, 'y');

    // ── 1. Body silhouette (torso + head + legs) in dark gray ───────────────
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.fillStyle   = 'rgba(255,255,255,0.06)';
    ctx.lineWidth   = 4;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    // Torso
    if (lSh && rSh && lHip && rHip) {
      ctx.beginPath();
      ctx.moveTo(px(lSh.x),  py(lSh.y));
      ctx.lineTo(px(rSh.x),  py(rSh.y));
      ctx.lineTo(px(rHip.x), py(rHip.y));
      ctx.lineTo(px(lHip.x), py(lHip.y));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Head (circle around nose)
    if (nose) {
      const headR = Math.abs((lSh?.y ?? shCY) - (nose?.y ?? shCY)) * height * 0.45;
      ctx.beginPath();
      ctx.arc(px(nose.x), py(nose.y), Math.max(headR, 12), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Legs (subtle)
    for (const [a, b] of [[23, 25], [25, 27], [24, 26], [26, 28]] as [number, number][]) {
      if (!lm[a] || !lm[b]) continue;
      ctx.beginPath();
      ctx.moveTo(px(lm[a].x), py(lm[a].y));
      ctx.lineTo(px(lm[b].x), py(lm[b].y));
      ctx.stroke();
    }
    ctx.restore();

    // ── 2. Arms — bright, thick, prominent ──────────────────────────────────
    ctx.save();
    ctx.lineCap = 'round';

    const ARM_SEGMENTS: [number, number, string][] = [
      [11, 13, 'left'],   // L upper arm
      [13, 15, 'left'],   // L forearm
      [12, 14, 'right'],  // R upper arm
      [14, 16, 'right'],  // R forearm
    ];

    for (const [i, j, side] of ARM_SEGMENTS) {
      if (!lm[i] || !lm[j]) continue;
      if (!vis(i) || !vis(j)) continue;

      const color = side === 'left' ? '#a78bfa' : '#34d399'; // purple=left, green=right
      const glow  = side === 'left' ? 'rgba(167,139,250,0.4)' : 'rgba(52,211,153,0.4)';

      // Glow layer
      ctx.shadowBlur   = 18;
      ctx.shadowColor  = glow;
      ctx.strokeStyle  = color;
      ctx.lineWidth    = 10;
      ctx.globalAlpha  = 0.5;
      ctx.beginPath();
      ctx.moveTo(px(lm[i].x), py(lm[i].y));
      ctx.lineTo(px(lm[j].x), py(lm[j].y));
      ctx.stroke();

      // Solid layer
      ctx.shadowBlur  = 0;
      ctx.globalAlpha = 1;
      ctx.lineWidth   = 6;
      ctx.beginPath();
      ctx.moveTo(px(lm[i].x), py(lm[i].y));
      ctx.lineTo(px(lm[j].x), py(lm[j].y));
      ctx.stroke();
    }

    // ── 3. Joint dots on arms ───────────────────────────────────────────────
    const ARM_JOINTS: [number, string][] = [
      [11, '#a78bfa'], [13, '#a78bfa'], [15, '#a78bfa'],
      [12, '#34d399'], [14, '#34d399'], [16, '#34d399'],
    ];
    for (const [idx, color] of ARM_JOINTS) {
      const p = lm[idx];
      if (!p || !vis(idx)) continue;
      ctx.shadowBlur  = 10;
      ctx.shadowColor = color;
      ctx.fillStyle   = '#fff';
      ctx.beginPath();
      ctx.arc(px(p.x), py(p.y), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // ── 4. Labels: LEFT / RIGHT on shoulders ───────────────────────────────
    if (lSh && vis(11)) {
      ctx.fillStyle   = '#a78bfa';
      ctx.font        = `bold ${Math.round(width * 0.04)}px sans-serif`;
      ctx.textAlign   = 'center';
      ctx.globalAlpha = 0.9;
      ctx.fillText('LEFT', px(lSh.x), py(lSh.y) - 14);
    }
    if (rSh && vis(12)) {
      ctx.fillStyle   = '#34d399';
      ctx.font        = `bold ${Math.round(width * 0.04)}px sans-serif`;
      ctx.textAlign   = 'center';
      ctx.globalAlpha = 0.9;
      ctx.fillText('RIGHT', px(rSh.x), py(rSh.y) - 14);
    }

    ctx.restore();

    // ── 5. Step label overlay ───────────────────────────────────────────────
    if (label) {
      ctx.save();
      ctx.fillStyle   = 'rgba(0,0,0,0.55)';
      ctx.roundRect?.(12, height - 42, label.length * 8 + 20, 30, 8);
      ctx.fill();
      ctx.fillStyle   = 'rgba(255,255,255,0.85)';
      ctx.font        = `600 ${Math.round(width * 0.038)}px sans-serif`;
      ctx.textAlign   = 'left';
      ctx.fillText(label, 22, height - 22);
      ctx.restore();
    }
  }, [landmarks, width, height, label]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className="absolute inset-0 w-full h-full"
    />
  );
}

// ─── Step labels ──────────────────────────────────────────────────────────────
const STEP_LABELS = [
  'Starting position',
  'First move',
  'Key shape',
  'Hold & finish',
];

const STEP_CUES = [
  'This is where you start — notice the arm position',
  'Watch how the arms move here',
  'This is the key shape — lock it in',
  'End strong — hold this position',
];

// ─── TeachPhase ───────────────────────────────────────────────────────────────

export function TeachPhase({ keyframes, onComplete, videoSrc, startMs = 0, endMs }: TeachPhaseProps) {
  const [mode, setMode]         = useState<'diagram' | 'done'>(videoSrc ? 'diagram' : 'diagram');
  const [currentIdx, setCurrentIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims]         = useState({ w: 0, h: 0 });

  // Measure container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const e = entries[0];
      setDims({ w: e.contentRect.width, h: e.contentRect.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // No keyframes — skip
  useEffect(() => {
    if (keyframes.length === 0) { onComplete(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Speak cue when frame changes
  useEffect(() => {
    if (keyframes.length === 0) return;
    const cue = STEP_CUES[Math.min(currentIdx, STEP_CUES.length - 1)];
    speechManager.speak(cue, 'normal');
  }, [currentIdx, keyframes.length]);

  if (keyframes.length === 0) return null;

  const total       = keyframes.length;
  const isLast      = currentIdx >= total - 1;
  const currentPose = keyframes[currentIdx]?.landmarks;
  const label       = STEP_LABELS[Math.min(currentIdx, STEP_LABELS.length - 1)];

  const goNext = () => {
    if (isLast) {
      onComplete();
    } else {
      setCurrentIdx(i => i + 1);
    }
  };

  const goPrev = () => {
    if (currentIdx > 0) setCurrentIdx(i => i - 1);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-10 pb-4 shrink-0">
        <div>
          <p className="text-white/30 text-[11px] uppercase tracking-widest">Tutorial</p>
          <p className="text-white text-xl font-bold mt-0.5">Study the arm positions</p>
        </div>
        <button
          onClick={onComplete}
          className="text-white/30 hover:text-white/60 text-sm transition-colors"
        >
          Skip
        </button>
      </div>

      {/* Step dots */}
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

      {/* Diagram area */}
      <div
        ref={containerRef}
        className="flex-1 relative mx-5 rounded-2xl overflow-hidden bg-gray-950 border border-white/8 min-h-0"
      >
        {currentPose && dims.w > 0 && (
          <BodyDiagram
            landmarks={currentPose}
            width={dims.w}
            height={dims.h}
            label={label}
          />
        )}

        {/* Color legend */}
        <div className="absolute top-3 right-3 flex flex-col gap-1.5 z-10">
          <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur px-2 py-1 rounded-lg">
            <div className="w-3 h-3 rounded-full bg-violet-400" />
            <span className="text-[11px] text-white/70 font-medium">Left arm</span>
          </div>
          <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur px-2 py-1 rounded-lg">
            <div className="w-3 h-3 rounded-full bg-emerald-400" />
            <span className="text-[11px] text-white/70 font-medium">Right arm</span>
          </div>
        </div>
      </div>

      {/* Cue text */}
      <p className="text-white/50 text-sm text-center px-6 py-3 shrink-0">
        {STEP_CUES[Math.min(currentIdx, STEP_CUES.length - 1)]}
      </p>

      {/* Navigation buttons */}
      <div className="flex gap-3 px-5 pb-10 shrink-0">
        {currentIdx > 0 && (
          <button
            onClick={goPrev}
            className="flex-1 py-4 bg-white/8 hover:bg-white/12 text-white/60 rounded-2xl font-medium transition-all flex items-center justify-center gap-2"
          >
            ← Back
          </button>
        )}

        <button
          onClick={goNext}
          className={`${currentIdx > 0 ? 'flex-[2]' : 'flex-1'} py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 ${
            isLast
              ? 'bg-primary hover:bg-primary/90 text-white shadow-[0_0_20px_rgba(147,51,234,0.3)]'
              : 'bg-white/12 hover:bg-white/20 text-white'
          }`}
        >
          {isLast ? (
            <>Let&apos;s dance! 🕺</>
          ) : (
            <>Next <ChevronRight className="w-4 h-4" /></>
          )}
        </button>
      </div>
    </div>
  );
}
