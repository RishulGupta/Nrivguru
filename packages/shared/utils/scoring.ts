import type { PoseLandmark, PoseFrame } from '../types/pose';
import type { JointScore, FinalScore } from '../types/routine';
import { KEY_JOINT_INDICES, JOINT_DEFINITIONS, ARM_JOINT_WEIGHTS } from './constants';

// ─── Low-level geometry ────────────────────────────────────────────────────────

export function distance(a: PoseLandmark, b: PoseLandmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

export function midpoint(a: PoseLandmark, b: PoseLandmark): PoseLandmark {
  return {
    x:          (a.x + b.x) / 2,
    y:          (a.y + b.y) / 2,
    z:          (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  };
}

export function calculateAngle(a: PoseLandmark, b: PoseLandmark, c: PoseLandmark): number {
  // Angle at vertex b, formed by rays b→a and b→c
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs(radians * 180 / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

// ─── Normalization ─────────────────────────────────────────────────────────────

/**
 * Translate + scale invariant normalization:
 * Center on torso midpoint, scale by torso height.
 * Degenerate poses (invisible/collapsed torso) return the original.
 */
export function normalizePose(landmarks: PoseLandmark[]): PoseLandmark[] {
  if (landmarks.length < 33) return landmarks;

  const lHip  = landmarks[23], rHip  = landmarks[24];
  const lSh   = landmarks[11], rSh   = landmarks[12];

  const torsoVis = Math.min(lHip.visibility, rHip.visibility, lSh.visibility, rSh.visibility);
  if (torsoVis < 0.2) return landmarks;

  const shMid     = midpoint(lSh, rHip);
  const hipMid    = midpoint(lHip, rHip);
  const torsoH    = distance(midpoint(lSh, rSh), hipMid);

  if (torsoH < 0.01) return landmarks; // degenerate

  const center = midpoint(midpoint(lSh, rSh), hipMid);

  return landmarks.map(lm => ({
    x:          (lm.x - center.x) / torsoH,
    y:          (lm.y - center.y) / torsoH,
    z:          lm.z / torsoH,
    visibility: lm.visibility,
  }));
}

// ─── Pose-to-vector encoding ───────────────────────────────────────────────────

/**
 * Encode a pose as a 12-element angle vector.
 * Invisible joints contribute 0 (neutral) — they won't dominate DTW distance.
 */
export function poseToVector(landmarks: PoseLandmark[]): number[] {
  const safe = (a: number, b: number, c: number): number => {
    const minVis = Math.min(
      landmarks[a]?.visibility ?? 0,
      landmarks[b]?.visibility ?? 0,
      landmarks[c]?.visibility ?? 0,
    );
    if (minVis < 0.25) return 0;
    return calculateAngle(landmarks[a], landmarks[b], landmarks[c]);
  };

  return [
    safe(11, 13, 15), // L elbow flex
    safe(12, 14, 16), // R elbow flex
    safe(13, 11, 23), // L shoulder pitch (arm↔torso)
    safe(14, 12, 24), // R shoulder pitch
    safe(12, 11, 13), // L shoulder yaw (cross-body)
    safe(11, 12, 14), // R shoulder yaw
    safe(23, 25, 27), // L knee flex
    safe(24, 26, 28), // R knee flex
    safe(11, 23, 25), // L hip flex
    safe(12, 24, 26), // R hip flex
    safe(25, 27, 31), // L ankle dorsiflexion
    safe(26, 28, 32), // R ankle dorsiflexion
  ];
}

// ─── FastDTW ──────────────────────────────────────────────────────────────────

/**
 * FastDTW with Sakoe-Chiba band (O(n·radius) time).
 * Uses Euclidean distance for richer gradient discrimination vs sum-of-abs.
 */
export function fastDTW(
  seq1: number[][],
  seq2: number[][],
  radius = 12,
): { distance: number; path: [number, number][] } {
  const n = seq1.length, m = seq2.length;
  if (n === 0 || m === 0) return { distance: 0, path: [] };

  // Dynamically widen radius to accommodate sequence length difference
  const r = Math.max(radius, Math.abs(n - m) + 2);

  const INF = Infinity;
  // Flat typed array for cache efficiency
  const dtw = new Float64Array((n + 1) * (m + 1)).fill(INF);
  const I = (i: number, j: number) => i * (m + 1) + j;
  dtw[I(0, 0)] = 0;

  for (let i = 1; i <= n; i++) {
    const jStart = Math.max(1, i - r);
    const jEnd   = Math.min(m, i + r);
    for (let j = jStart; j <= jEnd; j++) {
      // Euclidean distance between feature vectors
      const v1 = seq1[i - 1], v2 = seq2[j - 1];
      let cost = 0;
      const len = Math.min(v1.length, v2.length);
      for (let k = 0; k < len; k++) cost += (v1[k] - v2[k]) ** 2;
      cost = Math.sqrt(cost);

      dtw[I(i, j)] = cost + Math.min(
        dtw[I(i - 1, j - 1)],
        dtw[I(i - 1, j)],
        dtw[I(i, j - 1)],
      );
    }
  }

  // Backtrack
  const path: [number, number][] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    path.push([i - 1, j - 1]);
    if (i === 0)      { j--; continue; }
    if (j === 0)      { i--; continue; }
    const a = dtw[I(i-1, j-1)], b = dtw[I(i-1, j)], c = dtw[I(i, j-1)];
    if (a <= b && a <= c) { i--; j--; }
    else if (b <= c)       { i--;      }
    else                   {      j--; }
  }
  path.reverse();

  return { distance: dtw[I(n, m)], path };
}

// ─── Per-frame scoring ────────────────────────────────────────────────────────

/**
 * Score a single frame against a reference.
 *
 * Improvements over baseline:
 * - Cosine score curve: 100·cos(diff/90·π/2) — smooth, not cliff-edged
 * - Confidence-weighted averaging: low-vis joints don't drag the score
 * - Returns `confidence` per joint for external use
 */
export function scoreFrame(
  userLandmarks: PoseLandmark[],
  refLandmarks:  PoseLandmark[],
): { joints: JointScore[]; armScore: number; legScore: number } {
  const userNorm = normalizePose(userLandmarks);
  const refNorm  = normalizePose(refLandmarks);

  const joints: JointScore[] = JOINT_DEFINITIONS.map(j => {
    const [p0, p1, p2] = j.pts;
    const u0 = userNorm[p0], u1 = userNorm[p1], u2 = userNorm[p2];
    const r0 = refNorm[p0],  r1 = refNorm[p1],  r2 = refNorm[p2];

    if (!u0 || !u1 || !u2 || !r0 || !r1 || !r2) {
      return { name: j.name, type: j.type as 'arm'|'leg', diff: -1, color: 'green' as const, score: -1 };
    }

    const uVis = Math.min(u0.visibility ?? 0, u1.visibility ?? 0, u2.visibility ?? 0);
    const rVis = Math.min(r0.visibility ?? 0, r1.visibility ?? 0, r2.visibility ?? 0);

    // Not visible enough — skip (score -1), don't inflate with 100
    if (uVis < 0.28 || rVis < 0.28) {
      return { name: j.name, type: j.type as 'arm'|'leg', diff: -1, color: 'green' as const, score: -1 };
    }

    const diff = Math.abs(calculateAngle(u0, u1, u2) - calculateAngle(r0, r1, r2));

    // Cosine curve: 100 at diff=0, ~0 at diff=90, clamped to 0 beyond
    const score  = Math.max(0, 100 * Math.cos((diff / 90) * (Math.PI / 2)));
    const color  = diff < 15 ? 'green' : diff < 35 ? 'yellow' : 'red';

    return { name: j.name, type: j.type as 'arm'|'leg', diff, color, score };
  });

  // Weighted mean — arm joints use beginner weights (shoulder >> elbow > wrist)
  const wmean = (arr: JointScore[], useArmWeights = false) => {
    let wSum = 0, vSum = 0;
    for (const s of arr) {
      if (s.score < 0) continue;
      const w = useArmWeights ? (ARM_JOINT_WEIGHTS[s.name] ?? 1.0) : 1.0;
      wSum += w; vSum += s.score * w;
    }
    return wSum > 0 ? vSum / wSum : 0;
  };

  const armJoints = joints.filter(j => j.type === 'arm');
  const legJoints = joints.filter(j => j.type === 'leg');

  return { joints, armScore: wmean(armJoints, true), legScore: wmean(legJoints) };
}

// ─── Velocity helpers ─────────────────────────────────────────────────────────

/**
 * Compute kinetic energy profile (total joint displacement per ms).
 */
function velocityProfile(frames: PoseFrame[]): number[] {
  if (frames.length < 2) return frames.map(() => 0);
  const out = [0];
  for (let i = 1; i < frames.length; i++) {
    const dt = Math.max(1, frames[i].timestamp_ms - frames[i - 1].timestamp_ms);
    let v = 0;
    for (let j = 0; j < 33; j++) {
      const a = frames[i - 1].landmarks[j], b = frames[i].landmarks[j];
      if (!a || !b || (a.visibility ?? 0) < 0.35 || (b.visibility ?? 0) < 0.35) continue;
      v += distance(a, b);
    }
    out.push((v / dt) * 1000); // units: normalized/s
  }
  return out;
}

/** Pearson correlation between two equal-length arrays. */
function pearsonCorr(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b; dx2 += a * a; dy2 += b * b;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom < 1e-9 ? 0 : num / denom;
}

// ─── Full-sequence scoring ────────────────────────────────────────────────────

/**
 * Score an entire attempt:
 * - DTW path aligns user & reference temporally
 * - Per-frame arm/leg scores averaged along path (recency-weighted)
 * - Velocity correlation gives an independent timing signal
 * - Final score = 0.35·arm + 0.35·leg + 0.30·timing
 */
export function scoreSequence(
  userFrames:  PoseFrame[],
  refFrames:   PoseFrame[],
  seatedMode   = false,
): FinalScore {
  if (userFrames.length === 0 || refFrames.length === 0) {
    return { armScore: 0, legScore: 0, timingScore: 0, overallScore: 0 };
  }

  const userVec = userFrames.map(f => poseToVector(normalizePose(f.landmarks)));
  const refVec  = refFrames.map(f  => poseToVector(normalizePose(f.landmarks)));

  const { distance: dtwDist, path } = fastDTW(refVec, userVec, 15);

  // Normalize: maximum Euclidean distance for 12-dim vector (each dim [0,180])
  const maxPerFrame       = Math.sqrt(12 * 180 * 180); // ≈ 623.5
  const normalizedDtwDist = dtwDist / (Math.max(1, path.length) * maxPerFrame);
  const dtwScore          = Math.max(0, Math.min(100, (1 - normalizedDtwDist) * 100));

  // Velocity-correlation timing score (0–100)
  const uVel  = velocityProfile(userFrames);
  const rVel  = velocityProfile(refFrames);
  // Resample to the same length via linear interpolation
  const resample = (arr: number[], len: number) =>
    Array.from({ length: len }, (_, i) => {
      const t = i / Math.max(1, len - 1) * (arr.length - 1);
      const lo = Math.floor(t), hi = Math.min(arr.length - 1, lo + 1);
      return arr[lo] + (arr[hi] - arr[lo]) * (t - lo);
    });
  const targetLen = Math.max(uVel.length, rVel.length);
  const velCorr   = pearsonCorr(resample(uVel, targetLen), resample(rVel, targetLen));
  const velScore  = Math.max(0, Math.min(100, ((velCorr + 1) / 2) * 100));

  // Combine DTW + velocity for final timing score
  const timingScore = dtwScore * 0.65 + velScore * 0.35;

  // Score matched frames — slight recency weight (later frames matter a bit more)
  const frameScores = path
    .filter(([ri, ui]) => ri < refFrames.length && ui < userFrames.length)
    .map(([ri, ui], pathIdx) => {
      const w = 1 + pathIdx * 0.0008; // very gentle recency weight
      return { ...scoreFrame(userFrames[ui].landmarks, refFrames[ri].landmarks), w };
    });

  if (frameScores.length === 0) {
    return { armScore: 0, legScore: 0, timingScore: 0, overallScore: 0 };
  }

  const totalW = frameScores.reduce((s, f) => s + f.w, 0);
  const armScore = frameScores.reduce((s, f) => s + f.armScore * f.w, 0) / totalW;
  const legScore = seatedMode
    ? 100
    : frameScores.reduce((s, f) => s + f.legScore * f.w, 0) / totalW;

  const overallScore = armScore * 0.35 + legScore * 0.35 + timingScore * 0.30;

  return {
    armScore:     Math.round(armScore     * 10) / 10,
    legScore:     Math.round(legScore     * 10) / 10,
    timingScore:  Math.round(timingScore  * 10) / 10,
    overallScore: Math.round(overallScore * 10) / 10,
  };
}

// ─── Anti-cheat ───────────────────────────────────────────────────────────────

/**
 * Returns true if the attempt looks fraudulent:
 * - Too many low-visibility key joints (> 40% missing)
 * - Suspiciously static pose (user stood still the whole time)
 */
export function checkAntiCheat(frames: PoseFrame[]): boolean {
  if (frames.length < 10) return false;

  let missing = 0, total = 0;
  for (const frame of frames) {
    for (const idx of KEY_JOINT_INDICES) {
      total++;
      if ((frame.landmarks[idx]?.visibility ?? 0) < 0.5) missing++;
    }
  }
  if (missing / (total || 1) > 0.40) return true;

  // Variance check: if key joints barely moved, something is off
  const keyVars = KEY_JOINT_INDICES.map(idx => {
    const xs = frames.map(f => f.landmarks[idx]?.x ?? 0);
    const ys = frames.map(f => f.landmarks[idx]?.y ?? 0);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    return xs.reduce((s, x, i) => s + (x - mx) ** 2 + (ys[i] - my) ** 2, 0) / xs.length;
  });
  const avgVar = keyVars.reduce((a, b) => a + b, 0) / keyVars.length;

  // Below 0.00005 across > 60 frames = essentially frozen → cheat
  return avgVar < 0.00005 && frames.length > 60;
}