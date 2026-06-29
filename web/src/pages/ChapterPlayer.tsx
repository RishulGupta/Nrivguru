import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, CameraOff, Cpu, Play, Pause, SkipBack, Loader2, Menu, X } from 'lucide-react';
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

// ── Motion beat extraction (improved) ─────────────────────────────────────────

function extractMotionBeats(frames: any[], startTimeMs: number, endTimeMs: number): BeatCount[] {
  if (!Array.isArray(frames) || frames.length < 2) return [];
  const durationSec = (endTimeMs - startTimeMs) / 1000;
  if (durationSec <= 0) return [];
  const fps = frames.length / durationSec;

  const getLM = (frame: any, idx: number): { x: number; y: number; z: number; vis: number } | null => {
    if (!frame) return null;
    const lms: any[] = Array.isArray(frame)
      ? frame
      : (frame.landmarks ?? frame.pose_landmarks ?? frame.world_landmarks ?? null);
    if (!Array.isArray(lms) || !lms[idx]) return null;
    const lm = lms[idx];
    if (Array.isArray(lm)) return { x: lm[0] ?? 0, y: lm[1] ?? 0, z: lm[2] ?? 0, vis: (lm[3] ?? 1) };
    return { x: lm.x ?? 0, y: lm.y ?? 0, z: lm.z ?? 0, vis: lm.visibility ?? lm.score ?? 1 };
  };

  // Comprehensive joint weighting — matched to real dancer beat calling
  // Hips & shoulders drive the core beat, wrists add rhythm detail, knees & ankles add ground impact
  const JOINTS: [number, number][] = [
    [23, 3.0], [24, 3.0],       // hips — core weight shift
    [11, 2.0], [12, 2.0],       // shoulders — upper body accents
    [13, 1.5], [14, 1.5],       // elbows — arm extension
    [15, 2.0], [16, 2.0],       // wrists — fast accent, sharp gestures
    [25, 1.0], [26, 1.0],       // knees — leg lift / step
    [27, 1.0], [28, 1.0],       // ankles — footwork
  ];

  // Build velocity, acceleration and "foot-strike" (sharp deceleration) curves
  const n = frames.length;
  const velocity = new Float32Array(n);
  const acceleration = new Float32Array(n);
  const footStrike = new Float32Array(n);
  const armSnap = new Float32Array(n);

  for (let i = 1; i < n; i++) {
    let vel = 0, foot = 0, arm = 0;
    for (const [idx, w] of JOINTS) {
      const prev = getLM(frames[i - 1], idx);
      const curr = getLM(frames[i], idx);
      if (!prev || !curr || curr.vis < 0.25) continue;
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const speed = Math.sqrt(dx * dx + dy * dy);
      vel += w * curr.vis * speed;
      // Foot-strike: sharp downward deceleration on ankles (27,28) = large impact
      if (idx === 27 || idx === 28) {
        const dz = (curr.y - prev.y); // positive = moving down (y increases downward in normalized coords)
        if (dz > 0 && speed > 0.008) foot += w * curr.vis * dz;
      }
      // Arm snap: fast wrist movements (15,16)
      if (idx === 15 || idx === 16) {
        arm += w * curr.vis * speed;
      }
    }
    velocity[i] = vel;
    footStrike[i] = foot;
    armSnap[i] = arm;
  }

  // Compute acceleration (change in velocity)
  for (let i = 2; i < n; i++) {
    acceleration[i] = Math.abs(velocity[i] - velocity[i - 1]);
  }

  // Multi-signal energy: velocity + acceleration + foot-strike + arm-snap
  // Dancers count on the "hit" (velocity peak + arm snap) and the "land" (foot-strike)
  const energy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    energy[i] = velocity[i] * 0.45 + acceleration[i] * 0.25 + footStrike[i] * 0.2 + armSnap[i] * 0.1;
  }

  // Adaptive Gaussian smooth — tighter for fast movement, wider for slow
  const avgVel = velocity.reduce((a, b) => a + b, 0) / velocity.length;
  const stdVel = Math.sqrt(velocity.reduce((s, v) => s + (v - avgVel) ** 2, 0) / velocity.length);
  const motionIntensity = avgVel > 0 ? stdVel / avgVel : 1;
  const sigma = Math.max(1.5, Math.min(4, 5 - motionIntensity * 3)); // ~1.5 to 4 frames
  const win = Math.max(2, Math.round(sigma * 3));
  const smoothed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, wsum = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) {
      const gw = Math.exp(-0.5 * ((j - i) / sigma) ** 2);
      sum += energy[j] * gw; wsum += gw;
    }
    smoothed[i] = wsum > 0 ? sum / wsum : 0;
  }

  // Dynamic threshold: use percentile-based threshold for better handling of quiet sections
  const sorted = [...smoothed].sort((a, b) => a - b);
  const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
  const p25 = sorted[Math.floor(sorted.length * 0.25)] ?? 0;
  const iqr = p75 - p25;
  const threshold = Math.max(p25 + 0.1 * iqr, p25 * 1.5);

  // Peak pick with tempo regularization — real dancers count on a regular beat grid
  // Estimate the dominant inter-beat interval from auto-correlation
  let estimatedInterval = Math.max(6, Math.round(fps * 0.4)); // default ~400ms
  try {
    // Simple autocorrelation to find periodicity
    const maxLag = Math.min(n / 2, Math.round(fps * 3));
    let bestLag = estimatedInterval;
    let bestCorr = 0;
    for (let lag = Math.round(fps * 0.3); lag < maxLag; lag++) {
      let corr = 0;
      for (let i = lag; i < n; i++) corr += smoothed[i] * smoothed[i - lag];
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }
    estimatedInterval = bestLag;
  } catch {}

  // Candidate peaks with tempo snap — allow slight deviation but prefer regular spacing
  const minDist = Math.max(3, Math.round(estimatedInterval * 0.7));
  const maxDist = Math.round(estimatedInterval * 1.4);
  const candidates: number[] = [];
  let lastPeak = -minDist;

  for (let i = 1; i < n - 1; i++) {
    if (smoothed[i] < threshold) continue;
    if (smoothed[i] <= smoothed[i - 1] || smoothed[i] < smoothed[i + 1]) continue;
    if (i - lastPeak < minDist) {
      if (candidates.length && smoothed[i] > smoothed[candidates[candidates.length - 1]]) {
        candidates[candidates.length - 1] = i; lastPeak = i;
      }
      continue;
    }
    candidates.push(i); lastPeak = i;
  }

  // Tempo regularization: snap candidate peaks onto a grid based on the estimated interval
  const snapStrength = 0.3; // 0 = no snap, 1 = full grid
  const snapped: number[] = [];
  if (candidates.length >= 2) {
    for (let ci = 0; ci < candidates.length; ci++) {
      let bestT = candidates[ci];
      // Search nearby for the actual max near the snapped position
      const searchWindow = Math.max(2, Math.round(sigma));
      let windowMax = smoothed[bestT], windowIdx = bestT;
      for (let j = -searchWindow; j <= searchWindow; j++) {
        const idx = candidates[ci] + j;
        if (idx >= 0 && idx < n && smoothed[idx] > windowMax) {
          windowMax = smoothed[idx]; windowIdx = idx;
        }
      }
      snapped.push(windowIdx);
    }
  } else {
    snapped.push(...candidates);
  }

  return snapped.map((fi, i) => ({
    count: i + 1,
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
  upperCues: Map<number, string>;
  lowerCues: Map<number, string>;
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
): { cues: Map<number, string>; upperCues: Map<number, string>; lowerCues: Map<number, string>; pausePointCounts: number[] } {
  if (!poseSlice?.length) return { cues: new Map(), upperCues: new Map(), lowerCues: new Map(), pausePointCounts: [] };

  interface Delta { count: number; joint: string; delta: number; dx: number; dy: number; }
  const bodyDeltas: Delta[] = [];
  const upperDeltas: Delta[] = [];
  const lowerDeltas: Delta[] = [];

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
    let maxUpperDelta = 0, maxUpperJoint = '', maxUpperDx = 0, maxUpperDy = 0;
    let maxLowerDelta = 0, maxLowerJoint = '', maxLowerDx = 0, maxLowerDy = 0;
    for (const jname of getJointKeys()) {
      const idx = JOINT_IDX[jname];
      const lm1 = frame1.landmarks?.[idx] ?? frame1[idx];
      const lm2 = frame2.landmarks?.[idx] ?? frame2[idx];
      if (!lm1 || !lm2) continue;
      const dx = (lm2.x ?? 0) - (lm1.x ?? 0);
      const dy = (lm2.y ?? 0) - (lm1.y ?? 0);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxDelta) { maxDelta = d; maxJoint = jname; maxDx = dx; maxDy = dy; }
      const isUpper = jname.includes('shoulder') || jname.includes('elbow') || jname.includes('wrist');
      const isLower = jname.includes('hip') || jname.includes('knee') || jname.includes('ankle');
      if (isUpper && d > maxUpperDelta) { maxUpperDelta = d; maxUpperJoint = jname; maxUpperDx = dx; maxUpperDy = dy; }
      if (isLower && d > maxLowerDelta) { maxLowerDelta = d; maxLowerJoint = jname; maxLowerDx = dx; maxLowerDy = dy; }
    }
    if (maxDelta > CUE_THRESHOLD && maxJoint) {
      bodyDeltas.push({ count: beats[i].count, joint: maxJoint, delta: maxDelta, dx: maxDx, dy: maxDy });
    }
    if (maxUpperDelta > CUE_THRESHOLD && maxUpperJoint) {
      upperDeltas.push({ count: beats[i].count, joint: maxUpperJoint, delta: maxUpperDelta, dx: maxUpperDx, dy: maxUpperDy });
    }
    if (maxLowerDelta > CUE_THRESHOLD && maxLowerJoint) {
      lowerDeltas.push({ count: beats[i].count, joint: maxLowerJoint, delta: maxLowerDelta, dx: maxLowerDx, dy: maxLowerDy });
    }
  }

  const all = [...bodyDeltas, ...upperDeltas, ...lowerDeltas];
  const pausePointCounts = all
    .filter(d => d.delta > PAUSE_THRESHOLD)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 2)
    .map(d => d.count);

  const cues = new Map<number, string>();
  const upperCues = new Map<number, string>();
  const lowerCues = new Map<number, string>();
  bodyDeltas.forEach(d => cues.set(d.count, jointDeltaPhrase(d.joint, d.dx, d.dy)));
  upperDeltas.forEach(d => upperCues.set(d.count, jointDeltaPhrase(d.joint, d.dx, d.dy)));
  lowerDeltas.forEach(d => lowerCues.set(d.count, jointDeltaPhrase(d.joint, d.dx, d.dy)));
  return { cues, upperCues, lowerCues, pausePointCounts };
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

