import type { PoseFrame } from '../types/pose';
import { JOINT_INDEX } from '../types/pose';

// ─── Joint expressiveness weights ─────────────────────────────────────────────
// How much each MediaPipe landmark index contributes to the kinetic energy
// profile. Joints that carry expressive dance weight are amplified; face /
// spine joints that move passively are suppressed.

const JOINT_WEIGHTS: Partial<Record<number, number>> = {
  [JOINT_INDEX.LEFT_SHOULDER]:  1.1,  [JOINT_INDEX.RIGHT_SHOULDER]: 1.1,
  [JOINT_INDEX.LEFT_ELBOW]:     0.9,  [JOINT_INDEX.RIGHT_ELBOW]:    0.9,
  [JOINT_INDEX.LEFT_WRIST]:     1.4,  [JOINT_INDEX.RIGHT_WRIST]:    1.4,  // hands = style
  [JOINT_INDEX.LEFT_HIP]:       1.3,  [JOINT_INDEX.RIGHT_HIP]:      1.3,  // hips = rhythm anchor
  [JOINT_INDEX.LEFT_KNEE]:      0.75, [JOINT_INDEX.RIGHT_KNEE]:     0.75,
  [JOINT_INDEX.LEFT_ANKLE]:     1.0,  [JOINT_INDEX.RIGHT_ANKLE]:    1.0,
  [JOINT_INDEX.LEFT_FOOT_IDX]:  0.6,  [JOINT_INDEX.RIGHT_FOOT_IDX]: 0.6,
};
const DEFAULT_JOINT_WEIGHT = 0.15;  // face, fingers, spine

// ─── Signal processing utilities ──────────────────────────────────────────────

/** Build a Gaussian convolution kernel of the given sigma (frames). */
function gaussianKernel(sigma: number): number[] {
  const r = Math.ceil(3 * sigma);
  let sum = 0;
  const k: number[] = [];
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v); sum += v;
  }
  return k.map(v => v / sum);
}

/** Convolve a 1-D signal with a kernel (edge-pad with boundary values). */
function convolve(signal: number[], kernel: number[]): number[] {
  const r = Math.floor(kernel.length / 2);
  return signal.map((_, i) => {
    let acc = 0;
    for (let k = 0; k < kernel.length; k++) {
      const j = i + k - r;
      const v = j < 0 ? signal[0] : j >= signal.length ? signal[signal.length - 1] : signal[j];
      acc += v * kernel[k];
    }
    return acc;
  });
}

/** Zero-mean a signal (subtract the mean). */
function zeroMean(arr: number[]): number[] {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.map(v => v - m);
}

/** L2 norm of an array. */
function l2Norm(arr: number[]): number {
  return Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
}

/** Statistical variance of an array. */
function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
}

/**
 * Detect onset frames — local maxima in the (smoothed) velocity profile that
 * exceed a relative threshold.  These correspond to accent moments in the dance.
 */
function detectOnsets(
  velocity:     number[],
  minPeakRatio  = 0.35,
  minSpacingFr  = 3,
): number[] {
  if (velocity.length < 3) return [];
  const mean      = velocity.reduce((a, b) => a + b, 0) / velocity.length;
  const maxV      = Math.max(...velocity);
  const threshold = mean + (maxV - mean) * minPeakRatio;
  const onsets: number[] = [];
  for (let i = 1; i < velocity.length - 1; i++) {
    if (velocity[i] >= velocity[i - 1] &&
        velocity[i] >= velocity[i + 1] &&
        velocity[i] >= threshold) {
      if (onsets.length === 0 || i - onsets[onsets.length - 1] >= minSpacingFr) {
        onsets.push(i);
      }
    }
  }
  return onsets;
}

// ─── Cross-correlation result ─────────────────────────────────────────────────

export interface CorrelationResult {
  /** Best lag in frames. Positive = user is behind; negative = rushing. */
  lag:        number;
  /** 0–1 confidence in the lag estimate based on peak sharpness. */
  confidence: number;
}

// ─── MusicalityCoach ──────────────────────────────────────────────────────────

/**
 * MusicalityCoach analyses the rhythm and timing of a user's attempt
 * independent of spatial correctness.
 *
 * Pipeline:
 *  1. `extractVelocityProfile` — joint-weighted kinetic energy per frame.
 *  2. Gaussian smoothing — suppress high-frequency noise.
 *  3. `crossCorrelate` — ZNCC to find the global timing lag.
 *  4. `analyzeOnsets` — match accent peaks for a complementary local lag estimate.
 *  5. Blend both estimates; gate feedback on confidence; return human string.
 *
 * Call `analyzeSequence` for the full one-shot pipeline.
 */
export class MusicalityCoach {
  /** EMA-smoothed lag across the current session (frames). */
  private smoothedLag: number | null = null;
  private readonly LAG_EMA_ALPHA = 0.35;

