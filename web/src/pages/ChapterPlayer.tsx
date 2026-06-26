import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, CameraOff, Cpu, Play, Pause, SkipBack, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useStore';
import { getOriginalVideoUrl } from '../utils/videoStore';
import { usePoseDetection } from '../hooks/usePoseDetection';
import { StickmanCanvas } from '../components/StickmanCanvas';
import type { FinalScore, JointScore } from '@taal/shared/types/routine';

// ── Types ─────────────────────────────────────────────────────────────────────

type ChapterType = 'warmup' | 'watch' | 'teach' | 'practice' | 'connect' | 'full_routine';
type CameraMode = 'off' | 'mirror' | 'ai';

interface DbChunk {
  id: string;
  chunk_index: number;
  start_time_ms: number;
  end_time_ms: number;
  description?: string | null;
  clip_url?: string;
  pose_slice_json?: string | any[];
}

interface BeatCount { count: number; time: number; }

interface BeatGridJson {
  bpm: number;
  beats: number[];
  counts: BeatCount[];
  chunks: { chunkId: number; startCount: number; endCount: number; startTime: number; endTime: number; }[];
}

interface DbRoutine {
  id: string;
  title: string;
  duration_seconds?: number;
  thumbnail_url?: string;
  thumbnail?: string;
  video_blob_url?: string;
  chunks: DbChunk[];
  beat_grid_json?: BeatGridJson | null;
}

interface Chapter {
  id: string;
  type: ChapterType;
  title: string;
  chunkIndices: number[];
  startTimeMs: number;
  endTimeMs: number;
  playbackRate: number;
  muted: boolean;   // true = beats-only, false = with music/audio
  emoji: string;
  showSplit: boolean;
}

// ── Chapter generation ─────────────────────────────────────────────────────────
// Music stages always generated — if video has no audio they just play silently.
// "Count-only mode" label shown in header when no beat_grid_json (no captions).

function generateChapters(chunks: DbChunk[], durationMs: number): Chapter[] {
  const chapters: Chapter[] = [];
  const n = chunks.length;
  const allIdx = Array.from({ length: n }, (_, i) => i);

  // 1. Warm-up
  chapters.push({ id: 'warmup', type: 'warmup', title: 'Warm Up', chunkIndices: [], startTimeMs: 0, endTimeMs: 0, playbackRate: 1, muted: true, emoji: '🏋️', showSplit: false });

  // 2. Watch — full routine, full speed, with music
  chapters.push({ id: 'watch', type: 'watch', title: 'Watch · Full Routine', chunkIndices: allIdx, startTimeMs: 0, endTimeMs: durationMs, playbackRate: 1, muted: false, emoji: '👀', showSplit: false });

  for (let i = 0; i < n; i++) {
    const ch = chunks[i];
    const num = i + 1;
    const label = ch.description || `Chunk ${num}`;
    const s = ch.start_time_ms;
    const e = ch.end_time_ms;

    // 3. Teach
    chapters.push({ id: `teach-${i}`, type: 'teach', title: `Teach · ${label}`, chunkIndices: [i], startTimeMs: s, endTimeMs: e, playbackRate: 0.5, muted: true, emoji: '📖', showSplit: false });

    // 4. Practice — slow beats (0.5×)
    chapters.push({ id: `prac-${i}-slow`, type: 'practice', title: `Practice ${num} · Slow`, chunkIndices: [i], startTimeMs: s, endTimeMs: e, playbackRate: 0.5, muted: true, emoji: '🐢', showSplit: true });

    // 5. Practice — faster beats (0.75×)
    chapters.push({ id: `prac-${i}-med`, type: 'practice', title: `Practice ${num} · Building`, chunkIndices: [i], startTimeMs: s, endTimeMs: e, playbackRate: 0.75, muted: true, emoji: '⏫', showSplit: true });

    // 6. Practice — normal-speed beats (1×)
    chapters.push({ id: `prac-${i}-full`, type: 'practice', title: `Practice ${num} · Full speed`, chunkIndices: [i], startTimeMs: s, endTimeMs: e, playbackRate: 1.0, muted: true, emoji: '🎯', showSplit: true });

    // 7. Practice — slow music (0.75×, unmuted)
    chapters.push({ id: `prac-${i}-slow-music`, type: 'practice', title: `Practice ${num} · Slow + music`, chunkIndices: [i], startTimeMs: s, endTimeMs: e, playbackRate: 0.75, muted: false, emoji: '🎵', showSplit: true });

    // 8. Practice — normal-speed music (1×, unmuted)
    chapters.push({ id: `prac-${i}-music`, type: 'practice', title: `Practice ${num} · With music`, chunkIndices: [i], startTimeMs: s, endTimeMs: e, playbackRate: 1.0, muted: false, emoji: '🎶', showSplit: true });

    // Connect step (starting at chunk index 1, i.e. second chunk)
    if (i >= 1) {
      const winStart = Math.max(0, i - 2);
      const winChunks = chunks.slice(winStart, i + 1);
      const winLabel = winChunks.map((_, j) => winStart + j + 1).join('+');
      const winIndices = winChunks.map((_, j) => winStart + j);

      // 9. Connect — normal-speed beats
      chapters.push({ id: `connect-${i}`, type: 'connect', title: `Connect ${winLabel} · Full speed`, chunkIndices: winIndices, startTimeMs: chunks[winStart].start_time_ms, endTimeMs: ch.end_time_ms, playbackRate: 1.0, muted: true, emoji: '🔗', showSplit: true });

      // 10. Connect — music
      chapters.push({ id: `connect-${i}-music`, type: 'connect', title: `Connect ${winLabel} · With music`, chunkIndices: winIndices, startTimeMs: chunks[winStart].start_time_ms, endTimeMs: ch.end_time_ms, playbackRate: 1.0, muted: false, emoji: '🔗🎵', showSplit: true });
    }
  }

  // 11–14. Full routine practice after last chunk
  chapters.push({ id: 'full-slow', type: 'full_routine', title: 'Full Routine · Slow', chunkIndices: allIdx, startTimeMs: 0, endTimeMs: durationMs, playbackRate: 0.5, muted: true, emoji: '🌟', showSplit: true });
  chapters.push({ id: 'full-full', type: 'full_routine', title: 'Full Routine · Full speed', chunkIndices: allIdx, startTimeMs: 0, endTimeMs: durationMs, playbackRate: 1.0, muted: true, emoji: '⭐', showSplit: true });
  chapters.push({ id: 'full-slow-music', type: 'full_routine', title: 'Full Routine · Slow + music', chunkIndices: allIdx, startTimeMs: 0, endTimeMs: durationMs, playbackRate: 0.75, muted: false, emoji: '🌟🎵', showSplit: true });
  chapters.push({ id: 'full-music', type: 'full_routine', title: 'Full Routine · With music', chunkIndices: allIdx, startTimeMs: 0, endTimeMs: durationMs, playbackRate: 1.0, muted: false, emoji: '🏆', showSplit: true });

  return chapters;
}

// ── Motion beat extraction ────────────────────────────────────────────────────

function extractMotionBeats(frames: any[], startTimeMs: number, endTimeMs: number): BeatCount[] {
  if (!Array.isArray(frames) || frames.length < 8) return [];
  const durationSec = (endTimeMs - startTimeMs) / 1000;
  if (durationSec <= 0) return [];
  const fps = frames.length / durationSec;

  const getLM = (frame: any, idx: number): { x: number; y: number; vis: number } | null => {
    if (!frame) return null;
    const lms: any[] = Array.isArray(frame)
      ? frame
      : (frame.landmarks ?? frame.pose_landmarks ?? frame.world_landmarks ?? null);
    if (!Array.isArray(lms) || !lms[idx]) return null;
    const lm = lms[idx];
    if (Array.isArray(lm)) return { x: lm[0] ?? 0, y: lm[1] ?? 0, vis: lm[3] ?? 1 };
    return { x: lm.x ?? 0, y: lm.y ?? 0, vis: lm.visibility ?? lm.score ?? 1 };
  };

  // Hips (23,24) weight 2, shoulders (11,12) weight 1.5, knees (25,26) weight 1
  const JOINTS: [number, number][] = [[23, 2], [24, 2], [11, 1.5], [12, 1.5], [25, 1], [26, 1]];

  const energy = new Float32Array(frames.length);
  for (let i = 1; i < frames.length; i++) {
    let e = 0;
    for (const [idx, w] of JOINTS) {
      const prev = getLM(frames[i - 1], idx);
      const curr = getLM(frames[i], idx);
      if (!prev || !curr || curr.vis < 0.25) continue;
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      e += w * curr.vis * Math.sqrt(dx * dx + dy * dy);
    }
    energy[i] = e;
  }

  // Gaussian smooth (~fps/4 window)
  const win = Math.max(2, Math.round(fps / 4));
  const smoothed = new Float32Array(frames.length);
  for (let i = 0; i < energy.length; i++) {
    let sum = 0, wsum = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(energy.length - 1, i + win); j++) {
      const gw = Math.exp(-0.5 * ((j - i) / (win * 0.5)) ** 2);
      sum += energy[j] * gw; wsum += gw;
    }
    smoothed[i] = wsum > 0 ? sum / wsum : 0;
  }

  // Dynamic threshold: mean + 0.3σ
  const mean = smoothed.reduce((a, b) => a + b, 0) / smoothed.length;
  let variance = 0;
  for (let i = 0; i < smoothed.length; i++) variance += (smoothed[i] - mean) ** 2;
  const std = Math.sqrt(variance / smoothed.length);
  const threshold = mean + 0.3 * std;

  // Peak pick: min gap = 150ms
  const minDist = Math.max(3, Math.round(fps * 0.15));
  const peaks: number[] = [];
  let lastPeak = -minDist;

  for (let i = 1; i < smoothed.length - 1; i++) {
    if (smoothed[i] < threshold) continue;
    if (smoothed[i] <= smoothed[i - 1] || smoothed[i] < smoothed[i + 1]) continue;
    if (i - lastPeak < minDist) {
      if (peaks.length && smoothed[i] > smoothed[peaks[peaks.length - 1]]) {
        peaks[peaks.length - 1] = i; lastPeak = i;
      }
      continue;
    }
    peaks.push(i); lastPeak = i;
  }

  return peaks.map((fi, i) => ({
    count: (i % 8) + 1,
    time: startTimeMs / 1000 + fi / fps,
  }));
}


// ── TeachPlan types ────────────────────────────────────────────────────────────

interface PausePoint { count: number; callout: string; }
interface BuildStep {
  countRange: [number, number];
  reps: number;
  pausePoint?: PausePoint;
  narrationTexts: string[]; // one synthesized phrase per rep
}
interface TeachPlan {
  beats: BeatCount[];
  cues: Map<number, string>;
  descriptions: Map<number, string>; // richer per-count teacher phrases
  pausePoints: PausePoint[];
  steps: BuildStep[];
  connectors: string[];
}
type TeachPhase = 'computing' | 'teaching' | 'clean_pass' | 'done';

// ── Joint delta → short phrase ─────────────────────────────────────────────────

