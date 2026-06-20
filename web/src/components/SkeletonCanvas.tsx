import { useEffect, useRef } from 'react';
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

const POSE_CONNECTIONS = [
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Right Arm
  [12, 14], [14, 16],
  // Left Arm
  [11, 13], [13, 15],
  // Right Leg
  [24, 26], [26, 28], [28, 32], [32, 30], [30, 28],
  // Left Leg
  [23, 25], [25, 27], [27, 31], [31, 29], [29, 27],
  // Face (minimal)
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8]
];

export default function SkeletonCanvas({ 
  landmarks, 
  refLandmarks,
  width, 
  height, 
  jointScores,
  focusArea,
  showArrows = true
}: SkeletonCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const getColorForScore = (score?: number) => {
    if (score === undefined) return '#ec4899'; // Default Neon Pink
    if (score >= 85) return '#4ade80'; // Green
    if (score >= 70) return '#facc15'; // Yellow
    return '#f87171'; // Red
  };

  const isJointInFocus = (idx: number) => {
    if (!focusArea || focusArea === 'full' || focusArea === 'combine' || focusArea === 'teach' || focusArea === 'watch' || focusArea === 'idle') return true;
    if (focusArea === 'arms') return idx >= 11 && idx <= 16;
    if (focusArea === 'legs') return idx >= 23 && idx <= 32;
    return true;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (!landmarks || landmarks.length === 0) return;

    // Helper to draw a skeleton
    const drawSkeleton = (
      points: PoseLandmark[], 
      isReference: boolean = false,
      offsetX: number = 0,
      offsetY: number = 0
    ) => {
      ctx.lineWidth = isReference ? 2 : 4;
      
      POSE_CONNECTIONS.forEach(([i, j]) => {
        const p1 = points[i];
        const p2 = points[j];
        
        if (!p1 || !p2) return;
        if ((p1.visibility || 1) < 0.5 || (p2.visibility || 1) < 0.5) return;

        // Focus Dimming
        const inFocus = isReference || (isJointInFocus(i) || isJointInFocus(j));
        ctx.globalAlpha = inFocus ? (isReference ? 0.3 : 1.0) : 0.15;

        if (isReference) {
          ctx.strokeStyle = '#60a5fa'; // Translucent Blue
        } else {
          const score = jointScores ? (jointScores[i] + jointScores[j]) / 2 : undefined;
          ctx.strokeStyle = getColorForScore(score);
        }
        
        ctx.beginPath();
        ctx.moveTo((p1.x + offsetX) * width, (p1.y + offsetY) * height);
        ctx.lineTo((p2.x + offsetX) * width, (p2.y + offsetY) * height);
        ctx.stroke();
      });

      // Draw Joints
      points.forEach((p, index) => {
        if ((p.visibility || 1) < 0.5) return;
        
        const inFocus = isReference || isJointInFocus(index);
        ctx.globalAlpha = inFocus ? (isReference ? 0.3 : 1.0) : 0.15;

        if (isReference) {
          ctx.fillStyle = '#60a5fa';
        } else {
          const score = jointScores ? jointScores[index] : undefined;
          ctx.fillStyle = getColorForScore(score);
        }
        
        ctx.beginPath();
        ctx.arc((p.x + offsetX) * width, (p.y + offsetY) * height, isReference ? 3 : 5, 0, 2 * Math.PI);
        ctx.fill();
      });
      ctx.globalAlpha = 1.0;
    };

    // 1. Draw Ghost Reference Skeleton
    if (refLandmarks && refLandmarks.length > 0) {
      // Align reference to user's root (mid-hip)
      const uMidHipX = (landmarks[23].x + landmarks[24].x) / 2;
      const uMidHipY = (landmarks[23].y + landmarks[24].y) / 2;
      const rMidHipX = (refLandmarks[23].x + refLandmarks[24].x) / 2;
      const rMidHipY = (refLandmarks[23].y + refLandmarks[24].y) / 2;
      
      const dx = uMidHipX - rMidHipX;
      const dy = uMidHipY - rMidHipY;
      
      // Only draw ghost if user is roughly in the same spot, else it looks crazy
      if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) {
         drawSkeleton(refLandmarks, true, dx, dy);
      }
    }

    // 2. Draw User Skeleton
    drawSkeleton(landmarks, false);

    // 3. Draw Correction Arrows
    if (showArrows && refLandmarks && refLandmarks.length > 0) {
      const arrows = generateCorrectionArrows(landmarks, refLandmarks);
      
      arrows.forEach(arrow => {
        ctx.beginPath();
        
        // Draw dashed arrow line
        ctx.setLineDash([5, 5]);
        ctx.moveTo(arrow.startX * width, arrow.startY * height);
        ctx.lineTo(arrow.endX * width, arrow.endY * height);
        
        // Glow effect
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#eab308'; // Yellow
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        ctx.setLineDash([]); // Reset
        
        // Draw arrowhead
        const headlen = 10;
        ctx.beginPath();
        ctx.moveTo(arrow.endX * width, arrow.endY * height);
        ctx.lineTo(
          arrow.endX * width - headlen * Math.cos(arrow.angle - Math.PI / 6),
          arrow.endY * height - headlen * Math.sin(arrow.angle - Math.PI / 6)
        );
        ctx.lineTo(
          arrow.endX * width - headlen * Math.cos(arrow.angle + Math.PI / 6),
          arrow.endY * height - headlen * Math.sin(arrow.angle + Math.PI / 6)
        );
        ctx.fillStyle = '#facc15';
        ctx.fill();
        
        // Reset shadow
        ctx.shadowBlur = 0;
      });
    }

  }, [landmarks, refLandmarks, width, height, jointScores, focusArea, showArrows]);

  return (
    <canvas 
      ref={canvasRef} 
      width={width} 
      height={height} 
      className="absolute top-0 left-0 w-full h-full pointer-events-none"
    />
  );
}
