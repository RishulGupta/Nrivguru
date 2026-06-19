import { PoseLandmark, PoseFrame } from '../types/pose';
import { JointScore, FinalScore } from '../types/routine';
import { KEY_JOINT_INDICES, JOINT_DEFINITIONS } from './constants';

export function distance(a: PoseLandmark, b: PoseLandmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

export function midpoint(a: PoseLandmark, b: PoseLandmark): PoseLandmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: (a.visibility + b.visibility) / 2
  };
}

export function calculateAngle(a: PoseLandmark, b: PoseLandmark, c: PoseLandmark): number {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs(radians * 180.0 / Math.PI);
  if (angle > 180.0) angle = 360 - angle;
  return angle;
}

export function normalizePose(landmarks: PoseLandmark[]): PoseLandmark[] {
  const shoulderMid = midpoint(landmarks[11], landmarks[12]);
  const hipMid = midpoint(landmarks[23], landmarks[24]);
  const torsoHeight = distance(shoulderMid, hipMid);
  const center = midpoint(shoulderMid, hipMid);

  return landmarks.map(lm => ({
    x: (lm.x - center.x) / torsoHeight,
    y: (lm.y - center.y) / torsoHeight,
    z: lm.z / torsoHeight,
    visibility: lm.visibility
  }));
}

export function poseToVector(landmarks: PoseLandmark[]): number[] {
  const angles = [
    calculateAngle(landmarks[11], landmarks[13], landmarks[15]), // L elbow
    calculateAngle(landmarks[12], landmarks[14], landmarks[16]), // R elbow
    calculateAngle(landmarks[13], landmarks[11], landmarks[23]), // L shoulder
    calculateAngle(landmarks[14], landmarks[12], landmarks[24]), // R shoulder
    calculateAngle(landmarks[23], landmarks[25], landmarks[27]), // L knee
    calculateAngle(landmarks[24], landmarks[26], landmarks[28]), // R knee
    calculateAngle(landmarks[11], landmarks[23], landmarks[25]), // L hip
    calculateAngle(landmarks[12], landmarks[24], landmarks[26]), // R hip
  ];
  return angles;
}

export function fastDTW(
  seq1: number[][],
  seq2: number[][],
  radius: number
): { distance: number; path: [number, number][] } {
  const n = seq1.length;
  const m = seq2.length;
  
  if (n === 0 || m === 0) return { distance: 0, path: [] };

  const dtw = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity));
  dtw[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    const start = Math.max(1, i - radius);
    const end = Math.min(m, i + radius);
    for (let j = start; j <= end; j++) {
      let cost = 0;
      for (let k = 0; k < seq1[i - 1].length; k++) {
        cost += Math.abs(seq1[i - 1][k] - seq2[j - 1][k]);
      }
      dtw[i][j] = cost + Math.min(
        dtw[i - 1][j],
        dtw[i][j - 1],
        dtw[i - 1][j - 1]
      );
    }
  }

  // Backtrack
  const path: [number, number][] = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const minVal = Math.min(
      dtw[i - 1][j - 1],
      dtw[i - 1][j],
      dtw[i][j - 1]
    );
    if (minVal === dtw[i - 1][j - 1]) {
      i--; j--;
    } else if (minVal === dtw[i - 1][j]) {
      i--;
    } else {
      j--;
    }
  }
  path.reverse();

  return { distance: dtw[n][m], path };
}

export function scoreFrame(
  userLandmarks: PoseLandmark[],
  refLandmarks: PoseLandmark[]
): { joints: JointScore[], armScore: number, legScore: number }  {
  const userNorm = normalizePose(userLandmarks);
  const refNorm = normalizePose(refLandmarks);

  const joints: JointScore[] = JOINT_DEFINITIONS.map(j => {
    const userAngle = calculateAngle(userNorm[j.pts[0]], userNorm[j.pts[1]], userNorm[j.pts[2]]);
    const refAngle  = calculateAngle(refNorm[j.pts[0]],  refNorm[j.pts[1]],  refNorm[j.pts[2]]);
    const diff = Math.abs(userAngle - refAngle);

    return {
      name: j.name,
      type: j.type as 'arm' | 'leg',
      diff,
      color: diff < 15 ? 'green' : diff < 30 ? 'yellow' : 'red',
      score: Math.max(0, 100 - (diff / 180) * 100)
    };
  });

  const armJoints = joints.filter(j => j.type === 'arm');
  const legJoints = joints.filter(j => j.type === 'leg');
  const armScore  = armJoints.reduce((s,j) => s + j.score, 0) / (armJoints.length || 1);
  const legScore  = legJoints.reduce((s,j) => s + j.score, 0) / (legJoints.length || 1);

  return { joints, armScore, legScore };
}

export function scoreSequence(
  userFrames: PoseFrame[],
  refFrames: PoseFrame[],
  seatedMode: boolean = false
): FinalScore {
  const userVectors = userFrames.map(f => poseToVector(normalizePose(f.landmarks)));
  const refVectors  = refFrames.map(f  => poseToVector(normalizePose(f.landmarks)));

  const { distance, path } = fastDTW(refVectors, userVectors, 10);
  const maxPossibleDistance = 180 * 8 * Math.max(userVectors.length, refVectors.length);
  const timingScore = Math.max(0, 100 - (distance / maxPossibleDistance) * 100);

  const frameScores = path.map(([refIdx, userIdx]) =>
    scoreFrame(userFrames[userIdx].landmarks, refFrames[refIdx].landmarks)
  );

  const armScore = frameScores.reduce((s,f) => s + f.armScore, 0) / (frameScores.length || 1);
  const legScore = seatedMode
    ? 100
    : frameScores.reduce((s,f) => s + f.legScore, 0) / (frameScores.length || 1);

  const overallScore = armScore * 0.35 + legScore * 0.35 + timingScore * 0.30;

  return { armScore, legScore, timingScore, overallScore };
}

export function checkAntiCheat(frames: PoseFrame[]): boolean {
  let missingCount = 0;
  let totalChecks = 0;

  for (const frame of frames) {
    for (const idx of KEY_JOINT_INDICES) {
      totalChecks++;
      if (frame.landmarks[idx].visibility < 0.5) missingCount++;
    }
  }

  const missingRatio = missingCount / (totalChecks || 1);
  return missingRatio > 0.40;
}