function jointDeltaPhrase(joint: string, dx: number, dy: number): string {
  const side = joint.includes('left') ? 'left' : 'right';
  const isArm = joint.includes('wrist') || joint.includes('elbow') || joint.includes('shoulder');
  const isLeg = joint.includes('knee') || joint.includes('ankle');
  const isHip = joint.includes('hip');
  if (isArm) {
    if (Math.abs(dx) > Math.abs(dy)) return `${side} arm out`;
    return dy < 0 ? `${side} arm up` : `${side} arm down`;
  }
  if (isLeg) return Math.abs(dx) > Math.abs(dy) ? `step ${side}` : `${side} leg up`;
  if (isHip) return Math.abs(dx) > Math.abs(dy) ? `hips ${dx > 0 ? 'right' : 'left'}` : 'hips drop';
  return `shift ${side}`;
}

// ── Compute per-count cues + pause points from pose_slice_json ─────────────────

// Computed lazily to avoid forward-reference to JOINT_IDX declared later in file
let _JOINT_KEYS: (keyof typeof JOINT_IDX)[] | null = null;
function getJointKeys() {
  if (!_JOINT_KEYS) _JOINT_KEYS = Object.keys(JOINT_IDX) as (keyof typeof JOINT_IDX)[];
  return _JOINT_KEYS;
}
const CUE_THRESHOLD = 0.07;
const PAUSE_THRESHOLD = 0.16;

function computeJointCues(
  poseSlice: any[],
  beats: BeatCount[],
): { cues: Map<number, string>; pausePointCounts: number[] } {
  if (!poseSlice?.length) return { cues: new Map(), pausePointCounts: [] };

  interface Delta { count: number; joint: string; delta: number; dx: number; dy: number; }
  const deltas: Delta[] = [];

  for (let i = 0; i < beats.length; i++) {
    const t1 = beats[i].time;
    const t2 = i + 1 < beats.length ? beats[i + 1].time : t1 + 0.5;
    let f1Idx = 0, f2Idx = 0, d1Best = Infinity, d2Best = Infinity;
    for (let j = 0; j < poseSlice.length; j++) {
      const ft: number = poseSlice[j]?.t ?? poseSlice[j]?.time ?? (j / 30);
      const a = Math.abs(ft - t1), b = Math.abs(ft - t2);
      if (a < d1Best) { d1Best = a; f1Idx = j; }
      if (b < d2Best) { d2Best = b; f2Idx = j; }
    }
    const frame1 = poseSlice[f1Idx];
    const frame2 = poseSlice[f2Idx];
    if (!frame1 || !frame2) continue;
    let maxDelta = 0, maxJoint = '', maxDx = 0, maxDy = 0;
    for (const jname of getJointKeys()) {
      const idx = JOINT_IDX[jname];
      const lm1 = frame1.landmarks?.[idx] ?? frame1[idx];
      const lm2 = frame2.landmarks?.[idx] ?? frame2[idx];
      if (!lm1 || !lm2) continue;
      const dx = (lm2.x ?? 0) - (lm1.x ?? 0);
      const dy = (lm2.y ?? 0) - (lm1.y ?? 0);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxDelta) { maxDelta = d; maxJoint = jname; maxDx = dx; maxDy = dy; }
    }
    if (maxDelta > CUE_THRESHOLD && maxJoint) {
      deltas.push({ count: beats[i].count, joint: maxJoint, delta: maxDelta, dx: maxDx, dy: maxDy });
    }
  }

  const cues = new Map<number, string>();
  deltas.forEach(d => cues.set(d.count, jointDeltaPhrase(d.joint, d.dx, d.dy)));
  const pausePointCounts = deltas
    .filter(d => d.delta > PAUSE_THRESHOLD)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 2)
    .map(d => d.count);
  return { cues, pausePointCounts };
}

// ── Generate progressive build steps ──────────────────────────────────────────
// Step sizes are driven by cue positions so new movements get their own step.
// Each step carries pre-built narration phrases (one per rep) as full sentences.

function generateBuildSteps(
  beats: BeatCount[],
  pausePointCounts: number[],
  cues: Map<number, string>,
): { steps: BuildStep[]; connectors: string[] } {
  const n = beats.length;
  if (n === 0) return { steps: [], connectors: [] };

  // Build step endpoints around cue positions so each cue gets introduced naturally.
  // Always start at 1, then jump to ~3 or first cue, then each subsequent cue, then 8.
  const cueCounts = [...cues.keys()].sort((a, b) => a - b);
  const ends = new Set<number>();
  ends.add(1);                             // always introduce count 1 alone
  const firstGroup = cueCounts.find(c => c >= 3) ?? 3;
  ends.add(Math.min(firstGroup, Math.min(4, n)));
  for (const c of cueCounts) { if (c < n) ends.add(c); }
  ends.add(n);

  const sortedEnds = [...ends].sort((a, b) => a - b);
  const connPool = ['we go', 'now', 'right', 'from here'];
  const shuffled = [...connPool].sort(() => Math.random() - 0.5);

  // Build a natural-sounding count phrase for a given range end + rep index
  const buildPhrase = (rangeEnd: number, repIdx: number, conn: string, isLast: boolean): string => {
    // Connector prefix
    const prefix = repIdx === 0
      ? (isLast ? 'so we go' : conn)
      : null; // second rep of same range: just counts, no prefix

    const parts: string[] = [];
    for (let c = 1; c <= rangeEnd; c++) {
      const cue = cues.get(c)?.replace(/_/g, ' ') ?? null;
      const isLastCount = c === rangeEnd;
      if (cue) {
        // Cue is spoken just before the count: "arm to right, 6"
        parts.push(`${cue}, ${isLastCount && rangeEnd > 2 ? 'and ' : ''}${c}`);
      } else if (isLastCount && rangeEnd > 2) {
        parts.push(`and ${c}`);
      } else {
        parts.push(String(c));
      }
    }

    const countStr = parts.join(', ');
    return prefix ? `${prefix}, ${countStr}` : countStr;
  };

  const assignedPauses = new Set<number>();
  const steps: BuildStep[] = [];
  const connectors: string[] = [];

  sortedEnds.forEach((rangeEnd, i) => {
    const isLast = rangeEnd === n;
    const conn = shuffled[i % shuffled.length] ?? 'we go';
    // First step and 3-count groups get a repeat; longer groups don't
    const reps = rangeEnd <= 3 ? 2 : 1;

    const candidate = pausePointCounts.find(p => p <= rangeEnd && !assignedPauses.has(p));
    let pausePoint: PausePoint | undefined;
    if (candidate !== undefined) {
      assignedPauses.add(candidate);
      const cueText = cues.get(candidate)?.replace(/_/g, ' ');
      pausePoint = { count: candidate, callout: cueText ? `see — ${cueText}` : 'watch this' };
    }

    const narrationTexts = Array.from({ length: reps }, (_, r) => buildPhrase(rangeEnd, r, conn, isLast));
    steps.push({ countRange: [1, rangeEnd], reps, pausePoint, narrationTexts });
    connectors.push(conn);
  });

  return { steps, connectors };
}

// ── Gemini TTS pre-synthesis ────────────────────────────────────────────────────
// All narration tokens (count words, connectors, cues, callouts) are synthesized
// once per chapter via Gemini API, decoded to AudioBuffers, and scheduled against
// video.currentTime via Web Audio for beat-locked delivery.

const _ttsCache = new Map<string, AudioBuffer>();

async function synthesizeTTS(text: string, ctx: AudioContext): Promise<AudioBuffer | null> {
  const k = text.trim();
  if (_ttsCache.has(k)) return _ttsCache.get(k)!;
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY ?? '';
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: k }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          },
        }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const part = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!part?.data) return null;
    const mimeType: string = part.mimeType ?? 'audio/pcm;rate=24000';
    const raw = atob(part.data);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    let buf: AudioBuffer;
    if (mimeType.startsWith('audio/pcm')) {
      const rate = parseInt(mimeType.match(/rate=(\d+)/)?.[1] ?? '24000');
      const pcm16 = new Int16Array(bytes.buffer);
      buf = ctx.createBuffer(1, pcm16.length, rate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < pcm16.length; i++) ch[i] = pcm16[i] / 32768;
    } else {
      buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
    }
    _ttsCache.set(k, buf);
    return buf;
  } catch { return null; }
}


const COUNT_SPOKEN = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

// "trying one" / "trying two to three" — spoken right before each forward isolated play
function tryingPhrase(i: number): string {
  return i === 1 ? 'trying one' : `trying ${COUNT_SPOKEN[i - 1]} to ${COUNT_SPOKEN[i]}`;
}

// Synthesize cue descriptions, fallback descriptions, cumulative + individual count words.
async function presynthTeach(plan: TeachPlan, ctx: AudioContext): Promise<Map<string, AudioBuffer>> {
  const texts = new Set<string>();
  // Rich teacher description per count (already built in buildTeachPlan)
  plan.descriptions.forEach(phrase => texts.add(phrase));
  // "trying X to Y" phrases + "again" for isolated replay narration
  texts.add('again');
  for (let i = 1; i <= plan.beats.length; i++) texts.add(tryingPhrase(i));
  // Cumulative count phrases: "one", "one, two", …
  for (let c = 1; c <= plan.beats.length; c++) {
    texts.add(COUNT_SPOKEN.slice(1, c + 1).join(', '));
  }
  // Individual count words for beat narration during isolated replay
  for (let c = 1; c <= plan.beats.length; c++) {
    texts.add(COUNT_SPOKEN[c]);
  }
  // "from start till X" — spoken while paused at beat[0] before each cumulative run
  for (let i = 2; i <= plan.beats.length; i++) texts.add(`from start till ${COUNT_SPOKEN[i]}`);
  const entries = await Promise.allSettled(
    [...texts].map(async t => [t, await synthesizeTTS(t, ctx)] as [string, AudioBuffer | null]),
  );
  const map = new Map<string, AudioBuffer>();
  for (const e of entries) {
    if (e.status === 'fulfilled' && e.value[1]) map.set(e.value[0], e.value[1]);
  }
  return map;
}

// ── Module-level plan cache ────────────────────────────────────────────────────

// ── Teacher-style description per count ───────────────────────────────────────
// Generates varied natural phrases so the narrator sounds like a real instructor.

function buildTeacherDescription(i: number, cue: string | undefined): string {
  const word = COUNT_SPOKEN[i] ?? String(i);
  if (!cue) {
    const fillers = [
      `on ${word}, keep the energy going`,
      `${word} — stay smooth here`,
      `and ${word}, just flow through it`,
      `on ${word}, hold your posture`,
      `${word}, maintain that rhythm`,
      `on ${word}, keep it clean`,
      `and ${word}, breathe through`,
      `${word} — stay sharp`,
    ];
    return fillers[(i - 1) % fillers.length];
  }
  const c = cue.replace(/_/g, ' ');
  const templates = [
    `on ${word}, ${c}`,
    `watch this — on ${word}, ${c}`,
    `${word} is key — ${c}`,
    `right here on ${word}, ${c}`,
    `feel it — on ${word}, ${c}`,
    `on ${word} make sure ${c}`,
    `${word} — and ${c}`,
    `now on ${word}, ${c}`,
  ];
  return templates[(i - 1) % templates.length];
}

const _teachPlanCache = new Map<string, TeachPlan>();
const _teachPlanPending = new Map<string, Promise<TeachPlan>>();

