// ─── MediaPipe 33-landmark joint index map ────────────────────────────────────
// Using `as const` so individual values are narrow literal types.

export const JOINT_INDEX = {
  NOSE:            0,
  LEFT_EYE_INNER:  1, LEFT_EYE:  2, LEFT_EYE_OUTER:  3,
  RIGHT_EYE_INNER: 4, RIGHT_EYE: 5, RIGHT_EYE_OUTER: 6,
  LEFT_EAR:  7,  RIGHT_EAR:  8,
  MOUTH_LEFT: 9, MOUTH_RIGHT: 10,
  LEFT_SHOULDER:  11, RIGHT_SHOULDER:  12,
  LEFT_ELBOW:     13, RIGHT_ELBOW:     14,
  LEFT_WRIST:     15, RIGHT_WRIST:     16,
  LEFT_PINKY:     17, RIGHT_PINKY:     18,
  LEFT_INDEX:     19, RIGHT_INDEX:     20,
  LEFT_THUMB:     21, RIGHT_THUMB:     22,
  LEFT_HIP:       23, RIGHT_HIP:       24,
  LEFT_KNEE:      25, RIGHT_KNEE:      26,
  LEFT_ANKLE:     27, RIGHT_ANKLE:     28,
  LEFT_HEEL:      29, RIGHT_HEEL:      30,
  LEFT_FOOT_IDX:  31, RIGHT_FOOT_IDX:  32,
} as const;

export type JointIndex = typeof JOINT_INDEX[keyof typeof JOINT_INDEX];

// ─── Core landmark types ──────────────────────────────────────────────────────

/** Landmark in normalized image coordinates (x, y ∈ [0,1]; z is depth relative to hips). */
export interface PoseLandmark {
  x:          number;
  y:          number;
  z:          number;   // negative = closer to camera
  visibility: number;   // 0–1 detection confidence
}

/** Landmark in world/metric coordinates (origin = hip midpoint, units ≈ metres). */
export interface WorldLandmark {
  x:          number;
  y:          number;
  z:          number;
  visibility: number;
}

// ─── Per-frame quality metadata ───────────────────────────────────────────────

/**
 * Quality summary computed during extraction or live pose detection.
 * Used by downstream code to weight, gate, or skip unreliable frames.
 */
export interface FrameQuality {
  /** Average visibility across key torso joints (0–1). Primary quality signal. */
  torsoVisibility:  number;
  /** Average visibility across all 33 landmarks (0–1). */
  avgVisibility:    number;
  /** True when the frame passes minimum quality thresholds for scoring. */
  isValid:          boolean;
  /** Summed joint displacement since the previous frame (normalised coords). */
  velocity:         number;
  /** True when this frame was synthesised / interpolated rather than detected. */
  isInterpolated:   boolean;
}

// ─── Pose frame ───────────────────────────────────────────────────────────────

export interface PoseFrame {
  timestamp_ms:     number;
  landmarks:        PoseLandmark[];
  worldLandmarks?:  WorldLandmark[];
  /** Computed by extraction pipeline; optional for runtime frames. */
  quality?:         FrameQuality;
}

export type PoseSequence = PoseFrame[];

// ─── Chunk ────────────────────────────────────────────────────────────────────

export interface ChunkData {
  chunk_index:      number;
  start_time_ms:    number;
  end_time_ms:      number;
  description:      string;
  clip_url?:        string;
  pose_slice_json?: PoseFrame[] | string;
}

// ─── Presence & scoring joint groups ─────────────────────────────────────────

/**
 * Joints whose visibility determines whether a body is present in frame.
 * A frame is considered usable when the average visibility of these joints ≥ 0.40.
 */
export const PRESENCE_JOINTS: ReadonlyArray<JointIndex> = [
  JOINT_INDEX.NOSE,
  JOINT_INDEX.LEFT_SHOULDER,  JOINT_INDEX.RIGHT_SHOULDER,
  JOINT_INDEX.LEFT_HIP,       JOINT_INDEX.RIGHT_HIP,
];

