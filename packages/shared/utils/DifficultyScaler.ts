// ─── Types ────────────────────────────────────────────────────────────────────

/** Human-readable difficulty tier, for display and logging. */
export type DifficultyTier = 'beginner' | 'developing' | 'intermediate' | 'advanced';

export interface DifficultyThresholds {
  arm:     number;  // angular error tolerance (degrees)
  leg:     number;
  timing:  number;
  overall: number;  // average of the three
}

export interface SessionStats {
  totalAttempts:    number;
  avgArmScore:      number;
  avgLegScore:      number;
  avgTimingScore:   number;
  avgOverallScore:  number;
  /** Linear-regression slope over recent overall scores (+ve = improving). */
  scoreTrend:       number;
  startedAt:        number;
}

// ─── Per-dimension state ──────────────────────────────────────────────────────

interface DimState {
  emaScore:          number;
  threshold:         number;  // current error leniency (degrees)
  consecutivePasses: number;
  consecutiveFails:  number;
  history:           number[];  // last HISTORY_LEN scores
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HISTORY_LEN          = 10;
const EMA_ALPHA            = 0.38;  // responsiveness vs smoothness
// ponytail: lowered for beginners — 75/45 was penalising normal first-attempt scores
const PASS_SCORE           = 60;    // score above which we consider an attempt passed
const FAIL_SCORE           = 30;    // score below which we consider it failed
const HYSTERESIS_N         = 2;     // consecutive pass/fails before threshold changes
const RATE_LERP            = 0.12;  // fraction to move currentRate toward targetRate per call
const HOT_STREAK_SLOPE     = 10.0;  // score-points/attempt slope that triggers hot-streak

// Threshold clamps (degrees)
const THRESH_MIN = 14;
const THRESH_MAX = 42;
const THRESH_STEP = 3;  // how much to tighten/loosen per hysteresis trigger

// Playback rate clamps
const RATE_MIN_DEFAULT = 0.50;
const RATE_MAX_DEFAULT = 1.00;
const RATE_STEP_DOWN   = 0.10;
const RATE_STEP_UP     = 0.05;

// ─── DifficultyScaler ─────────────────────────────────────────────────────────

/**
 * Adaptive difficulty system for dance coaching.
 *
 * Improvements over the baseline:
 * - Three independent EMA-tracked dimensions (arm, leg, timing).
 * - Hysteresis: thresholds only change after N consecutive pass/fail frames.
 * - Learning-velocity detection: no slow-down during hot streaks.
 * - Smooth playback-rate transitions (lerp toward target instead of jumping).
 * - Weakest-link rate policy: playback speed is governed by the dimension
 *   the user is finding hardest.
 * - Granular rate steps: 0.10 down / 0.05 up (asymmetric — easier to slow than speed).
 * - Session statistics with trend line.
 */
export class DifficultyScaler {
  private readonly minRate: number;
  private readonly maxRate: number;

  private targetRate:  number;
  private currentRate: number;  // lerped toward targetRate on each getPlaybackRate() call

  private arm:    DimState;
  private leg:    DimState;
  private timing: DimState;

  private session: SessionStats;

