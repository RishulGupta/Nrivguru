import { useEffect, useRef, useState, useCallback } from 'react';
import type { JointScore, FinalScore } from '@taal/shared/types/routine';
import type { PoseFrame } from '@taal/shared/types/pose';
import type { FocusArea } from '@taal/shared/utils/CorrectionEngine';
import type { Landmark } from '@mediapipe/tasks-vision';

interface PoseDetectionState {
  isWorkerReady: boolean;
  userPose: Landmark[] | null;
  jointScores: JointScore[];
  currentArmScore: number;
  currentLegScore: number;
}

export function usePoseDetection() {
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<PoseDetectionState>({
    isWorkerReady: false,
    userPose: null,
    jointScores: [],
    currentArmScore: 0,
    currentLegScore: 0
  });

  // Track the finish attempt callback
  const onAttemptFinishedRef = useRef<((score: FinalScore) => void) | null>(null);

  useEffect(() => {
    // Instantiate worker
    const worker = new Worker(new URL('../workers/pose.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const { type, payload } = e.data;

      if (type === 'INIT_DONE') {
        setState(s => ({ ...s, isWorkerReady: true }));
      } else if (type === 'FRAME_RESULT') {
        setState(s => ({
          ...s,
          userPose: payload.pose || null,
          jointScores: payload.jointScores || [],
          currentArmScore: payload.armScore || 0,
          currentLegScore: payload.legScore || 0
        }));
      } else if (type === 'ATTEMPT_FINISHED') {
        if (onAttemptFinishedRef.current) {
          onAttemptFinishedRef.current(payload.finalScore);
          onAttemptFinishedRef.current = null;
        }
      }
    };

    worker.postMessage({ type: 'INIT' });

    return () => {
      worker.terminate();
    };
  }, []);

  const loadReference = useCallback((poses: PoseFrame[]) => {
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'LOAD_REFERENCE',
        payload: { poses }
      });
    }
  }, []);

  const processFrame = useCallback((videoElement: HTMLVideoElement, timestamp: number, focusArea: FocusArea) => {
    if (!workerRef.current || !state.isWorkerReady) return;
    
    // We must send an ImageBitmap to the worker for performance
    createImageBitmap(videoElement).then(bitmap => {
      workerRef.current!.postMessage({
        type: 'PROCESS_FRAME',
        payload: { bitmap, timestamp, focusArea }
      }, [bitmap]); // Transfer ownership to avoid copying
    }).catch(err => {
      // Catch errors if video is not ready
      console.warn('Bitmap creation failed:', err);
    });
  }, [state.isWorkerReady]);

  const finishAttempt = useCallback((): Promise<FinalScore> => {
    return new Promise((resolve) => {
      onAttemptFinishedRef.current = resolve;
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'FINISH_ATTEMPT' });
      } else {
        resolve({ armScore: 0, legScore: 0, timingScore: 0, overallScore: 0 });
      }
    });
  }, []);

  return {
    ...state,
    loadReference,
    processFrame,
    finishAttempt
  };
}
