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
// Draws a filled "gingerbread person" figure — recognisable as human, not a stick figure.
// Head = filled circle, torso = rounded rectangle, limbs = thick rounded capsule shapes.
// Arms are large and coloured: left arm = purple, right arm = green.
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

    const lm = landmarks;
    const vis = (idx: number) => (lm[idx]?.visibility ?? 0) > 0.25;

    const px = (x: number) => x * width;
    const py = (y: number) => y * height;

    // Helper — draw a filled "capsule" (line with round caps) representing a limb
    const capsule = (x1: number, y1: number, x2: number, y2: number, r: number, color: string, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth   = r * 2;
      ctx.lineCap     = 'round';
      ctx.shadowBlur  = 0;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    };

    const lSh = lm[11], rSh = lm[12];
    const lEl = lm[13], rEl = lm[14];
    const lWr = lm[15], rWr = lm[16];
    const lHip = lm[23], rHip = lm[24];
    const lKn = lm[25],  rKn = lm[26];
    const lAn = lm[27],  rAn = lm[28];
    const nose = lm[0];

    // Dimensions
    const armW  = Math.max(8, width * 0.055); // capsule half-radius for arms
    const limbW = Math.max(5, width * 0.035); // legs / torso
    const bodyGray = 'rgba(255,255,255,0.18)';
    const leftColor  = '#a78bfa'; // purple
    const rightColor = '#34d399'; // green

    // ── 1. Gray body outline (torso + legs — background layer) ──────────────
    if (lSh && rSh && lHip && rHip) {
      const torsoX = (px(lSh.x) + px(rSh.x) + px(lHip.x) + px(rHip.x)) / 4;
      const torsoY = (py(lSh.y) + py(rSh.y)) / 2;
      const torsoBotY = (py(lHip.y) + py(rHip.y)) / 2;
      // Torso as a single capsule from shoulders to hips
      capsule(torsoX, torsoY, torsoX, torsoBotY, limbW * 1.6, bodyGray);
    }
    // Legs
    for (const [a, b] of [[23, 25], [25, 27], [24, 26], [26, 28]] as [number, number][]) {
      if (!lm[a] || !lm[b] || !vis(a) || !vis(b)) continue;
      capsule(px(lm[a].x), py(lm[a].y), px(lm[b].x), py(lm[b].y), limbW, bodyGray);
    }

    // ── 2. Left arm — PURPLE ─────────────────────────────────────────────────
    if (lSh && lEl && vis(11) && vis(13)) {
      // Glow
      ctx.save();
      ctx.shadowBlur  = 20; ctx.shadowColor = leftColor;
      ctx.strokeStyle = leftColor; ctx.lineWidth = armW * 2; ctx.lineCap = 'round';
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.moveTo(px(lSh.x), py(lSh.y)); ctx.lineTo(px(lEl.x), py(lEl.y)); ctx.stroke();
      ctx.restore();
      capsule(px(lSh.x), py(lSh.y), px(lEl.x), py(lEl.y), armW, leftColor);
    }
    if (lEl && lWr && vis(13) && vis(15)) {
      capsule(px(lEl.x), py(lEl.y), px(lWr.x), py(lWr.y), armW * 0.85, leftColor);
    }

    // ── 3. Right arm — GREEN ─────────────────────────────────────────────────
    if (rSh && rEl && vis(12) && vis(14)) {
      ctx.save();
      ctx.shadowBlur  = 20; ctx.shadowColor = rightColor;
      ctx.strokeStyle = rightColor; ctx.lineWidth = armW * 2; ctx.lineCap = 'round';
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.moveTo(px(rSh.x), py(rSh.y)); ctx.lineTo(px(rEl.x), py(rEl.y)); ctx.stroke();
      ctx.restore();
      capsule(px(rSh.x), py(rSh.y), px(rEl.x), py(rEl.y), armW, rightColor);
    }
    if (rEl && rWr && vis(14) && vis(16)) {
      capsule(px(rEl.x), py(rEl.y), px(rWr.x), py(rWr.y), armW * 0.85, rightColor);
    }

    // ── 4. Filled head circle ─────────────────────────────────────────────────
    if (nose && vis(0)) {
      const headR = lSh ? Math.max(14, Math.abs(py(lSh.y) - py(nose.y)) * 0.5) : 20;
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      ctx.strokeStyle = 'rgba(255,255,255,0.30)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px(nose.x), py(nose.y), headR, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // Simple face dots
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(px(nose.x) - headR * 0.28, py(nose.y) - headR * 0.1, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(px(nose.x) + headR * 0.28, py(nose.y) - headR * 0.1, 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // ── 5. Labels ───────────────────────────────────────────────────────────
    const fontSize = Math.max(11, Math.round(width * 0.042));
    ctx.font    = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    if (lSh && vis(11)) {
      ctx.fillStyle = leftColor;
      ctx.fillText('LEFT', px(lSh.x), py(lSh.y) - armW - 6);
    }
    if (rSh && vis(12)) {
      ctx.fillStyle = rightColor;
      ctx.fillText('RIGHT', px(rSh.x), py(rSh.y) - armW - 6);
    }

    // ── 6. Step label pill ───────────────────────────────────────────────────
    if (label) {
      const lw = ctx.measureText(label).width + 24;
      const lx = width / 2 - lw / 2;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.roundRect?.(lx, height - 38, lw, 26, 13);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.80)';
      ctx.font = `600 ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(label, width / 2, height - 20);
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
