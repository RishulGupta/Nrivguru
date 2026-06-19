export async function extractThumbnail(videoFile: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = URL.createObjectURL(videoFile);
    video.muted = true;
    video.playsInline = true;

    video.onloadeddata = () => {
      // Seek to 1 second in to grab a thumbnail (avoids black first frames)
      video.currentTime = Math.min(1, video.duration / 2);
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        URL.revokeObjectURL(video.src);
        resolve(dataUrl);
      } else {
        URL.revokeObjectURL(video.src);
        reject(new Error('Failed to get canvas context'));
      }
    };

    video.onerror = (e) => {
      URL.revokeObjectURL(video.src);
      reject(e);
    };
  });
}

/**
 * Mock chunking function to simulate Gemini's logic.
 * Real implementation would send the video/audio to Gemini and return optimal segments.
 */
export async function chunkVideoWithAI(videoFile: File, duration: number) {
  return new Promise((resolve) => {
    setTimeout(() => {
      // Create some dummy chunks based on duration
      const chunks = [];
      const chunkCount = Math.max(3, Math.floor(duration / 10)); // ~10s per chunk
      const chunkSize = duration / chunkCount;
      
      for (let i = 0; i < chunkCount; i++) {
        chunks.push({
          startTime: i * chunkSize,
          endTime: (i + 1) * chunkSize,
          name: `Segment ${i + 1}`,
          difficulty: 'Intermediate'
        });
      }
      resolve(chunks);
    }, 2000); // simulate 2s API delay
  });
}
