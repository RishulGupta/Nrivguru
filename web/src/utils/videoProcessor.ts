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

export async function chunkVideoWithAI(_videoFile: File, duration: number, styleTag: string = 'other') {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('VITE_GEMINI_API_KEY is not defined');
  }

  const prompt = `This is a dance video of style: ${styleTag}.
Duration: ${duration} seconds.
Identify 8-12 distinct movement segments that a learner should practice separately.
Each segment should be 2-5 seconds long and represent one clear, learnable movement or combination.
Return ONLY valid JSON in this exact format, no other text:
{
  "chunks": [
    {
      "chunk_index": 0,
      "start_time_ms": 0,
      "end_time_ms": 2500,
      "description": "opening arm sweep to the right"
    }
  ]
}`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json" }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.statusText}`);
  }

  const data = await response.json();
  const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResponse) {
    throw new Error('Failed to parse Gemini response');
  }

  try {
    const parsed = JSON.parse(textResponse);
    return parsed.chunks || [];
  } catch (e) {
    console.error('JSON Parse error', e);
    // Fallback: auto-split into 3-second segments
    const chunks = [];
    let start = 0;
    let idx = 0;
    while (start < duration * 1000) {
      const end = Math.min(start + 3000, duration * 1000);
      chunks.push({
        chunk_index: idx++,
        start_time_ms: start,
        end_time_ms: end,
        description: `Segment ${idx}`
      });
      start = end;
    }
    return chunks;
  }
}

export async function sliceVideo(
  videoFile: File,
  startTimeMs: number,
  endTimeMs: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.muted = true;
    video.playsInline = true;

    const canvas = document.createElement('canvas');
    canvas.width = 854;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');

    video.onloadeddata = () => {
      const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const w = video.videoWidth * scale;
      const h = video.videoHeight * scale;
      const x = (canvas.width - w) / 2;
      const y = (canvas.height - h) / 2;

      let stream: MediaStream;
      try {
        stream = (canvas as any).captureStream(30);
      } catch (e) {
        // Fallback for browsers that don't support captureStream
        URL.revokeObjectURL(video.src);
        return reject(new Error('captureStream not supported'));
      }
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        URL.revokeObjectURL(video.src);
        resolve(blob);
      };

      video.currentTime = startTimeMs / 1000;
      
      let recording = false;

      video.onseeked = () => {
        if (!recording) {
          recording = true;
          mediaRecorder.start();
          video.playbackRate = 0.5;
          video.play();
          
          const drawFrame = () => {
            if (video.currentTime * 1000 >= endTimeMs || video.ended || video.paused) {
              video.pause();
              mediaRecorder.stop();
              return;
            }
            if (ctx) {
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(video, x, y, w, h);
            }
            requestAnimationFrame(drawFrame);
          };
          drawFrame();
        }
      };

      video.onerror = (e) => {
        URL.revokeObjectURL(video.src);
        reject(e);
      };
    };
  });
}

