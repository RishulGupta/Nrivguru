import { useEffect, useRef, useCallback } from 'react';
import { generateCorrectionArrows } from '@taal/shared/utils/MistakeHighlighter';
import type { PoseLandmark } from '@taal/shared/types/pose';

interface SkeletonCanvasProps {
  landmarks: PoseLandmark[] | null;
  refLandmarks?: PoseLandmark[] | null;
  width: number;
  height: number;
  jointScores?: Record<number, number>;
  focusArea?: 'arms' | 'legs' | 'full' | 'idle' | 'combine' | 'watch' | 'teach';
  showArrows?: boolean;
}

type RGB = [number, number, number];

// Arms-only connections for upper-body practice phase
const ARM_CONNECTIONS: [number, number][] = [
  [11, 13], [13, 15], // left shoulder→elbow→wrist
  [12, 14], [14, 16], // right shoulder→elbow→wrist
  [11, 12],           // shoulder bridge
];
const ARM_JOINT_INDICES = [11, 12, 13, 14, 15, 16];

// Full body groups for non-arms phases
const BODY_GROUPS: { connections: [number, number][]; rgb: RGB }[] = [
  { connections: [[11,12],[11,23],[12,24],[23,24]], rgb: [200,180,255] },
  { connections: [[11,13],[13,15]],                rgb: [155,200,255] },
  { connections: [[12,14],[14,16]],                rgb: [180,230,200] },
  { connections: [[23,25],[25,27],[27,31],[31,29],[29,27]], rgb: [255,180,180] },
  { connections: [[24,26],[26,28],[28,32],[32,30],[30,28]], rgb: [180,210,255] },
  { connections: [[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8]], rgb: [255,220,180] },
];

const VIS_THRESHOLD = 0.4;

function rgba(rgb: RGB, a: number) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

// Map score 0-100 to RGB. Only two states: good (white) or needs-work (amber).
// ponytail: two states not a gradient — beginner can't parse gradients mid-dance
function scoreToRGB(score: number | undefined, isWorstArm: boolean): RGB {
  if (score === undefined) return [255, 255, 255];
  if (isWorstArm && score < 75) return [255, 185, 70]; // amber
  return [255, 255, 255]; // white
}

function isArmsPhase(focusArea?: string): boolean {
  return focusArea === 'arms';
}

