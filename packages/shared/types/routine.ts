// ─── Core domain types ────────────────────────────────────────────────────────

export interface Routine {
  id:                  string;
  user_id:             string;
  title:               string;
  style_tag?:          string;
  thumbnail_url?:      string;
  pose_json_url?:      string;
  /** Blob URL for local/guest routines — time-range seeking into the original video. */
  video_blob_url?:     string;
  total_chunks:        number;
  duration_seconds:    number;
  // ── Best-ever scores across all attempts ──
  best_overall_score?: number;
  best_arm_score?:     number;
  best_leg_score?:     number;
  best_timing_score?:  number;
  last_practiced_at?:  string;
  created_at:          string;
  is_deleted:          boolean;
}

export interface Chunk {
  id:               string;
  routine_id:       string;
  chunk_index:      number;
  start_time_ms:    number;
  end_time_ms:      number;
  clip_url?:        string;
  description?:     string;
  pose_slice_json?: string | any[];
  breathing_cues?:  BreathingCue[];
  created_at:       string;
}

export interface BreathingCue {
  timestamp_ms: number;
  type:         'inhale' | 'exhale';
}

// ─── Scores ───────────────────────────────────────────────────────────────────

export interface JointScore {
  name:  string;
  type:  'arm' | 'leg';
  /** Angular difference in degrees (lower = better). */
  diff:  number;
  color: 'green' | 'yellow' | 'red';
  /** 0–100 cosine score for display. */
  score: number;
}

export interface FinalScore {
  armScore:      number;  // 0–100
  legScore:      number;  // 0–100
  timingScore:   number;  // 0–100 (DTW + velocity correlation blend)
  overallScore:  number;  // weighted combination of the above
  // ── Enriched fields from post-processing ──
  timingFeedback?: string | null;      // human-readable timing note
  weakerSide?:     'left' | 'right' | null;
  /** Cross-correlation lag in frames. +ve = user is behind, -ve = rushing. */
  lagFrames?:      number | null;
  /** Correlation confidence 0–1 (below 0.25 the timing feedback is suppressed). */
  timingConfidence?: number;
  /** True when the attempt was flagged as potentially fraudulent by anti-cheat. */
  flagged?:        boolean;
}

// ─── Attempt history ──────────────────────────────────────────────────────────

export interface AttemptHistory {
  id:                     string;
  user_id:                string;
  routine_id:             string;
  chunk_id?:              string;
  is_full_routine:        boolean;
  arm_score?:             number;
  leg_score?:             number;
  timing_score?:          number;
  overall_score?:         number;
  missing_joints_flagged: boolean;
  duration_ms?:           number;
  created_at:             string;
}

// ─── Session analytics (computed client-side, never persisted) ────────────────

/**
 * Live analytics for the current practice session.
 * Reconstructed fresh each session from the attempt buffer.
 */
export interface SessionAnalytics {
  /** performance.now() at session start. */
  startedAt:        number;
  attemptsCount:    number;
  totalDurationMs:  number;
  scoreHistory:     FinalScore[];
  // Running averages (updated after each attempt)
  avgArmScore:      number;
  avgLegScore:      number;
  avgTimingScore:   number;
  avgOverallScore:  number;
  /**
   * Linear regression slope over recent overall scores.
   * Positive = improving, negative = declining.
   * Units: score points per attempt.
   */
  scoreTrend:       number;
  bestOverallScore: number;
  /** Index within scoreHistory of the best attempt. */
  bestAttemptIndex: number;
  /** True when the user is on a rapid-improvement hot streak. */
  isHotStreak:      boolean;
}

/** Full timeline of scores for charting / trend analysis. */
export interface ScoreTimeline {
  /** ISO timestamps of each attempt. */
  timestamps:    string[];
  armScores:     number[];
  legScores:     number[];
  timingScores:  number[];
  overallScores: number[];
}

// ─── Difficulty & learning progression ───────────────────────────────────────

export type DifficultyLevel = 'learning' | 'practicing' | 'mastering' | 'mastered';

/** Per-chunk difficulty state, keyed by chunk ID. */
export interface ChunkProgress {
  chunkId:          string;
  level:            DifficultyLevel;
  attempts:         number;
  bestScore:        number;
  lastScore:        number;
  lastPracticedAt?: string;
  /** EMA of recent scores — smoothed for stable level decisions. */
  emaScore:         number;
  /** Current playback rate for this chunk (0.5–1.0). */
  playbackRate:     number;
}

// ─── Milestones / gamification ────────────────────────────────────────────────

export type MilestoneType =
  | 'first_attempt'
  | 'score_50'
  | 'score_75'
  | 'score_90'
  | 'score_perfect'
  | 'streak_3'
  | 'streak_7'
  | 'arm_master'
  | 'leg_master'
  | 'timing_master'
  | 'full_routine_complete'
  | 'improved_10_points'
  | 'improved_25_points';