async function synthesizeTTS(text: string, ctx: AudioContext, _retry = false): Promise<AudioBuffer | null> {
  const k = text.trim();
  if (_ttsCache.has(k)) return _ttsCache.get(k)!;
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY ?? '';
  if (!apiKey) {
    console.warn('[synthesizeTTS] VITE_GEMINI_API_KEY not set — Gemini TTS disabled, using Web Speech fallback');
    return null;
  }
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
    if (!res.ok) {
      if (res.status === 429 && !_retry) {
        console.warn('[synthesizeTTS] Rate limited (429), retrying in 3s…');
        await new Promise<void>(r => setTimeout(r, 3000));
        return synthesizeTTS(text, ctx, true);
      }
      const err = await res.text().catch(() => res.status.toString());
      console.error('[synthesizeTTS] Gemini API error:', res.status, err.slice(0, 200));
      return null;
    }
    const data = await res.json();
    const part = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!part?.data) { console.warn('[synthesizeTTS] no inlineData in response', JSON.stringify(data).slice(0, 300)); return null; }
    const mimeType: string = part.mimeType ?? 'audio/pcm;rate=24000';
    console.log('[synthesizeTTS] mimeType:', mimeType);
    const raw = atob(part.data);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const decodePCM = (b: Uint8Array, rate: number): AudioBuffer => {
      const pcm16 = new Int16Array(b.buffer);
      const ab = ctx.createBuffer(1, pcm16.length, rate);
      const ch = ab.getChannelData(0);
      for (let i = 0; i < pcm16.length; i++) ch[i] = pcm16[i] / 32768;
      return ab;
    };
    let buf: AudioBuffer;
    const lmt = mimeType.toLowerCase();
    if (lmt.startsWith('audio/pcm') || lmt.startsWith('audio/l16') || lmt.startsWith('audio/raw')) {
      const rate = parseInt(mimeType.match(/rate=(\d+)/i)?.[1] ?? '24000');
      buf = decodePCM(bytes, rate);
    } else {
      try {
        buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
      } catch {
        // Gemini often returns raw PCM16 even with a non-pcm mime type — try it
        console.warn('[synthesizeTTS] decodeAudioData failed for mimeType:', mimeType, '— falling back to PCM16@24kHz');
        buf = decodePCM(bytes, 24000);
      }
    }
    _ttsCache.set(k, buf);
    return buf;
  } catch (e) { console.error('[synthesizeTTS] fetch error:', e); return null; }
}


const COUNT_SPOKEN = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'];

// "trying one" / "trying two to four" — spoken right before each forward isolated play.
// Count 1: always "trying one". Count 2+: uses the previous count from `from`. 
function tryingPhrase(i: number): string {
  if (i === 1) return 'trying one';
  if (i === 2) return 'trying one and two';
  return `trying ${COUNT_SPOKEN[i - 1]} and ${COUNT_SPOKEN[i]}`;
}

function howToGoPhrase(from: number, to: number): string {
  if (from === 0) return `here is count ${COUNT_SPOKEN[to]}`;
  return `how to do count ${COUNT_SPOKEN[to]}`;
}

// Synthesize cue descriptions, fallback descriptions, cumulative + individual count words.
async function presynthTeach(plan: TeachPlan, ctx: AudioContext): Promise<Map<string, AudioBuffer>> {
  const texts = new Set<string>();
  // Rich teacher description per count (already built in buildTeachPlan)
  plan.descriptions.forEach(phrase => texts.add(phrase));
  texts.add('again');
  texts.add('check your posture');
  for (let i = 1; i <= plan.beats.length; i++) {
    texts.add(tryingPhrase(i));
    texts.add(howToGoPhrase(i - 1, i));
  }
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
  // Sequential synthesis at ~6 s/request to stay within 10 RPM quota
  const map = new Map<string, AudioBuffer>();
  const textArr = [...texts];
  for (let idx = 0; idx < textArr.length; idx++) {
    const t = textArr[idx];
    const buf = await synthesizeTTS(t, ctx);
    if (buf) map.set(t, buf);
    if (idx < textArr.length - 1) await new Promise<void>(r => setTimeout(r, 6500));
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
    const beats = ensureCounts(effectiveCounts, startMs, endMs);
    const { cues, upperCues, lowerCues, pausePointCounts } = computeJointCues(poseSlice ?? [], beats);
    const { steps, connectors } = generateBuildSteps(beats, pausePointCounts, cues);
    const pausePoints: PausePoint[] = steps.filter(s => s.pausePoint).map(s => s.pausePoint!);
    const descriptions = new Map<number, string>();
    for (let i = 1; i <= beats.length; i++) descriptions.set(i, buildTeacherDescription(i, cues.get(i)));
    const plan: TeachPlan = { beats, cues, upperCues, lowerCues, descriptions, pausePoints, steps, connectors };
    _teachPlanCache.set(chunkId, plan);
    return plan;
  })();

  _teachPlanPending.set(chunkId, promise);
  promise.finally(() => _teachPlanPending.delete(chunkId));
  return promise;
}

// ── Ensure teaching counts across the chunk ─────────────────────────
// Uses the actual detected beat grid counts (variable, 4–12+).
// Falls back to evenly-spaced counts if absent—but respects chunk length.
// Also appends any 'and' half-counts detected between beats.

function _detectAndCounts(beats: BeatCount[], intervalSec: number): BeatCount[] {
  // Simple heuristic: if there's ~50% temporal gap, insert an 'and' count
  const result: BeatCount[] = [];
  for (let i = 0; i < beats.length; i++) {
    result.push(beats[i]);
    if (i + 1 < beats.length) {
      const gap = beats[i + 1].time - beats[i].time;
      if (gap > intervalSec * 0.75) {
        // Midpoint is an "and" count
        result.push({
          count: beats[i].count + 0.5 as any, // typed as any for display purposes
          time: (beats[i].time + beats[i + 1].time) / 2,
        });
      }
    }
  }
  return result;
}

