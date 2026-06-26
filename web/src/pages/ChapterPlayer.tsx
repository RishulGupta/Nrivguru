import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, CameraOff, Cpu, Play, Loader2 } from 'lucide-react';
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

// ── Gemini cue generation for teach chapters ───────────────────────────────────

const GEMINI_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY ?? '';

async function fetchTeachCues(chunkDesc: string, counts: number[]): Promise<Record<number, string>> {
  if (!GEMINI_KEY || counts.length === 0) return {};
  const unique = [...new Set(counts)].slice(0, 8);
  const prompt = `You are a dance teacher. The dance move is called "${chunkDesc || 'this move'}".
Write a very short teaching cue (max 5 words) for each count below. Tell students what to do with their body.
Counts to cover: ${unique.join(', ')}.
Return ONLY valid JSON with count numbers as string keys: {"1":"step right foot","2":"swing arms up",...}`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { response_mime_type: 'application/json' } }) }
    );
    if (!res.ok) return {};
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch { return {}; }
}

// ── speakAndWait — promise-based TTS using Web Speech API ────────────────────

function speakAndWait(text: string, rate = 0.9): Promise<void> {
  return new Promise(resolve => {
    if (!window.speechSynthesis) { resolve(); return; }
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = rate;
    utt.onend = () => resolve();
    utt.onerror = () => resolve();
    // Chrome bug: speech stalls if tab is backgrounded; resolve after 4s fallback
    const fallback = setTimeout(resolve, 4000);
    utt.onend = () => { clearTimeout(fallback); resolve(); };
    utt.onerror = () => { clearTimeout(fallback); resolve(); };
    window.speechSynthesis.speak(utt);
  });
}

// ── TeachContent ───────────────────────────────────────────────────────────────
// Plays the reference video at 0.5× and pauses at each beat to narrate a cue.