/**
 * Joints included in dance scoring (excludes face, fingers, and spine,
 * which cannot be consciously corrected in real time).
 */
export const SCORING_JOINTS: ReadonlyArray<JointIndex> = [
  JOINT_INDEX.LEFT_SHOULDER,  JOINT_INDEX.RIGHT_SHOULDER,
  JOINT_INDEX.LEFT_ELBOW,     JOINT_INDEX.RIGHT_ELBOW,
  JOINT_INDEX.LEFT_WRIST,     JOINT_INDEX.RIGHT_WRIST,
  JOINT_INDEX.LEFT_HIP,       JOINT_INDEX.RIGHT_HIP,
  JOINT_INDEX.LEFT_KNEE,      JOINT_INDEX.RIGHT_KNEE,
  JOINT_INDEX.LEFT_ANKLE,     JOINT_INDEX.RIGHT_ANKLE,
];

/**
 * Joints that express musicality / stylistic nuance.
 * Given extra weight in the MusicalityCoach velocity profile.
 */
export const EXPRESSIVE_JOINTS: ReadonlyArray<JointIndex> = [
  JOINT_INDEX.LEFT_WRIST,  JOINT_INDEX.RIGHT_WRIST,
  JOINT_INDEX.LEFT_HIP,    JOINT_INDEX.RIGHT_HIP,
  JOINT_INDEX.LEFT_ANKLE,  JOINT_INDEX.RIGHT_ANKLE,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True when a single landmark is sufficiently visible. */
export function isVisible(lm: PoseLandmark, threshold = 0.30): boolean {
  return (lm?.visibility ?? 0) >= threshold;
}

/** Average visibility for a given set of joint indices. */
export function avgJointVisibility(
  landmarks: PoseLandmark[],
  indices:   ReadonlyArray<number>,
): number {
  if (indices.length === 0 || landmarks.length === 0) return 0;
  return indices.reduce((s, i) => s + (landmarks[i]?.visibility ?? 0), 0) / indices.length;
}

/** True when this frame has enough visibility for reliable dance scoring. */
export function isQualityFrame(frame: PoseFrame, threshold = 0.40): boolean {
  return avgJointVisibility(frame.landmarks, PRESENCE_JOINTS) >= threshold;
}

/**
 * Type guard: verifies the value is a structurally valid PoseFrame.
 * Useful when deserialising from localStorage / remote JSON.
 */
export function isPoseFrame(value: unknown): value is PoseFrame {
  if (!value || typeof value !== 'object') return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.timestamp_ms === 'number' &&
    Array.isArray(f.landmarks)         &&
    (f.landmarks as unknown[]).length >= 33
  );
}

/**
 * Type guard: verifies an array is a non-empty PoseSequence.
 */
export function isPoseSequence(value: unknown): value is PoseSequence {
  return Array.isArray(value) && value.length > 0 && isPoseFrame(value[0]);
}

/**
 * Compute the sum of Euclidean displacements of all visible joints between
 * two landmark arrays. Used for velocity / outlier detection.
 */
export function frameVelocity(a: PoseLandmark[], b: PoseLandmark[], visThreshold = 0.35): number {
  let total = 0, count = 0;
  for (let i = 0; i < Math.min(a.length, b.length, 33); i++) {
    if ((a[i]?.visibility ?? 0) < visThreshold || (b[i]?.visibility ?? 0) < visThreshold) continue;
    const dx = b[i].x - a[i].x, dy = b[i].y - a[i].y;
    total += Math.sqrt(dx * dx + dy * dy);
    count++;
  }
  return count > 0 ? total / count : 0;
}

/**
 * Mirror a pose horizontally (flip x coordinates around 0.5).
 * Useful for comparing when teacher and student face the camera from opposite sides.
 */
export function mirrorPose(landmarks: PoseLandmark[]): PoseLandmark[] {
  return landmarks.map(lm => ({ ...lm, x: 1 - lm.x }));
}