import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

let poseLandmarker: PoseLandmarker | null = null;

export async function initializePoseLandmarker() {
  if (poseLandmarker) return poseLandmarker;

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

  return poseLandmarker;
}

/**
 * Extract pose frames using seek-based approach (NOT play-based).
 *
 * Why seek-based: offscreen <video> elements often fail to play reliably or
 * trigger requestVideoFrameCallback in all browsers. Seeking to exact positions
 * and detecting on seeked events is deterministic and faster.
 *
 * Processes every 3rd frame at ~30fps = ~10 poses/second.
 */
export async function extractFrames(
  videoFile: File,
  onProgress?: (progress: number) => void
): Promise<any[]> {
  const landmarker = await initializePoseLandmarker();

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = URL.createObjectURL(videoFile);

    const frames: any[] = [];
    let abort = false;
    const timeout = setTimeout(() => { abort = true; }, 120000); // 2 min max

    // After each seek, detect landmarks, then seek to next position
    let seekPositions: number[] = [];
    let currentSeekIdx = 0;
    let lastTimestampMs = 0;

    video.onloadedmetadata = () => {
      const fps = 30;
      const totalFrames = Math.floor(video.duration * fps);
      const step = 3; // every 3rd frame
      seekPositions = [];
      for (let i = 0; i < totalFrames; i += step) {
        seekPositions.push(i / fps);
      }
      // Start seeking
      doSeek();
    };

    function doSeek() {
      if (abort || currentSeekIdx >= seekPositions.length) {
        clearTimeout(timeout);
        URL.revokeObjectURL(video.src);
        resolve(frames);
        return;
      }

      video.currentTime = seekPositions[currentSeekIdx];
    }

    video.onseeked = async () => {
      if (abort) return;

      try {
        const timestampMs = Math.round(video.currentTime * 1000);
        if (timestampMs <= lastTimestampMs) {
          // Ensure strictly increasing timestamps for MediaPipe
          lastTimestampMs = timestampMs + 1;
        } else {
          lastTimestampMs = timestampMs;
        }

        const result = landmarker.detectForVideo(video, lastTimestampMs);

        if (result.landmarks && result.landmarks.length > 0) {
          frames.push({
            timestamp: video.currentTime,
            landmarks: result.landmarks[0]
          });
        }

        if (onProgress && seekPositions.length > 0) {
          const pct = Math.round((currentSeekIdx / seekPositions.length) * 100);
          onProgress(pct);
        }
      } catch (err) {
        console.warn('Pose extraction skipped a frame at', video.currentTime, err);
      }

      currentSeekIdx++;
      // Schedule next seek asynchronously to avoid blocking
      setTimeout(doSeek, 0);
    };

    video.onerror = (e) => {
      clearTimeout(timeout);
      URL.revokeObjectURL(video.src);
      reject(e);
    };
  });
}
