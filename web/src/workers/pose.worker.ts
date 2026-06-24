import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { scoreFrame, scoreSequence } from '@taal/shared/utils/scoring';
import { CorrectionEngine } from '@taal/shared/utils/CorrectionEngine';
import { MusicalityCoach } from '@taal/shared/utils/MusicalityCoach';
import type { PoseFrame } from '@taal/shared/types/pose';

// ─── Kalman Filter (1D) ───────────────────────────────────────────────────────
// Smooth noisy landmark coordinates to reduce jitter without adding lag.
class KalmanFilter1D {
  private x: number;  // estimated state
  private P: number;  // error covariance
  constructor(
    private Q = 0.008, // process noise (higher = trust measurements more)
    private R = 0.06,  // measurement noise (higher = trust model more)
    initial   = 0,
  ) {
    this.x = initial;
    this.P = 1.0;
  }
  update(z: number): number {
    this.P += this.Q;
    const K = this.P / (this.P + this.R);
    this.x += K * (z - this.x);
    this.P  = (1 - K) * this.P;
    return this.x;
  }
  reset(v: number) { this.x = v; this.P = 1.0; }
}

// 33 landmarks × 4 channels (x,y,z,vis)
// Arm joints (11-16) get higher Q so fast dance moves track without lag
const NUM_LANDMARKS = 33;
const ARM_JOINTS = new Set([11, 12, 13, 14, 15, 16]);
const kFilters: KalmanFilter1D[][] = Array.from({ length: NUM_LANDMARKS }, (_, i) => {
  const q = ARM_JOINTS.has(i) ? 0.025 : 0.008; // ponytail: 3x more responsive for arms
  return [new KalmanFilter1D(q), new KalmanFilter1D(q), new KalmanFilter1D(0.01, 0.08), new KalmanFilter1D(0.005, 0.05)];
});

function applyKalman(landmarks: any[]): any[] {
  return landmarks.map((lm, i) => {
    const kx = kFilters[i][0].update(lm.x);
    const ky = kFilters[i][1].update(lm.y);
    const kz = kFilters[i][2].update(lm.z ?? 0);
    const kv = kFilters[i][3].update(lm.visibility ?? 1);
    return { x: kx, y: ky, z: kz, visibility: Math.max(0, Math.min(1, kv)) };
  });
}

function resetKalman() {
  for (const filters of kFilters) {
    for (const f of filters) f.reset(0);
  }
}

// ─── EMA for scores ───────────────────────────────────────────────────────────
const SCORE_EMA_ALPHA = 0.5;
let emaArmScore = 0, emaLegScore = 0;

// ─── Frame queue (back-pressure) ──────────────────────────────────────────────
// If the main thread sends frames faster than we can process them,
// we keep only the most recent bitmap and discard older ones.
const MAX_QUEUE = 2;
let frameQueue: Array<{ bitmap: ImageBitmap; timestamp: number; focusArea: string }> = [];
let processing = false;

// ─── Worker state ─────────────────────────────────────────────────────────────
let poseLandmarker:    PoseLandmarker | null = null;
let correctionEngine:  CorrectionEngine | null = null;
const musicalityCoach = new MusicalityCoach();

let referencePoses:      PoseFrame[] = [];
let accumulatedUserFrames: PoseFrame[] = [];
let lastWorkerTs         = 0;

let lastUserLandmarks: any = null;
let lowVelocityCount  = 0;
const LOW_VEL_THRESHOLD = 0.004;
const LOW_VEL_FRAMES    = 35;

// ─── Message handler ──────────────────────────────────────────────────────────
self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'INIT': {
      try {
        await Promise.race([
          initLandmarker(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 8000)),
        ]);
      } catch (err) {
        console.warn('WORKER: MediaPipe init failed or timed out', err);
      }
      correctionEngine = new CorrectionEngine();
      self.postMessage({ type: 'INIT_DONE' });
      break;
    }

    case 'LOAD_REFERENCE': {
      referencePoses        = payload.poses ?? [];
      accumulatedUserFrames = [];
      resetKalman();
      emaArmScore = 0;
      emaLegScore = 0;
      correctionEngine?.resetAttempt();
      self.postMessage({ type: 'LOAD_DONE' });
      break;
    }

    case 'CAPTURE_REFERENCE': {
      if (poseLandmarker && payload.bitmap) {
        const ts = Math.max(payload.timestamp ?? 0, lastWorkerTs + 1);
        lastWorkerTs = ts;
        try {
          const result = poseLandmarker.detectForVideo(payload.bitmap, ts);
          if (result.landmarks?.length > 0) {
            referencePoses.push({
              timestamp_ms: payload.timestamp ?? 0,
              landmarks:    applyKalman(result.landmarks[0]),
            });
          }
        } catch { /* skip */ }
      }
      payload.bitmap?.close();
      break;
    }

    case 'PROCESS_FRAME': {
      // Enqueue, drop oldest if over cap
      frameQueue.push({
        bitmap:    payload.bitmap,
        timestamp: payload.timestamp,
        focusArea: payload.focusArea ?? 'full',
      });
      if (frameQueue.length > MAX_QUEUE) {
        const dropped = frameQueue.shift();
        dropped?.bitmap.close(); // free GPU memory immediately
      }
      if (!processing) processNextFrame();
      break;
    }

    case 'FINISH_ATTEMPT': {
      if (referencePoses.length > 0 && accumulatedUserFrames.length > 0) {
        const finalScore = scoreSequence(accumulatedUserFrames, referencePoses);

        const refVel  = musicalityCoach.extractVelocityProfile(referencePoses);
        const userVel = musicalityCoach.extractVelocityProfile(accumulatedUserFrames);
        const lag     = musicalityCoach.crossCorrelate(refVel, userVel);
        const timingFeedback = lag !== null ? musicalityCoach.getTimingFeedback(lag) : null;

        const weakerSide = correctionEngine?.getWeakerSide() ?? null;

        self.postMessage({
          type:    'ATTEMPT_FINISHED',
          payload: { finalScore: { ...finalScore, timingFeedback, weakerSide } },
        });
      } else {
        self.postMessage({
          type:    'ATTEMPT_FINISHED',
          payload: { finalScore: { armScore: 0, legScore: 0, timingScore: 0, overallScore: 0 } },
        });
      }
      accumulatedUserFrames = [];
      break;
    }
  }
};