export default function SkeletonCanvas({
  landmarks,
  refLandmarks,
  width,
  height,
  jointScores,
  focusArea,
  showArrows = false,
}: SkeletonCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Refs for rAF loop — no deps so loop never restarts on prop change
  const lmRef          = useRef<PoseLandmark[] | null>(null);
  const refLmRef       = useRef<PoseLandmark[] | null>(null);
  const scoresRef      = useRef<Record<number, number> | undefined>(jointScores);
  const focusRef       = useRef(focusArea);
  const showArrowsRef  = useRef(showArrows);
  const rafRef         = useRef<number>(0);
  const pulseRef       = useRef(0);

  useEffect(() => { lmRef.current     = landmarks;           }, [landmarks]);
  useEffect(() => { refLmRef.current  = refLandmarks ?? null; }, [refLandmarks]);
  useEffect(() => { scoresRef.current = jointScores;         }, [jointScores]);
  useEffect(() => { focusRef.current  = focusArea;           }, [focusArea]);
  useEffect(() => { showArrowsRef.current = showArrows;      }, [showArrows]);

  // Compute which arm joint is the worst so we highlight only one
  const worstArmJoint = useCallback((): number | null => {
    const s = scoresRef.current;
    if (!s) return null;
    // Only check shoulder and elbow indices for arms
    const armScores = [11, 12, 13, 14].map(i => ({ i, score: s[i] ?? 100 }));
    const worst = armScores.reduce((a, b) => b.score < a.score ? b : a);
    return worst.score < 75 ? worst.i : null;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const draw = () => {
      pulseRef.current += 0.05;
      ctx.clearRect(0, 0, width, height);

      const lm  = lmRef.current;
      const ref = refLmRef.current;
      if (!lm || lm.length === 0) { rafRef.current = requestAnimationFrame(draw); return; }

      const px = (x: number) => x * width;
      const py = (y: number) => y * height;

      const armsOnly = isArmsPhase(focusRef.current);
      const scores   = scoresRef.current;

      // Compute arm accuracy for fade-on-success
      let armAccuracy = 100;
      if (scores && armsOnly) {
        const vals = [11, 12, 13, 14].map(i => scores[i] ?? 100);
        armAccuracy = vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      // Fade skeleton when both arms doing well — "absence means success"
      // ponytail: smooth via sin, feels natural not jarring
      const successFade = armAccuracy > 80
        ? Math.max(0.08, 1 - (armAccuracy - 80) / 30)
        : 1;

      const worstArm = worstArmJoint();

      // ── 1. TARGET ARM SILHOUETTE (reference — only in arms phase) ──────────
      if (armsOnly && ref && ref.length > 0) {
        // Hip-align reference to user position
        const uHipX = ((lm[23]?.x ?? 0.5) + (lm[24]?.x ?? 0.5)) / 2;
        const uHipY = ((lm[23]?.y ?? 0.8) + (lm[24]?.y ?? 0.8)) / 2;
        const rHipX = ((ref[23]?.x ?? 0.5) + (ref[24]?.x ?? 0.5)) / 2;
        const rHipY = ((ref[23]?.y ?? 0.8) + (ref[24]?.y ?? 0.8)) / 2;
        const dx = uHipX - rHipX, dy = uHipY - rHipY;

        if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) {
          // Draw only arm silhouette — thick, soft, calming blue
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          // Gentle breathing pulse
          const breathAlpha = 0.18 + 0.06 * Math.sin(pulseRef.current * 0.4);
          ctx.globalAlpha = breathAlpha;
          ctx.strokeStyle = 'rgba(100,160,255,1)';
          ctx.lineWidth = 8;
          ctx.shadowBlur = 14;
          ctx.shadowColor = 'rgba(100,160,255,0.6)';

          for (const [i, j] of ARM_CONNECTIONS) {
            const p1 = ref[i], p2 = ref[j];
            if (!p1 || !p2) continue;
            if ((p1.visibility ?? 1) < VIS_THRESHOLD || (p2.visibility ?? 1) < VIS_THRESHOLD) continue;
            ctx.beginPath();
            ctx.moveTo(px(p1.x + dx), py(p1.y + dy));
            ctx.lineTo(px(p2.x + dx), py(p2.y + dy));
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // ── 2. USER SKELETON ─────────────────────────────────────────────────
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = successFade;

      const connections = armsOnly ? ARM_CONNECTIONS : BODY_GROUPS.flatMap(g => g.connections);

      for (const [i, j] of connections) {
        const p1 = lm[i], p2 = lm[j];
        if (!p1 || !p2) continue;
        if ((p1.visibility ?? 1) < VIS_THRESHOLD || (p2.visibility ?? 1) < VIS_THRESHOLD) continue;

        const c1 = scoreToRGB(scores?.[i], i === worstArm);
        const c2 = scoreToRGB(scores?.[j], j === worstArm);

        // Black outline
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.beginPath();
        ctx.moveTo(px(p1.x), py(p1.y));
        ctx.lineTo(px(p2.x), py(p2.y));
        ctx.stroke();

        // Coloured bone
        const grad = ctx.createLinearGradient(px(p1.x), py(p1.y), px(p2.x), py(p2.y));
        grad.addColorStop(0, rgba(c1, 1));
        grad.addColorStop(1, rgba(c2, 1));
        ctx.lineWidth = 3;
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(px(p1.x), py(p1.y));
        ctx.lineTo(px(p2.x), py(p2.y));
        ctx.stroke();
      }

      // Joint dots
      const jointSet = armsOnly ? ARM_JOINT_INDICES : Array.from({ length: 33 }, (_, i) => i);
      for (const idx of jointSet) {
        const p = lm[idx];
        if (!p || (p.visibility ?? 1) < VIS_THRESHOLD) continue;
        const cx = px(p.x), cy = py(p.y);
        const isWorst = idx === worstArm;
        const rgb = scoreToRGB(scores?.[idx], isWorst);

        // Pulsing halo only on the single worst arm joint
        if (isWorst) {
          const r2 = 8 + 4 * Math.abs(Math.sin(pulseRef.current));
          ctx.globalAlpha = (0.25 + 0.15 * Math.abs(Math.sin(pulseRef.current))) * successFade;
          ctx.fillStyle = rgba(rgb, 1);
          ctx.shadowBlur = 12;
          ctx.shadowColor = rgba(rgb, 1);
          ctx.beginPath();
          ctx.arc(cx, cy, r2, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        ctx.globalAlpha = successFade;
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = rgba(rgb, 1);
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // ── 3. CORRECTION ARROWS (only shown in review / ImprovementPhase) ────
      if (showArrowsRef.current && ref && ref.length > 0) {
        const arrows = generateCorrectionArrows(lm, ref);
        const dashOffset = (pulseRef.current * 12) % 24;

        arrows.slice(0, 1).forEach(arrow => { // ponytail: max 1 arrow, not 3
          const severity = Math.min(1, arrow.errorMagnitude / 0.14);
          const color: RGB = [250, 180, 60];

          ctx.save();
          ctx.globalAlpha = 0.9;
          ctx.lineCap = 'round';
          ctx.setLineDash([8, 5]);
          ctx.lineDashOffset = -dashOffset;
          ctx.strokeStyle = rgba(color, 1);
          ctx.lineWidth = 2.5 + severity;
          ctx.beginPath();
          ctx.moveTo(arrow.startX * width, arrow.startY * height);
          ctx.lineTo(arrow.endX   * width, arrow.endY   * height);
          ctx.stroke();

          ctx.setLineDash([]);
          const hl = 12 + severity * 6;
          ctx.fillStyle = rgba(color, 1);
          ctx.beginPath();
          ctx.moveTo(arrow.endX * width, arrow.endY * height);
          ctx.lineTo(
            arrow.endX * width - hl * Math.cos(arrow.angle - Math.PI / 6),
            arrow.endY * height - hl * Math.sin(arrow.angle - Math.PI / 6),
          );
          ctx.lineTo(
            arrow.endX * width - hl * Math.cos(arrow.angle + Math.PI / 6),
            arrow.endY * height - hl * Math.sin(arrow.angle + Math.PI / 6),
          );
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        });
      }

      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, worstArmJoint]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute top-0 left-0 w-full h-full pointer-events-none"
    />
  );
}