export interface Milestone {
  type:       MilestoneType;
  achievedAt: string;     // ISO date string
  routineId:  string;
  chunkId?:   string;
  value?:     number;     // e.g. the score that triggered the milestone
}

// ─── Helper functions ─────────────────────────────────────────────────────────

/** Derive a human-readable label from a difficulty level. */
export function difficultyLabel(level: DifficultyLevel): string {
  const map: Record<DifficultyLevel, string> = {
    learning:   'Learning',
    practicing: 'Practicing',
    mastering:  'Mastering',
    mastered:   'Mastered ✓',
  };
  return map[level];
}

/** Return the score band name for display (matches CorrectionEngine severity). */
export function scoreBand(score: number): 'weak' | 'developing' | 'good' | 'excellent' {
  if (score < 45)  return 'weak';
  if (score < 65)  return 'developing';
  if (score < 85)  return 'good';
  return 'excellent';
}

/** Initialise an empty SessionAnalytics object. */
export function createSession(): SessionAnalytics {
  return {
    startedAt:        performance.now(),
    attemptsCount:    0,
    totalDurationMs:  0,
    scoreHistory:     [],
    avgArmScore:      0,
    avgLegScore:      0,
    avgTimingScore:   0,
    avgOverallScore:  0,
    scoreTrend:       0,
    bestOverallScore: 0,
    bestAttemptIndex: 0,
    isHotStreak:      false,
  };
}

/**
 * Update a SessionAnalytics object in-place after a new attempt.
 * Computes rolling averages, trend (linear regression slope over last 8 attempts),
 * and hot-streak detection (slope > 8 points/attempt).
 */
export function updateSession(session: SessionAnalytics, score: FinalScore, durationMs = 0): void {
  session.scoreHistory.push(score);
  session.attemptsCount++;
  session.totalDurationMs += durationMs;

  const n = session.attemptsCount;
  session.avgArmScore    = (session.avgArmScore    * (n - 1) + score.armScore)    / n;
  session.avgLegScore    = (session.avgLegScore    * (n - 1) + score.legScore)    / n;
  session.avgTimingScore = (session.avgTimingScore * (n - 1) + score.timingScore) / n;
  session.avgOverallScore = (session.avgOverallScore * (n - 1) + score.overallScore) / n;

  if (score.overallScore > session.bestOverallScore) {
    session.bestOverallScore = score.overallScore;
    session.bestAttemptIndex = n - 1;
  }

  // Linear regression slope over last 8 overall scores
  const recent = session.scoreHistory.slice(-8).map(s => s.overallScore);
  if (recent.length >= 3) {
    const m     = recent.length;
    let sx = 0, sy = 0, sxy = 0, sx2 = 0;
    for (let i = 0; i < m; i++) {
      sx += i; sy += recent[i]; sxy += i * recent[i]; sx2 += i * i;
    }
    const denom = m * sx2 - sx * sx;
    session.scoreTrend = Math.abs(denom) < 1e-9 ? 0 : (m * sxy - sx * sy) / denom;
  }

  session.isHotStreak = session.scoreTrend > 8 && n >= 3;
}

/** Check which milestones are newly earned by this attempt. */
export function checkMilestones(
  session:   SessionAnalytics,
  routineId: string,
  chunkId?:  string,
): Milestone[] {
  const score    = session.scoreHistory.at(-1);
  if (!score) return [];
  const earned: Milestone[] = [];
  const at = new Date().toISOString();
  const make = (type: MilestoneType, value?: number): Milestone =>
    ({ type, achievedAt: at, routineId, chunkId, value });

  if (session.attemptsCount === 1) earned.push(make('first_attempt'));
  if (score.overallScore >= 50  && session.bestAttemptIndex === session.attemptsCount - 1) {
    if (score.overallScore < 60) earned.push(make('score_50', score.overallScore));
  }
  if (score.overallScore >= 75  && session.bestAttemptIndex === session.attemptsCount - 1) {
    if (score.overallScore < 85) earned.push(make('score_75', score.overallScore));
  }
  if (score.overallScore >= 90  && session.bestAttemptIndex === session.attemptsCount - 1) {
    if (score.overallScore < 98) earned.push(make('score_90', score.overallScore));
  }
  if (score.overallScore >= 98) earned.push(make('score_perfect', score.overallScore));
  if (score.armScore    >= 90) earned.push(make('arm_master',    score.armScore));
  if (score.legScore    >= 90) earned.push(make('leg_master',    score.legScore));
  if (score.timingScore >= 90) earned.push(make('timing_master', score.timingScore));
  if (session.isHotStreak && session.scoreTrend >= 10) {
    earned.push(make('improved_10_points', session.scoreTrend));
  }

  return earned;
}