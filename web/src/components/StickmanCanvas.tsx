/**
 * StickmanCanvas — clean, humanized stick figure renderer.
 *
 * Design goals:
 *  - ~10 joints (upper body) or ~14 (full body) — not all 33 MediaPipe points
 *  - Capsule-shaped limbs (rounded thick lines), not thin wires
 *  - Confidence-aware: low-confidence joints fade out (honest, not glitchy)
 *  - Dynamic viewport: figure always fills canvas even for extreme poses
 *  - Adaptive smoothing: slow moves smooth, fast snaps responsive
 *  - Optional ghost: reference stickman drawn behind primary
 *  - Color-coded limbs based on joint accuracy scores
 */

import { useRef, useEffect, useState } from 'react';
import type { PoseLandmark } from '@taal/shared/types/pose';

// ── Joint indices ─────────────────────────────────────────────────────────────
const JOINTS_UPPER = [0, 11, 12, 13, 14, 15, 16, 23, 24] as const;
const JOINTS_FULL  = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const;

const EDGES_UPPER: [number, number][] = [
  [11, 13], [13, 15],  // left arm
  [12, 14], [14, 16],  // right arm
  [11, 12],             // shoulder bar
  [11, 23], [12, 24],  // torso sides
  [23, 24],             // hip bar
];
const EDGES_FULL: [number, number][] = [
  ...EDGES_UPPER,
  [23, 25], [25, 27],  // left leg
  [24, 26], [26, 28],  // right leg
];

const DOT_UPPER = [13, 14, 15, 16];
const DOT_FULL  = [13, 14, 15, 16, 25, 26, 27, 28];

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number | undefined, fallback: string): string {
  if (score === undefined) return fallback;
  if (score >= 75) return '#4ade80';
  if (score >= 45) return '#fbbf24';
  return '#f87171';
}

type V3 = { x: number; y: number; z: number };

