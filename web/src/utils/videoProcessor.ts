export async function extractThumbnail(videoFile: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = URL.createObjectURL(videoFile);
    video.muted = true;
    video.playsInline = true;

    video.onloadeddata = () => {
      video.currentTime = Math.max(1, video.duration * 0.1);
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
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

// Model list: newer models first. 1.5-flash was deprecated (returns 404).
// If all fail, the caller falls back to auto-split.
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

async function callGemini(prompt: string, apiKey: string): Promise<string | null> {
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: "application/json" }
        })
      });
      if (res.ok) {
        return res.text();
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function chunkVideoWithAI(_videoFile: File, duration: number, styleTag: string = 'other') {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('VITE_GEMINI_API_KEY is not defined — falling back to auto-split');
    return fallbackSplit(duration);
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

  // Try Gemini with model fallback
  let textResponse: string | null = null;
  try {
    const raw = await callGemini(prompt, apiKey);
    if (raw) {
      const data = JSON.parse(raw);
      textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    }
  } catch {
    textResponse = null;
  }

  // If we got a response, try to parse it
  if (textResponse) {
    try {
      const parsed = JSON.parse(textResponse);
      if (parsed.chunks && Array.isArray(parsed.chunks) && parsed.chunks.length > 0) {
        return parsed.chunks;
      }
    } catch {
      console.warn('Gemini returned unparseable JSON, falling back to auto-split');
    }
  }

  // Gemini failed or returned bad data — use auto-split
  console.warn('Gemini chunking failed, using auto-split fallback');
  return fallbackSplit(duration);
}

function fallbackSplit(duration: number) {
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

export async function sliceVideo(
  videoFile: File,
  startTimeMs: number,
  endTimeMs: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = URL.createObjectURL(videoFile);

    const canvas = document.createElement('canvas');
    canvas.width = 854;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    const timeout = setTimeout(() => reject(new Error('sliceVideo timed out')), 30000);

    video.onloadeddata = () => {
      const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const w = video.videoWidth * scale;
      const h = video.videoHeight * scale;
      const drawX = (canvas.width - w) / 2;
      const drawY = (canvas.height - h) / 2;

      let stream: MediaStream;
      try {
        stream = (canvas as any).captureStream(15);
      } catch {
        URL.revokeObjectURL(video.src);
        clearTimeout(timeout);
        return reject(new Error('captureStream not supported'));
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const blobs: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) blobs.push(e.data);
      };

      mediaRecorder.onstop = () => {
        clearTimeout(timeout);
        const blob = new Blob(blobs, { type: 'video/webm' });
        URL.revokeObjectURL(video.src);
        resolve(blob);
      };

      // Seek-based frame capture: seek to each time position and draw to canvas
      const frameIntervalMs = 100; // 10fps for slow-mo clip
      let currentFrameTime = startTimeMs;

      // Start recording
      mediaRecorder.start();

      function captureNextFrame() {
        if (currentFrameTime > endTimeMs) {
          mediaRecorder.stop();
          return;
        }
        video.currentTime = currentFrameTime / 1000;
      }

      video.onseeked = () => {
        if (ctx && video.videoWidth > 0) {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(video, drawX, drawY, w, h);
        }
        currentFrameTime += frameIntervalMs;
        // Schedule next frame capture
        setTimeout(captureNextFrame, 16); // ~60fps schedule
      };

      // Start capturing
      captureNextFrame();
    };

    video.onerror = (e) => {
      clearTimeout(timeout);
      URL.revokeObjectURL(video.src);
      reject(e);
    };
  });
}