  constructor(minRate = RATE_MIN_DEFAULT, maxRate = RATE_MAX_DEFAULT) {
    this.minRate     = minRate;
    this.maxRate     = maxRate;
    this.targetRate  = maxRate;
    this.currentRate = maxRate;

    const defaultDim = (threshold: number): DimState => ({
      emaScore:          60,
      threshold,
      consecutivePasses: 0,
      consecutiveFails:  0,
      history:           [],
    });

    this.arm    = defaultDim(25);
    this.leg    = defaultDim(25);
    this.timing = defaultDim(30);  // timing starts slightly more lenient

    this.session = {
      totalAttempts:   0,
      avgArmScore:     0,
      avgLegScore:     0,
      avgTimingScore:  0,
      avgOverallScore: 0,
      scoreTrend:      0,
      startedAt:       Date.now(),
    };
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Call after every scored attempt.
   * @param armScore    0–100 arm accuracy score
   * @param legScore    0–100 leg accuracy score
   * @param timingScore 0–100 timing / DTW score
   */
  public evaluateAttempt(armScore: number, legScore: number, timingScore: number): void {
    const overall = armScore * 0.35 + legScore * 0.35 + timingScore * 0.30;

    this.updateDim(this.arm,    armScore);
    this.updateDim(this.leg,    legScore);
    this.updateDim(this.timing, timingScore);

    this.updateSession(armScore, legScore, timingScore, overall);
    this.adaptRate(overall);
  }

  /**
   * Backward-compatible single-score API.
   * @deprecated Prefer `evaluateAttempt(arm, leg, timing)`.
   */
  public evaluateAttemptSingleScore(score: number): void {
    this.evaluateAttempt(score, score, score);
  }

  /**
   * Returns the smoothed playback rate.
   * Lerps the displayed rate toward the target so changes feel gradual.
   * Call this every frame (or whenever you need the rate).
   */
  public getPlaybackRate(): number {
    const diff = this.targetRate - this.currentRate;
    if (Math.abs(diff) > 0.005) {
      this.currentRate += diff * RATE_LERP;
    } else {
      this.currentRate = this.targetRate;
    }
    return Math.round(this.currentRate * 100) / 100;
  }

  /** Returns the current target playback rate (un-lerped). */
  public getTargetPlaybackRate(): number { return this.targetRate; }

  /** Returns per-dimension error thresholds (in degrees). */
  public getErrorThresholds(): DifficultyThresholds {
    return {
      arm:     this.arm.threshold,
      leg:     this.leg.threshold,
      timing:  this.timing.threshold,
      overall: Math.round((this.arm.threshold + this.leg.threshold + this.timing.threshold) / 3),
    };
  }

  /** Backward-compat single-threshold accessor. */
  public getErrorThreshold(): number { return this.getErrorThresholds().overall; }

  /** Current session stats (read-only snapshot). */
  public getSessionStats(): Readonly<SessionStats> { return { ...this.session }; }

  /** Current difficulty tier for UI display. */
  public getDifficultyTier(): DifficultyTier {
    const r = this.targetRate;
    if (r < 0.65) return 'beginner';
    if (r < 0.80) return 'developing';
    if (r < 0.95) return 'intermediate';
    return 'advanced';
  }

  /** True when the user is rapidly improving (hot streak). */
  public isHotStreak(): boolean {
    return this.computeTrend() >= HOT_STREAK_SLOPE && this.session.totalAttempts >= 3;
  }

  public forcePlaybackRate(rate: number): void {
    this.targetRate = this.clampRate(rate);
    this.currentRate = this.targetRate;
  }

  public forceSlowDown(): void {
    this.targetRate = this.clampRate(this.targetRate - RATE_STEP_DOWN);
  }

  public reset(): void {
    this.targetRate  = this.maxRate;
    this.currentRate = this.maxRate;
    const defaultDim = (threshold: number): DimState => ({
      emaScore: 60, threshold,
      consecutivePasses: 0, consecutiveFails: 0, history: [],
    });
    this.arm    = defaultDim(25);
    this.leg    = defaultDim(25);
    this.timing = defaultDim(30);
    this.session = {
      totalAttempts: 0, avgArmScore: 0, avgLegScore: 0,
      avgTimingScore: 0, avgOverallScore: 0, scoreTrend: 0,
      startedAt: Date.now(),
    };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private updateDim(dim: DimState, score: number): void {
    dim.emaScore = EMA_ALPHA * score + (1 - EMA_ALPHA) * dim.emaScore;
    dim.history.push(score);
    if (dim.history.length > HISTORY_LEN) dim.history.shift();

    if (score > PASS_SCORE) {
      dim.consecutivePasses++;
      dim.consecutiveFails = 0;
    } else if (score < FAIL_SCORE) {
      dim.consecutiveFails++;
      dim.consecutivePasses = 0;
    } else {
      // Learning zone — hold steady
      dim.consecutiveFails  = 0;
      dim.consecutivePasses = 0;
    }

    // Hysteresis-gated threshold adjustment
    if (dim.consecutivePasses >= HYSTERESIS_N) {
      dim.threshold = Math.max(THRESH_MIN, dim.threshold - THRESH_STEP);
      dim.consecutivePasses = 0;
    } else if (dim.consecutiveFails >= HYSTERESIS_N) {
      dim.threshold = Math.min(THRESH_MAX, dim.threshold + THRESH_STEP);
      dim.consecutiveFails = 0;
    }
  }

  private adaptRate(overallScore: number): void {
    // Don't slow down when the user is on a learning hot streak
    if (this.isHotStreak()) return;

    // Weakest-link: use whichever dimension is struggling most
    const weakest = Math.min(this.arm.emaScore, this.leg.emaScore, this.timing.emaScore);
    // Blend overall and weakest-link for a balanced signal
    const signal  = overallScore * 0.6 + weakest * 0.4;

    if (signal < FAIL_SCORE) {
      this.targetRate = this.clampRate(this.targetRate - RATE_STEP_DOWN);
    } else if (signal > PASS_SCORE) {
      this.targetRate = this.clampRate(this.targetRate + RATE_STEP_UP);
    }
    // Learning zone (45–75): hold rate — let the user consolidate
  }

  /** Linear regression slope over the last N overall scores (points / attempt). */
  private computeTrend(): number {
    const h = this.arm.history;  // all dims have same attempt count
    if (h.length < 3) return 0;
    const n = h.length;
    let sx = 0, sy = 0, sxy = 0, sx2 = 0;
    for (let i = 0; i < n; i++) {
      sx += i; sy += h[i]; sxy += i * h[i]; sx2 += i * i;
    }
    const denom = n * sx2 - sx * sx;
    return Math.abs(denom) < 1e-9 ? 0 : (n * sxy - sx * sy) / denom;
  }

  private updateSession(arm: number, leg: number, timing: number, overall: number): void {
    const s  = this.session;
    const n  = ++s.totalAttempts;
    s.avgArmScore     = (s.avgArmScore     * (n - 1) + arm)     / n;
    s.avgLegScore     = (s.avgLegScore     * (n - 1) + leg)     / n;
    s.avgTimingScore  = (s.avgTimingScore  * (n - 1) + timing)  / n;
    s.avgOverallScore = (s.avgOverallScore * (n - 1) + overall) / n;
    s.scoreTrend      = this.computeTrend();
  }

  private clampRate(r: number): number {
    return Math.min(this.maxRate, Math.max(this.minRate, r));
  }
}