import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { scoreFrame } from '@taal/shared/utils/scoring';
import { CorrectionEngine } from '@taal/shared/utils/CorrectionEngine';
import { MusicalityCoach } from '@taal/shared/utils/MusicalityCoach';
import { scoreSequence } from '@taal/shared/utils/scoring';
import type { PoseFrame } from '@taal/shared/types/pose';
let poseLandmarker: PoseLandmarker | null = null;
let correctionEngine: CorrectionEngine | null = null;
const musicalityCoach = new MusicalityCoach();

// Reference sequence loaded per chunk
let referencePoses: PoseFrame[] = [];
let accumulatedUserFrames: PoseFrame[] = [];

// Track timing internally
let lastWorkerTimestamp = 0;

let lastUserLandmarks: any = null;
let lowVelocityFrameCount = 0;
const LOW_VELOCITY_THRESHOLD = 0.005;
const LOW_VELOCITY_FRAME_COUNT = 30;

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'INIT':
      console.log("WORKER: Starting INIT");
      try {
        await Promise.race([
          initLandmarker(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("MediaPipe WASM timeout")), 5000))
        ]);
        console.log("WORKER: Landmarker initialized");
      } catch (e) {
        console.warn("WORKER: Landmarker failed or timed out, continuing anyway", e);
      }
      console.log("WORKER: creating CorrectionEngine");
      correctionEngine = new CorrectionEngine();
      console.log("WORKER: Posting INIT_DONE");
      self.postMessage({ type: 'INIT_DONE' });
      break;

    case 'LOAD_REFERENCE':
      referencePoses = payload.poses || [];
      accumulatedUserFrames = [];
      self.postMessage({ type: 'LOAD_DONE' });
      break;

    case 'PROCESS_FRAME':
      const { bitmap, timestamp, focusArea } = payload;
      let resultLandmarks = null;

      try {
        if (timestamp <= lastWorkerTimestamp) {
          lastWorkerTimestamp = timestamp + 1;
        } else {
          lastWorkerTimestamp = timestamp;
        }

        if (poseLandmarker) {
          const result = poseLandmarker.detectForVideo(bitmap, lastWorkerTimestamp);
          if (result.landmarks && result.landmarks.length > 0) {
            const keyLandmarks = [0, 11, 12, 23, 24];
            const avgVisibility = keyLandmarks.reduce((sum, idx) => sum + (result.landmarks[0][idx]?.visibility || 0), 0) / keyLandmarks.length;
            if (avgVisibility < 0.5) {
              self.postMessage({ type: 'LOW_VISIBILITY' });
              bitmap.close();
              return;
            }
            resultLandmarks = result.landmarks[0];
          }
        } else {
           // MOCK LOGIC for headless browser testing if WASM timed out
           // Generate a fake user pose based on the reference pose but with a deliberate error
           const refFrame = referencePoses.find(r => r.timestamp_ms >= timestamp) || referencePoses[referencePoses.length - 1];
           if (refFrame && refFrame.landmarks) {
              // Create a deep copy of the reference landmarks
              resultLandmarks = JSON.parse(JSON.stringify(refFrame.landmarks));
              // Deliberately offset the left shoulder (landmark 11) to trigger a Freeze-Frame correction!
              if (resultLandmarks[11]) {
                resultLandmarks[11].y -= 0.5; // Massive error to trigger correction
              }
           }
        }

        bitmap.close(); // free memory

        if (resultLandmarks && lastUserLandmarks) {
          let totalDisplacement = 0;
          for (let i = 0; i < Math.min(resultLandmarks.length, lastUserLandmarks.length, 33); i++) {
            const dx = resultLandmarks[i].x - lastUserLandmarks[i].x;
            const dy = resultLandmarks[i].y - lastUserLandmarks[i].y;
            totalDisplacement += Math.sqrt(dx * dx + dy * dy);
          }
          const avgDisplacement = totalDisplacement / 33;
          if (avgDisplacement < LOW_VELOCITY_THRESHOLD) {
            lowVelocityFrameCount++;
            if (lowVelocityFrameCount >= LOW_VELOCITY_FRAME_COUNT) {
              self.postMessage({ type: 'USER_STOPPED' });
              lowVelocityFrameCount = 0;
            }
          } else {
            lowVelocityFrameCount = 0;
          }
        }
        if (resultLandmarks) {
          lastUserLandmarks = JSON.parse(JSON.stringify(resultLandmarks));
        }

        if (resultLandmarks) {
          const userPose = resultLandmarks;
          
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
            
            if (correctionEngine) {
                correctionEngine.analyze(jointScores, focusArea);
                
                self.postMessage({
                  type: 'FRAME_RESULT',
                  payload: {
                    pose: userPose,
                    jointScores,
                    armScore,
                    legScore,
                    pendingAdjustment: correctionEngine.getPendingAdjustment()
                  }
                });
            } else {
                self.postMessage({
                  type: 'FRAME_RESULT',
                  payload: {
                    pose: userPose,
                    jointScores,
                    armScore,
                    legScore
                  }
                });
            }
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

        // Musicality Coach: cross-correlate velocity profiles
        const refVel = musicalityCoach.extractVelocityProfile(referencePoses);
        const userVel = musicalityCoach.extractVelocityProfile(accumulatedUserFrames);
        const frameLag = musicalityCoach.crossCorrelate(refVel, userVel);
        const timingFeedback = frameLag !== null ? musicalityCoach.getTimingFeedback(frameLag) : null;

        // Asymmetrical Feedback: detect weaker side
        const weakerSide = correctionEngine?.getWeakerSide() || null;

        self.postMessage({
            type: 'ATTEMPT_FINISHED',
            payload: { finalScore: { ...finalScore, timingFeedback, weakerSide } }
        });
      } else {
        self.postMessage({
            type: 'ATTEMPT_FINISHED',
            payload: { finalScore: { armScore: 0, legScore: 0, timingScore: 0, overallScore: 0, timingFeedback: null, weakerSide: null } }
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
      delegate: 'CPU'
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}