async function buildTeachPlan(
  chunkId: string,
  effectiveCounts: BeatCount[] | undefined,
  poseSlice: any[] | undefined,
  startMs: number,
  endMs: number,
): Promise<TeachPlan> {
  if (_teachPlanCache.has(chunkId)) return _teachPlanCache.get(chunkId)!;
  if (_teachPlanPending.has(chunkId)) return _teachPlanPending.get(chunkId)!;

  const promise = (async (): Promise<TeachPlan> => {
    const beats = ensure8Counts(effectiveCounts, startMs, endMs);
    const { cues, pausePointCounts } = computeJointCues(poseSlice ?? [], beats);
    const { steps, connectors } = generateBuildSteps(beats, pausePointCounts, cues);
    const pausePoints: PausePoint[] = steps.filter(s => s.pausePoint).map(s => s.pausePoint!);
    const descriptions = new Map<number, string>();
    for (let i = 1; i <= beats.length; i++) descriptions.set(i, buildTeacherDescription(i, cues.get(i)));
    const plan: TeachPlan = { beats, cues, descriptions, pausePoints, steps, connectors };
    _teachPlanCache.set(chunkId, plan);
    return plan;
  })();

  _teachPlanPending.set(chunkId, promise);
  promise.finally(() => _teachPlanPending.delete(chunkId));
  return promise;
}

// ── Ensure exactly 8 teaching counts across the chunk ─────────────────────────
// Beat detection may return fewer beats (short chunks, no audio). This always
// produces exactly 8 evenly-spaced positions so all 8 counts are taught.

function ensure8Counts(effectiveCounts: BeatCount[] | undefined, startMs: number, endMs: number): BeatCount[] {
  // If we have 8+ good beats, use the first 8
  if (effectiveCounts && effectiveCounts.length >= 8) return effectiveCounts.slice(0, 8);

  // Otherwise space 8 counts evenly across the chunk.
  // Minimum interval 0.4s so the teach loop has time to speak between pauses.
  const durSec = Math.max(0.4 * 8, (endMs - startMs) / 1000);
  const interval = durSec / 8;
  return Array.from({ length: 8 }, (_, i) => ({
    count: i + 1,
    time: startMs / 1000 + i * interval,
  }));
}

// ── Helpers for TeachContent ──────────────────────────────────────────────────

function seekVideo(v: HTMLVideoElement, time: number): Promise<void> {
  return new Promise<void>(resolve => {
    if (Math.abs(v.currentTime - time) < 0.05) { resolve(); return; }
    v.addEventListener('seeked', resolve as () => void, { once: true });
    setTimeout(resolve, 2000);
    v.currentTime = time;
  });
}


// ── VideoScrubber ──────────────────────────────────────────────────────────────
// YouTube-style progress bar. Shows position within [startMs, endMs].
// Click or drag to seek anywhere in that range.