function ensureCounts(effectiveCounts: BeatCount[] | undefined, startMs: number, endMs: number): BeatCount[] {
  const durSec = (endMs - startMs) / 1000;
  if (effectiveCounts && effectiveCounts.length > 0) {
    // Use actual detected counts but cap at 8 max per teach phase.
    const raw = effectiveCounts.slice(0, 8);
    const beats = raw.map(b => ({ ...b }));
    // Ensure first beat is offset from chunk start so count-1 has visible movement.
    const avgInterval = durSec / beats.length;
    const firstOffset = Math.min(avgInterval * 0.25, durSec * 0.05, 0.12);
    if (beats[0].time <= startMs / 1000 + 0.02) {
      beats[0].time = startMs / 1000 + firstOffset;
    }
    const withAnd = _detectAndCounts(beats, avgInterval);
    return withAnd;
  }

  // Fallback: estimate count based on chunk duration (~0.5s per beat = ~120 BPM)
  const estimatedCount = Math.max(4, Math.min(16, Math.round(durSec / 0.5)));
  const interval = durSec / estimatedCount;
  // Offset first beat from chunk start so count-1 ALWAYS shows visible movement.
  // (real beats may land at the start, but this fallback must never give 0-length counts)
  const firstOffset = Math.min(interval * 0.25, durSec * 0.05, 0.12);
  return Array.from({ length: estimatedCount }, (_, i) => ({
    count: i + 1,
    time: startMs / 1000 + firstOffset + i * interval,
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
  onEnd, onCountChange, onLabelChange, onCountdownChange, onPausedChange, onTeachStepChange, onDescribePhase, onFreezePhase, audioCtx, seekRef, controlRef,
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
  onFreezePhase?: (active: boolean) => void;
  audioCtx: AudioContext | null;
  seekRef: { current: ((n: number) => void) | null };
  controlRef: { current: { pause: () => void; resume: () => void; rewind: () => void } | null };
}) {
  const [phase, setPhase] = useState<TeachPhase>('computing');
  const [localPaused, setLocalPaused] = useState(false);
  const planRef = useRef<TeachPlan | null>(null);
  const audioMapRef = useRef(new Map<string, AudioBuffer>());
  // Keep TTS cache bounded to avoid unbounded memory growth
  const addToTTSCache = (key: string, buf: AudioBuffer) => {
    const map = audioMapRef.current;
    map.set(key, buf);
    if (map.size > 30) {
      const first = map.keys().next().value;
      map.delete(first);
    }
  };
  const mountedRef = useRef(true);
  // Ensure AudioContext is always available — parent may pass null on first render
  const localCtxRef = useRef<AudioContext | null>(null);
  const ctx: AudioContext | null = audioCtx ?? (() => {
    if (!localCtxRef.current) { try { localCtxRef.current = new AudioContext(); } catch {} }
    return localCtxRef.current;
  })();
  const scheduledRef = useRef<AudioBufferSourceNode[]>([]);
  const seekToRef = useRef<number | null>(null);
  const onEndRef = useRef(onEnd);
  const onCCRef = useRef(onCountChange);
  const onLCRef = useRef(onLabelChange);
  const onCDRef = useRef(onCountdownChange);
  const onTSCRef = useRef(onTeachStepChange);
  const onDPRef = useRef(onDescribePhase);
  const onFPRef = useRef(onFreezePhase);
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
    onFPRef.current = onFreezePhase;
  }, [onEnd, onCountChange, onLabelChange, onCountdownChange, onTeachStepChange, onDescribePhase, onFreezePhase]);

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
        audioCtx?.suspend().catch(() => {});
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
        audioCtx?.resume().catch(() => {});
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

    buildTeachPlan(chapter.id, effectiveCounts, poseSlice, chapter.startTimeMs, chapter.endTimeMs)
      .then(plan => {
        if (!mountedRef.current) return;
        planRef.current = plan;
        // Start teaching immediately — no blocking presynth.
        // Gemini buffers warm up in the background; Web Speech covers uncached text.
        if (ctx) {
          presynthTeach(plan, ctx).then(bufs => {
            if (mountedRef.current) {
              audioMapRef.current = bufs;
              console.log(`[TeachContent] Gemini TTS warmed: ${bufs.size} buffers`);
            }
          }).catch(() => {});
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
    // Use component-level ctx (never null — creates its own AudioContext if prop is null)
    if (!v || !plan) return;

    const cancel = { cancelled: false };

    const stopScheduled = () => {
      for (const s of scheduledRef.current) { try { s.stop(); } catch {} }
      scheduledRef.current = [];
    };

    // Play an AudioBuffer via Web Audio.
    const playBuf = (buf: AudioBuffer, wait: boolean): Promise<void> => new Promise(resolve => {
      stopScheduled();
      const src = ctx!.createBufferSource();
      src.buffer = buf;
      src.connect(ctx!.destination);
      if (wait) { src.onended = () => resolve(); setTimeout(() => resolve(), (buf.duration + 2) * 1000); }
      else resolve();
      const doStart = () => { src.start(); scheduledRef.current.push(src); };
      if (ctx!.state === 'suspended') ctx!.resume().then(doStart).catch(doStart);
      else doStart();
    });

    // Web Speech fallback.
    const speakWS = (text: string, wait: boolean): Promise<void> => {
      if (!window.speechSynthesis) return Promise.resolve();
      const u = new SpeechSynthesisUtterance(text); u.rate = 0.78;
      if (!wait) {
        window.speechSynthesis.speak(u); // just queue it, don't cancel (fixes 5-6-7-8 bug)
        return Promise.resolve();
      }
      window.speechSynthesis.cancel(); // blocking mode: cancel previous, then speak
      return new Promise(resolve => {
        const done = () => resolve();
        u.onend = done; u.onerror = done; setTimeout(done, 7000);
        window.speechSynthesis.speak(u);
      });
    };

    // Speak text:
    //  • If cached → Gemini (instant).
    //  • If wait=true and not cached → synthesize now inline (we're already waiting for speech).
    //  • If wait=false and not cached → Web Speech immediately, synthesize in background for next time.
    const speak = (text: string, wait: boolean): Promise<void> => {
      const cached = audioMapRef.current.get(text);
      if (cached && ctx) return playBuf(cached, wait);

      if (wait && ctx) {
        // Synthesize inline — caller is already waiting for speech to finish
        return synthesizeTTS(text, ctx).then(buf => {
          if (buf) { addToTTSCache(text, buf); return playBuf(buf, true); }
          return speakWS(text, true);
        }).catch(() => speakWS(text, true));
      }

      // Fire-and-forget: Web Speech now, cache Gemini for next time
      if (ctx) synthesizeTTS(text, ctx).then(buf => { if (buf) addToTTSCache(text, buf); }).catch(() => {});
      return speakWS(text, false);
    };

    const aborted = () => cancel.cancelled || rewindTrig.current || seekToRef.current !== null;

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
        let countEnd = beats[c].time;
        if (c === 0 && beats.length > 1) {
          countEnd = Math.max(countEnd, (beats[0].time + beats[1].time) / 2);
        }

        // ── 1. TELEPORT to beat[0], cumulative run ──────────────────────────
        // For count 1, start from the beginning of the chunk (start → 1)
        // For count 2+, start from beats[0] (the first count)
        const cumStartTime = c === 0 ? (chapter.startTimeMs / 1000) : beats[0].time;
        await seekVideo(v, cumStartTime);
        // For count 2+, hold at beat[0] and announce "from start till X" before playing
        if (i > 1 && !aborted()) {
          await speak(`from start till ${COUNT_SPOKEN[i]}`, true);
          if (aborted()) { if (rewindTrig.current) { goToSeekOrRewind(); continue; } return; }
        }
        await sleepMs(200);
        if (aborted()) { if (rewindTrig.current) { goToSeekOrRewind(); continue; } return; }

        // ── 0.5. 5-6-7-8 COUNTDOWN (sloooow — ~1s per number) ──────────────
        speak('five six seven eight', false);
        for (const num of [5, 6, 7, 8] as const) {
          if (aborted()) { if (rewindTrig.current) { goToSeekOrRewind(); continue; } return; }
          onCDRef.current(String(num));
          await sleepMs(900);
        }
        onCDRef.current(null);
        if (aborted()) { if (rewindTrig.current) { goToSeekOrRewind(); continue; } return; }
        // ── 1. CUMULATIVE RUN ────────────────────────────────────────────────
        v.playbackRate = 0.35;
        await v.play().catch(() => {});

        // Real-time count narration: say each count exactly as the video reaches its beat
        await new Promise<void>(resolve => {
          const said = new Set<number>();
          const tick = () => {
            if (aborted()) { resolve(); return; }
            const t = v.currentTime;
            let display: number | null = null;
            for (let j = 0; j < i; j++) {
              if (t >= beats[j].time - 0.14 && t < beats[j].time + 0.5) { display = j + 1; break; }
            }
            onCCRef.current(display);
            // Narrator says each count right ON the beat (only once per count)
            for (let j = 0; j < i; j++) {
              if (!said.has(j) && t >= beats[j].time - 0.02) {
                said.add(j);
                speak(COUNT_SPOKEN[j + 1], false);
              }
            }
            if (t >= countEnd) { v.pause(); v.currentTime = countEnd; resolve(); return; }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        if (aborted()) { v.pause(); if (rewindTrig.current) { goToSeekOrRewind(); continue; } return; }
        v.pause();
        onCCRef.current(i);

        // ── 2. DESCRIBE (3 sub-phases: VERY SLOW, each body part fully explained) ─────────────────
        // Upper → Lower → Connect.
        // Per body part: dancer slow → stickman×2 → dancer slow again.
        const descFrom = c > 0 ? beats[c - 1].time : chapter.startTimeMs / 1000;
        const descTo = beats[c].time;

        const danceSlow = (): Promise<void> => new Promise(resolve => {
          if (aborted() || descTo <= descFrom) { resolve(); return; }
          v.currentTime = descFrom;
          v.playbackRate = 0.15; // VERY slow for beginner learning
          v.play().catch(() => {});
          const tick = () => {
            if (aborted() || v.currentTime >= descTo) { v.pause(); resolve(); return; }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });

        const danceReverse = (): Promise<void> => new Promise(resolve => {
          if (aborted()) { resolve(); return; }
          reverseSeekTo(descFrom).then(resolve);
        });

        // 3 body-part sub-phases (with per-body-part dominant-joint cues)
        const subPhases = [
          { label: 'Arms', body: 'arms and hands', cue: plan.upperCues.get(i)?.replace(/_/g, ' ') ?? 'focus on hands' },
          { label: 'Legs', body: 'legs and hips', cue: plan.lowerCues.get(i)?.replace(/_/g, ' ') ?? 'focus on feet' },
          { label: 'Connect', body: 'full body', cue: plan.cues.get(i)?.replace(/_/g, ' ') ?? 'connect everything' },
        ];

        for (const sp of subPhases) {
          if (aborted()) break;
          onLCRef.current(sp.label);
          onCCRef.current(null);

          // ── a) DANCER SLOW: show only dancer, narrate body-specific cue ──
          onDPRef.current?.(false);
          speak(`Watch the ${sp.body} very carefully. On ${COUNT_SPOKEN[i]}, ${sp.cue}.`, false);
          await danceSlow();
          if (aborted()) break;
          await sleepMs(500); // pause at end so learner sees the final pose

          // ── b) STICKMAN ×2: dancer pauses, stickman shows movement ──
          onDPRef.current?.(true);
          onCCRef.current(i);
          speak(`Now watch the stickman show the ${sp.body} movement.`, false);
          await sleepMs(4500); // TeachPoseAnimator auto-loops; give it time for 2 full cycles
          if (aborted()) break;

          speak(`Once more — watch the ${sp.body} very carefully.`, false);
          await sleepMs(4500); // stickman runs 2 more cycles
          if (aborted()) break;

          // ── c) DANCER AGAIN: show the same movement again, slowly ──
          onDPRef.current?.(false);
          onCCRef.current(null);
          speak(`Again — watch the ${sp.body}. On ${COUNT_SPOKEN[i]}, ${sp.cue}.`, false);
          await danceSlow();
          if (aborted()) break;
          await sleepMs(800); // pause after dancer, let it sink in

          if (rewindTrig.current) { goToSeekOrRewind(); break; }
        }

        onDPRef.current?.(false);
        onLCRef.current(null);
        onCCRef.current(null);
        if (aborted()) { if (rewindTrig.current) { goToSeekOrRewind(); continue; } return; }

        // ── 2b. FREEZE CHECK — hold final frame 5s, narrator cues posture check ──
        onFPRef.current?.(true);
        speak('check your posture', false);
        await sleepMs(5000);
        onFPRef.current?.(false);
        if (aborted()) { if (rewindTrig.current) { goToSeekOrRewind(); continue; } return; }

        onCCRef.current(null);
        await sleepMs(300);

        // ── 2c/2d. "HOW TO GO" ×2 — demo current count i ──────────────────────
        // HOW TO GO: starts from i-1 to i (half length of trying)
        // After forward play, reverse back to start, then play forward again
        if (!aborted() && c > 0) {
          const howStart = beats[c - 1].time; // i-1
          const howEnd   = beats[c].time;     // i
          for (let rep = 0; rep < 2 && !aborted(); rep++) {
            await reverseSeekTo(howStart);
            if (aborted()) break;
            speak(howToGoPhrase(i - 1, i), false);
            if (aborted()) break;
            onCCRef.current(i - 1);
            if (aborted()) break;
            onLCRef.current(rep === 0 ? `How to do ${COUNT_SPOKEN[i]}` : `Again — ${COUNT_SPOKEN[i]}`);
            onCDRef.current('2'); await sleepMs(1000); if (aborted()) break;
            onCDRef.current('1'); await sleepMs(1000); if (aborted()) break;
            onCDRef.current('go'); await sleepMs(200); if (aborted()) break;
            onCDRef.current(null);
            v.playbackRate = 0.25;
            await v.play().catch(() => {});
            // Forward play
            await new Promise<void>(resolve => {
              const said = new Set<number>();
              for (let beatIdx = c - 1; beatIdx <= c; beatIdx++) {
                if (!aborted() && beatIdx >= 0) { said.add(beatIdx); }
              }
              const tick = () => {
                if (aborted()) { resolve(); return; }
                const t = v.currentTime;
                for (let beatIdx = c - 1; beatIdx <= c; beatIdx++) {
                  if (beatIdx < 0) continue;
                  if (!said.has(beatIdx) && t >= beats[beatIdx].time - 0.02) {
                    said.add(beatIdx);
                    onCCRef.current(beatIdx + 1);
                    if (beatIdx === c) {
                      speak(COUNT_SPOKEN[beatIdx + 1], false);
                    }
                  }
                }
                if (t >= howEnd + 0.22) { resolve(); return; }
                requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            });
            v.pause(); onCCRef.current(null); onLCRef.current(null);
            // ── REVERSE back to howStart ──
            speak('Reverse.', false);
            await reverseSeekTo(howStart);
            if (aborted()) break;
            await sleepMs(300);
          }
        }
        if (aborted()) { if (rewindTrig.current) { goToSeekOrRewind(); continue; } return; }
        await sleepMs(150);

        // ── 3. ISOLATED REPLAY ×2 (TRYING: from i-2 to i, double length of howToGo) ──
        // For count 1, start from the beginning. For count 2, start from i-1.
        if (!aborted()) {
          const isFirstCount = c === 0;
          // TRYING: from i-2 to i (double the length of howToGo)
          const revTarget = isFirstCount ? (chapter.startTimeMs / 1000) : (c >= 2 ? beats[c - 2].time : beats[c - 1].time);
          const prevCount = isFirstCount ? 0 : (c >= 2 ? i - 2 : i - 1);

          for (let rep = 0; rep < 2 && !aborted(); rep++) {
            await reverseSeekTo(revTarget);
            if (aborted()) break;

            speak(rep === 0 ? tryingPhrase(i) : 'again', false);

            if (prevCount > 0) onCCRef.current(prevCount);
            const naturalLabel = isFirstCount
            ? `Trying ${COUNT_SPOKEN[i]}`
            : (c >= 2 ? `${COUNT_SPOKEN[i - 2]} to ${COUNT_SPOKEN[i]}` : `${COUNT_SPOKEN[i - 1]} and ${COUNT_SPOKEN[i]}`);
          onLCRef.current(rep === 0 ? naturalLabel : `Again`);
            onCDRef.current('2'); await sleepMs(1000); if (aborted()) break;
            onCDRef.current('1'); await sleepMs(1000); if (aborted()) break;
            onCDRef.current('go'); await sleepMs(200); if (aborted()) break;
            onCDRef.current(null); onLCRef.current(null); onCCRef.current(null);

            // Forward play: trying goes from i-2 to i. Video shows all beats,
            // but narrator only says i-1 and i (not i-2).
            v.playbackRate = 0.25;
            await v.play().catch(() => {});
            await new Promise<void>(resolve => {
              const said = new Set<number>();
              const firstBeatToSay = Math.max(0, c - 2); // start video from i-2
              for (let beatIdx = firstBeatToSay; beatIdx <= c; beatIdx++) {
                if (!aborted()) said.add(beatIdx);
              }
              const tick = () => {
                if (aborted()) { resolve(); return; }
                const t = v.currentTime;
                for (let beatIdx = firstBeatToSay; beatIdx <= c; beatIdx++) {
                  if (!said.has(beatIdx)) continue;
                  const beatTime = beatIdx >= 0 ? beats[beatIdx].time : chapter.startTimeMs / 1000;
                  if (t >= beatTime - 0.02) {
                    said.delete(beatIdx);
                    const countNumber = beatIdx + 1;
                    onCCRef.current(countNumber); // always show the count on screen
                    // Narrator speaks ONLY if this is count i-1 or i (not i-2)
                    if (beatIdx >= c - 1) {
                      speak(COUNT_SPOKEN[countNumber], false);
                    }
                  }
                }
                if (t >= beats[c].time + 0.22) { resolve(); return; }
                requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            });
            v.pause(); onCCRef.current(null);
            // ── REVERSE back to revTarget ──
            speak('Reverse.', false);
            await reverseSeekTo(revTarget);
            if (aborted()) break;
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
      onDPRef.current?.(false);
      onFPRef.current?.(false);
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
        const lastBeat = plan.beats[plan.beats.length - 1];
        const chunkEnd = chapter.endTimeMs > 0 ? chapter.endTimeMs / 1000 : (v.duration ?? 999);
        // Don't stop before the last beat has been passed
        const endGuard = Math.max(chunkEnd, (lastBeat?.time ?? 0) + 0.3);

        await new Promise<void>(resolve => {
          const tick = () => {
            if (cancel.cancelled) { resolve(); return; }
            const t = v.currentTime;
            for (const beat of plan.beats) {
              if (!fired.has(beat.count) && t >= beat.time - 0.15) {
                fired.add(beat.count);
                onCCRef.current(beat.count);
                setTimeout(() => onCCRef.current(null), 800);
              }
            }
            if (t >= endGuard - 0.1) { resolve(); return; }
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

function EndOfChapterScreen({ score, jointScores, nextTitle, onRetry, onNext, cameraMode, onCameraModeChange }: {
  score: FinalScore | null;
  jointScores: JointScore[];
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
    // Countdown runs to 0 but does NOT auto-retry — user must click
    if (cd <= 0) return;
    const t = setTimeout(() => setCd(c => c - 1), 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cd]);

  const radius = 28; const circ = 2 * Math.PI * radius;
  // Score computation
  const totalJoint = jointScores.length ? jointScores.reduce((s, j) => s + j.score, 0) / jointScores.length : 0;
  const pct = Math.round(totalJoint);
  const isGood = pct >= 80;

  return (
    <div className="absolute inset-0 z-50 bg-black/92 backdrop-blur-sm flex items-center justify-center p-8">
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-20%) rotate(0deg); opacity: 1; }
          100% { transform: translateY(120%) rotate(720deg); opacity: 0; }
        }
      `}</style>
      <div className="max-w-sm w-full space-y-5">

        {/* Animated score ring */}
        {score && (
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <svg width="120" height="120" className="-rotate-90">
                <circle cx="60" cy="60" r={50} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" />
                <circle cx="60" cy="60" r={50} fill="none" stroke={isGood ? 'rgba(34,197,94,0.85)' : 'rgba(139,92,246,0.85)'} strokeWidth="6"
                  strokeDasharray={`${2 * Math.PI * 50 * (pct / 100)} ${2 * Math.PI * 50}`} strokeLinecap="round"
                  style={{ transition: 'stroke-dasharray 1.5s ease-out' }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-black text-white">{pct}%</span>
              </div>
            </div>
            <p className="text-white/50 text-sm font-medium">{isGood ? '🎉 Great job!' : 'Keep practicing!'}</p>
          </div>
        )}

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
              className={`w-full flex items-start gap-3 px-3.5 py-3 text-left transition-all border-b border-white/4 hover:bg-white/5 group ${isActive ? 'bg-violet-600/12 border-l-[3px] border-l-violet-500 shadow-[inset_0_0_20px_rgba(139,92,246,0.08)]' : 'border-l-[3px] border-l-transparent'}`}>
              <div className={`shrink-0 w-[72px] h-[44px] rounded-lg overflow-hidden relative transition-shadow duration-300 ${isActive ? 'shadow-[0_0_16px_rgba(139,92,246,0.35)]' : 'shadow-sm'}`}>
                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${thumbnail})`, opacity: 0.5 }} />
                <div className="absolute inset-0 bg-black/30" />
                <div className={`absolute inset-0 flex items-center justify-center ${isActive ? 'bg-violet-500/20' : 'group-hover:bg-white/5'}`}>
                  {isActive ? <Play className="w-4 h-4 text-violet-300 fill-current" /> : <span className="text-sm">{ch.emoji}</span>}
                </div>
                {/* Duration badge for active item */}
                {durMs > 0 && (
                  <span className="absolute bottom-0.5 right-0.5 text-[9px] font-medium bg-black/60 text-white/70 px-1.5 py-0.5 rounded-md">
                    {fmtMs(durMs)}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[11px] font-semibold leading-tight ${isActive ? 'text-violet-200' : 'text-white/60 group-hover:text-white/80'}`}>{ch.title}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  {/* Chapter type tag */}
                  <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-md ${
                    ch.type === 'teach' ? 'bg-violet-500/15 text-violet-300/80' :
                    ch.type === 'warmup' ? 'bg-amber-500/15 text-amber-300/80' :
                    ch.type === 'watch' ? 'bg-blue-500/15 text-blue-300/80' :
                    ch.type === 'practice' ? 'bg-green-500/15 text-green-300/80' :
                    'bg-white/5 text-white/30'
                  }`}>{ch.type}</span>
                </div>
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
    <div className="absolute bottom-0 left-0 right-0 h-10 z-25 flex items-center px-3 gap-1.5 bg-gradient-to-t from-black/70 to-transparent select-none">
      {Array.from({ length: totalSteps }, (_, i) => {
        const count = i + 1;
        const isDone = currentStep > count;
        const isActive = currentStep === count;
        return (
          <div
            key={count}
            onClick={() => onSeek(count)}
            title={`Jump to count ${count}`}
            className="flex-1 group relative h-6 flex items-center cursor-pointer"
          >
            {/* Segment bar with active glow */}
            <div className={`w-full rounded-full transition-all duration-200 pointer-events-none ${
              isActive ? 'h-2.5 bg-violet-400 shadow-[0_0_10px_rgba(139,92,246,0.8),0_0_20px_rgba(139,92,246,0.4)]'
              : isDone  ? 'h-2 bg-violet-600/50'
              : 'h-1.5 bg-white/15 group-hover:h-2 group-hover:bg-white/30'
            }`} />
            {/* Hover & active labels */}
            <span className={`absolute inset-x-0 -top-5 text-center text-[10px] font-bold pointer-events-none transition-all duration-150 ${
              isActive ? 'text-violet-300 opacity-100 scale-110' : 'opacity-0 group-hover:opacity-80 group-hover:scale-100 text-white/60'
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
    <div className="h-full flex items-center justify-center bg-black relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 40%, rgba(139,92,246,0.08) 0%, transparent 60%)' }} />
      <div className="max-w-sm w-full text-center space-y-8 px-6 relative z-10">
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
        <div className="space-y-3">
          <div className="text-7xl leading-none drop-shadow-lg">{exercise.icon}</div>
          <h2 className="text-3xl font-black text-white tracking-tight">{exercise.name}</h2>
          <p className="text-white/50 text-sm leading-relaxed max-w-[260px] mx-auto">{exercise.desc}</p>
          
          {/* Per-exercise progress bar */}
          <div className="flex items-center justify-center gap-3 mt-2">
            <div className="h-1.5 w-24 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-violet-400/80 transition-all duration-500"
                style={{ width: `${(exerciseRemaining / WARMUP_PER_EXERCISE) * 100}%` }} />
            </div>
            <span className="text-white/30 text-xs font-mono">{exerciseRemaining}s</span>
          </div>

          {/* Progress dots */}
          <div className="flex justify-center gap-2.5 pt-4">
            {WARMUP_EXERCISES.map((_, i) => (
              <div key={i} className={`rounded-full transition-all duration-500 ${
                i < exerciseIdx ? 'w-2.5 h-2.5 bg-violet-400 shadow-[0_0_6px_rgba(139,92,246,0.5)]'
                : i === exerciseIdx ? 'w-3 h-3 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)] scale-110'
                : 'w-2.5 h-2.5 bg-white/10'
              }`} />
            ))}
          </div>
        </div>

        <button
          onClick={() => { if (!firedRef.current) { firedRef.current = true; onDoneRef.current(); } }}
          className="w-full py-3.5 bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/70 text-sm font-semibold rounded-2xl transition-all border border-white/10 backdrop-blur-sm"
        >
          Skip warmup →
        </button>
      </div>
    </div>
  );
}

// ── TeachPoseAnimator ─────────────────────────────────────────────────────────
// Smooth RAF-interpolated animation through pose frames at ~0.3× real speed.

function TeachPoseAnimator({ poseSlice, fromTime, toTime, cueJointIdx, highlightJoints }: {
  poseSlice: any[];
  fromTime: number;
  toTime: number;
  cueJointIdx?: number;
  highlightJoints?: number[];
}) {
  const [landmarks, setLandmarks] = useState<any[] | null>(null);

  // Filter frames in the beat range (or fall back to boundary frames)
  const frames = (() => {
    const result: any[] = [];
    for (let i = 0; i < poseSlice.length; i++) {
      const t: number = poseSlice[i]?.t ?? poseSlice[i]?.time ?? (i / 30);
      if (t >= fromTime - 0.05 && t <= toTime + 0.05) result.push(poseSlice[i]);
    }
    if (result.length < 2) {
      let b0 = 0, b1 = poseSlice.length - 1, d0 = Infinity, d1 = Infinity;
      for (let i = 0; i < poseSlice.length; i++) {
        const t: number = poseSlice[i]?.t ?? poseSlice[i]?.time ?? (i / 30);
        if (Math.abs(t - fromTime) < d0) { d0 = Math.abs(t - fromTime); b0 = i; }
        if (Math.abs(t - toTime)   < d1) { d1 = Math.abs(t - toTime);   b1 = i; }
      }
      return [poseSlice[b0], poseSlice[b1]].filter(Boolean);
    }
    return result;
  })();

  useEffect(() => {
    if (!frames.length) return;
    if (frames.length === 1) {
      const f = frames[0];
      setLandmarks(f?.landmarks ?? (Array.isArray(f) ? f : null));
      return;
    }

    // Render at 30fps (~33ms per frame) for smooth, snappy stickman animation
    const CYCLE_MS = frames.length * 33;
    const startMs  = performance.now();
    let raf: number;

    const tick = (now: number) => {
      const elapsed = (now - startMs) % CYCLE_MS;
      const pos     = (elapsed / CYCLE_MS) * (frames.length - 1);
      const i0      = Math.floor(pos);
      const i1      = Math.min(i0 + 1, frames.length - 1);
      const alpha   = pos - i0; // interpolation factor 0→1

      const f0 = frames[i0];
      const f1 = frames[i1];
      const lm0: any[] | null = f0?.landmarks ?? (Array.isArray(f0) ? f0 : null);
      const lm1: any[] | null = f1?.landmarks ?? (Array.isArray(f1) ? f1 : null);

      if (lm0 && lm1 && lm0.length > 0 && lm1.length >= lm0.length) {
        // Linear interpolation between consecutive frames → smooth 60fps rendering
        const interp = lm0.map((p: any, j: number) => {
          const q = lm1[j] ?? p;
          return {
            x: p.x + (q.x - p.x) * alpha,
            y: p.y + (q.y - p.y) * alpha,
            z: (p.z ?? 0) + ((q.z ?? 0) - (p.z ?? 0)) * alpha,
            visibility: Math.min(p.visibility ?? 1, q.visibility ?? 1),
          };
        });
        setLandmarks(interp);
      } else if (lm0) {
        setLandmarks(lm0);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frames.length, fromTime, toTime]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!landmarks) {
    return (
      <div className="flex items-center justify-center" style={{ width: 300, height: 480 }}>
        <div className="animate-spin rounded-full"
          style={{ width: 44, height: 44, border: '2px solid rgba(160, 80, 255, 0.15)', borderTopColor: 'rgba(160, 80, 255, 0.75)' }} />
      </div>
    );
  }

  return (
    <div style={{
      filter: 'drop-shadow(0 0 14px rgba(160, 80, 255, 0.60)) drop-shadow(0 0 4px rgba(240, 220, 255, 0.28))',
      position: 'relative',
      width: 300,
      height: 480,
    }}>
      <StickmanCanvas
        landmarks={landmarks}
        mode="full_body"
        smooth
        width={300}
        height={480}
        color="rgba(225, 195, 255, 0.96)"
        highlightJoints={highlightJoints ?? (cueJointIdx !== undefined ? [cueJointIdx] : undefined)}
      />
    </div>
  );
}

// ── ChapterPlayer ─────────────────────────────────────────────────────────────

export default function ChapterPlayer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const session = useAuthStore(s => s.session);

  const [routine, setRoutine] = useState<DbRoutine | null>(null);
  const [loading, setLoading] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [hasBeatGrid, setHasBeatGrid] = useState(false);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [showEoC, setShowEoC] = useState(false);
  const [isLeadIn, setIsLeadIn] = useState(false);
  const [leadInCount, setLeadInCount] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [watchCountdown, setWatchCountdown] = useState<number | null>(null);

  const [cameraMode, setCameraMode] = useState<CameraMode>('mirror');
  const [videoMirrored, setVideoMirrored] = useState(true);
  const [hasWebcam, setHasWebcam] = useState(false);
  const [teachCount, setTeachCount] = useState<number | null>(null);
  const [teachLabel, setTeachLabel] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [teachCountdown, setTeachCountdown] = useState<string | null>(null);
  const [teachPaused, setTeachPaused] = useState(false);
  const [teachStep, setTeachStep] = useState(0);
  const [teachDescribeActive, setTeachDescribeActive] = useState(false);
  const [teachFreezeActive, setTeachFreezeActive] = useState(false);
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
      const isDemo = (new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')).get('demo') === '1' || id === 'demo';
      if (isDemo) {
        data = {
          id: id || 'demo',
          title: 'Bom Diggy Diggy (Demo)',
          duration_seconds: 12,
          video_blob_url: '/videos/test.mp4',
          chunks: [
            { id: 'ch-0', chunk_index: 0, start_time_ms: 0, end_time_ms: 4100, description: 'Intro', pose_slice_json: '[]' },
            { id: 'ch-1', chunk_index: 1, start_time_ms: 4100, end_time_ms: 8200, description: 'Verse', pose_slice_json: '[]' },
            { id: 'ch-2', chunk_index: 2, start_time_ms: 8200, end_time_ms: 12300, description: 'Chorus', pose_slice_json: '[]' },
          ],
          beat_grid_json: {
            bpm: 140,
            beats: [0.5, 1.28, 2.14, 2.87, 3.64, 4.5, 5.28, 6.14, 6.87, 7.71, 8.5, 9.28, 10.14, 10.87, 11.64],
            counts: [
              { count: 1, time: 0.5 }, { count: 2, time: 1.28 }, { count: 3, time: 2.14 },
              { count: 4, time: 2.87 }, { count: 5, time: 3.64 }, { count: 6, time: 4.5 },
              { count: 7, time: 5.28 }, { count: 8, time: 6.14 }, { count: 1, time: 6.87 },
              { count: 2, time: 7.71 }, { count: 3, time: 8.5 }, { count: 4, time: 9.28 },
              { count: 5, time: 10.14 }, { count: 6, time: 10.87 }, { count: 7, time: 11.64 },
            ],
            chunks: [
              { chunkId: 0, startCount: 1, endCount: 5, startTime: 0, endTime: 4.1 },
              { chunkId: 1, startCount: 6, endCount: 10, startTime: 4.1, endTime: 8.2 },
              { chunkId: 2, startCount: 11, endCount: 15, startTime: 8.2, endTime: 12.3 },
            ]
          },
        };
      } else {
        if (session?.user?.id) {
          const res = await supabase.rpc('rpc_get_routine_detail', { p_routine_id: id, p_user_id: session.user.id });
          if (res.data) data = res.data;
        }
        if (!data) {
          try { const raw = localStorage.getItem(`taal-local-routine-${id}`); if (raw) data = JSON.parse(raw); } catch {}
        }
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

      // Teach, Practice, and Connect always get a lead-in (5-6-7-8 audio countdown)
      const needsLeadIn = ch.type === 'teach' || ch.type === 'practice' || ch.type === 'connect';
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
        processFrame(w, rv.currentTime * 1000, 'full');
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
    setMobileSidebarOpen(false);
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
    <div className="h-screen bg-black flex items-center justify-center p-8">
      <div className="text-center space-y-5 max-w-md">
        <p className="text-white/40 text-lg">Routine not found</p>
        <p className="text-white/25 text-sm">This routine may not exist or its data couldn't be loaded.</p>

        {/* Create a demo routine with the test video */}
        <div className="pt-4">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-3">Test with demo video</p>
          <button onClick={() => {
            // Inject demo routine inline and reload
            const demoRoutine: DbRoutine = {
              id: id || 'demo',
              title: 'Bom Diggy Diggy (Demo)',
              duration_seconds: 12,
              thumbnail_url: '',
              video_blob_url: '/videos/test.mp4',
              chunks: [
                { id: 'ch-0', chunk_index: 0, start_time_ms: 0, end_time_ms: 4100, description: 'Intro', pose_slice_json: '[]' },
                { id: 'ch-1', chunk_index: 1, start_time_ms: 4100, end_time_ms: 8200, description: 'Verse', pose_slice_json: '[]' },
                { id: 'ch-2', chunk_index: 2, start_time_ms: 8200, end_time_ms: 12300, description: 'Chorus', pose_slice_json: '[]' },
              ],
              beat_grid_json: {
                bpm: 140,
                beats: [0.5, 1.28, 2.14, 2.87, 3.64, 4.5, 5.28, 6.14, 6.87, 7.71, 8.5, 9.28, 10.14, 10.87, 11.64],
                counts: [
                  { count: 1, time: 0.5 }, { count: 2, time: 1.28 }, { count: 3, time: 2.14 },
                  { count: 4, time: 2.87 }, { count: 5, time: 3.64 }, { count: 6, time: 4.5 },
                  { count: 7, time: 5.28 }, { count: 8, time: 6.14 }, { count: 1, time: 6.87 },
                  { count: 2, time: 7.71 }, { count: 3, time: 8.5 }, { count: 4, time: 9.28 },
                  { count: 5, time: 10.14 }, { count: 6, time: 10.87 }, { count: 7, time: 11.64 },
                ],
                chunks: [
                  { chunkId: 0, startCount: 1, endCount: 5, startTime: 0, endTime: 4.1 },
                  { chunkId: 1, startCount: 6, endCount: 10, startTime: 4.1, endTime: 8.2 },
                  { chunkId: 2, startCount: 11, endCount: 15, startTime: 8.2, endTime: 12.3 },
                ]
              },
            };
            localStorage.setItem(`taal-local-routine-${id || 'demo'}`, JSON.stringify(demoRoutine));
            // Refresh page to load the new routine
            window.location.search = '?demo=1';
          }} className="w-full py-3.5 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-2xl transition-all shadow-[0_0_18px_rgba(139,92,246,0.35)]">
            Start Demo with Test Video
          </button>
        </div>

        <button onClick={() => navigate(-1)} className="text-violet-400 text-sm underline mt-4">Go back</button>
      </div>
    </div>
  );

  // Check for demo mode - bypasses auth and loads test video
  const search = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const isDemo = search.get('demo') === '1' || id === 'demo';

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
    ? ensureCounts(effectiveRangeCounts, chapter.startTimeMs, chapter.endTimeMs)
    : [];

  const teachCues = (() => {
    if (!teachPoseSlice?.length || !teachBeats.length) return new Map<number, string>();
    const { cues } = computeJointCues(teachPoseSlice, teachBeats);
    return cues;
  })();

  // Frames for animated stickman during describe phase (i-1 → i transition).
  // Use teachStep when teachCount is null (describe phase holds null count).
  const activeAnimCount = teachCount ?? teachStep ?? 1;
  const teachAnimFromTime = activeAnimCount > 1
    ? (teachBeats[activeAnimCount - 2]?.time ?? teachBeats[0]?.time ?? 0)
    : (chapter?.startTimeMs ? chapter.startTimeMs / 1000 : (teachBeats[0]?.time ?? 0));
  const teachAnimToTime = (() => {
    const raw = activeAnimCount >= 1
      ? (teachBeats[activeAnimCount - 1]?.time ?? teachBeats[teachBeats.length - 1]?.time ?? 1)
      : 1;
    // Count 1 often has its beat at the chunk start → zero-length animation range.
    // Force a minimum 0.2 s window so the stickman actually moves.
    if (activeAnimCount === 1 && raw <= teachAnimFromTime + 0.02) {
      return teachAnimFromTime + 0.2;
    }
    return raw;
  })();

  const teachCueJointName = (teachCount ?? teachStep ?? 0) >= 1 ? (teachCues.get(teachCount ?? teachStep ?? 1) ?? null) : null;
  const teachCueJointIdx = teachCueJointName !== null ? JOINT_IDX[teachCueJointName] : undefined;
  const showTeachSplit = teachDescribeActive && !showEoC && !!teachPoseSlice?.length;

  return (
    <div className="h-screen bg-black flex flex-col overflow-hidden">

      {/* ── Top bar ── */}
      <header className="shrink-0 h-11 flex items-center gap-3 px-3 bg-black/60 backdrop-blur-xl border-b border-white/6 z-30 relative">
        {/* Overall progress line */}
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/5">
          <div className="h-full bg-violet-500/60 transition-all duration-300" style={{ width: `${((currentIdx) / Math.max(chapters.length - 1, 1)) * 100}%` }} />
        </div>
        <button onClick={() => navigate(`/routine/${id}`)} className="shrink-0 w-7 h-7 flex items-center justify-center text-white/40 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        {/* Mobile sidebar toggle */}
        <button onClick={() => setMobileSidebarOpen(o => !o)} className="lg:hidden shrink-0 w-7 h-7 flex items-center justify-center text-white/40 hover:text-white transition-colors">
          <Menu className="w-4 h-4" />
        </button>
        <p className="flex-1 min-w-0 text-white/75 text-xs font-medium truncate">{chapter?.emoji} {chapter?.title}</p>
        <span className="shrink-0 text-white/30 text-xs">{currentIdx + 1}/{chapters.length}</span>
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

        {/* Mirror toggle */}
        <button
          onClick={() => setVideoMirrored(m => !m)}
          title={videoMirrored ? 'Video mirrored (follow along)' : 'Video not mirrored'}
          className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
            videoMirrored ? 'bg-white/7 border-white/12 text-white/50' : 'bg-white/3 border-white/7 text-white/25'
          }`}
        >
          <span>↔</span>
          <span>{videoMirrored ? 'Mirror' : 'Normal'}</span>
        </button>
      </header>

      {/* ── 70 / 30 body ── */}
      <div className="flex-1 flex min-h-0">

        {/* ── 70% main content ── */}
        <div className="flex-1 lg:flex-[7] min-w-0 relative overflow-hidden">

          {/* Warmup — timed guided warmup */}
          {chapter?.type === 'warmup' && <WarmupChapter onDone={handleNext} />}

          {/* All video chapters */}
          {chapter?.type !== 'warmup' && (
            <div className="h-full flex bg-black">

              {/* Reference video — full width OR left half (when split) */}
              <div className={`relative bg-black overflow-hidden flex-1 ${showSplit || showTeachSplit ? 'border-r border-white/5' : ''}`}>
                <video
                  ref={refVideoRef}
                  className={`absolute inset-0 w-full h-full object-contain ${videoMirrored ? 'scale-x-[-1]' : ''}`}
                  playsInline
                  onError={(e) => setVideoError('Failed to load video. The link may have expired.')}
                  onLoadedData={() => setVideoError(null)}
                />
                {/* Cinematic radial vignette */}
                <div className="absolute inset-0 pointer-events-none" style={{
                  background: 'radial-gradient(circle at 50% 50%, transparent 50%, rgba(0,0,0,0.35) 100%)',
                }} />

                {/* Video error/loading overlay */}
                {videoError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
                    <div className="text-center">
                      <p className="text-red-400 font-medium mb-2">⚠️ {videoError}</p>
                      <button onClick={() => { setVideoError(null); const v = refVideoRef.current; if (v) { v.load(); } }}
                        className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-500 transition-colors">
                        Retry
                      </button>
                    </div>
                  </div>
                )}

                {/* Ghost overlay: dims non-focused body part during describe sub-phases */}
                {teachDescribeActive && teachLabel === 'Arms' && (
                  <div className="absolute inset-0 z-20 pointer-events-none"
                    style={{ background: 'linear-gradient(to bottom, transparent 0%, transparent 45%, rgba(0,0,0,0.60) 100%)' }}
                  />
                )}
                {teachDescribeActive && teachLabel === 'Legs' && (
                  <div className="absolute inset-0 z-20 pointer-events-none"
                    style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.60) 0%, transparent 55%, transparent 100%)' }}
                  />
                )}

                {/* L / R labels (swap when video is mirrored) */}
                {!videoMirrored ? (
                  <div className="absolute bottom-0 left-0 right-0 flex justify-between z-30 pointer-events-none">
                    <span className="bg-black/50 text-white/70 text-xs font-bold px-2 py-0.5 m-1 rounded">R</span>
                    <span className="bg-black/50 text-white/70 text-xs font-bold px-2 py-0.5 m-1 rounded">L</span>
                  </div>
                ) : (
                  <div className="absolute bottom-0 left-0 right-0 flex justify-between z-30 pointer-events-none">
                    <span className="bg-black/50 text-white/70 text-xs font-bold px-2 py-0.5 m-1 rounded">L</span>
                    <span className="bg-black/50 text-white/70 text-xs font-bold px-2 py-0.5 m-1 rounded">R</span>
                  </div>
                )}

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
                    videoRef={refVideoRef as React.RefObject<HTMLVideoElement>}
                    videoSrc={videoSrc}
                    effectiveCounts={effectiveRangeCounts}
                    poseSlice={teachPoseSlice}
                    onEnd={handleChapterEnd}
                    onCountChange={setTeachCount}
                    onLabelChange={setTeachLabel}
                    onCountdownChange={setTeachCountdown}
                    onPausedChange={setTeachPaused}
                    onDescribePhase={setTeachDescribeActive}
                    onFreezePhase={setTeachFreezeActive}
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
                    totalSteps={teachBeats.length || 8}
                    onSeek={count => teachSeekRef.current?.(count)}
                  />
                )}

                {/* Beat count caption — muted beat chapters (not teach, not watch) */}
                {isPlaying && chapter?.muted && chapter?.type !== 'teach' && chapter?.type !== 'watch' && (
                  <CountCaption videoRef={refVideoRef as React.RefObject<HTMLVideoElement>} rangeCounts={effectiveRangeCounts} bpm={bpm} startTimeMs={chapter.startTimeMs} speakCounts />
                )}

                {/* Freeze check overlay — "Hold this pose" */}
                {chapter?.type === 'teach' && teachFreezeActive && (
                  <div className="absolute inset-0 z-30 pointer-events-none flex flex-col items-center justify-start pt-5">
                    <div className="px-5 py-2 rounded-xl"
                      style={{ background: 'rgba(0,0,0,0.62)', border: '1.5px solid rgba(139,92,246,0.55)', backdropFilter: 'blur(6px)' }}>
                      <span className="font-bold tracking-widest uppercase"
                        style={{ fontSize: '1.15rem', color: 'rgba(167,139,250,1)', textShadow: '0 2px 10px rgba(0,0,0,0.9)', letterSpacing: '0.12em' }}>
                        Hold this pose
                      </span>
                    </div>
                  </div>
                )}

                {/* Teach overlay — Steezy-style: massive centred count + frosted pills */}
                {chapter?.type === 'teach' && (teachCount !== null || teachLabel !== null || teachCountdown !== null) && (
                  <div className="absolute inset-0 z-20 pointer-events-none select-none flex flex-col items-center justify-center">
                    {/* Massive glowing count — centre-screen */}
                    {teachCount !== null && (
                      <span className="font-black tabular-nums leading-none transition-all duration-200 ease-out"
                        style={{
                          fontSize: '7rem',
                          color: 'rgba(255,255,255,0.95)',
                          textShadow: '0 0 40px rgba(139,92,246,0.5), 0 4px 20px rgba(0,0,0,0.9)',
                          filter: 'drop-shadow(0 0 12px rgba(139,92,246,0.6))',
                        }}>
                        {teachCount}
                      </span>
                    )}
                    {/* Frosted-glass label pill */}
                    {teachLabel !== null && (
                      <span className="mt-3 font-bold tracking-widest uppercase px-5 py-2 rounded-full backdrop-blur-xl border border-white/10 transition-all duration-300"
                        style={{
                          fontSize: '0.85rem',
                          color: 'rgba(255,255,255,0.9)',
                          background: 'rgba(0,0,0,0.45)',
                          boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
                        }}>
                        {teachLabel}
                      </span>
                    )}
                    {/* Punchy countdown — 2, 1, GO */}
                    {teachCountdown !== null && (
                      <span className="font-black tabular-nums leading-none mt-2 transition-all duration-150 ease-out"
                        style={{
                          fontSize: teachCountdown === 'go' ? '2.5rem' : '4.5rem',
                          color: teachCountdown === 'go' ? 'rgba(74,222,128,0.95)' : 'rgba(251,191,36,0.95)',
                          textShadow: '0 0 30px rgba(251,191,36,0.5), 0 4px 20px rgba(0,0,0,0.9)',
                          transform: teachCountdown === 'go' ? 'scale(1.15)' : 'scale(1)',
                        }}>
                        {typeof teachCountdown === 'string' ? teachCountdown.toUpperCase() : teachCountdown}
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
                <div className="flex-1 relative overflow-hidden flex flex-col items-center justify-center"
                  style={{ background: '#05040c' }}>

                  {/* Stage uplighting — violet footlight rising from below */}
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ background: 'radial-gradient(ellipse 70% 55% at 50% 108%, rgba(120, 55, 230, 0.22) 0%, rgba(75, 25, 155, 0.08) 52%, transparent 100%)' }} />

                  {/* Floor bloom */}
                  <div className="absolute bottom-0 left-0 right-0 pointer-events-none"
                    style={{ height: '38%', background: 'radial-gradient(ellipse 85% 45% at 50% 100%, rgba(100, 40, 200, 0.11) 0%, transparent 72%)' }} />

                  {/* Stickman */}
                  <TeachPoseAnimator
                    poseSlice={teachPoseSlice}
                    fromTime={teachAnimFromTime}
                    toTime={teachAnimToTime}
                    cueJointIdx={teachCueJointIdx}
                    highlightJoints={teachLabel === 'Arms' ? [11,12,13,14,15,16] : teachLabel === 'Legs' ? [23,24,25,26,27,28] : undefined}
                  />

                  {/* Count transition — frosted pill, top-center */}
                  <div className="absolute top-3 inset-x-0 flex justify-center pointer-events-none">
                    <div style={{
                      background: 'rgba(75, 28, 155, 0.32)',
                      border: '1px solid rgba(185, 130, 255, 0.28)',
                      backdropFilter: 'blur(10px)',
                      padding: '3px 16px',
                      borderRadius: '20px',
                    }}>
                      <span style={{ fontSize: '0.6rem', color: 'rgba(205, 170, 255, 0.92)', letterSpacing: '0.18em', fontWeight: 600, textTransform: 'uppercase' }}>
                        {teachCount !== null && teachCount > 1 ? `${teachCount - 1} → ${teachCount}` : `count ${teachCount ?? ''}`}
                      </span>
                    </div>
                  </div>

                  {/* Cue joint badge — frosted card, bottom-center */}
                  {teachCueJointName && (
                    <div className="absolute bottom-10 inset-x-0 flex justify-center pointer-events-none select-none">
                      <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px',
                        background: 'rgba(12, 6, 28, 0.84)',
                        border: '1px solid rgba(195, 115, 255, 0.36)',
                        backdropFilter: 'blur(14px)',
                        padding: '9px 24px',
                        borderRadius: '14px',
                      }}>
                        <span style={{ fontSize: '0.52rem', color: 'rgba(185, 105, 255, 0.80)', letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 600 }}>focus here</span>
                        <span style={{ fontSize: '0.82rem', color: 'rgba(245, 228, 255, 0.97)', fontWeight: 700, letterSpacing: '0.03em' }}>
                          {teachCueJointName.replace(/_/g, ' ')}
                        </span>
                        <div className="animate-pulse rounded-full"
                          style={{ width: '6px', height: '6px', background: 'rgba(218, 112, 255, 0.92)', boxShadow: '0 0 9px rgba(218, 112, 255, 0.82)' }} />
                      </div>
                    </div>
                  )}

                  {/* Beat dot strip — 8 dots, active one glows */}
                  <div className="absolute bottom-3 inset-x-0 flex justify-center gap-1.5 pointer-events-none">
                    {Array.from({ length: 8 }, (_, i) => {
                      const active = (teachCount ?? 0) === i + 1;
                      return (
                        <div key={i} style={{
                          width: active ? '8px' : '5px',
                          height: active ? '8px' : '5px',
                          borderRadius: '50%',
                          background: active ? 'rgba(210, 128, 255, 1)' : 'rgba(255, 255, 255, 0.14)',
                          boxShadow: active ? '0 0 10px rgba(200, 108, 255, 0.88)' : 'none',
                          transition: 'all 0.18s ease',
                        }} />
                      );
                    })}
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
              score={finalScore}
              jointScores={jointScores}
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
        <div className={`${mobileSidebarOpen ? 'fixed inset-y-0 right-0 z-50 bg-black/95 backdrop-blur-xl border-l border-white/10 w-[280px]' : 'hidden lg:block'} flex-[3] min-w-[220px] max-w-[320px]`}>
          {/* Close button for mobile overlay */}
          <button onClick={() => setMobileSidebarOpen(false)} className="lg:hidden absolute top-3 right-3 z-50 p-2 text-white/60 hover:text-white">
            <X className="w-5 h-5" />
          </button>
          <ChapterSidebar chapters={chapters} currentIdx={currentIdx} onSelect={idx => { setMobileSidebarOpen(false); setCurrentIdx(idx); }} routine={routine} />
        </div>
      </div>
    </div>
  );
}