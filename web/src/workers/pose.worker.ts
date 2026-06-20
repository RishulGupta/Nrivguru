import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { scoreFrame } from '@taal/shared/utils/scoring';
import { CorrectionEngine } from '@taal/shared/utils/CorrectionEngine';
import { scoreSequence } from '@taal/shared/utils/scoring';
import type { PoseFrame } from '@taal/shared/types/pose';
let poseLandmarker: PoseLandmarker | null = null;
let correctionEngine: CorrectionEngine | null = null;

// Reference sequence loaded per chunk
let referencePoses: PoseFrame[] = [];
let accumulatedUserFrames: PoseFrame[] = [];

// Track timing internally
let lastWorkerTimestamp = 0;

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'INIT':
      await initLandmarker();
      correctionEngine = new CorrectionEngine();
      self.postMessage({ type: 'INIT_DONE' });
      break;

    case 'LOAD_REFERENCE':
      referencePoses = payload.poses || [];
      accumulatedUserFrames = [];
      self.postMessage({ type: 'LOAD_DONE' });
      break;

    case 'PROCESS_FRAME':
      if (!poseLandmarker) return;
      const { bitmap, timestamp, focusArea } = payload;
      
      try {
        if (timestamp <= lastWorkerTimestamp) {
          lastWorkerTimestamp = timestamp + 1;
        } else {
          lastWorkerTimestamp = timestamp;
        }

        const result = poseLandmarker.detectForVideo(bitmap, lastWorkerTimestamp);
        bitmap.close(); // free memory

        if (result.landmarks && result.landmarks.length > 0) {
          const userPose = result.landmarks[0];
          
          accumulatedUserFrames.push({
            timestamp_ms: timestamp,
            landmarks: userPose
          });

          // Find corresponding reference frame by matching timestamps
          // (assuming reference video and user practice started at 0)
          const refFrame = referencePoses.find(r => r.timestamp_ms >= timestamp) || referencePoses[referencePoses.length - 1];

          if (refFrame) {
            // Score the frame
            const { joints: jointScores, armScore, legScore } = scoreFrame(userPose, refFrame.landmarks);
            
            // Run correction engine to determine what to say
            if (correctionEngine) {
                correctionEngine.analyze(jointScores, focusArea);
            }

            self.postMessage({
              type: 'FRAME_RESULT',
              payload: {
                pose: userPose,
                jointScores,
                armScore,
                legScore
              }
            });
          } else {
             self.postMessage({
              type: 'FRAME_RESULT',
              payload: { pose: userPose }
            });
          }
        } else {
             self.postMessage({
              type: 'FRAME_RESULT',
              payload: { pose: null }
            });
        }
      } catch (err) {
        console.error('Worker processing error:', err);
      }
      break;

    case 'FINISH_ATTEMPT':
      // Run FastDTW sequence scoring at the end of the attempt
      if (referencePoses.length > 0 && accumulatedUserFrames.length > 0) {
        // Sample down to max 300 frames to keep DTW fast if it was a very long chunk
        const finalScore = scoreSequence(accumulatedUserFrames, referencePoses);
        
        self.postMessage({
            type: 'ATTEMPT_FINISHED',
            payload: { finalScore }
        });
      } else {
        self.postMessage({
            type: 'ATTEMPT_FINISHED',
            payload: { finalScore: { armScore: 0, legScore: 0, timingScore: 0, overallScore: 0 } }
        });
      }
      accumulatedUserFrames = [];
      break;
  }
};

async function initLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}