  private readonly GAUSS_SIGMA = 2.0;  // Gaussian smoothing kernel sigma (frames)
  private kernel = gaussianKernel(this.GAUSS_SIGMA);

  // ── Velocity profile ─────────────────────────────────────────────────────────

  /**
   * Compute the joint-weighted kinetic energy profile for a sequence of frames.
   *
   * V(t) = Σ_j  w_j · ‖Δr_j(t)‖   (only visible joints)
   * Normalised by total visible weight to be scale-invariant.
   * Result is Gaussian-smoothed at σ ≈ 2 frames (~67 ms at 30 fps).
   */
  public extractVelocityProfile(frames: PoseFrame[]): number[] {
    if (frames.length < 2) return new Array(frames.length).fill(0);

    const raw: number[] = [0];
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1].landmarks;
      const curr = frames[i].landmarks;
      let vSum = 0, wSum = 0;
      for (let j = 0; j < Math.min(prev.length, curr.length, 33); j++) {
        if ((prev[j]?.visibility ?? 0) < 0.45 || (curr[j]?.visibility ?? 0) < 0.45) continue;
        const w  = JOINT_WEIGHTS[j] ?? DEFAULT_JOINT_WEIGHT;
        const dx = curr[j].x - prev[j].x;
        const dy = curr[j].y - prev[j].y;
        vSum += w * Math.sqrt(dx * dx + dy * dy);
        wSum += w;
      }
      raw.push(wSum > 0 ? vSum / wSum : 0);
    }

    return convolve(raw, this.kernel);
  }

  // ── Zero-mean normalised cross-correlation ────────────────────────────────

  /**
   * Zero-mean Normalised Cross-Correlation (ZNCC) between two velocity profiles.
   *
   * Unlike a plain dot-product, ZNCC is invariant to amplitude differences
   * (the user may flail more than the teacher but still be on the beat).
   * The result is ∈ [−1, 1] per lag; confidence is the sharpness of the peak
   * relative to the surrounding noise floor.
   *
   * @returns `null` when either signal is too flat to yield a reliable result.
   */
  public crossCorrelate(
    refVel:  number[],
    userVel: number[],
    maxLag   = 45,
  ): CorrelationResult | null {
    if (refVel.length < 10 || userVel.length < 10) return null;

    // Flat-signal guard (variance < tiny threshold → meaningless)
    if (variance(refVel) < 1e-8 || variance(userVel) < 1e-8) return null;

    const rZ = zeroMean(refVel);
    const uZ = zeroMean(userVel);

    const scores: number[] = [];
    let bestScore = -Infinity;
    let bestLag   = 0;

    for (let lag = -maxLag; lag <= maxLag; lag++) {
      const rSlice: number[] = [];
      const uSlice: number[] = [];
      for (let i = 0; i < rZ.length; i++) {
        const ui = i - lag;
        if (ui >= 0 && ui < uZ.length) { rSlice.push(rZ[i]); uSlice.push(uZ[ui]); }
      }
      if (rSlice.length < 8) { scores.push(0); continue; }

      // Normalised inner product
      const dot   = rSlice.reduce((s, v, k) => s + v * uSlice[k], 0);
      const denom = l2Norm(rSlice) * l2Norm(uSlice);
      const score = denom < 1e-9 ? 0 : dot / denom;
      scores.push(score);
      if (score > bestScore) { bestScore = score; bestLag = lag; }
    }

    // Confidence: how much better is the peak than the mean of all other lags?
    const otherMean = (scores.reduce((s, v) => s + v, 0) - bestScore) / Math.max(1, scores.length - 1);
    const confidence = Math.max(0, Math.min(1, (bestScore - otherMean) / (1 - otherMean + 1e-9)));

    return { lag: bestLag, confidence };
  }

  // ── Onset-based timing ────────────────────────────────────────────────────

  /**
   * Onset analysis: matches velocity peaks (accent moments) between reference
   * and user and returns the median temporal offset in frames.
   *
   * This is complementary to the global ZNCC: ZNCC tells you the overall shift;
   * onset analysis tells you whether the user hits each accent at the right moment.
   */
  public analyzeOnsets(refVel: number[], userVel: number[]): number | null {
    const refOnsets  = detectOnsets(refVel);
    const userOnsets = detectOnsets(userVel);
    if (refOnsets.length < 2 || userOnsets.length < 2) return null;

    const diffs: number[] = [];
    // Match each reference onset to its nearest user onset (within ±15 frames)
    for (const r of refOnsets) {
      let best = Infinity, diff = 0;
      for (const u of userOnsets) {
        const d = Math.abs(u - r);
        if (d < best) { best = d; diff = u - r; }
      }
      if (best <= 15) diffs.push(diff);
    }
    if (diffs.length < 2) return null;

    // Return median onset difference (robust to outlier onset matches)
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)];
  }

  // ── Session-level lag smoothing ───────────────────────────────────────────

  private updateSmoothedLag(rawLag: number): number {
    if (this.smoothedLag === null) {
      this.smoothedLag = rawLag;
    } else {
      this.smoothedLag = this.LAG_EMA_ALPHA * rawLag + (1 - this.LAG_EMA_ALPHA) * this.smoothedLag;
    }
    return this.smoothedLag;
  }

  // ── Feedback generation ───────────────────────────────────────────────────

  /**
   * Convert a frame lag + confidence into a human coaching string.
   * Returns `null` when confidence is too low or timing is within an acceptable window.
   */
  public getTimingFeedback(
    frameLag:   number,
    confidence: number,
    fps         = 30,
  ): string | null {
    if (confidence < 0.25) return null;  // Unreliable — stay silent

    const lagSeconds = frameLag / fps;
    const absLag     = Math.abs(lagSeconds);

    if (absLag < 0.12) return null;  // ±120 ms — considered on beat

    const amount =
      absLag < 0.25 ? 'a touch'      :
      absLag < 0.50 ? 'noticeably'   :
                      'significantly';

    if (lagSeconds > 0) {
      return `You're ${amount} behind the beat (≈${absLag.toFixed(2)} s). Try to initiate each move a fraction earlier.`;
    } else {
      return `You're ${amount} ahead of the beat (≈${absLag.toFixed(2)} s). Wait for the count before committing to the move.`;
    }
  }

  // ── Full analysis pipeline ────────────────────────────────────────────────

  /**
   * One-shot analysis: extract velocities, run ZNCC + onset analysis,
   * blend results, update session history, and return a complete timing report.
   */
  public analyzeSequence(
    refFrames:  PoseFrame[],
    userFrames: PoseFrame[],
    fps         = 30,
  ): TimingResult {
    const refVel  = this.extractVelocityProfile(refFrames);
    const userVel = this.extractVelocityProfile(userFrames);

    const corrResult = this.crossCorrelate(refVel, userVel);
    const onsetLag   = this.analyzeOnsets(refVel, userVel);

    if (!corrResult) {
      return {
        lagFrames: null, confidence: 0,
        feedback: null, onsetLagFrames: onsetLag,
        isRushing: false, isDragging: false,
        smoothedLagFrames: this.smoothedLag,
      };
    }

    const { lag, confidence } = corrResult;

    // Blend ZNCC lag with onset lag (if available — onset is more localised)
    const blendedLag = onsetLag !== null
      ? Math.round(lag * 0.55 + onsetLag * 0.45)
      : lag;

    const smoothed = this.updateSmoothedLag(blendedLag);

    // Use smoothed lag for feedback (reduces single-attempt noise)
    const feedback   = this.getTimingFeedback(smoothed, confidence, fps);
    const lagSeconds = blendedLag / fps;

    return {
      lagFrames:         blendedLag,
      confidence,
      feedback,
      onsetLagFrames:    onsetLag,
      isRushing:         lagSeconds < -0.12,
      isDragging:        lagSeconds >  0.12,
      smoothedLagFrames: smoothed,
    };
  }

  // ── Legacy compat ─────────────────────────────────────────────────────────
  // These methods match the previous API so callers don't need to change.

  /** @deprecated Prefer `analyzeSequence` for the full pipeline. */
  public crossCorrelateLegacy(refVel: number[], userVel: number[], maxLag = 30): number | null {
    const result = this.crossCorrelate(refVel, userVel, maxLag);
    return result ? result.lag : null;
  }

  /** @deprecated Prefer `analyzeSequence` for the full pipeline. */
  public getTimingFeedbackLegacy(frameLag: number, fps = 30): string | null {
    return this.getTimingFeedback(frameLag, 1.0, fps);
  }

  /** Reset session-level state (call when starting a new routine). */
  public reset(): void {
    this.smoothedLag = null;
  }
}

// ─── Result type ──────────────────────────────────────────────────────────────

export interface TimingResult {
  /** ZNCC + onset blended lag in frames. Positive = lagging; negative = rushing. */
  lagFrames:         number | null;
  /** Confidence 0–1 from ZNCC peak sharpness. */
  confidence:        number;
  /** Human-readable coaching text, or null if within acceptable range. */
  feedback:          string | null;
  /** Onset-only lag estimate (complementary to ZNCC). */
  onsetLagFrames:    number | null;
  isRushing:         boolean;
  isDragging:        boolean;
  /** EMA-smoothed lag across the session — more stable for UI display. */
  smoothedLagFrames: number | null;
}

export const musicalityCoach = new MusicalityCoach();