function VideoScrubber({ videoRef, startMs, endMs }: {
  videoRef: React.RefObject<HTMLVideoElement>;
  startMs: number;
  endMs: number;
}) {
  const [pct, setPct] = useState(0);
  const [hovPct, setHovPct] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    let id: number;
    const tick = () => {
      const dur = (endMs - startMs) / 1000 || v.duration || 1;
      const pos = Math.max(0, v.currentTime - startMs / 1000);
      setPct(Math.min(1, pos / dur));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [videoRef, startMs, endMs]);

  const seekAt = (clientX: number) => {
    const bar = barRef.current; const v = videoRef.current;
    if (!bar || !v) return;
    const rect = bar.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const dur = (endMs - startMs) / 1000 || v.duration || 1;
    v.currentTime = startMs / 1000 + f * dur;
  };

  const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const hoverSec = hovPct !== null ? (startMs / 1000 + hovPct * ((endMs - startMs) / 1000 || 1)) : null;

  return (
    <div
      ref={barRef}
      className="absolute bottom-0 left-0 right-0 h-6 flex items-end z-25 cursor-pointer group select-none"
      onMouseMove={e => {
        const rect = barRef.current!.getBoundingClientRect();
        setHovPct(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
        if (dragging.current) seekAt(e.clientX);
      }}
      onMouseLeave={() => { setHovPct(null); dragging.current = false; }}
      onMouseDown={e => { dragging.current = true; seekAt(e.clientX); }}
      onMouseUp={() => { dragging.current = false; }}
      onClick={e => seekAt(e.clientX)}
      onTouchMove={e => seekAt(e.touches[0].clientX)}
      onTouchStart={e => seekAt(e.touches[0].clientX)}
    >
      {/* hover time tooltip */}
      {hoverSec !== null && (
        <div
          className="absolute bottom-5 text-[10px] text-white/80 bg-black/70 px-1.5 py-0.5 rounded pointer-events-none -translate-x-1/2"
          style={{ left: `${(hovPct ?? 0) * 100}%` }}
        >
          {fmtSec(hoverSec)}
        </div>
      )}
      {/* track */}
      <div className="w-full h-1 group-hover:h-1.5 bg-white/15 relative transition-all duration-100">
        {/* played */}
        <div className="absolute inset-y-0 left-0 bg-violet-500" style={{ width: `${pct * 100}%` }} />
        {/* hover ghost */}
        {hovPct !== null && (
          <div className="absolute inset-y-0 left-0 bg-white/20 pointer-events-none" style={{ width: `${hovPct * 100}%` }} />
        )}
        {/* thumb */}
        <div
          className="absolute top-1/2 w-3 h-3 rounded-full bg-violet-400 shadow opacity-0 group-hover:opacity-100 -translate-y-1/2 -translate-x-1/2 transition-opacity"
          style={{ left: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}

// ── TeachContent (redesigned) ──────────────────────────────────────────────────
// Progressive build: steps grow from [1-2] → [1-4] → [1-6] → [1-8], each looped
// 2-3 times. Video runs continuously at 0.4×. Gemini TTS tokens are scheduled via
// Web Audio against video.currentTime. At most 1-2 brief freeze-frames total.
// Ends with 2 clean full passes, then advances to Practice.

function TeachContent({
  chapter, videoRef, videoSrc, effectiveCounts, poseSlice,
  onEnd, onCountChange, onLabelChange, onCountdownChange, onPausedChange, onTeachStepChange, onDescribePhase, audioCtx, seekRef, controlRef,
}: {
  chapter: Chapter;
  videoRef: React.RefObject<HTMLVideoElement>;
  videoSrc: string;
  effectiveCounts: BeatCount[] | undefined;
  poseSlice?: any[];
  onEnd: () => void;
  onCountChange: (count: number | null) => void;
  onLabelChange: (label: string | null) => void;
  onCountdownChange: (v: string | null) => void;
  onPausedChange: (p: boolean) => void;
  onTeachStepChange?: (step: number) => void;
  onDescribePhase?: (active: boolean) => void;
  audioCtx: AudioContext | null;
  seekRef: { current: ((n: number) => void) | null };
  controlRef: { current: { pause: () => void; resume: () => void; rewind: () => void } | null };
}) {
  const [phase, setPhase] = useState<TeachPhase>('computing');
  const [localPaused, setLocalPaused] = useState(false);
  const planRef = useRef<TeachPlan | null>(null);
  const audioMapRef = useRef(new Map<string, AudioBuffer>());
  const mountedRef = useRef(true);
  const scheduledRef = useRef<AudioBufferSourceNode[]>([]);
  const seekToRef = useRef<number | null>(null);
  const onEndRef = useRef(onEnd);
  const onCCRef = useRef(onCountChange);
  const onLCRef = useRef(onLabelChange);
  const onCDRef = useRef(onCountdownChange);
  const onTSCRef = useRef(onTeachStepChange);
  const onDPRef = useRef(onDescribePhase);
  // Pause / rewind state — shared between the building loop and controlRef
  const pauseState = useRef({ paused: false, videoWasPlaying: false, resolve: null as (() => void) | null });
  const rewindTrig = useRef(false);
  useEffect(() => {
    onEndRef.current = onEnd;
    onCCRef.current = onCountChange;
    onLCRef.current = onLabelChange;
    onCDRef.current = onCountdownChange;
    onTSCRef.current = onTeachStepChange;
    onDPRef.current = onDescribePhase;
  }, [onEnd, onCountChange, onLabelChange, onCountdownChange, onTeachStepChange, onDescribePhase]);

  // Expose seek-to-count to parent (1-based count number)
  useEffect(() => {
    seekRef.current = (n: number) => {
      seekToRef.current = n - 1; // store 0-based index
      rewindTrig.current = true; // abort current step so loop restarts
    };
    return () => { seekRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose pause / resume / rewind controls
  useEffect(() => {
    const v = videoRef.current;
    controlRef.current = {
      pause: () => {
        const ps = pauseState.current;
        if (ps.paused) return;
        ps.paused = true;
        ps.videoWasPlaying = !!(v && !v.paused);
        v?.pause();
        window.speechSynthesis?.pause();
        for (const s of scheduledRef.current) { try { s.stop(); } catch {} }
        scheduledRef.current = [];
        audioCtx?.suspend();
        setLocalPaused(true);
        onPausedChange(true);
      },
      resume: () => {
        const ps = pauseState.current;
        if (!ps.paused) return;
        ps.paused = false;
        const res = ps.resolve; ps.resolve = null;
        res?.();
        if (ps.videoWasPlaying) v?.play().catch(() => {});
        window.speechSynthesis?.resume();
        audioCtx?.resume();
        setLocalPaused(false);
        onPausedChange(false);
      },
      rewind: () => {
        rewindTrig.current = true;
        const ps = pauseState.current;
        if (ps.paused) {
          ps.paused = false;
          ps.resolve?.(); ps.resolve = null;
          onPausedChange(false);
        }
        v?.pause();
      },
    };
    return () => { controlRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Init: build plan + pre-synthesize all narration tokens ─────────────────
  useEffect(() => {
    mountedRef.current = true;
    const v = videoRef.current;
    if (v && videoSrc && !v.src) { v.src = videoSrc; v.load(); }

    buildTeachPlan(chapter.id, effectiveCounts, poseSlice, chapter.startTimeMs, chapter.endTimeMs)
      .then(async plan => {
        if (!mountedRef.current) return;
        planRef.current = plan;
        if (audioCtx) {
          const bufs = await presynthTeach(plan, audioCtx);
          if (mountedRef.current) audioMapRef.current = bufs;
        }
        if (mountedRef.current) setPhase('teaching');
      });

    return () => {
      mountedRef.current = false;
      for (const s of scheduledRef.current) { try { s.stop(); } catch {} }
      onCCRef.current(null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Building phase ─────────────────────────────────────────────────────────
  // Per count i (1→8):
  //   1. TELEPORT to beat[0], play cumulative 1..i at 0.4×, count narration
  //   2. Stop → describe every count (cue or fallback)
  //   3. REPEAT ×2 (skip for i=1):
  //        reverse end-of-i → beats[i-1] (animated), hold 2s + show label,
  //        play beats[i-1]→end-of-i at 0.25× with beat-locked count words
  //   4. TELEPORT back to beat[0] (no animation)
  useEffect(() => {
    if (phase !== 'teaching') return;
    const v = videoRef.current;
    const plan = planRef.current;
    const ctx = audioCtx;
    if (!v || !plan) return;

    const cancel = { cancelled: false };

    const stopScheduled = () => {
      for (const s of scheduledRef.current) { try { s.stop(); } catch {} }
      scheduledRef.current = [];
    };

    // Speak text: tries Gemini AudioBuffer, falls back to Web Speech API.
    const speak = (text: string, wait: boolean): Promise<void> => {
      const buf = audioMapRef.current.get(text);
      if (buf && ctx) {
        return new Promise(resolve => {
          stopScheduled();
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          if (wait) {
            src.onended = () => resolve();
            setTimeout(() => resolve(), (buf.duration + 2) * 1000);
          } else {
            resolve();
          }
          src.start();
          scheduledRef.current.push(src);
        });
      }
      if (!window.speechSynthesis) return Promise.resolve();
      if (!wait) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text); u.rate = 0.88;
        window.speechSynthesis.speak(u);
        return Promise.resolve();
      }
      return new Promise(resolve => {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text); u.rate = 0.88;
        const done = () => resolve();
        u.onend = done; u.onerror = done; setTimeout(done, 7000);
        window.speechSynthesis.speak(u);
      });
    };

    const aborted = () => cancel.cancelled || rewindTrig.current;

    // Pause-aware sleep: suspends when paused, resumes on resume(), exits on rewind/cancel
    const sleepMs = async (ms: number): Promise<void> => {
      const end = Date.now() + ms;
      while (!aborted()) {
        const ps = pauseState.current;
        if (ps.paused) await new Promise<void>(r => { ps.resolve = r; });
        if (aborted()) return;
        const rem = end - Date.now();
        if (rem <= 0) return;
        await new Promise<void>(r => setTimeout(r, Math.min(50, rem)));
      }
    };

    // Step-based rewind: 40 ms per step so each frame is rendered visibly
    const reverseSeekTo = (targetTime: number): Promise<void> => new Promise(resolve => {
      const startT = v.currentTime;
      if (targetTime >= startT - 0.03) { v.currentTime = targetTime; resolve(); return; }
      v.pause();
      const dist = startT - targetTime;
      const steps = Math.max(8, Math.min(22, Math.round(dist * 12)));
      const stepSize = dist / steps;
      let idx = 0;
      const doStep = () => {
        if (aborted()) { resolve(); return; }
        if (idx >= steps) { v.currentTime = targetTime; resolve(); return; }
        idx++;
        v.currentTime = startT - idx * stepSize;
        setTimeout(doStep, 40);
      };
      doStep();
    });

    (async () => {
      if (v.readyState < 2) {
        await new Promise<void>(r => {
          v.addEventListener('canplay', () => r(), { once: true });
          setTimeout(r, 5000);
        });
      }
      if (cancel.cancelled) return;
      v.muted = true;

      const beats = plan.beats;
      const n = beats.length;
      const chunkEnd = chapter.endTimeMs > 0 ? chapter.endTimeMs / 1000 : (v.duration ?? 999);
      const endOf = (c: number) => c + 1 < n ? beats[c + 1].time : chunkEnd;

      let c = 0;
      // Jump to seeked count or rewind by 1
      const goToSeekOrRewind = () => {
        if (seekToRef.current !== null) {
          c = Math.max(0, Math.min(n - 1, seekToRef.current));
          seekToRef.current = null;
        } else {
          c = Math.max(0, c - 1);
        }
      };

      while (c < n && !cancel.cancelled) {
        // Consume a seek request queued while a prior step was running
        if (seekToRef.current !== null) {
          c = Math.max(0, Math.min(n - 1, seekToRef.current));
          seekToRef.current = null;
        }
        rewindTrig.current = false;
        onTSCRef.current?.(c + 1); // report 1-based step to parent for progress bar
        const i = c + 1;
        const countEnd = endOf(c);

        // ── 1. TELEPORT to beat[0], cumulative run ──────────────────────────
        v.pause();
        v.currentTime = beats[0].time;
        // For count 2+, hold at beat[0] and announce "from start till X" before playing
        if (i > 1 && !aborted()) {
          await speak(`from start till ${COUNT_SPOKEN[i]}`, true);
          if (aborted()) { if (rewindTrig.current) { goToSeekOrRewind(); continue; } return; }
        }
        await sleepMs(80);
        if (aborted()) { if (rewindTrig.current) { goToSeekOrRewind(); continue; } return; }
        v.playbackRate = 0.4;
        await v.play().catch(() => {});
        speak(COUNT_SPOKEN.slice(1, i + 1).join(', '), false);

        await new Promise<void>(resolve => {
          const tick = () => {
            if (aborted()) { resolve(); return; }
            const t = v.currentTime;
            let display: number | null = null;
            for (let j = 0; j < i; j++) {
              if (t >= beats[j].time - 0.14 && t < beats[j].time + 0.5) { display = j + 1; break; }
            }
            onCCRef.current(display);
            if (t >= countEnd - 0.04) { resolve(); return; }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        if (aborted()) { v.pause(); if (rewindTrig.current) { goToSeekOrRewind(); continue; } return; }
        v.pause();
        onCCRef.current(i);

        // ── 2. DESCRIBE — show animated stickman split while narrator speaks ──
        onDPRef.current?.(true);
        await speak(plan.descriptions.get(i) ?? COUNT_SPOKEN[i] ?? String(i), true);
        onDPRef.current?.(false);
        if (aborted()) { if (rewindTrig.current) { goToSeekOrRewind(); continue; } return; }
        onCCRef.current(null);
        await sleepMs(200);

        // ── 3. ISOLATED REPLAY ×2 (always — count 1 reverses to its own start) ──
        if (!aborted()) {
          // For count 1: reverse to beats[0] (same start), play once.
          // For count 2+: reverse 2 beats back, play from there.
          const revTarget = beats[Math.max(0, c - 1)].time;
          const prevCount = i - 1; // 0 for count 1 (no prev beat to narrate)
          const label = c === 0 ? `→ ${i}` : `${prevCount} → ${i}`;

          for (let rep = 0; rep < 2 && !aborted(); rep++) {
            await reverseSeekTo(revTarget);
            if (aborted()) break;

            // Announce BEFORE countdown so the phrase finishes before video plays
            speak(rep === 0 ? tryingPhrase(i) : 'again', false);

            // Countdown: 2 · 1 · go
            if (prevCount > 0) onCCRef.current(prevCount);
            onLCRef.current(label);
            onCDRef.current('2'); await sleepMs(1000); if (aborted()) break;
            onCDRef.current('1'); await sleepMs(1000); if (aborted()) break;
            onCDRef.current('go'); await sleepMs(200); if (aborted()) break;
            onCDRef.current(null); onLCRef.current(null); onCCRef.current(null);

            // Forward play: narrator fires at beats[c-1] (if exists) and beats[c]
            v.playbackRate = 0.25;
            await v.play().catch(() => {});
            let saidPrev = false, saidCurr = false;
            await new Promise<void>(resolve => {
              const tick = () => {
                if (aborted()) { resolve(); return; }
                const t = v.currentTime;
                if (!saidPrev && prevCount > 0 && t >= beats[c - 1].time - 0.12) {
                  saidPrev = true; speak(COUNT_SPOKEN[prevCount], false); onCCRef.current(prevCount);
                }
                if (!saidCurr && t >= beats[c].time - 0.12) {
                  saidCurr = true; speak(COUNT_SPOKEN[i], false); onCCRef.current(i);
                }
                if (t >= countEnd - 0.04) { resolve(); return; }
                requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            });
            v.pause(); onCCRef.current(null);
            await sleepMs(300);
          }
          onCDRef.current(null); onLCRef.current(null); onCCRef.current(null);
        }

        if (rewindTrig.current) { goToSeekOrRewind(); continue; }
        if (cancel.cancelled) return;

        // ── 4. TELEPORT to beat[0] ───────────────────────────────────────────
        v.pause(); v.currentTime = beats[0].time;
        await sleepMs(100);
        c++;
      }

      if (!cancel.cancelled) setPhase('clean_pass');
    })();

    return () => {
      cancel.cancelled = true;
      stopScheduled();
      v.pause();
      window.speechSynthesis?.cancel();
      onCCRef.current(null); onLCRef.current(null); onCDRef.current(null);
    };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Clean pass: 2 full runs, count display only, no narration ──────────────
  useEffect(() => {
    if (phase !== 'clean_pass') return;
    const v = videoRef.current;
    const plan = planRef.current;
    if (!v || !plan) return;
    const cancel = { cancelled: false };

    (async () => {
      for (let pass = 0; pass < 2 && !cancel.cancelled; pass++) {
        await seekVideo(v, plan.beats[0].time);
        if (cancel.cancelled) return;
        v.playbackRate = 0.5;
        await v.play().catch(() => {});

        const fired = new Set<number>();
        const chunkEnd = chapter.endTimeMs > 0 ? chapter.endTimeMs / 1000 : (v.duration ?? 999);

        await new Promise<void>(resolve => {
          const tick = () => {
            if (cancel.cancelled) { resolve(); return; }
            const t = v.currentTime;
            for (const beat of plan.beats) {
              if (!fired.has(beat.count) && t >= beat.time - 0.15) {
                fired.add(beat.count);
                onCCRef.current(beat.count);
                setTimeout(() => onCCRef.current(null), 380);
              }
            }
            if (t >= chunkEnd - 0.1) { resolve(); return; }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      }
      if (!cancel.cancelled) setPhase('done');
    })();

    return () => { cancel.cancelled = true; v.pause(); onCCRef.current(null); };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'done') return;
    onCCRef.current(null);
    onEndRef.current();
  }, [phase]);

  const skipBtn = (
    <div className="absolute bottom-4 right-4 z-30 pointer-events-auto">
      <button
        onClick={() => {
          for (const s of scheduledRef.current) { try { s.stop(); } catch {} }
          onEndRef.current();
        }}
        className="text-white/30 text-[11px] hover:text-white/60 transition-colors bg-black/40 px-3 py-1.5 rounded-lg"
      >
        Skip to practice →
      </button>
    </div>
  );

  // Pause / rewind control bar — shown during building + clean_pass
  const controlBar = phase !== 'computing' && phase !== 'done' ? (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 pointer-events-auto">
      <button
        onClick={() => {
          if (pauseState.current.paused) {
            controlRef.current?.resume?.();
          } else {
            controlRef.current?.pause?.();
          }
        }}
        title={pauseState.current.paused ? 'Resume' : 'Pause'}
        className="w-9 h-9 rounded-full bg-black/60 border border-white/20 flex items-center justify-center text-white/75 hover:bg-black/80 hover:text-white transition-all"
      >
        {localPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4" />}
      </button>
      <button
        onClick={() => controlRef.current?.rewind?.()}
        title="Rewind to previous count"
        className="w-9 h-9 rounded-full bg-black/60 border border-white/20 flex items-center justify-center text-white/75 hover:bg-black/80 hover:text-white transition-all"
      >
        <SkipBack className="w-4 h-4" />
      </button>
    </div>
  ) : null;

  if (phase === 'computing') {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
        <div className="bg-black/75 backdrop-blur px-5 py-3 rounded-2xl flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
          <span className="text-white/50 text-sm">Preparing your lesson…</span>
        </div>
        <div className="absolute bottom-4 right-4 pointer-events-auto">
          {skipBtn}
        </div>
      </div>
    );
  }

  return <>{controlBar}{skipBtn}</>;
}

// ── Lead-in beeps (5-6-7-8) ───────────────────────────────────────────────────

function playLeadIn(ctx: AudioContext, beatMs: number, onCount: (n: number | null) => void, onDone: () => void): () => void {
  if (ctx.state === 'suspended') ctx.resume();
  const counts = [5, 6, 7, 8];
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;

  counts.forEach((c, i) => {
    const t = ctx.currentTime + i * (beatMs / 1000);
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = i === 0 ? 880 : 660;
    gain.gain.setValueAtTime(0.3, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(t); osc.stop(t + 0.12);
    timers.push(setTimeout(() => { if (!cancelled) onCount(c); }, i * beatMs));
  });
  timers.push(setTimeout(() => { if (!cancelled) { onCount(null); onDone(); } }, counts.length * beatMs + 60));
  return () => { cancelled = true; timers.forEach(clearTimeout); onCount(null); };
}

// ── CountCaption ───────────────────────────────────────────────────────────────

function CountCaption({ videoRef, rangeCounts, bpm, startTimeMs, speakCounts = false }: {
  videoRef: React.RefObject<HTMLVideoElement>;
  rangeCounts?: BeatCount[];
  bpm: number;
  startTimeMs: number;
  speakCounts?: boolean;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const lastRef = useRef<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    let animId: number;
    const tick = () => {
      const t = v.currentTime;
      let c: number | null = null;
      if (rangeCounts && rangeCounts.length > 0) {
        let found: BeatCount | null = null;
        for (const rc of rangeCounts) { if (rc.time <= t + 0.05) found = rc; else break; }
        c = found?.count ?? null;
      } else if (bpm > 0) {
        const e = t - startTimeMs / 1000;
        if (e >= 0) c = (Math.floor(e / (60 / bpm)) % 8) + 1;
      }
      if (c !== null && c !== lastRef.current) {
        lastRef.current = c; setCount(c); setFlash(true);
        if (speakCounts && window.speechSynthesis) {
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(String(c));
          u.rate = 1.7; u.volume = 1;
          window.speechSynthesis.speak(u);
        }
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(false), 110);
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(animId); if (flashTimer.current) clearTimeout(flashTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, rangeCounts, bpm, startTimeMs]);

  if (count === null) return null;
  return (
    <div className="absolute bottom-20 inset-x-0 flex items-center justify-center pointer-events-none z-10">
      <span className={`font-black tabular-nums leading-none select-none transition-transform duration-75 ${flash ? 'scale-125' : 'scale-100'}`}
        style={{ fontSize: '5rem', color: 'rgba(255,255,255,0.9)', textShadow: '0 0 12px rgba(0,0,0,0.9)', willChange: 'transform' }}>
        {count}
      </span>
    </div>
  );
}

// ── EndOfChapterScreen ─────────────────────────────────────────────────────────

function EndOfChapterScreen({ nextTitle, onRetry, onNext, cameraMode, onCameraModeChange }: {
  nextTitle: string | null;
  onRetry: () => void;
  onNext: () => void;
  cameraMode: CameraMode;
  onCameraModeChange: (m: CameraMode) => void;
}) {
  const [cd, setCd] = useState(5);
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    setCd(5);
  }, []);

  useEffect(() => {
    if (cd <= 0 && !firedRef.current) { firedRef.current = true; onRetry(); return; }
    if (cd <= 0) return;
    const t = setTimeout(() => setCd(c => c - 1), 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cd]);

  const radius = 28; const circ = 2 * Math.PI * radius;
  const dash = circ * (cd / 5);

  return (
    <div className="absolute inset-0 z-50 bg-black/92 backdrop-blur-sm flex items-center justify-center p-8">
      <div className="max-w-xs w-full space-y-5">

        <div className="flex flex-col items-center gap-2">
          <svg width="68" height="68" className="-rotate-90">
            <circle cx="34" cy="34" r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4" />
            <circle cx="34" cy="34" r={radius} fill="none" stroke="rgba(139,92,246,0.75)" strokeWidth="4"
              strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 1s linear' }} />
            <text x="34" y="34" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="17" fontWeight="bold"
              style={{ transform: 'rotate(90deg)', transformOrigin: '34px 34px' }}>{cd}</text>
          </svg>
          <p className="text-white/35 text-xs text-center">No input → replays this chapter automatically</p>
        </div>

        <div className="bg-white/4 border border-white/8 rounded-xl p-3 space-y-2">
          <p className="text-white/25 text-[10px] uppercase tracking-widest">Camera for next chapter</p>
          <div className="flex gap-1.5">
            {([
              { v: 'off' as CameraMode, label: 'Off', icon: <CameraOff className="w-3 h-3" /> },
              { v: 'mirror' as CameraMode, label: 'Mirror', icon: <Camera className="w-3 h-3" /> },
              { v: 'ai' as CameraMode, label: 'AI On', icon: <Cpu className="w-3 h-3" /> },
            ]).map(opt => (
              <button key={opt.v} onClick={() => onCameraModeChange(opt.v)}
                className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] font-semibold border transition-all ${
                  cameraMode === opt.v ? 'bg-violet-500/25 border-violet-500/50 text-violet-200' : 'bg-white/4 border-white/8 text-white/35 hover:border-white/20'
                }`}>
                {opt.icon}{opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <button onClick={onRetry} className="w-full py-3.5 bg-white/10 hover:bg-white/16 text-white font-bold rounded-2xl transition-all">
            🔄 Retry chapter
          </button>
          {nextTitle && (
            <button onClick={onNext} className="w-full py-3.5 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-2xl transition-all shadow-[0_0_18px_rgba(139,92,246,0.35)]">
              Next: {nextTitle} →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ChapterSidebar ─────────────────────────────────────────────────────────────

function ChapterSidebar({ chapters, currentIdx, onSelect, routine }: {
  chapters: Chapter[]; currentIdx: number; onSelect: (i: number) => void; routine: DbRoutine;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [currentIdx]);

  const thumbnail = routine.thumbnail_url || routine.thumbnail || '';
  const fmtMs = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60 > 0 ? `${s % 60}s` : ''}`.trim(); };

  return (
    <div className="h-full min-h-0 flex flex-col bg-[#0a0a0f] border-l border-white/6 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/6 shrink-0">
        <p className="text-white/30 text-[10px] uppercase tracking-widest">Chapters · {chapters.length}</p>
        <p className="text-white/60 text-xs mt-0.5 font-medium truncate">{routine.title}</p>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}>
        {chapters.map((ch, idx) => {
          const isActive = idx === currentIdx;
          const durMs = ch.endTimeMs > ch.startTimeMs ? ch.endTimeMs - ch.startTimeMs : 0;
          return (
            <button key={ch.id} ref={isActive ? activeRef : null} onClick={() => onSelect(idx)}
              className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-all border-b border-white/4 hover:bg-white/4 ${isActive ? 'bg-violet-600/15 border-l-[3px] border-l-violet-500' : 'border-l-[3px] border-l-transparent'}`}>
              <div className="shrink-0 w-[68px] h-10 rounded-md overflow-hidden bg-white/5 relative">
                {thumbnail && <img src={thumbnail} alt="" className="w-full h-full object-cover opacity-55" />}
                <div className={`absolute inset-0 flex items-center justify-center ${isActive ? 'bg-violet-500/30' : ''}`}>
                  {isActive ? <Play className="w-3.5 h-3.5 text-violet-300 fill-current" /> : <span className="text-sm">{ch.emoji}</span>}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[11px] font-semibold leading-tight ${isActive ? 'text-violet-200' : 'text-white/60'}`}>{ch.title}</p>
                <p className="text-[10px] text-white/22 mt-0.5">{idx + 1}{durMs > 0 ? ` · ${fmtMs(durMs)}` : ''}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── TeachProgressBar ──────────────────────────────────────────────────────────
// Full teach-session scrubber: 8 segments (one per count). Click any to jump there.

function TeachProgressBar({ currentStep, totalSteps, onSeek }: {
  currentStep: number; // 1-based, 0 = not started
  totalSteps: number;
  onSeek: (count: number) => void;
}) {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-9 z-25 flex items-center px-3 gap-1 bg-gradient-to-t from-black/60 to-transparent select-none">
      {Array.from({ length: totalSteps }, (_, i) => {
        const count = i + 1;
        const isDone = currentStep > count;
        const isActive = currentStep === count;
        return (
          <div
            key={count}
            onClick={() => onSeek(count)}
            title={`Jump to count ${count}`}
            className="flex-1 group relative h-5 flex items-center cursor-pointer"
          >
            <div className={`w-full rounded-full transition-all duration-150 pointer-events-none ${
              isActive ? 'h-2 bg-violet-400 shadow-[0_0_6px_rgba(139,92,246,0.7)]'
              : isDone  ? 'h-1.5 bg-violet-600/60'
              : 'h-1 bg-white/20 group-hover:h-1.5 group-hover:bg-white/40'
            }`} />
            <span className={`absolute inset-x-0 -top-4 text-center text-[9px] font-semibold pointer-events-none transition-opacity ${
              isActive ? 'text-violet-300 opacity-100' : 'opacity-0 group-hover:opacity-60 text-white/60'
            }`}>{count}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Failure counter (instrumentation only) ────────────────────────────────────

const failureCounts: Record<string, number> = {};
function trackFailure(id: string) {
  failureCounts[id] = (failureCounts[id] ?? 0) + 1;
  if (failureCounts[id] >= 3) console.info('[ChapterPlayer] isolation-candidate:', id, 'failures:', failureCounts[id]);
}

const JOINT_IDX: Record<string, number> = {
  left_shoulder: 11, right_shoulder: 12, left_elbow: 13, right_elbow: 14,
  left_wrist: 15, right_wrist: 16, left_hip: 23, right_hip: 24,
  left_knee: 25, right_knee: 26, left_ankle: 27, right_ankle: 28,
};

// ── WarmupChapter ─────────────────────────────────────────────────────────────

const WARMUP_EXERCISES = [
  { name: 'Neck Rolls', icon: '🔄', desc: 'Slowly roll your head in a full circle, 3 times each way.' },
  { name: 'Shoulder Shrugs', icon: '💪', desc: 'Raise both shoulders to your ears, hold 2 s, then release.' },
  { name: 'Hip Circles', icon: '🌀', desc: 'Hands on hips, draw big slow circles — loosen that core.' },
  { name: 'Wrist Rolls', icon: '✊', desc: 'Roll both wrists forward and backward, loosen the joints.' },
  { name: 'Arm Swings', icon: '🦅', desc: 'Swing both arms front to back, let the momentum build.' },
  { name: 'March in Place', icon: '🚶', desc: 'High knees, alternating — get the blood pumping!' },
];

const WARMUP_TOTAL_SECS = 60;
const WARMUP_PER_EXERCISE = Math.floor(WARMUP_TOTAL_SECS / WARMUP_EXERCISES.length); // 10s each

function WarmupChapter({ onDone }: { onDone: () => void }) {
  const [remaining, setRemaining] = useState(WARMUP_TOTAL_SECS);
  const firedRef = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  const exerciseIdx = Math.min(
    WARMUP_EXERCISES.length - 1,
    Math.floor((WARMUP_TOTAL_SECS - remaining) / WARMUP_PER_EXERCISE),
  );
  const exercise = WARMUP_EXERCISES[exerciseIdx];
  const exerciseRemaining = WARMUP_PER_EXERCISE - ((WARMUP_TOTAL_SECS - remaining) % WARMUP_PER_EXERCISE);

  useEffect(() => {
    if (remaining <= 0) {
      if (!firedRef.current) { firedRef.current = true; onDoneRef.current(); }
      return;
    }
    const t = setTimeout(() => setRemaining(r => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  const radius = 42;
  const circ = 2 * Math.PI * radius;
  const pct = remaining / WARMUP_TOTAL_SECS;

  return (
    <div className="h-full flex items-center justify-center bg-black">
      <div className="max-w-sm w-full text-center space-y-6 px-6">
        {/* Total countdown ring */}
        <div className="flex justify-center">
          <svg width="108" height="108" className="-rotate-90">
            <circle cx="54" cy="54" r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="6" />
            <circle cx="54" cy="54" r={radius} fill="none" stroke="rgba(139,92,246,0.65)" strokeWidth="6"
              strokeDasharray={`${circ * pct} ${circ}`} strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 1s linear' }} />
            <text x="54" y="54" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="22" fontWeight="bold"
              style={{ transform: 'rotate(90deg)', transformOrigin: '54px 54px' }}>{remaining}</text>
          </svg>
        </div>

        {/* Exercise prompt */}
        <div className="space-y-2">
          <div className="text-6xl">{exercise.icon}</div>
          <h2 className="text-2xl font-bold text-white">{exercise.name}</h2>
          <p className="text-white/45 text-sm leading-relaxed">{exercise.desc}</p>
          <p className="text-white/20 text-xs">{exerciseRemaining}s left on this exercise</p>

          {/* Progress dots */}
          <div className="flex justify-center gap-2 pt-2">
            {WARMUP_EXERCISES.map((_, i) => (
              <div key={i} className={`rounded-full transition-all duration-500 ${
                i < exerciseIdx ? 'w-2 h-2 bg-violet-500'
                : i === exerciseIdx ? 'w-3 h-3 bg-violet-400'
                : 'w-2 h-2 bg-white/12'
              }`} />
            ))}
          </div>
        </div>

        <button
          onClick={() => { if (!firedRef.current) { firedRef.current = true; onDoneRef.current(); } }}
          className="w-full py-3.5 bg-white/7 hover:bg-white/13 text-white/50 text-sm font-medium rounded-2xl transition-all border border-white/8"
        >
          Skip warmup →
        </button>
      </div>
    </div>
  );
}

// ── TeachPoseAnimator ─────────────────────────────────────────────────────────
// Animates pose frames between two beat timestamps, highlighting the cue joint.

function TeachPoseAnimator({ poseSlice, fromTime, toTime, cueJointIdx }: {
  poseSlice: any[];
  fromTime: number;
  toTime: number;
  cueJointIdx?: number;
}) {
  const [frameIdx, setFrameIdx] = useState(0);

  const frames = (() => {
    const result: any[] = [];
    for (let i = 0; i < poseSlice.length; i++) {
      const t: number = poseSlice[i]?.t ?? poseSlice[i]?.time ?? (i / 30);
      if (t >= fromTime - 0.05 && t <= toTime + 0.05) result.push(poseSlice[i]);
    }
    // Fallback: pick 2 boundary frames if range returned nothing
    if (result.length < 2) {
      let best0 = 0, best1 = poseSlice.length - 1, d0 = Infinity, d1 = Infinity;
      for (let i = 0; i < poseSlice.length; i++) {
        const t: number = poseSlice[i]?.t ?? poseSlice[i]?.time ?? (i / 30);
        if (Math.abs(t - fromTime) < d0) { d0 = Math.abs(t - fromTime); best0 = i; }
        if (Math.abs(t - toTime) < d1) { d1 = Math.abs(t - toTime); best1 = i; }
      }
      return [poseSlice[best0], poseSlice[best1]].filter(Boolean);
    }
    return result;
  })();

  useEffect(() => {
    if (frames.length < 2) return;
    const id = setInterval(() => setFrameIdx(i => (i + 1) % frames.length), 220);
    return () => clearInterval(id);
  }, [frames.length]);

  const frame = frames[Math.min(frameIdx, frames.length - 1)];
  const landmarks = frame?.landmarks ?? (Array.isArray(frame) ? frame : null);
  if (!landmarks) return null;

  return (
    <StickmanCanvas
      landmarks={landmarks}
      mode="full_body"
      smooth={false}
      width={300}
      height={480}
      color="rgba(255,255,255,0.85)"
      highlightJoints={cueJointIdx !== undefined ? [cueJointIdx] : undefined}
    />
  );
}

// ── ChapterPlayer ─────────────────────────────────────────────────────────────

export default function ChapterPlayer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const session = useAuthStore(s => s.session);

  const [routine, setRoutine] = useState<DbRoutine | null>(null);
  const [loading, setLoading] = useState(true);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [hasBeatGrid, setHasBeatGrid] = useState(false);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [showEoC, setShowEoC] = useState(false);
  const [isLeadIn, setIsLeadIn] = useState(false);
  const [leadInCount, setLeadInCount] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [watchCountdown, setWatchCountdown] = useState<number | null>(null);

  const [cameraMode, setCameraMode] = useState<CameraMode>('mirror');
  const [hasWebcam, setHasWebcam] = useState(false);
  const [teachCount, setTeachCount] = useState<number | null>(null);
  const [teachLabel, setTeachLabel] = useState<string | null>(null);
  const [teachCountdown, setTeachCountdown] = useState<string | null>(null);
  const [teachPaused, setTeachPaused] = useState(false);
  const [teachStep, setTeachStep] = useState(0);
  const [teachDescribeActive, setTeachDescribeActive] = useState(false);
  const teachSeekRef = useRef<((n: number) => void) | null>(null);
  const teachControlRef = useRef<{ pause: () => void; resume: () => void; rewind: () => void } | null>(null);

  const [finalScore, setFinalScore] = useState<FinalScore | null>(null);
  const [worstJoint, setWorstJoint] = useState<JointScore | null>(null);
  const mistakeFrames = useRef<{ dataUrl: string; refMs: number }[]>([]);

  // Refs
  const refVideoRef = useRef<HTMLVideoElement>(null);
  const webcamRef = useRef<HTMLVideoElement>(null);       // ALWAYS in DOM
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const leadInCancelRef = useRef<(() => void) | null>(null);
  const videoCleanupRef = useRef<(() => void) | null>(null);
  const loadedSrcRef = useRef('');
  const isMountedRef = useRef(true);

  const { isWorkerReady, userPose, jointScores, currentArmScore, loadReference, processFrame, finishAttempt } = usePoseDetection();

  const chapter = chapters[currentIdx] ?? null;
  const nextChapter = chapters[currentIdx + 1] ?? null;
  const beatGrid = routine?.beat_grid_json ?? null;
  const bpm = beatGrid?.bpm ?? 120;

  const videoSrc = useMemo(() => getOriginalVideoUrl() || routine?.video_blob_url || '', [routine]);

  // rangeCounts filtered to this chapter's time window
  const rangeCounts = useMemo(() => {
    if (!beatGrid || !chapter) return undefined;
    if (!chapter.startTimeMs && !chapter.endTimeMs) return undefined;
    const s = chapter.startTimeMs / 1000 - 0.05;
    const e = chapter.endTimeMs / 1000 + 0.05;
    return beatGrid.counts.filter(c => c.time >= s && c.time <= e);
  }, [beatGrid, chapter]);

  // Effective end time: use chapter.endTimeMs when set, fall back to video duration
  const effectiveEndMs = useCallback((ch: Chapter): number => {
    if (ch.endTimeMs > 0) return ch.endTimeMs;
    const v = refVideoRef.current;
    return v && v.duration > 0 ? v.duration * 1000 : 0;
  }, []);

  // Motion-derived beat fallback when no beat_grid_json (extracted from pose_slice_json)
  const motionBeats = useMemo((): BeatCount[] | undefined => {
    if (beatGrid) return undefined;
    if (!chapter || chapter.type === 'warmup' || chapter.type === 'watch') return undefined;
    const chunkIdx = chapter.chunkIndices[0];
    if (chunkIdx === undefined) return undefined;
    const chunk = routine?.chunks.find(c => c.chunk_index === chunkIdx);
    if (!chunk?.pose_slice_json) return undefined;
    try {
      const frames = typeof chunk.pose_slice_json === 'string'
        ? JSON.parse(chunk.pose_slice_json) as any[]
        : chunk.pose_slice_json as any[];
      const beats = extractMotionBeats(frames, chunk.start_time_ms, chunk.end_time_ms);
      return beats.length > 0 ? beats : undefined;
    } catch { return undefined; }
  }, [beatGrid, chapter, routine]);

  // Best available beat data: audio beats → motion beats → undefined (synthetic used in TeachContent)
  const effectiveRangeCounts = rangeCounts ?? motionBeats;

  // Split screen: only for chapters with showSplit = true AND camera is on AND stream acquired
  const showSplit = !!(chapter?.showSplit && cameraMode !== 'off' && hasWebcam);

  // ── Load routine ──────────────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    async function load() {
      if (!id) { setLoading(false); return; }
      let data: DbRoutine | null = null;
      if (session?.user?.id) {
        const res = await supabase.rpc('rpc_get_routine_detail', { p_routine_id: id, p_user_id: session.user.id });
        if (res.data) data = res.data;
      }
      if (!data) {
        try { const raw = localStorage.getItem(`taal-local-routine-${id}`); if (raw) data = JSON.parse(raw); } catch {}
      }
      if (!isMountedRef.current) return;
      if (data) {
        setRoutine(data);
        setHasBeatGrid(!!(data.beat_grid_json?.bpm));
        const sorted = [...(data.chunks ?? [])].sort((a, b) => a.chunk_index - b.chunk_index);
        setChapters(generateChapters(sorted, (data.duration_seconds ?? 0) * 1000));
      }
      setLoading(false);
    }
    load();
    return () => { isMountedRef.current = false; };
  }, [id, session]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load reference poses when chapter changes
  useEffect(() => {
    if (!chapter || !routine) return;
    const idx = chapter.chunkIndices[0];
    if (idx === undefined) return;
    const ch = routine.chunks.find(c => c.chunk_index === idx);
    if (!ch?.pose_slice_json) return;
    try {
      const poses = typeof ch.pose_slice_json === 'string' ? JSON.parse(ch.pose_slice_json) : ch.pose_slice_json;
      if (Array.isArray(poses) && poses.length > 0) loadReference(poses);
    } catch {}
  }, [currentIdx, routine, chapter, loadReference]);

  // ── Camera setup ─────────────────────────────────────────────────────────
  // setupCamera wires the stream to webcamRef which is ALWAYS in the DOM.
  const setupCamera = useCallback(async () => {
    if (cameraMode === 'off') {
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
      const v = webcamRef.current;
      if (v) { v.srcObject = null; }
      setHasWebcam(false);
      return;
    }
    try {
      if (!cameraStreamRef.current) {
        cameraStreamRef.current = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' }, audio: false,
        });
      }
      const v = webcamRef.current;
      if (v) {
        v.srcObject = cameraStreamRef.current;
        await v.play();
        setHasWebcam(true);
      }
    } catch { setHasWebcam(false); }
  }, [cameraMode]);

  useEffect(() => { setupCamera(); }, [setupCamera]);

  // ── AudioContext ──────────────────────────────────────────────────────────
  const getCtx = useCallback((): AudioContext | null => {
    if (!audioCtxRef.current) try { audioCtxRef.current = new AudioContext(); } catch { return null; }
    return audioCtxRef.current;
  }, []);

  // ── Chapter end handler ───────────────────────────────────────────────────
  const handleChapterEnd = useCallback(() => {
    const v = refVideoRef.current;
    if (v) v.pause();
    setIsPlaying(false);
    setIsLeadIn(false);

    if (cameraMode === 'ai' && isWorkerReady) {
      finishAttempt().then(score => {
        if (!isMountedRef.current) return;
        setFinalScore(score);
        const worst = [...jointScores].filter(j => j.type === 'arm').sort((a, b) => a.score - b.score)[0] ?? null;
        setWorstJoint(worst);
        if (score.armScore < 50 && chapter) trackFailure(chapter.id);
      });
    }
    setShowEoC(true);
  }, [cameraMode, isWorkerReady, finishAttempt, jointScores, chapter]);

  // ── Start a chapter ───────────────────────────────────────────────────────
  const startChapter = useCallback((ch: Chapter) => {
    if (!ch) return;

    setShowEoC(false);
    setIsPlaying(false);
    setIsLeadIn(false);
    setLeadInCount(null);
    setFinalScore(null);
    setWorstJoint(null);
    mistakeFrames.current = [];

    leadInCancelRef.current?.(); leadInCancelRef.current = null;
    videoCleanupRef.current?.(); videoCleanupRef.current = null;
    window.speechSynthesis?.cancel();

    if (ch.type === 'warmup') return;

    const v = refVideoRef.current;
    if (!v) return;

    // Teach is driven by TeachContent — just ensure video source is loaded and pause any prior playback
    if (ch.type === 'teach') {
      v.pause();
      if (loadedSrcRef.current !== videoSrc && videoSrc) {
        loadedSrcRef.current = videoSrc;
        v.src = videoSrc;
        v.load();
      }
      return;
    }

    // Fix: use video.ended + timeupdate for reliable EoC detection
    const onEnded = () => handleChapterEnd();

    const onTimeUpdate = () => {
      const endMs = ch.endTimeMs > 0 ? ch.endTimeMs : (v.duration > 0 ? v.duration * 1000 : 0);
      if (!endMs) return;
      if (v.currentTime * 1000 >= endMs - 80) handleChapterEnd();
    };

    v.addEventListener('ended', onEnded);
    v.addEventListener('timeupdate', onTimeUpdate);
    videoCleanupRef.current = () => {
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('timeupdate', onTimeUpdate);
    };

    const doPlay = () => {
      v.muted = ch.muted;
      v.playbackRate = ch.playbackRate;

      const needsLeadIn = ch.showSplit; // beat-based chapters always get lead-in
      if (needsLeadIn) {
        const ctx = getCtx();
        if (ctx) {
          setIsLeadIn(true);
          const beatMs = (60 / (bpm * ch.playbackRate)) * 1000;
          leadInCancelRef.current = playLeadIn(ctx, beatMs, setLeadInCount, () => {
            setIsLeadIn(false);
            setLeadInCount(null);
            v.play().catch(() => {}).then(() => { if (refVideoRef.current) refVideoRef.current.playbackRate = ch.playbackRate; });
            setIsPlaying(true);
          });
          return;
        }
      }
      v.play().catch(() => {}).then(() => { if (refVideoRef.current) refVideoRef.current.playbackRate = ch.playbackRate; });
      setIsPlaying(true);
    };

    const seekAndPlay = () => {
      const target = ch.startTimeMs / 1000;
      if (Math.abs(v.currentTime - target) < 0.05) { doPlay(); return; }
      v.addEventListener('seeked', doPlay, { once: true });
      v.currentTime = target;
    };

    if (loadedSrcRef.current !== videoSrc && videoSrc) {
      loadedSrcRef.current = videoSrc;
      v.src = videoSrc;
      v.load();
      v.addEventListener('loadedmetadata', seekAndPlay, { once: true });
    } else if (videoSrc) {
      seekAndPlay();
    }
  }, [videoSrc, bpm, getCtx, handleChapterEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start chapter when index changes
  useEffect(() => {
    if (chapters.length && chapter) startChapter(chapter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, chapters]);

  // For Watch chapter: also load video source (startChapter skips it for watch/teach but watch needs video)
  useEffect(() => {
    if (!chapter || chapter.type !== 'watch') return;
    const v = refVideoRef.current;
    if (!v || !videoSrc) return;

    setShowEoC(false);
    setIsPlaying(false);
    videoCleanupRef.current?.(); videoCleanupRef.current = null;

    const onEnded = () => handleChapterEnd();
    const onTimeUpdate = () => {
      const endMs = chapter.endTimeMs > 0 ? chapter.endTimeMs : (v.duration > 0 ? v.duration * 1000 : 0);
      if (!endMs) return;
      if (v.currentTime * 1000 >= endMs - 80) handleChapterEnd();
    };
    v.addEventListener('ended', onEnded);
    v.addEventListener('timeupdate', onTimeUpdate);
    videoCleanupRef.current = () => { v.removeEventListener('ended', onEnded); v.removeEventListener('timeupdate', onTimeUpdate); };

    v.muted = false;
    v.playbackRate = 1;

    let cdCancelled = false;
    const doPlay = () => {
      if (cdCancelled) return;
      v.currentTime = 0;
      v.play().then(() => { if (v) { v.playbackRate = 1; setIsPlaying(true); } }).catch(() => {});
    };
    const runCountdown = () => {
      setWatchCountdown(3);
      const t1 = setTimeout(() => { if (!cdCancelled) setWatchCountdown(2); }, 1000);
      const t2 = setTimeout(() => { if (!cdCancelled) setWatchCountdown(1); }, 2000);
      const t3 = setTimeout(() => { if (!cdCancelled) { setWatchCountdown(null); doPlay(); } }, 3000);
      const prevCleanup = videoCleanupRef.current;
      videoCleanupRef.current = () => {
        cdCancelled = true; setWatchCountdown(null);
        clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
        prevCleanup?.();
      };
    };

    if (loadedSrcRef.current !== videoSrc) {
      loadedSrcRef.current = videoSrc;
      v.src = videoSrc; v.load();
      v.addEventListener('loadedmetadata', runCountdown, { once: true });
    } else {
      runCountdown();
    }
  }, [currentIdx, chapters, videoSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pose processing loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying || cameraMode !== 'ai' || !isWorkerReady || !hasWebcam) return;
    let animId: number;
    const loop = () => {
      const w = webcamRef.current; const rv = refVideoRef.current;
      if (w && rv && w.readyState >= 2 && !rv.paused) {
        processFrame(w, rv.currentTime * 1000, 'all');
        if (currentArmScore < 50 && mistakeFrames.current.length < 5) {
          try {
            const c = document.createElement('canvas');
            c.width = w.videoWidth || 320; c.height = w.videoHeight || 240;
            c.getContext('2d')?.drawImage(w, 0, 0);
            mistakeFrames.current.push({ dataUrl: c.toDataURL('image/jpeg', 0.65), refMs: rv.currentTime * 1000 });
          } catch {}
        }
      }
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, cameraMode, isWorkerReady, hasWebcam, processFrame, currentArmScore]);

  // ── Space bar → pause/resume teach ───────────────────────────────────────
  useEffect(() => {
    if (!chapter || chapter.type !== 'teach') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      e.preventDefault();
      if (teachPaused) teachControlRef.current?.resume();
      else teachControlRef.current?.pause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chapter, teachPaused]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      videoCleanupRef.current?.();
      leadInCancelRef.current?.();
      window.speechSynthesis?.cancel();
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const handleRetry = useCallback(() => {
    window.speechSynthesis?.cancel();
    if (chapter) startChapter(chapter);
  }, [chapter, startChapter]);

  const handleNext = useCallback(() => {
    window.speechSynthesis?.cancel();
    if (currentIdx < chapters.length - 1) setCurrentIdx(i => i + 1);
    else navigate(`/routine/${id}`);
  }, [currentIdx, chapters.length, navigate, id]);

  // ── Loading / error states ────────────────────────────────────────────────
  if (loading) return (
    <div className="h-screen bg-black flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!routine || !chapters.length) return (
    <div className="h-screen bg-black flex items-center justify-center">
      <div className="text-center space-y-3">
        <p className="text-white/40">Routine not found</p>
        <button onClick={() => navigate(-1)} className="text-violet-400 text-sm underline">Go back</button>
      </div>
    </div>
  );

  // Pose slice for teach narration (cue computation) — IIFE, not a hook
  const teachPoseSlice = (() => {
    if (!chapter || chapter.type !== 'teach') return undefined;
    const idx = chapter.chunkIndices[0];
    if (idx === undefined) return undefined;
    const chunk = routine?.chunks.find(c => c.chunk_index === idx);
    if (!chunk?.pose_slice_json) return undefined;
    try {
      return typeof chunk.pose_slice_json === 'string'
        ? JSON.parse(chunk.pose_slice_json)
        : chunk.pose_slice_json;
    } catch { return undefined; }
  })();

  // ── Teach stickman derived values — plain IIFEs, no hooks ─────────────────
  const teachBeats = chapter?.type === 'teach'
    ? ensure8Counts(effectiveRangeCounts, chapter.startTimeMs, chapter.endTimeMs)
    : [];

  const teachCues = (() => {
    if (!teachPoseSlice?.length || !teachBeats.length) return new Map<number, string>();
    const { cues } = computeJointCues(teachPoseSlice, teachBeats);
    return cues;
  })();

  // Frames for animated stickman during describe phase (i-1 → i transition)
  const teachAnimFromTime = teachCount !== null && teachCount > 1
    ? (teachBeats[teachCount - 2]?.time ?? teachBeats[0]?.time ?? 0)
    : (teachBeats[0]?.time ?? 0);
  const teachAnimToTime = teachCount !== null
    ? (teachBeats[teachCount - 1]?.time ?? teachBeats[teachBeats.length - 1]?.time ?? 1)
    : 1;

  const teachCueJointName = teachCount !== null ? (teachCues.get(teachCount) ?? null) : null;
  const teachCueJointIdx = teachCueJointName !== null ? JOINT_IDX[teachCueJointName] : undefined;
  const showTeachSplit = teachDescribeActive && !showEoC && !!teachPoseSlice?.length;

  return (
    <div className="h-screen bg-black flex flex-col overflow-hidden">

      {/* ── Top bar ── */}
      <header className="shrink-0 h-11 flex items-center gap-3 px-3 bg-[#09090e] border-b border-white/6 z-30">
        <button onClick={() => navigate(`/routine/${id}`)} className="shrink-0 w-7 h-7 flex items-center justify-center text-white/40 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <p className="flex-1 min-w-0 text-white/55 text-xs font-medium truncate">{chapter?.emoji} {chapter?.title}</p>
        <span className="shrink-0 text-white/20 text-xs">{currentIdx + 1}/{chapters.length}</span>
        {!hasBeatGrid && <span className="shrink-0 text-amber-400/60 text-[10px] border border-amber-400/20 px-2 py-0.5 rounded-md">Count-only</span>}

        {/* Camera mode cycle: Off → Mirror → AI → Off */}
        <button
          onClick={() => setCameraMode(m => m === 'off' ? 'mirror' : m === 'mirror' ? 'ai' : 'off')}
          title={cameraMode === 'off' ? 'Camera off' : cameraMode === 'mirror' ? 'Mirror — AI off' : 'AI scoring on'}
          className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
            cameraMode === 'ai' ? 'bg-violet-500/25 border-violet-500/45 text-violet-200'
            : cameraMode === 'mirror' ? 'bg-white/7 border-white/12 text-white/50'
            : 'bg-white/3 border-white/7 text-white/25'
          }`}
        >
          {cameraMode === 'off' ? <CameraOff className="w-3 h-3" /> : <Camera className="w-3 h-3" />}
          {cameraMode === 'ai' && <Cpu className="w-3 h-3" />}
          <span>{cameraMode === 'off' ? 'Off' : cameraMode === 'mirror' ? 'Mirror' : 'AI'}</span>
        </button>
      </header>

      {/* ── 70 / 30 body ── */}
      <div className="flex-1 flex min-h-0">

        {/* ── 70% main content ── */}
        <div className="flex-[7] min-w-0 relative overflow-hidden">

          {/* Warmup — timed guided warmup */}
          {chapter?.type === 'warmup' && <WarmupChapter onDone={handleNext} />}

          {/* All video chapters */}
          {chapter?.type !== 'warmup' && (
            <div className="h-full flex bg-black">

              {/* Reference video — full width OR left half (when split) */}
              <div className={`relative bg-black overflow-hidden flex-1 ${showSplit || showTeachSplit ? 'border-r border-white/5' : ''}`}>
                <video
                  ref={refVideoRef}
                  className="absolute inset-0 w-full h-full object-contain"
                  playsInline
                />

                {/* Watch chapter 3-2-1 countdown overlay */}
                {chapter?.type === 'watch' && watchCountdown !== null && (
                  <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 pointer-events-none">
                    <p className="text-white/35 text-xs uppercase tracking-widest mb-4">Starting in</p>
                    <span className="font-black tabular-nums leading-none animate-in zoom-in duration-150"
                      style={{ fontSize: '10rem', color: 'white', textShadow: '0 0 32px rgba(139,92,246,0.6)' }}>
                      {watchCountdown}
                    </span>
                  </div>
                )}

                {/* Lead-in overlay */}
                {isLeadIn && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/65 pointer-events-none">
                    <p className="text-white/35 text-xs uppercase tracking-widest mb-6">Get ready</p>
                    <span className="font-black tabular-nums leading-none animate-in zoom-in duration-100"
                      style={{ fontSize: '8rem', color: 'white', textShadow: '0 0 24px rgba(255,255,255,0.35)' }}>
                      {leadInCount ?? '…'}
                    </span>
                  </div>
                )}

                {/* Teach overlay: beat-synced narration (count display is in sidebar) */}
                {chapter?.type === 'teach' && !showEoC && (
                  <TeachContent
                    key={chapter.id}
                    chapter={chapter}
                    videoRef={refVideoRef}
                    videoSrc={videoSrc}
                    effectiveCounts={effectiveRangeCounts}
                    poseSlice={teachPoseSlice}
                    onEnd={handleChapterEnd}
                    onCountChange={setTeachCount}
                    onLabelChange={setTeachLabel}
                    onCountdownChange={setTeachCountdown}
                    onPausedChange={setTeachPaused}
                    onDescribePhase={setTeachDescribeActive}
                    onTeachStepChange={setTeachStep}
                    audioCtx={audioCtxRef.current}
                    seekRef={teachSeekRef}
                    controlRef={teachControlRef}
                  />
                )}

                {/* Teach progress bar — full session scrubber (click any count to jump) */}
                {chapter?.type === 'teach' && !showEoC && (
                  <TeachProgressBar
                    currentStep={teachStep}
                    totalSteps={8}
                    onSeek={count => teachSeekRef.current?.(count)}
                  />
                )}

                {/* Beat count caption — muted beat chapters (not teach, not watch) */}
                {isPlaying && chapter?.muted && chapter?.type !== 'teach' && chapter?.type !== 'watch' && (
                  <CountCaption videoRef={refVideoRef} rangeCounts={effectiveRangeCounts} bpm={bpm} startTimeMs={chapter.startTimeMs} speakCounts />
                )}

                {/* Teach overlay — count, transition label, countdown */}
                {chapter?.type === 'teach' && (teachCount !== null || teachLabel !== null || teachCountdown !== null) && (
                  <div className="absolute top-3 right-3 z-20 pointer-events-none select-none flex flex-col items-end gap-1">
                    {teachCount !== null && (
                      <span className="font-black tabular-nums leading-none"
                        style={{ fontSize: '3.5rem', color: 'rgba(255,255,255,0.9)', textShadow: '0 2px 12px rgba(0,0,0,0.8)' }}>
                        {teachCount}
                      </span>
                    )}
                    {teachLabel !== null && (
                      <span className="font-bold tracking-wide"
                        style={{ fontSize: '1.05rem', color: 'rgba(139,92,246,0.9)', textShadow: '0 1px 8px rgba(0,0,0,0.9)' }}>
                        {teachLabel}
                      </span>
                    )}
                    {teachCountdown !== null && (
                      <span className="font-black tabular-nums leading-none"
                        style={{
                          fontSize: teachCountdown === 'go' ? '1.4rem' : '2.8rem',
                          color: teachCountdown === 'go' ? 'rgba(74,222,128,0.95)' : 'rgba(251,191,36,0.95)',
                          textShadow: '0 2px 10px rgba(0,0,0,0.9)',
                        }}>
                        {teachCountdown}
                      </span>
                    )}
                  </div>
                )}

                {/* Chapter badge top-left */}
                {chapter && (
                  <div className="absolute top-3 left-3 z-10 bg-black/50 text-white/40 text-[10px] px-2 py-1 rounded-md pointer-events-none">
                    {chapter.type === 'teach' ? '📖 TEACH' : `${chapter.emoji} ${chapter.playbackRate < 1 ? (chapter.playbackRate === 0.5 ? '½×' : '¾×') : '1×'}`}
                  </div>
                )}

                {/* Correction badge (AI, shown between beats) */}
                {cameraMode === 'ai' && worstJoint && isPlaying && !showEoC && (
                  <div className="absolute top-16 left-3 z-10 max-w-[55%] pointer-events-none">
                    <div className="bg-amber-500/10 border border-amber-400/22 backdrop-blur-md px-3 py-2 rounded-xl">
                      <p className="text-amber-400/55 text-[9px] uppercase tracking-widest mb-0.5">Fix this</p>
                      <p className="text-white/85 text-[11px] font-semibold">{worstJoint.name.replace(/_/g, ' ')} — {Math.round(worstJoint.score)}%</p>
                    </div>
                  </div>
                )}

                {showSplit && <div className="absolute top-2 right-2 z-10 bg-black/35 text-white/18 text-[10px] px-2 py-0.5 rounded-md pointer-events-none">Reference</div>}
              </div>

              {/* Animated stickman panel — visible during describe phase only */}
              {showTeachSplit && teachPoseSlice && (
                <div className="flex-1 relative bg-[#07070d] overflow-hidden flex flex-col items-center justify-center">
                  <TeachPoseAnimator
                    poseSlice={teachPoseSlice}
                    fromTime={teachAnimFromTime}
                    toTime={teachAnimToTime}
                    cueJointIdx={teachCueJointIdx}
                  />
                  {teachCueJointName && (
                    <div className="absolute bottom-12 inset-x-0 flex flex-col items-center gap-1 pointer-events-none select-none">
                      <span className="text-[10px] text-green-400/75 font-semibold tracking-widest uppercase">{teachCueJointName.replace(/_/g, ' ')}</span>
                      <span className="text-[9px] text-white/20">watch this joint</span>
                    </div>
                  )}
                  <div className="absolute top-2 left-2 text-[9px] text-white/18 pointer-events-none uppercase tracking-widest">
                    {teachCount !== null && teachCount > 1 ? `${teachCount - 1} → ${teachCount}` : `count ${teachCount ?? ''}`}
                  </div>
                </div>
              )}

              {/* Webcam panel — visible when showSplit, always in DOM for ref */}
              <div className={`relative bg-black overflow-hidden ${showSplit ? 'flex-1' : 'hidden'}`}>
                <video ref={webcamRef} className="absolute inset-0 w-full h-full object-cover scale-x-[-1]" playsInline muted />

                <div className="absolute top-2 left-2 z-10 bg-black/35 text-white/18 text-[10px] px-2 py-0.5 rounded-md pointer-events-none">You</div>

                {cameraMode === 'ai' && userPose && (
                  <div className="absolute inset-0 pointer-events-none">
                    <StickmanCanvas landmarks={userPose} mode="upper_body" smooth width={640} height={480}
                      jointScores={jointScores.length > 0 ? Object.fromEntries(jointScores.map(j => [JOINT_IDX[j.name] ?? j.name, j.score])) as any : undefined} />
                  </div>
                )}

                {cameraMode === 'mirror' && (
                  <div className="absolute bottom-3 inset-x-0 flex justify-center pointer-events-none">
                    <span className="text-white/15 text-[10px] bg-black/30 px-3 py-1 rounded-full">Mirror · AI off</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── End-of-chapter screen ── */}
          {showEoC && (
            <EndOfChapterScreen
              nextTitle={nextChapter?.title ?? null}
              onRetry={handleRetry}
              onNext={handleNext}
              cameraMode={cameraMode}
              onCameraModeChange={setCameraMode}
            />
          )}

          {/* Mistake frame strip shown during EoC */}
          {showEoC && cameraMode === 'ai' && mistakeFrames.current.length > 0 && (
            <div className="absolute bottom-36 left-4 right-4 z-[60] flex gap-2 overflow-x-auto pb-1">
              <p className="shrink-0 text-white/22 text-[10px] self-center pr-1">Snapshots:</p>
              {mistakeFrames.current.slice(0, 4).map((f, i) => (
                <div key={i} className="shrink-0 rounded-lg overflow-hidden border border-amber-400/25">
                  <img src={f.dataUrl} alt="mistake" className="w-20 h-14 object-cover opacity-75" />
                  <p className="text-[9px] text-amber-300/50 text-center py-0.5">{Math.round(f.refMs / 1000)}s</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 30% sidebar ── */}
        <div className="flex-[3] min-w-[220px] max-w-[320px]">
          <ChapterSidebar chapters={chapters} currentIdx={currentIdx} onSelect={idx => setCurrentIdx(idx)} routine={routine} />
        </div>
      </div>
    </div>
  );
}