import { useEffect, useRef } from 'react';

// Using minimal typing from shared types we built in Phase 2
// Assuming PoseLandmark has {x,y,z,visibility}
export interface PoseLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

interface SkeletonCanvasProps {
  landmarks: PoseLandmark[] | null;
  width: number;
  height: number;
  // Optional accuracy scores per joint (0-100) to color code the skeleton
  jointScores?: Record<number, number>;
}

// MediaPipe Pose Connections
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

export default function SkeletonCanvas({ landmarks, width, height, jointScores }: SkeletonCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const getColorForScore = (score?: number) => {
    if (score === undefined) return '#ec4899'; // Default Neon Pink
    if (score >= 85) return '#4ade80'; // Green
    if (score >= 70) return '#facc15'; // Yellow
    return '#f87171'; // Red
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (!landmarks || landmarks.length === 0) return;

    // Draw Connections
    ctx.lineWidth = 4;
    POSE_CONNECTIONS.forEach(([i, j]) => {
      const p1 = landmarks[i];
      const p2 = landmarks[j];
      
      if (!p1 || !p2) return;
      if ((p1.visibility || 1) < 0.5 || (p2.visibility || 1) < 0.5) return;

      const score = jointScores ? (jointScores[i] + jointScores[j]) / 2 : undefined;
      ctx.strokeStyle = getColorForScore(score);
      
      ctx.beginPath();
      ctx.moveTo(p1.x * width, p1.y * height);
      ctx.lineTo(p2.x * width, p2.y * height);
      ctx.stroke();
    });

    // Draw Joints
    landmarks.forEach((p, index) => {
      if ((p.visibility || 1) < 0.5) return;
      
      const score = jointScores ? jointScores[index] : undefined;
      ctx.fillStyle = getColorForScore(score);
      
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, 5, 0, 2 * Math.PI);
      ctx.fill();
    });

  }, [landmarks, width, height, jointScores]);

  return (
    <canvas 
      ref={canvasRef} 
      width={width} 
      height={height} 
      className="absolute top-0 left-0 w-full h-full pointer-events-none"
    />
  );
}
