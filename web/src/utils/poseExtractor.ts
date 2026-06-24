import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseFrame, PoseLandmark, FrameQuality } from '@taal/shared/types/pose';
import {
  PRESENCE_JOINTS,
  SCORING_JOINTS,
  avgJointVisibility,
  frameVelocity,
} from '@taal/shared/types/pose';

// ─── Singleton landmarker ─────────────────────────────────────────────────────
// Initialised once per page load; GPU delegate runs on the main thread.
let poseLandmarker: PoseLandmarker | null = null;
let initPromise:    Promise<PoseLandmarker> | null = null;

export async function initializePoseLandmarker(): Promise<PoseLandmarker> {
  if (poseLandmarker) return poseLandmarker;
  if (initPromise)    return initPromise;

  initPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU',  // main thread → GPU available
      },
      runningMode:                'VIDEO',
      numPoses:                   1,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence:  0.45,
      minTrackingConfidence:      0.45,
    });
    return poseLandmarker;
  })();

  return initPromise;
}

/** Release the shared instance. Call when the user navigates away from Upload. */
export function disposePoseLandmarker(): void {
  poseLandmarker?.close();
  poseLandmarker = null;
  initPromise    = null;
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface ExtractionConfig {
  /**
   * Target frames per second to sample.
   * Default 10 — good balance of accuracy vs speed.
   * At 30fps source this means every 3rd frame.
   */
  targetFps?:       number;
  /**
   * Minimum average visibility of key torso joints for a frame to be accepted.
   * Default 0.40 — rejects frames where the person walks out of frame.
   */
  minVisibility?:   number;
  /**
   * Maximum per-frame joint velocity before a frame is classified as an outlier
   * (tracker glitch / sudden seek jump).  Default 0.35 (normalised coords / frame).
   */
  maxVelocity?:     number;
  /**
   * EMA smoothing alpha applied in a post-processing pass on the accepted sequence.
   * 0 = no smoothing; 0.3 = gentle; 1.0 = no history.  Default 0.28.
   */
  smoothAlpha?:     number;
  /** AbortSignal for cancellation. Resolves with frames collected so far. */
  signal?:          AbortSignal;
  /** Called with 0–100 progress percentage on each frame seek. */
  onProgress?:      (pct: number) => void;
  /**
   * Called with each accepted PoseFrame as it is extracted.
   * Lets the caller stream frames to the UI without waiting for the full sequence.
   */
  onFrame?:         (frame: PoseFrame, index: number) => void;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Detect the video's native FPS from videoTracks (Chrome/Safari non-standard API).
 * Falls back to 30 if unavailable or if detection takes too long.
 */
async function detectNativeFps(objectUrl: string): Promise<number> {
  return new Promise<number>(resolve => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted   = true;
    v.src     = objectUrl;
    const done = (fps: number) => { v.src = ''; resolve(Math.max(10, Math.min(60, fps))); };
    const timer = setTimeout(() => done(30), 3000);
    v.onloadedmetadata = () => {
      clearTimeout(timer);
      // @ts-ignore — non-standard but available in Chrome and Safari
      const vt = v.videoTracks;
      if (vt && vt.length > 0) {
        const settings = vt[0].getSettings?.();
        if (settings?.frameRate) { done(Math.round(settings.frameRate)); return; }
      }
      done(30);
    };
    v.onerror = () => { clearTimeout(timer); done(30); };
  });
}

/** Compute per-frame quality metadata. */
function computeQuality(
  landmarks:    PoseLandmark[],
  velocity:     number,
  visThreshold  = 0.40,
): FrameQuality {
  const torsoVis = avgJointVisibility(landmarks, PRESENCE_JOINTS);
  const allVis   = landmarks.reduce((s, lm) => s + (lm?.visibility ?? 0), 0) / landmarks.length;
  return {
    torsoVisibility: torsoVis,
    avgVisibility:   allVis,
    isValid:         torsoVis >= visThreshold,
    velocity,
    isInterpolated:  false,
  };
}

/**
 * EMA temporal smoothing pass on an extracted pose sequence.
 * Reduces per-frame jitter introduced by the MediaPipe tracker without
 * adding the lag a Kalman filter can introduce on fast moves.
 */
function smoothSequence(frames: PoseFrame[], alpha: number): PoseFrame[] {
  if (frames.length < 2 || alpha >= 1) return frames;
  const inv = 1 - alpha;
  const out: PoseFrame[] = [frames[0]];

  for (let i = 1; i < frames.length; i++) {
    const prev = out[i - 1].landmarks;
    const curr = frames[i].landmarks;
    const smoothed: PoseLandmark[] = curr.map((lm, j) => ({
      x:          alpha * lm.x          + inv * (prev[j]?.x          ?? lm.x),
      y:          alpha * lm.y          + inv * (prev[j]?.y          ?? lm.y),
      z:          alpha * lm.z          + inv * (prev[j]?.z          ?? lm.z),
      visibility: alpha * lm.visibility + inv * (prev[j]?.visibility ?? lm.visibility),
    }));
    out.push({
      ...frames[i],
      landmarks: smoothed,
      quality:   frames[i].quality,
    });
  }
  return out;
}

// ─── Main extractor ───────────────────────────────────────────────────────────

/**
 * Extract pose frames from a video file.
 *
 * Design decisions:
 * - **Seek-based** (not play-based): play() is unreliable on off-screen elements
 *   and can deadlock in some browsers.  Seeking to explicit timestamps is
 *   deterministic and respects onseeked events consistently.
 * - **Adaptive sampling**: we sample at `targetFps` but the positions are
 *   derived from the detected native FPS so we don't create duplicates.
 * - **Quality gate**: frames with low torso visibility are dropped before they
 *   pollute the scoring reference.
 * - **Outlier rejection**: impossibly large inter-frame joint jumps (tracker
 *   glitches) are rejected and replaced with the last good frame's pose.
 * - **EMA post-processing**: a lightweight smoothing pass reduces jitter.
 * - **AbortSignal**: the caller can cancel at any point; we resolve with
 *   whatever frames have been collected so far, so partial results are useful.
 * - **Streaming**: `onFrame` fires on every accepted frame so the UI can show
 *   a live preview skeleton during extraction.
 */
export async function extractFrames(
  videoFile: File,
  onProgress?: (pct: number) => void,
  config: ExtractionConfig = {},
): Promise<PoseFrame[]> {
  const {
    targetFps    = 10,
    minVisibility = 0.40,
    maxVelocity  = 0.35,
    smoothAlpha  = 0.28,
    signal,
    onFrame,
  } = config;

  // Merge legacy onProgress arg with config
  const progressCb = onProgress ?? config.onProgress;

  const landmarker = await initializePoseLandmarker();
  const objectUrl  = URL.createObjectURL(videoFile);

  // Detect native FPS (for accurate seek positions)
  const nativeFps  = await detectNativeFps(objectUrl);
  const frameStep  = Math.max(1, Math.round(nativeFps / targetFps));

  return new Promise<PoseFrame[]>((resolve, reject) => {
    if (signal?.aborted) { URL.revokeObjectURL(objectUrl); resolve([]); return; }

    const video = document.createElement('video');
    video.muted       = true;
    video.playsInline = true;
    video.preload     = 'auto';
    video.src         = objectUrl;

    const accepted: PoseFrame[] = [];
    let lastAcceptedLandmarks: PoseLandmark[] | null = null;
    let seekPositions: number[] = [];
    let seekIdx       = 0;
    let lastTsMs      = -1;
    let frameIdx      = 0;
    let aborted       = false;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.src = '';
      video.load();  // break any pending network request
    };

    const finish = () => {
      signal?.removeEventListener('abort', onAbort);
      cleanup();
      const smoothed = smoothAlpha > 0 && accepted.length > 2
        ? smoothSequence(accepted, smoothAlpha)
        : accepted;
      resolve(smoothed);
    };

    const onAbort = () => {
      aborted = true;
      finish();
    };
    signal?.addEventListener('abort', onAbort);

    // Build seek positions once metadata is available
    video.onloadedmetadata = () => {
      const totalSrcFrames = Math.floor(video.duration * nativeFps);
      seekPositions = [];
      for (let i = 0; i < totalSrcFrames; i += frameStep) {
        seekPositions.push(i / nativeFps);
      }
      if (seekPositions.length === 0) { finish(); return; }
      doSeek();
    };

    function doSeek() {
      if (aborted || seekIdx >= seekPositions.length) { finish(); return; }
      try {
        video.currentTime = seekPositions[seekIdx];
      } catch {
        // Seeking failed (e.g. corrupted keyframe) — skip to next
        seekIdx++;
        setTimeout(doSeek, 0);
      }
    }

    video.onseeked = async () => {
      if (aborted) return;

      try {
        // Strictly increasing timestamps required by MediaPipe
        let tsMs = Math.round(video.currentTime * 1000);
        if (tsMs <= lastTsMs) tsMs = lastTsMs + 1;
        lastTsMs = tsMs;

        const result    = landmarker.detectForVideo(video, tsMs);
        const landmarks = result.landmarks?.[0] as PoseLandmark[] | undefined;

        if (landmarks && landmarks.length >= 33) {
          const torsoVis = avgJointVisibility(landmarks, PRESENCE_JOINTS);

          if (torsoVis >= minVisibility) {
            const vel       = lastAcceptedLandmarks ? frameVelocity(lastAcceptedLandmarks, landmarks) : 0;
            const isOutlier = lastAcceptedLandmarks !== null && vel > maxVelocity;

            if (!isOutlier) {
              const frame: PoseFrame = {
                timestamp_ms: Math.round(video.currentTime * 1000),
                landmarks,
                quality: computeQuality(landmarks, vel, minVisibility),
              };
              accepted.push(frame);
              lastAcceptedLandmarks = landmarks;
              onFrame?.(frame, frameIdx++);
            }
            // Outlier: silently skip — lastAcceptedLandmarks unchanged
          }
        }

        progressCb?.(Math.round((seekIdx / seekPositions.length) * 100));

      } catch (err) {
        // Single-frame failure: log but don't abort the whole extraction
        console.warn('[poseExtractor] frame skipped at', video.currentTime, err);
      }

      seekIdx++;
      setTimeout(doSeek, 0);  // yield to browser between seeks
    };

    video.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      cleanup();
      reject(new Error(`Video failed to load for pose extraction.`));
    };
  });
}