export interface BeatCount  { count: number; time: number; }
export interface BeatChunk  { chunkId: number; startCount: number; endCount: number; startTime: number; endTime: number; }
export interface BeatGrid   { bpm: number; beats: number[]; counts: BeatCount[]; chunks: BeatChunk[]; }

const SERVICE_URL = (import.meta as any).env?.VITE_BEAT_SERVICE_URL ?? '';
const API_KEY     = (import.meta as any).env?.VITE_BEAT_API_KEY     ?? '';

/** POST the video file to the beat-detector service and return the beat grid.
 *  Returns null when the service URL is not configured — caller falls back to AI chunking. */
export async function detectBeats(
  videoFile: File,
  countGrouping = 8,
  signal?: AbortSignal,
): Promise<BeatGrid | null> {
  if (!SERVICE_URL) {
    console.warn('[BeatDetector] ❌ VITE_BEAT_SERVICE_URL not set — skipped, beat_grid_json will be null');
    return null;
  }

  console.log(`[BeatDetector] 🎵 Calling ${SERVICE_URL}/detect …`);
  const form = new FormData();
  form.append('file', videoFile);
  form.append('api_key', API_KEY);
  form.append('count_grouping', String(countGrouping));

  const res = await fetch(`${SERVICE_URL}/detect`, { method: 'POST', body: form, signal });
  if (!res.ok) {
    const detail = await res.text().catch(() => String(res.status));
    console.error(`[BeatDetector] ❌ Service returned ${res.status}:`, detail);
    throw new Error(`Beat detection failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const grid = await res.json() as BeatGrid;
  console.log(`[BeatDetector] ✅ BPM: ${grid.bpm}, beats: ${grid.beats.length}, chunks: ${grid.chunks.length}`);
  return grid;
}

/** Convert beat-grid chunks to the internal chunk record shape used throughout the pipeline. */
export function beatGridToChunks(
  grid: BeatGrid,
  videoDurationMs: number,
): Array<{
  chunk_index:      number;
  start_time_ms:    number;
  end_time_ms:      number;
  description:      string;
  clip_url:         string;
  beat_start_count: number;
  beat_end_count:   number;
}> {
  return grid.chunks.map((c, i) => ({
    chunk_index:      i,
    start_time_ms:    Math.round(c.startTime * 1000),
    end_time_ms:      Math.min(Math.round(c.endTime * 1000), videoDurationMs),
    description:      `Counts ${c.startCount}–${c.endCount}`,
    clip_url:         '',
    beat_start_count: c.startCount,
    beat_end_count:   c.endCount,
  }));
}
