import { useEffect, useRef, useState, useCallback } from 'react';
import type { JointScore, FinalScore } from '@taal/shared/types/routine';
import type { PoseFrame } from '@taal/shared/types/pose';
import type { FocusArea } from '@taal/shared/utils/CorrectionEngine';
import type { Landmark } from '@mediapipe/tasks-vision';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PoseDetectionState {
  isWorkerReady:     boolean;
  userPose:          Landmark[] | null;
  jointScores:       JointScore[];
  currentArmScore:   number;
  currentLegScore:   number;
  pendingAdjustment: { jointId: string; targetDiff: number } | null;
  lowVisibility:     boolean;
  userStopped:       boolean;
  isFrustrated:      boolean;
  framesReceived:    number;
  /** Approximate frames-per-second delivered to the worker */
  workerFps:         number;
}

// ─── Global worker singleton ──────────────────────────────────────────────────
// One worker survives across component remounts / route changes.
// Re-creating it causes WASM re-init (expensive) and can deadlock.
let globalWorker:        Worker | null = null;
let isGlobalWorkerReady  = false;

const TARGET_FPS         = 30;
const FRAME_INTERVAL_MS  = 1000 / TARGET_FPS;
// Max unacknowledged frames in flight — prevents flooding a slow worker
const MAX_IN_FLIGHT      = 2;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePoseDetection() {
  const [state, setState] = useState<PoseDetectionState>({
    isWorkerReady:     isGlobalWorkerReady,
    userPose:          null,
    jointScores:       [],
    currentArmScore:   0,
    currentLegScore:   0,
    pendingAdjustment: null,
    lowVisibility:     false,
    userStopped:       false,
    isFrustrated:      false,
    framesReceived:    0,
    workerFps:         0,
  });

  const onAttemptFinishedRef = useRef<((score: FinalScore) => void) | null>(null);

  // Throttle / back-pressure refs
  const lastFrameTimeRef   = useRef(0);
  const inFlightCountRef   = useRef(0);

  // FPS tracking
  const fpsFramesRef       = useRef<number[]>([]);  // timestamps of last N frames
  const FPS_WINDOW         = 30;

  useEffect(() => {
    if (!globalWorker) {
      globalWorker = new Worker(
        new URL('../workers/pose.worker.ts', import.meta.url),
        { type: 'module' }
      );
      globalWorker.postMessage({ type: 'INIT' });
    } else if (isGlobalWorkerReady) {
      setState(s => ({ ...s, isWorkerReady: true }));
    }

    const handleMessage = (e: MessageEvent) => {
      const { type, payload } = e.data;

      switch (type) {
        case 'INIT_DONE':
          isGlobalWorkerReady = true;
          setState(s => ({ ...s, isWorkerReady: true }));
          break;

        case 'FRAME_RESULT':
          // Decrement in-flight counter whenever worker responds
          inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);

          // Update FPS rolling window
          const now = performance.now();
          fpsFramesRef.current.push(now);
          if (fpsFramesRef.current.length > FPS_WINDOW) fpsFramesRef.current.shift();
          const fps = fpsFramesRef.current.length >= 2
            ? Math.round((fpsFramesRef.current.length - 1) /
                ((now - fpsFramesRef.current[0]) / 1000))
            : 0;

          setState(s => ({
            ...s,
            userPose:          payload.pose ?? null,
            jointScores:       payload.jointScores ?? [],
            currentArmScore:   payload.armScore   ?? s.currentArmScore,
            currentLegScore:   payload.legScore   ?? s.currentLegScore,
            pendingAdjustment: payload.pendingAdjustment ?? null,
            lowVisibility:     false,
            isFrustrated:      payload.isFrustrated ?? false,
            framesReceived:    s.framesReceived + 1,
            workerFps:         fps,
          }));
          break;

        case 'ATTEMPT_FINISHED':
          inFlightCountRef.current = 0;
          onAttemptFinishedRef.current?.(payload.finalScore);
          onAttemptFinishedRef.current = null;
          break;

        case 'LOW_VISIBILITY':
          setState(s => ({ ...s, lowVisibility: true }));
          break;

        case 'USER_STOPPED':
          setState(s => ({ ...s, userStopped: true }));
          break;
      }
    };

    globalWorker.addEventListener('message', handleMessage);
    return () => globalWorker?.removeEventListener('message', handleMessage);
  }, []);

  // ── loadReference ─────────────────────────────────────────────────────────

  const loadReference = useCallback((poses: PoseFrame[]) => {
    globalWorker?.postMessage({ type: 'LOAD_REFERENCE', payload: { poses } });
  }, []);

  // ── processFrame (throttled + back-pressured) ─────────────────────────────

  const processFrame = useCallback((
    videoElement: HTMLVideoElement,
    timestamp:    number,
    focusArea:    FocusArea,
  ) => {
    if (!globalWorker || !state.isWorkerReady) return;

    const now = performance.now();
    // Hard throttle: don't exceed TARGET_FPS
    if (now - lastFrameTimeRef.current < FRAME_INTERVAL_MS) return;
    // Back-pressure: don't flood a slow worker
    if (inFlightCountRef.current >= MAX_IN_FLIGHT) return;

    lastFrameTimeRef.current = now;

    createImageBitmap(videoElement)
      .then(bitmap => {
        inFlightCountRef.current++;
        globalWorker!.postMessage(
          { type: 'PROCESS_FRAME', payload: { bitmap, timestamp, focusArea } },
          [bitmap], // transfer ownership
        );
      })
      .catch(() => {
        // Video not ready (e.g. seeking) — silently skip
      });
  }, [state.isWorkerReady]);

  // ── finishAttempt ─────────────────────────────────────────────────────────

  const finishAttempt = useCallback((): Promise<FinalScore> => {
    return new Promise(resolve => {
      onAttemptFinishedRef.current = resolve;
      if (globalWorker) {
        globalWorker.postMessage({ type: 'FINISH_ATTEMPT' });
      } else {
        resolve({ armScore: 0, legScore: 0, timingScore: 0, overallScore: 0 });
      }
    });
  }, []);

  // ── captureReferenceFrame ─────────────────────────────────────────────────

  const captureReferenceFrame = useCallback((videoElement: HTMLVideoElement, timestamp: number) => {
    if (!globalWorker || !isGlobalWorkerReady) return;
    createImageBitmap(videoElement)
      .then(bitmap => {
        globalWorker!.postMessage(
          { type: 'CAPTURE_REFERENCE', payload: { bitmap, timestamp } },
          [bitmap],
        );
      })
      .catch(() => {});
  }, []);

  // ── clearUserStopped ──────────────────────────────────────────────────────

  const clearUserStopped = useCallback(() => {
    setState(s => ({ ...s, userStopped: false }));
  }, []);

  // ── clearLowVisibility ────────────────────────────────────────────────────

  const clearLowVisibility = useCallback(() => {
    setState(s => ({ ...s, lowVisibility: false }));
  }, []);

  return {
    ...state,
    loadReference,
    processFrame,
    finishAttempt,
    clearUserStopped,
    clearLowVisibility,
    captureReferenceFrame,
  };
}