function TeachContent({ chapter, videoRef, rangeCounts, chunkDesc, onEnd }: {
  chapter: Chapter;
  videoRef: React.RefObject<HTMLVideoElement>;
  rangeCounts?: BeatCount[];
  chunkDesc: string;
  onEnd: () => void;
}) {
  const [loadingCues, setLoadingCues] = useState(true);
  const [currentCount, setCurrentCount] = useState<number | null>(null);
  const [currentCue, setCurrentCue] = useState('');
  const cuesRef = useRef<Record<number, string>>({});
  const activeRef = useRef(true);

  // Fetch Gemini cues once on mount
  useEffect(() => {
    activeRef.current = true;
    const counts = rangeCounts?.map(rc => rc.count) ?? [];
    fetchTeachCues(chunkDesc, counts).then(c => {
      if (!activeRef.current) return;
      cuesRef.current = c;
      setLoadingCues(false);
    });
    return () => { activeRef.current = false; window.speechSynthesis?.cancel(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Once cues are ready, drive the beat-by-beat teach loop
  useEffect(() => {
    if (loadingCues) return;
    const v = videoRef.current;
    if (!v) { onEnd(); return; }

    // If no beat grid data, just play through and end
    const beats = rangeCounts && rangeCounts.length > 0 ? rangeCounts : null;
    if (!beats) {
      v.muted = true;
      v.playbackRate = 0.5;
      const onEnded = () => { if (activeRef.current) onEnd(); };
      v.addEventListener('ended', onEnded, { once: true });
      v.play().then(() => { v.playbackRate = 0.5; });
      return () => v.removeEventListener('ended', onEnded);
    }

    let beatIdx = 0;
    let running = true;

    const runLoop = async () => {
      // Seek to chapter start
      await new Promise<void>(resolve => {
        const target = chapter.startTimeMs / 1000;
        if (Math.abs(v.currentTime - target) < 0.05) { resolve(); return; }
        v.addEventListener('seeked', () => resolve(), { once: true });
        v.currentTime = target;
      });

      v.muted = true;
      v.playbackRate = 0.5;
      await v.play();

      while (running && beatIdx < beats.length) {
        const beat = beats[beatIdx];

        // Wait until video reaches this beat's timestamp
        await new Promise<void>(resolve => {
          const check = () => {
            if (!running) { resolve(); return; }
            if (v.currentTime >= beat.time - 0.04) { resolve(); return; }
            requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        });
        if (!running) break;

        v.pause();
        setCurrentCount(beat.count);
        const cue = cuesRef.current[beat.count] ?? '';
        setCurrentCue(cue);

        const text = cue ? `Count ${beat.count}. ${cue}.` : `Count ${beat.count}.`;
        await speakAndWait(text);
        if (!running) break;

        // Brief visual pause after speech
        await new Promise(r => setTimeout(r, 350));
        if (!running) break;

        beatIdx++;
        if (beatIdx < beats.length) {
          v.play().then(() => { v.playbackRate = 0.5; });
        }
      }

      if (running) {
        setCurrentCount(null);
        onEnd();
      }
    };

    runLoop();
    return () => { running = false; v.pause(); window.speechSynthesis?.cancel(); };
  }, [loadingCues]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="absolute inset-0 z-20 pointer-events-none flex flex-col items-center justify-end pb-28">
      {loadingCues ? (
        <div className="bg-black/70 backdrop-blur px-5 py-3 rounded-2xl flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
          <span className="text-white/50 text-sm">Preparing lesson…</span>
        </div>
      ) : currentCount !== null ? (
        <div className="bg-black/85 backdrop-blur-md px-8 py-5 rounded-2xl text-center space-y-1 animate-in slide-in-from-bottom-3 duration-200">
          <p className="text-white/35 text-[10px] uppercase tracking-widest">Count</p>
          <p className="text-white font-black tabular-nums" style={{ fontSize: '5rem', lineHeight: 1 }}>{currentCount}</p>
          {currentCue && (
            <p className="text-violet-300 text-sm font-semibold mt-1">{currentCue}</p>
          )}
        </div>
      ) : (
        <div className="bg-black/60 backdrop-blur px-5 py-2 rounded-xl">
          <p className="text-white/30 text-xs">Watch the movement</p>
        </div>
      )}
    </div>
  );
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

function CountCaption({ videoRef, rangeCounts, bpm, startTimeMs }: {
  videoRef: React.RefObject<HTMLVideoElement>;
  rangeCounts?: BeatCount[];
  bpm: number;
  startTimeMs: number;
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
    <div className="h-full flex flex-col bg-[#0a0a0f] border-l border-white/6 overflow-hidden">
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

  const [cameraMode, setCameraMode] = useState<CameraMode>('mirror');
  const [hasWebcam, setHasWebcam] = useState(false);

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

    // Warmup and Teach chapters don't use the generic video start logic here —
    // Teach is handled by TeachContent; Warmup has its own UI.
    if (ch.type === 'warmup' || ch.type === 'teach') return;

    const v = refVideoRef.current;
    if (!v) return;

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

    const play = () => { v.currentTime = 0; v.play().then(() => { v.playbackRate = 1; setIsPlaying(true); }); };

    if (loadedSrcRef.current !== videoSrc) {
      loadedSrcRef.current = videoSrc;
      v.src = videoSrc; v.load();
      v.addEventListener('loadedmetadata', play, { once: true });
    } else {
      play();
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

  // Chunk description for teach narration
  const teachChunkDesc = (() => {
    if (!chapter || chapter.type !== 'teach') return '';
    const idx = chapter.chunkIndices[0];
    if (idx === undefined) return '';
    return routine.chunks.find(c => c.chunk_index === idx)?.description || chapter.title;
  })();

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

          {/* Warmup */}
          {chapter?.type === 'warmup' && (
            <div className="h-full flex items-center justify-center bg-black">
              <div className="max-w-sm text-center space-y-6 px-6">
                <div className="text-5xl">🏋️</div>
                <h2 className="text-xl font-bold text-white">Warm Up</h2>
                <p className="text-white/45 text-sm leading-relaxed">Neck rolls, shoulder shrugs, hip circles, wrist rolls, and light marching in place.</p>
                <button onClick={handleNext} className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-2xl transition-all">
                  I'm warmed up → Let's go
                </button>
              </div>
            </div>
          )}

          {/* All video chapters */}
          {chapter?.type !== 'warmup' && (
            <div className="h-full flex bg-black">

              {/* Reference video — full width OR left half (when split) */}
              <div className={`relative bg-black overflow-hidden ${showSplit ? 'flex-1 border-r border-white/5' : 'flex-1'}`}>
                <video
                  ref={refVideoRef}
                  className="absolute inset-0 w-full h-full object-contain"
                  playsInline
                />

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

                {/* Teach overlay: beat-synced narration */}
                {chapter?.type === 'teach' && !showEoC && (
                  <TeachContent
                    key={chapter.id}
                    chapter={chapter}
                    videoRef={refVideoRef}
                    rangeCounts={rangeCounts}
                    chunkDesc={teachChunkDesc}
                    onEnd={handleChapterEnd}
                  />
                )}

                {/* Beat count caption — muted beat chapters (not teach, not watch) */}
                {isPlaying && chapter?.muted && chapter?.type !== 'teach' && chapter?.type !== 'watch' && (
                  <CountCaption videoRef={refVideoRef} rangeCounts={rangeCounts} bpm={bpm} startTimeMs={chapter.startTimeMs} />
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
