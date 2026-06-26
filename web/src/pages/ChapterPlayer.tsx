import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, CameraOff, Cpu, Play } from 'lucide-react';
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
  instructor?: string;
  style_tag?: string;
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
  muted: boolean;
  emoji: string;
  showSplit: boolean; // reference + webcam side-by-side (when camera on)
}

// ── Chapter generation ─────────────────────────────────────────────────────────
// Implements the exact sequencing from the spec.

function generateChapters(chunks: DbChunk[], durationMs: number, hasAudio: boolean): Chapter[] {
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

    // 4–6. Practice beats at three speeds
    chapters.push({ id: `prac-${i}-slow`, type: 'practice', title: `Practice ${num} · Slow`, chunkIndices: [i], startTimeMs: s, endTimeMs: e, playbackRate: 0.5, muted: true, emoji: '🐢', showSplit: true });
    chapters.push({ id: `prac-${i}-med`, type: 'practice', title: `Practice ${num} · Building`, chunkIndices: [i], startTimeMs: s, endTimeMs: e, playbackRate: 0.75, muted: true, emoji: '⏫', showSplit: true });
    chapters.push({ id: `prac-${i}-full`, type: 'practice', title: `Practice ${num} · Full speed`, chunkIndices: [i], startTimeMs: s, endTimeMs: e, playbackRate: 1.0, muted: true, emoji: '🎯', showSplit: true });

    if (hasAudio) {
      // 7–8. Practice with music
      chapters.push({ id: `prac-${i}-slow-music`, type: 'practice', title: `Practice ${num} · Slow + music`, chunkIndices: [i], startTimeMs: s, endTimeMs: e, playbackRate: 0.75, muted: false, emoji: '🎵', showSplit: true });
      chapters.push({ id: `prac-${i}-music`, type: 'practice', title: `Practice ${num} · With music`, chunkIndices: [i], startTimeMs: s, endTimeMs: e, playbackRate: 1.0, muted: false, emoji: '🎶', showSplit: true });
    }

    // Connect window (starts at chunk index 1, i.e. second chunk)
    if (i >= 1) {
      const winStart = Math.max(0, i - 2); // sliding window: last 3 chunks
      const winChunks = chunks.slice(winStart, i + 1);
      const winLabel = winChunks.map((_, j) => winStart + j + 1).join('+');
      const winIndices = winChunks.map((_, j) => winStart + j);

      // 9. Connect — normal-speed beats
      chapters.push({ id: `connect-${i}`, type: 'connect', title: `Connect ${winLabel} · Full speed`, chunkIndices: winIndices, startTimeMs: chunks[winStart].start_time_ms, endTimeMs: ch.end_time_ms, playbackRate: 1.0, muted: true, emoji: '🔗', showSplit: true });

      if (hasAudio) {
        // 10. Connect — music
        chapters.push({ id: `connect-${i}-music`, type: 'connect', title: `Connect ${winLabel} · With music`, chunkIndices: winIndices, startTimeMs: chunks[winStart].start_time_ms, endTimeMs: ch.end_time_ms, playbackRate: 1.0, muted: false, emoji: '🔗🎵', showSplit: true });
      }
    }
  }

  // 11–14. Full routine practice after last chunk
  chapters.push({ id: 'full-slow', type: 'full_routine', title: 'Full Routine · Slow', chunkIndices: allIdx, startTimeMs: 0, endTimeMs: durationMs, playbackRate: 0.5, muted: true, emoji: '🌟', showSplit: true });
  chapters.push({ id: 'full-full', type: 'full_routine', title: 'Full Routine · Full speed', chunkIndices: allIdx, startTimeMs: 0, endTimeMs: durationMs, playbackRate: 1.0, muted: true, emoji: '⭐', showSplit: true });

  if (hasAudio) {
    chapters.push({ id: 'full-slow-music', type: 'full_routine', title: 'Full Routine · Slow + music', chunkIndices: allIdx, startTimeMs: 0, endTimeMs: durationMs, playbackRate: 0.75, muted: false, emoji: '🌟🎵', showSplit: true });
    chapters.push({ id: 'full-music', type: 'full_routine', title: 'Full Routine · With music', chunkIndices: allIdx, startTimeMs: 0, endTimeMs: durationMs, playbackRate: 1.0, muted: false, emoji: '🏆', showSplit: true });
  }

  return chapters;
}

