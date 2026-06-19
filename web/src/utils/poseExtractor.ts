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

export async function extractFrames(
  videoFile: File, 
  onProgress?: (progress: number) => void
): Promise<any[]> {
  const landmarker = await initializePoseLandmarker();
  
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.muted = true;
    video.playsInline = true;

    const frames: any[] = [];
    let isProcessing = false;

    video.onloadeddata = () => {
      video.play();
      processVideo();
    };

    const processVideo = () => {
      if (video.paused || video.ended) {
        URL.revokeObjectURL(video.src);
        resolve(frames);
        return;
      }

      if (!isProcessing && video.currentTime > 0) {
        isProcessing = true;
        const startTimeMs = performance.now();
        const result = landmarker.detectForVideo(video, startTimeMs);
        
        if (result.landmarks && result.landmarks.length > 0) {
          frames.push({
            timestamp: video.currentTime,
            landmarks: result.landmarks[0]
          });
        }
        
        if (onProgress && video.duration) {
          onProgress((video.currentTime / video.duration) * 100);
        }
        
        isProcessing = false;
      }

      // Use requestVideoFrameCallback if available for precise frame tracking, fallback to requestAnimationFrame
      if ('requestVideoFrameCallback' in video) {
        (video as any).requestVideoFrameCallback(processVideo);
      } else {
        requestAnimationFrame(processVideo);
      }
    };

    video.onerror = (e) => {
      URL.revokeObjectURL(video.src);
      reject(e);
    };
  });
}
