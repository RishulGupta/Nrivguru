import type { PoseLandmark } from '../types/pose';

export interface CorrectionArrow {
  jointIndex:     number;
  startX:         number;
  startY:         number;
  endX:           number;
  endY:           number;
  angle:          number;
  errorMagnitude: number;
  /** 0–1 stability score. Arrows become visible only once stability is high. */
  stability:      number;
}

// ─── Temporal stability buffer ────────────────────────────────────────────────
// Prevents arrows from flickering by requiring consistent errors across frames.

const HISTORY_DEPTH   = 16;  // frames to average over
const STABLE_FRAMES   = 6;   // must appear for N consecutive frames to show
const EMA_ARROW_ALPHA = 0.22; // position smoothing factor

interface ArrowHistory {
  frames:       ({ dx: number; dy: number; dist: number } | null)[];
  head:         number;  // ring buffer head
  presentCount: number;  // how many of last HISTORY_DEPTH frames had an arrow
  // EMA-smoothed positions
  smoothStartX: number;
  smoothStartY: number;
  smoothEndX:   number;
  smoothEndY:   number;
  initialized:  boolean;
}

// Keyed by joint index — module-level to persist across animation frames
const arrowHistories = new Map<number, ArrowHistory>();

function getOrCreateHistory(idx: number): ArrowHistory {
  if (!arrowHistories.has(idx)) {
    arrowHistories.set(idx, {
      frames:       new Array(HISTORY_DEPTH).fill(null),
      head:         0,
      presentCount: 0,
      smoothStartX: 0,
      smoothStartY: 0,
      smoothEndX:   0,
      smoothEndY:   0,
      initialized:  false,
    });
  }
  return arrowHistories.get(idx)!;
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

// ─── Key joints to highlight ──────────────────────────────────────────────────
// Only the joints users can consciously correct (not face, not spine)
const KEY_JOINTS = [13, 14, 15, 16, 25, 26, 27, 28]; // elbows, wrists, knees, ankles

/**
 * Generate temporally-stable correction arrows pointing from the user's joint
 * to where the reference joint is.
 *
 * Improvements over baseline:
 * - 16-frame ring buffer per joint — flickers averaged out
 * - EMA-smoothed arrow positions — no jitter
 * - Arrows only appear after STABLE_FRAMES consecutive frames of error
 * - Returns top 3 by severity (was 2)
 * - Severity = magnitude × consistency, not just magnitude
 */
export function generateCorrectionArrows(
  userPose:       PoseLandmark[],
  refPose:        PoseLandmark[],
  errorThreshold  = 0.038,
): CorrectionArrow[] {
  if (!userPose[23] || !userPose[24] || !refPose[23] || !refPose[24]) return [];

  // Root hip alignment — translate reference into user's coordinate space
  const uHipX = (userPose[23].x + userPose[24].x) / 2;
  const uHipY = (userPose[23].y + userPose[24].y) / 2;
  const rHipX = (refPose[23].x  + refPose[24].x)  / 2;
  const rHipY = (refPose[23].y  + refPose[24].y)  / 2;

  const candidate: CorrectionArrow[] = [];

  for (const idx of KEY_JOINTS) {
    const u = userPose[idx];
    const r = refPose[idx];
    const hist = getOrCreateHistory(idx);

    // Advance ring buffer
    const prevFrame = hist.frames[hist.head];

    if (
      !u || !r ||
      (u.visibility ?? 1) < 0.42 ||
      (r.visibility ?? 1) < 0.42
    ) {
      // Joint not visible this frame — record null
      hist.frames[hist.head] = null;
      hist.head = (hist.head + 1) % HISTORY_DEPTH;
      hist.presentCount = Math.max(0, hist.presentCount - 1);
      continue;
    }

    // Align reference to user's hip
    const rAlignX = r.x - rHipX + uHipX;
    const rAlignY = r.y - rHipY + uHipY;

    const dx   = rAlignX - u.x;
    const dy   = rAlignY - u.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Record frame
    hist.frames[hist.head] = dist > errorThreshold ? { dx, dy, dist } : null;
    hist.head = (hist.head + 1) % HISTORY_DEPTH;

    // Count how many of the last HISTORY_DEPTH frames had an error
    hist.presentCount = hist.frames.filter(f => f !== null).length;

    if (dist <= errorThreshold || hist.presentCount < STABLE_FRAMES) {
      // Not stable enough yet
      continue;
    }

    // Average dx/dy over recent non-null frames for robust direction
    const validFrames = hist.frames.filter((f): f is NonNullable<typeof f> => f !== null);
    const avgDx   = validFrames.reduce((s, f) => s + f.dx, 0)   / validFrames.length;
    const avgDy   = validFrames.reduce((s, f) => s + f.dy, 0)   / validFrames.length;
    const avgDist = validFrames.reduce((s, f) => s + f.dist, 0) / validFrames.length;

    // EMA-smooth the arrow endpoints
    if (!hist.initialized) {
      hist.smoothStartX = u.x;
      hist.smoothStartY = u.y;
      hist.smoothEndX   = u.x + avgDx;
      hist.smoothEndY   = u.y + avgDy;
      hist.initialized  = true;
    } else {
      hist.smoothStartX = lerp(hist.smoothStartX, u.x, EMA_ARROW_ALPHA);
      hist.smoothStartY = lerp(hist.smoothStartY, u.y, EMA_ARROW_ALPHA);
      hist.smoothEndX   = lerp(hist.smoothEndX, u.x + avgDx, EMA_ARROW_ALPHA);
      hist.smoothEndY   = lerp(hist.smoothEndY, u.y + avgDy, EMA_ARROW_ALPHA);
    }

    // Stability: ratio of frames with error vs history depth (0–1)
    const stability = hist.presentCount / HISTORY_DEPTH;

    candidate.push({
      jointIndex:     idx,
      startX:         hist.smoothStartX,
      startY:         hist.smoothStartY,
      endX:           hist.smoothEndX,
      endY:           hist.smoothEndY,
      angle:          Math.atan2(avgDy, avgDx),
      errorMagnitude: avgDist * stability, // penalize unstable arrows
      stability,
    });
  }

  // Sort by combined severity and return top 3
  candidate.sort((a, b) => b.errorMagnitude - a.errorMagnitude);
  return candidate.slice(0, 3);
}

/**
 * Reset the temporal history (e.g. when switching chunks or routines).
 */
export function resetArrowHistories() {
  arrowHistories.clear();
}