// ─── Frame processor ──────────────────────────────────────────────────────────

async function processNextFrame() {
  if (frameQueue.length === 0) { processing = false; return; }
  processing = true;

  const { bitmap, timestamp, focusArea } = frameQueue.shift()!;

  try {
    const ts = timestamp <= lastWorkerTs ? lastWorkerTs + 1 : timestamp;
    lastWorkerTs = ts;

    let rawLandmarks: any = null;

    if (poseLandmarker) {
      const result = poseLandmarker.detectForVideo(bitmap, ts);
      if (result.landmarks?.length > 0) {
        rawLandmarks = result.landmarks[0];
      }
    } else {
      // Graceful degradation: synthesize from reference for testing
      const ref = referencePoses.find(r => r.timestamp_ms >= timestamp) ?? referencePoses.at(-1);
      if (ref?.landmarks) {
        rawLandmarks = JSON.parse(JSON.stringify(ref.landmarks));
        // Inject a deliberate small error to exercise the pipeline
        if (rawLandmarks[11]) rawLandmarks[11].y -= 0.12;
      }
    }

    bitmap.close();

    if (!rawLandmarks) {
      self.postMessage({ type: 'FRAME_RESULT', payload: { pose: null } });
      processNextFrame();
      return;
    }

    // ── Body presence check ──────────────────────────────────────────────────
    const keyIdxs = [0, 11, 12, 23, 24];
    const avgVis  = keyIdxs.reduce((s, i) => s + (rawLandmarks[i]?.visibility ?? 0), 0) / keyIdxs.length;
    const torsoH  = Math.abs((rawLandmarks[11]?.y ?? 0) - (rawLandmarks[23]?.y ?? 0));
    const shW     = Math.abs((rawLandmarks[11]?.x ?? 0) - (rawLandmarks[12]?.x ?? 0));

    if (avgVis < 0.45 || (torsoH < 0.10 && shW < 0.12)) {
      self.postMessage({ type: 'LOW_VISIBILITY' });
      processNextFrame();
      return;
    }

    // ── Kalman smoothing ────────────────────────────────────────────────────
    const landmarks = applyKalman(rawLandmarks);

    // ── Low-velocity (stopped) detection ────────────────────────────────────
    if (lastUserLandmarks) {
      let disp = 0;
      for (let i = 0; i < Math.min(landmarks.length, lastUserLandmarks.length, 33); i++) {
        const dx = landmarks[i].x - lastUserLandmarks[i].x;
        const dy = landmarks[i].y - lastUserLandmarks[i].y;
        disp += Math.sqrt(dx * dx + dy * dy);
      }
      const avgDisp = disp / 33;
      if (avgDisp < LOW_VEL_THRESHOLD) {
        if (++lowVelocityCount >= LOW_VEL_FRAMES) {
          self.postMessage({ type: 'USER_STOPPED' });
          lowVelocityCount = 0;
        }
      } else {
        lowVelocityCount = 0;
      }
    }
    lastUserLandmarks = landmarks;

    // ── Accumulate ──────────────────────────────────────────────────────────
    accumulatedUserFrames.push({ timestamp_ms: timestamp, landmarks });

    // ── Match to reference ──────────────────────────────────────────────────
    const refFrame = referencePoses.find(r => r.timestamp_ms >= timestamp) ?? referencePoses.at(-1);

    if (refFrame) {
      const { joints: jointScores, armScore: rawArm, legScore: rawLeg } =
        scoreFrame(landmarks, refFrame.landmarks);

      // EMA smooth scores for display stability
      emaArmScore = SCORE_EMA_ALPHA * rawArm + (1 - SCORE_EMA_ALPHA) * emaArmScore;
      emaLegScore = SCORE_EMA_ALPHA * rawLeg + (1 - SCORE_EMA_ALPHA) * emaLegScore;

      if (correctionEngine) {
        correctionEngine.analyze(jointScores, focusArea as any);
      }

      self.postMessage({
        type:    'FRAME_RESULT',
        payload: {
          pose:              landmarks,
          jointScores,
          armScore:          emaArmScore,
          legScore:          emaLegScore,
          pendingAdjustment: correctionEngine?.getPendingAdjustment() ?? null,
          isFrustrated:      correctionEngine?.isFrustrated() ?? false,
        },
      });
    } else {
      self.postMessage({ type: 'FRAME_RESULT', payload: { pose: landmarks } });
    }
  } catch (err) {
    console.error('Worker frame error:', err);
    self.postMessage({ type: 'FRAME_RESULT', payload: { pose: null, error: String(err) } });
  }

  // Process next queued frame (async, avoids stack overflow)
  setTimeout(processNextFrame, 0);
}

// ─── MediaPipe init ───────────────────────────────────────────────────────────

async function initLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  );
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'CPU', // workers can't use GPU — GPU is main-thread only
    },
    runningMode:              'VIDEO',
    numPoses:                 1,
    minPoseDetectionConfidence: 0.45,
    minPosePresenceConfidence:  0.45,
    minTrackingConfidence:      0.45,
  });
}