// ── Lead-in beeps (5-6-7-8) ───────────────────────────────────────────────────

function playLeadIn(
  ctx: AudioContext,
  beatMs: number,
  onCount: (n: number | null) => void,
  onDone: () => void,
): () => void {
  if (ctx.state === 'suspended') ctx.resume();
  const counts = [5, 6, 7, 8];
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;

  counts.forEach((c, i) => {
    const t = ctx.currentTime + i * (beatMs / 1000);
    const freq = i === 0 ? 880 : 660;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.12);
    timers.push(setTimeout(() => { if (!cancelled) onCount(c); }, i * beatMs));
  });

  timers.push(setTimeout(() => {
    if (!cancelled) { onCount(null); onDone(); }
  }, counts.length * beatMs + 60));

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
    const v = videoRef.current;
    if (!v) return;
    let animId: number;

    const tick = () => {
      const t = v.currentTime;
      let c: number | null = null;

      if (rangeCounts && rangeCounts.length > 0) {
        let found: BeatCount | null = null;
        for (const rc of rangeCounts) {
          if (rc.time <= t + 0.05) found = rc;
          else break;
        }
        c = found?.count ?? null;
      } else if (bpm > 0) {
        const elapsed = t - startTimeMs / 1000;
        if (elapsed >= 0) c = (Math.floor(elapsed / (60 / bpm)) % 8) + 1;
      }

      if (c !== null && c !== lastRef.current) {
        lastRef.current = c;
        setCount(c);
        setFlash(true);
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
      <span
        className={`font-black tabular-nums leading-none select-none transition-transform duration-75 ${flash ? 'scale-125' : 'scale-100'}`}
        style={{ fontSize: '5rem', color: 'rgba(255,255,255,0.9)', textShadow: '0 0 12px rgba(0,0,0,0.9)', display: 'block', willChange: 'transform' }}
      >
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

  useEffect(() => {
    if (cd <= 0) { onRetry(); return; }
    const t = setTimeout(() => setCd(c => c - 1), 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cd]);

  const radius = 28;
  const circ = 2 * Math.PI * radius;
  const dash = circ * (cd / 5);

  return (
    <div className="absolute inset-0 z-50 bg-black/92 backdrop-blur-sm flex items-center justify-center p-8">
      <div className="max-w-xs w-full space-y-5">

        {/* Circular countdown */}
        <div className="flex flex-col items-center gap-2">
          <svg width="68" height="68" className="-rotate-90">
            <circle cx="34" cy="34" r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4" />
            <circle
              cx="34" cy="34" r={radius} fill="none"
              stroke="rgba(139,92,246,0.75)" strokeWidth="4"
              strokeDasharray={`${dash} ${circ}`}
              strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 1s linear' }}
            />
            <text
              x="34" y="34" textAnchor="middle" dominantBaseline="central"
              fill="white" fontSize="17" fontWeight="bold"
              style={{ transform: 'rotate(90deg)', transformOrigin: '34px 34px' }}
            >
              {cd}
            </text>
          </svg>
          <p className="text-white/35 text-xs text-center leading-snug">
            No input → replays this chapter automatically
          </p>
        </div>

        {/* Camera setting for next chapter */}
        <div className="bg-white/4 border border-white/8 rounded-xl p-3 space-y-2">
          <p className="text-white/25 text-[10px] uppercase tracking-widest">Camera for next chapter</p>
          <div className="flex gap-1.5">
            {([
              { v: 'off' as CameraMode, label: 'Off', icon: <CameraOff className="w-3 h-3" /> },
              { v: 'mirror' as CameraMode, label: 'Mirror', icon: <Camera className="w-3 h-3" /> },
              { v: 'ai' as CameraMode, label: 'AI On', icon: <Cpu className="w-3 h-3" /> },
            ]).map(opt => (
              <button
                key={opt.v}
                onClick={() => onCameraModeChange(opt.v)}
                className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] font-semibold border transition-all ${
                  cameraMode === opt.v
                    ? 'bg-violet-500/25 border-violet-500/50 text-violet-200'
                    : 'bg-white/4 border-white/8 text-white/35 hover:border-white/20'
                }`}
              >
                {opt.icon}{opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2.5">
          <button
            onClick={onRetry}
            className="w-full py-3.5 bg-white/10 hover:bg-white/16 text-white font-bold rounded-2xl transition-all"
          >
            🔄 Retry chapter
          </button>
          {nextTitle && (
            <button
              onClick={onNext}
              className="w-full py-3.5 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-2xl transition-all shadow-[0_0_18px_rgba(139,92,246,0.35)]"
            >
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
  chapters: Chapter[];
  currentIdx: number;
  onSelect: (idx: number) => void;
  routine: DbRoutine;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentIdx]);

  const thumbnail = routine.thumbnail_url || routine.thumbnail || '';

  const fmtMs = (ms: number) => {
    if (!ms) return '';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60 > 0 ? `${s % 60}s` : ''}`.trim();
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f] border-l border-white/6 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/6 shrink-0">
        <p className="text-white/35 text-[10px] uppercase tracking-widest">Chapters · {chapters.length}</p>
        <p className="text-white/65 text-xs mt-0.5 font-medium truncate">{routine.title}</p>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}>
        {chapters.map((ch, idx) => {
          const isActive = idx === currentIdx;
          const durMs = ch.endTimeMs > ch.startTimeMs ? ch.endTimeMs - ch.startTimeMs : 0;

          return (
            <button
              key={ch.id}
              ref={isActive ? activeRef : null}
              onClick={() => onSelect(idx)}
              className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-all border-b border-white/4 hover:bg-white/4 ${
                isActive
                  ? 'bg-violet-600/15 border-l-[3px] border-l-violet-500'
                  : 'border-l-[3px] border-l-transparent'
              }`}
            >
              {/* Thumbnail */}
              <div className="shrink-0 w-[72px] h-10 rounded-md overflow-hidden bg-white/5 relative">
                {thumbnail && (
                  <img src={thumbnail} alt="" className="w-full h-full object-cover opacity-60" />
                )}
                <div className={`absolute inset-0 flex items-center justify-center ${isActive ? 'bg-violet-500/30' : ''}`}>
                  {isActive
                    ? <Play className="w-3.5 h-3.5 text-violet-300 fill-current" />
                    : <span className="text-sm">{ch.emoji}</span>
                  }
                </div>
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <p className={`text-[11px] font-semibold leading-tight ${isActive ? 'text-violet-200' : 'text-white/65'}`}>
                  {ch.title}
                </p>
                <p className="text-[10px] text-white/25 mt-0.5">
                  {idx + 1}{durMs > 0 ? ` · ${fmtMs(durMs)}` : ''}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Failure counter (instrumentation only — no isolation UI per spec) ──────────

const failureCounts: Record<string, number> = {};
function trackFailure(chapterId: string) {
  failureCounts[chapterId] = (failureCounts[chapterId] ?? 0) + 1;
  if (failureCounts[chapterId] >= 3) {
    console.info('[ChapterPlayer] isolation-candidate:', chapterId, 'failures:', failureCounts[chapterId]);
  }
}

// ── Joint label map ───────────────────────────────────────────────────────────

const JOINT_IDX: Record<string, number> = {
  left_shoulder: 11, right_shoulder: 12, left_elbow: 13, right_elbow: 14,
  left_wrist: 15,   right_wrist: 16,   left_hip: 23,   right_hip: 24,
  left_knee: 25,    right_knee: 26,    left_ankle: 27, right_ankle: 28,
};

// ── ChapterPlayer ─────────────────────────────────────────────────────────────

export default function ChapterPlayer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const session = useAuthStore(s => s.session);

  // ── Data ──
  const [routine, setRoutine] = useState<DbRoutine | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasAudio, setHasAudio] = useState(true);
  const [chapters, setChapters] = useState<Chapter[]>([]);

  // ── Chapter state ──
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showEoC, setShowEoC] = useState(false);
  const [isLeadIn, setIsLeadIn] = useState(false);
  const [leadInCount, setLeadInCount] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // ── Camera ──
  const [cameraMode, setCameraMode] = useState<CameraMode>('mirror');
  const [hasWebcam, setHasWebcam] = useState(false);

  // ── Scoring ──
  const [finalScore, setFinalScore] = useState<FinalScore | null>(null);
  const [worstJoint, setWorstJoint] = useState<JointScore | null>(null);
  const mistakeFrames = useRef<{ dataUrl: string; refMs: number }[]>([]);

  // ── Refs ──
  const refVideoRef = useRef<HTMLVideoElement>(null);
  const webcamRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const leadInCancelRef = useRef<(() => void) | null>(null);
  const videoCleanupRef = useRef<(() => void) | null>(null);
  const loadedSrcRef = useRef('');
  const isMountedRef = useRef(true);

  // ── Pose detection ──
  const { isWorkerReady, userPose, jointScores, currentArmScore, loadReference, processFrame, finishAttempt } = usePoseDetection();

  // ── Derived ──
  const chapter = chapters[currentIdx] ?? null;
  const nextChapter = chapters[currentIdx + 1] ?? null;
  const beatGrid = routine?.beat_grid_json ?? null;
  const bpm = beatGrid?.bpm ?? 120;

  const videoSrc = useMemo(() =>
    getOriginalVideoUrl() || routine?.video_blob_url || '',
  [routine]);

  const rangeCounts = useMemo(() => {
    if (!beatGrid || !chapter || !chapter.startTimeMs) return undefined;
    const s = chapter.startTimeMs / 1000 - 0.05;
    const e = chapter.endTimeMs / 1000 + 0.05;
    return beatGrid.counts.filter(c => c.time >= s && c.time <= e);
  }, [beatGrid, chapter]);

  const showSplit = !!(chapter?.showSplit && cameraMode !== 'off' && hasWebcam);

  // ── Load routine ──
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
        const audio = !!(data.beat_grid_json?.bpm);
        setHasAudio(audio);
        const sorted = [...(data.chunks ?? [])].sort((a, b) => a.chunk_index - b.chunk_index);
        setChapters(generateChapters(sorted, (data.duration_seconds ?? 0) * 1000, audio));
      }
      setLoading(false);
    }
    load();
    return () => { isMountedRef.current = false; };
  }, [id, session]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load reference poses when chapter changes to a chunk-based one
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

  // ── Camera setup ──
  const setupCamera = useCallback(async () => {
    if (cameraMode === 'off') {
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
      if (webcamRef.current) webcamRef.current.srcObject = null;
      setHasWebcam(false);
      return;
    }
    try {
      if (!cameraStreamRef.current) {
        cameraStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
      }
      const v = webcamRef.current;
      if (v) { v.srcObject = cameraStreamRef.current; await v.play(); setHasWebcam(true); }
    } catch { setHasWebcam(false); }
  }, [cameraMode]);

  useEffect(() => { setupCamera(); }, [setupCamera]);

  // ── AudioContext ──
  const getCtx = useCallback((): AudioContext | null => {
    if (!audioCtxRef.current) try { audioCtxRef.current = new AudioContext(); } catch { return null; }
    return audioCtxRef.current;
  }, []);

  // ── Start a chapter ──
  const startChapter = useCallback((ch: Chapter) => {
    if (!ch) return;

    // Reset state
    setShowEoC(false);
    setIsPlaying(false);
    setIsLeadIn(false);
    setLeadInCount(null);
    setFinalScore(null);
    setWorstJoint(null);
    mistakeFrames.current = [];

    if (leadInCancelRef.current) { leadInCancelRef.current(); leadInCancelRef.current = null; }
    if (videoCleanupRef.current) { videoCleanupRef.current(); videoCleanupRef.current = null; }

    // Warmup has no video
    if (ch.type === 'warmup') return;

    const v = refVideoRef.current;
    if (!v) return;

    v.muted = ch.muted;

    // When video reaches the chapter end → trigger EoC
    const onTimeUpdate = () => {
      if (!ch.endTimeMs || v.currentTime * 1000 < ch.endTimeMs) return;
      v.pause();
      setIsPlaying(false);

      if (cameraMode === 'ai' && isWorkerReady) {
        finishAttempt().then(score => {
          if (!isMountedRef.current) return;
          setFinalScore(score);
          const worst = [...jointScores].filter(j => j.type === 'arm').sort((a, b) => a.score - b.score)[0] ?? null;
          setWorstJoint(worst);
          if (score.armScore < 50) trackFailure(ch.id);
        });
      }
      setShowEoC(true);
    };

    v.addEventListener('timeupdate', onTimeUpdate);
    videoCleanupRef.current = () => v.removeEventListener('timeupdate', onTimeUpdate);

    const doPlay = () => {
      v.playbackRate = ch.playbackRate;
      const needsLeadIn = ch.showSplit && ch.type !== 'watch' && ch.type !== 'teach';
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
      const targetSec = ch.startTimeMs / 1000;
      if (Math.abs(v.currentTime - targetSec) < 0.05) { doPlay(); return; }
      const onSeeked = () => { v.removeEventListener('seeked', onSeeked); doPlay(); };
      v.addEventListener('seeked', onSeeked);
      v.currentTime = targetSec;
    };

    if (loadedSrcRef.current !== videoSrc && videoSrc) {
      loadedSrcRef.current = videoSrc;
      v.src = videoSrc;
      v.load();
      v.addEventListener('loadedmetadata', seekAndPlay, { once: true });
    } else if (videoSrc) {
      seekAndPlay();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSrc, bpm, cameraMode, isWorkerReady, jointScores, getCtx]);

  // Start chapter when index changes or chapters first load
  useEffect(() => {
    if (chapters.length && chapter) startChapter(chapter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, chapters]);

  // ── Pose processing loop ──
  useEffect(() => {
    if (!isPlaying || cameraMode !== 'ai' || !isWorkerReady || !hasWebcam) return;
    let animId: number;
    const loop = () => {
      const w = webcamRef.current;
      const rv = refVideoRef.current;
      if (w && rv && w.readyState >= 2 && !rv.paused) {
        processFrame(w, rv.currentTime * 1000, 'all');
        // Capture a snapshot on low score (at most 5 per chapter)
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

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      videoCleanupRef.current?.();
      leadInCancelRef.current?.();
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // ── Navigation handlers ──
  const handleRetry = useCallback(() => { if (chapter) startChapter(chapter); }, [chapter, startChapter]);

  const handleNext = useCallback(() => {
    if (currentIdx < chapters.length - 1) setCurrentIdx(i => i + 1);
    else navigate(`/routine/${id}`);
  }, [currentIdx, chapters.length, navigate, id]);

  // ── Render ──
  if (loading) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!routine || !chapters.length) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-white/40">Routine not found</p>
          <button onClick={() => navigate(-1)} className="text-violet-400 text-sm underline">Go back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-black flex flex-col overflow-hidden">

      {/* ── Top bar ── */}
      <header className="shrink-0 h-11 flex items-center gap-3 px-3 bg-[#09090e] border-b border-white/6 z-30">
        <button onClick={() => navigate(`/routine/${id}`)} className="shrink-0 w-7 h-7 flex items-center justify-center text-white/40 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>

        <p className="flex-1 min-w-0 text-white/55 text-xs font-medium truncate">
          {chapter?.emoji} {chapter?.title}
        </p>

        <span className="shrink-0 text-white/20 text-xs">
          {currentIdx + 1}/{chapters.length}
        </span>

        {!hasAudio && (
          <span className="shrink-0 text-amber-400/60 text-[10px] border border-amber-400/20 px-2 py-0.5 rounded-md">
            Count-only
          </span>
        )}

        {/* Camera cycle button: Off → Mirror → AI On → Off */}
        <button
          onClick={() => setCameraMode(m => m === 'off' ? 'mirror' : m === 'mirror' ? 'ai' : 'off')}
          title={cameraMode === 'off' ? 'Camera off' : cameraMode === 'mirror' ? 'Mirror (AI off)' : 'AI scoring on'}
          className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
            cameraMode === 'ai'
              ? 'bg-violet-500/25 border-violet-500/45 text-violet-200'
              : cameraMode === 'mirror'
              ? 'bg-white/7 border-white/12 text-white/50'
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

          {/* Warmup chapter */}
          {chapter?.type === 'warmup' && (
            <div className="h-full flex items-center justify-center bg-black">
              <div className="max-w-sm text-center space-y-6 px-6">
                <div className="text-5xl">🏋️</div>
                <h2 className="text-xl font-bold text-white">Warm Up</h2>
                <p className="text-white/45 text-sm leading-relaxed">
                  Spend a few minutes warming up: neck rolls, shoulder shrugs, hip circles, wrist rolls, and light marching.
                </p>
                <button
                  onClick={handleNext}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-2xl transition-all"
                >
                  I'm warmed up → Let's go
                </button>
              </div>
            </div>
          )}

          {/* Video-based chapters */}
          {chapter?.type !== 'warmup' && (
            <div className="h-full flex bg-black">

              {/* Reference video — full width or left half */}
              <div className={`relative bg-black overflow-hidden ${showSplit ? 'flex-1 border-r border-white/5' : 'flex-1'}`}>
                <video
                  ref={refVideoRef}
                  className="absolute inset-0 w-full h-full object-contain"
                  playsInline
                  muted={chapter?.muted ?? true}
                />

                {/* Lead-in overlay */}
                {isLeadIn && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/65 pointer-events-none">
                    <p className="text-white/35 text-xs uppercase tracking-widest mb-6">Get ready</p>
                    <span
                      className="font-black tabular-nums leading-none animate-in zoom-in duration-100"
                      style={{ fontSize: '8rem', color: 'white', textShadow: '0 0 24px rgba(255,255,255,0.35)' }}
                    >
                      {leadInCount ?? '…'}
                    </span>
                  </div>
                )}

                {/* Beat count caption — only for muted (beat-only) non-teach/watch chapters */}
                {isPlaying && chapter?.muted && chapter?.type !== 'teach' && (
                  <CountCaption
                    videoRef={refVideoRef}
                    rangeCounts={rangeCounts}
                    bpm={bpm}
                    startTimeMs={chapter.startTimeMs}
                  />
                )}

                {/* Chapter badge */}
                {chapter && (
                  <div className="absolute top-3 left-3 z-10 bg-black/50 text-white/40 text-[10px] px-2 py-1 rounded-md pointer-events-none">
                    {chapter.type === 'teach' ? 'TEACH ½×' : `${chapter.emoji} ${chapter.playbackRate < 1 ? `${chapter.playbackRate === 0.5 ? '½×' : '¾×'}` : '1×'}`}
                  </div>
                )}

                {/* Correction badge (AI mode, appears after first rep) */}
                {cameraMode === 'ai' && worstJoint && isPlaying && (
                  <div className="absolute top-16 left-3 z-10 max-w-[55%] pointer-events-none">
                    <div className="bg-amber-500/10 border border-amber-400/22 backdrop-blur-md px-3 py-2 rounded-xl">
                      <p className="text-amber-400/55 text-[9px] uppercase tracking-widest mb-0.5">Fix this</p>
                      <p className="text-white/85 text-[11px] font-semibold leading-snug">
                        {worstJoint.name.replace(/_/g, ' ')} — {Math.round(worstJoint.score)}%
                      </p>
                    </div>
                  </div>
                )}

                {/* Reference label */}
                {showSplit && (
                  <div className="absolute top-2 right-2 z-10 bg-black/35 text-white/20 text-[10px] px-2 py-0.5 rounded-md pointer-events-none">
                    Reference
                  </div>
                )}
              </div>

              {/* Webcam — right half, only in split mode */}
              {showSplit && (
                <div className="flex-1 relative bg-black overflow-hidden">
                  <video
                    ref={webcamRef}
                    className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
                    playsInline
                    muted
                  />

                  <div className="absolute top-2 left-2 z-10 bg-black/35 text-white/20 text-[10px] px-2 py-0.5 rounded-md pointer-events-none">
                    You
                  </div>

                  {/* AI skeleton */}
                  {cameraMode === 'ai' && userPose && (
                    <div className="absolute inset-0 pointer-events-none">
                      <StickmanCanvas
                        landmarks={userPose}
                        mode="upper_body"
                        smooth
                        width={640}
                        height={480}
                        jointScores={
                          jointScores.length > 0
                            ? Object.fromEntries(jointScores.map(j => [JOINT_IDX[j.name] ?? j.name, j.score])) as any
                            : undefined
                        }
                      />
                    </div>
                  )}

                  {/* Mirror label */}
                  {cameraMode === 'mirror' && (
                    <div className="absolute bottom-3 inset-x-0 flex justify-center pointer-events-none">
                      <span className="text-white/18 text-[10px] bg-black/30 px-3 py-1 rounded-full">Mirror · AI off</span>
                    </div>
                  )}
                </div>
              )}
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

          {/* Mistake snapshot strip — shown during EoC when AI is on */}
          {showEoC && cameraMode === 'ai' && mistakeFrames.current.length > 0 && (
            <div className="absolute bottom-36 left-4 right-4 z-[60] flex gap-2 overflow-x-auto pb-1">
              <p className="shrink-0 text-white/25 text-[10px] self-center pr-1">Snapshots:</p>
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
          <ChapterSidebar
            chapters={chapters}
            currentIdx={currentIdx}
            onSelect={idx => setCurrentIdx(idx)}
            routine={routine}
          />
        </div>
      </div>
    </div>
  );
}