function ema(prev: V3, next: V3): V3 {
  const d = Math.sqrt((next.x - prev.x) ** 2 + (next.y - prev.y) ** 2);
  const a = d > 0.08 ? 0.85 : 0.35; // snap on fast moves, smooth on slow
  return { x: a * next.x + (1 - a) * prev.x, y: a * next.y + (1 - a) * prev.y, z: a * next.z + (1 - a) * prev.z };
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface StickmanCanvasProps {
  landmarks: PoseLandmark[];
  ghostLandmarks?: PoseLandmark[];
  jointScores?: Record<number, number>;
  mode?: 'upper_body' | 'full_body';
  smooth?: boolean;
  width: number;
  height: number;
  color?: string;
}

export function StickmanCanvas({
  landmarks,
  ghostLandmarks,
  jointScores,
  mode = 'upper_body',
  smooth = true,
  width,
  height,
  color = 'rgba(255,255,255,0.92)',
}: StickmanCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smoothRef = useRef<(V3 | null)[]>(Array(33).fill(null));
  const vpRef     = useRef<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0 || height === 0 || !landmarks?.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width  = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);

    const jointList = mode === 'full_body' ? [...JOINTS_FULL] : [...JOINTS_UPPER];
    const edges     = mode === 'full_body' ? EDGES_FULL : EDGES_UPPER;
    const dotList   = mode === 'full_body' ? DOT_FULL : DOT_UPPER;

    // Smooth primary landmarks
    const pos: (V3 | null)[] = Array(33).fill(null);
    for (const idx of jointList) {
      const raw = landmarks[idx];
      if (!raw || (raw.visibility ?? 0) < 0.1) { smoothRef.current[idx] = null; continue; }
      const next: V3 = { x: raw.x, y: raw.y, z: raw.z ?? 0 };
      if (!smooth) { pos[idx] = next; continue; }
      const prev = smoothRef.current[idx];
      const r = prev ? ema(prev, next) : next;
      smoothRef.current[idx] = r;
      pos[idx] = r;
    }

    // Dynamic viewport: bounding box of ALL visible points (primary + ghost)
    const allPts: V3[] = [];
    for (const idx of jointList) {
      if (pos[idx]) allPts.push(pos[idx]!);
      if (ghostLandmarks?.[idx] && (ghostLandmarks[idx].visibility ?? 0) > 0.2)
        allPts.push({ x: ghostLandmarks[idx].x, y: ghostLandmarks[idx].y, z: 0 });
    }
    if (!allPts.length) return;

    const rawMinX = Math.min(...allPts.map(p => p.x));
    const rawMaxX = Math.max(...allPts.map(p => p.x));
    const rawMinY = Math.min(...allPts.map(p => p.y));
    const rawMaxY = Math.max(...allPts.map(p => p.y));

    // Smooth viewport bounds separately to avoid pop when joints appear/disappear
    let vp = vpRef.current ?? { minX: rawMinX, maxX: rawMaxX, minY: rawMinY, maxY: rawMaxY };
    const va = 0.18;
    vp = { minX: va * rawMinX + (1 - va) * vp.minX, maxX: va * rawMaxX + (1 - va) * vp.maxX,
           minY: va * rawMinY + (1 - va) * vp.minY, maxY: va * rawMaxY + (1 - va) * vp.maxY };
    vpRef.current = vp;

    const pad    = 0.14;
    const vw     = Math.max(vp.maxX - vp.minX, 0.12);
    const vh     = Math.max(vp.maxY - vp.minY, 0.12);
    const scale  = Math.min(width * (1 - 2 * pad) / vw, height * (1 - 2 * pad) / vh);
    const ox     = width / 2  - ((vp.minX + vp.maxX) / 2) * scale;
    const oy     = height / 2 - ((vp.minY + vp.maxY) / 2) * scale;
    const toXY   = (p: V3): [number, number] => [p.x * scale + ox, p.y * scale + oy];

    const lw = Math.max(5, width * 0.046); // base limb width

    const drawFigure = (lmArr: PoseLandmark[], pts: (V3 | null)[], ghost: boolean) => {
      ctx.save();

      // Edges
      for (const [a, b] of edges) {
        const pa = pts[a], pb = pts[b];
        if (!pa || !pb) continue;
        const visAvg = ((lmArr[a]?.visibility ?? 0) + (lmArr[b]?.visibility ?? 0)) / 2;
        if (visAvg < 0.12) continue;
        const alpha = (ghost ? 0.32 : 1) * Math.min(1, (visAvg - 0.12) / 0.38);

        let c = ghost ? '#9333ea' : color;
        if (!ghost && jointScores) c = scoreColor(Math.min(jointScores[a] ?? 100, jointScores[b] ?? 100), color);

        const [x1, y1] = toXY(pa), [x2, y2] = toXY(pb);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = c;
        ctx.lineWidth   = ghost ? lw * 0.62 : lw;
        ctx.lineCap     = 'round';
        if (!ghost && jointScores) { ctx.shadowBlur = 6; ctx.shadowColor = c; }
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();
      }

      // Key joint dots (elbows, wrists, knees, ankles)
      for (const idx of dotList) {
        const p = pts[idx];
        if (!p) continue;
        const vis = lmArr[idx]?.visibility ?? 0;
        if (vis < 0.18) continue;
        const alpha = (ghost ? 0.35 : 1) * Math.min(1, (vis - 0.18) / 0.32);

        let c = ghost ? '#a855f7' : color;
        if (!ghost && jointScores?.[idx] !== undefined) c = scoreColor(jointScores[idx], color);

        const [dx, dy] = toXY(p);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle   = c;
        if (!ghost && jointScores) { ctx.shadowBlur = 10; ctx.shadowColor = c; }
        ctx.beginPath(); ctx.arc(dx, dy, ghost ? lw * 0.52 : lw * 0.72, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // Head circle (from nose landmark, radius derived from shoulder width)
      const nose = pts[0];
      if (nose && (lmArr[0]?.visibility ?? 0) > 0.2) {
        const nVis  = lmArr[0]?.visibility ?? 0;
        const alpha = (ghost ? 0.3 : 1) * Math.min(1, (nVis - 0.2) / 0.3);
        const lShP  = pts[11], rShP = pts[12];
        let r = lw * 1.8;
        if (lShP && rShP) r = Math.abs(toXY(rShP)[0] - toXY(lShP)[0]) * 0.27;
        r = Math.max(lw * 1.1, Math.min(r, lw * 3.2));

        const [hx, hy] = toXY(nose);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = ghost ? '#9333ea' : color;
        ctx.lineWidth   = ghost ? lw * 0.52 : lw * 0.88;
        if (!ghost) { ctx.shadowBlur = 5; ctx.shadowColor = color; }
        ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    };

    // Ghost first (behind)
    if (ghostLandmarks?.length) {
      const gPos: (V3 | null)[] = Array(33).fill(null);
      for (const idx of jointList) {
        const g = ghostLandmarks[idx];
        if (g && (g.visibility ?? 0) > 0.12) gPos[idx] = { x: g.x, y: g.y, z: g.z ?? 0 };
      }
      drawFigure(ghostLandmarks, gPos, true);
    }

    drawFigure(landmarks, pos, false);

  }, [landmarks, ghostLandmarks, jointScores, mode, smooth, width, height, color]);

  return <canvas ref={canvasRef} width={width} height={height} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

// ── Pose replay hook ──────────────────────────────────────────────────────────
// Animates a recorded pose sequence (for the 2×2 results grid).

export function usePoseReplay(poses: PoseLandmark[][] | null, fps = 5, playing = true): PoseLandmark[] | null {
  const [frameIdx, setFrameIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!poses?.length || !playing) return;
    setFrameIdx(0);
    timerRef.current = setInterval(() => setFrameIdx(i => (i + 1) % poses.length), 1000 / fps);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [poses, fps, playing]);

  if (!poses?.length) return null;
  return poses[Math.min(frameIdx, poses.length - 1)];
}
