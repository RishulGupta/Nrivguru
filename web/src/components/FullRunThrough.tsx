import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Play, Pause, SlidersHorizontal, ChevronDown } from 'lucide-react';
import type { PoseFrame } from '@taal/shared/types/pose';
import type { FinalScore, JointScore } from '@taal/shared/types/routine';

// ── FullRunThrough ─────────────────────────────────────────────────────────────
// Step 9 of the 11-step class model: full run-through, slow first then full speed.
//
// Key spec requirements implemented here:
//   • Hands-free auto-loop — lead-in "5 6 7 8" before each repeat.
//   • Two stages: SLOW (½×, muted, counts) → FULL (1×, with music).
//     Change applies on next loop start, never mid-loop.
//   • Correction badge surfaces at most 2 weakest spots per rep, not a
//     running list — mirrors "teacher doesn't correct everything at once".
//   • No connect-mode boundary weighting — the whole piece is the scoring unit.

export interface FullRunThroughProps {
  videoSrc:     string;
  startTimeMs:  number;
  endTimeMs:    number;
  bpm?:         number;
  rangeCounts?: { count: number; time: number }[];
  referencePoses?: PoseFrame[];
  poseDetection?: {
    isWorkerReady: boolean;
    jointScores:   JointScore[];
    loadReference: (poses: PoseFrame[]) => void;
    processFrame:  (video: HTMLVideoElement, timeMs: number, focus: string) => void;
    finishAttempt: () => Promise<FinalScore>;
    webcamRef:     React.RefObject<HTMLVideoElement>;
  };
  onClose: () => void;
}

type RunStage  = 'slow' | 'full';
type LoopPhase = 'lead_in' | 'playing' | 'paused';

const MAX_WEAK_SPOTS = 2;

const JOINT_FIX: Record<string, string> = {
  left_shoulder:  'Left shoulder — lift it higher',
  right_shoulder: 'Right shoulder — lift it higher',
  left_elbow:     'Left elbow — extend it more',
  right_elbow:    'Right elbow — extend it more',
  left_wrist:     'Lead with your left wrist',
  right_wrist:    'Lead with your right wrist',
  left_hip:       'Open your left hip more',
  right_hip:      'Open your right hip more',
  left_knee:      'Bend your left knee more',
  right_knee:     'Bend your right knee more',
};

// ── Lead-in audio — identical to DrillLoop ────────────────────────────────────

function playLeadIn(
  audioCtx: AudioContext, beatMs: number,
  onCount: (n: number | null) => void, onDone: () => void,
): () => void {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const counts = [5, 6, 7, 8];
  const beatSec = beatMs / 1000;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;

  counts.forEach((c, i) => {
    const t    = audioCtx.currentTime + i * beatSec;
    const freq = i === 0 ? 880 : 660;
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.15);
    timers.push(setTimeout(() => { if (!cancelled) onCount(c); }, i * beatMs));
  });

  timers.push(setTimeout(() => {
    if (!cancelled) { onCount(null); onDone(); }
  }, counts.length * beatMs + 80));

  return () => { cancelled = true; timers.forEach(clearTimeout); onCount(null); };
}

// ── RepBadge — at most MAX_WEAK_SPOTS after each rep ─────────────────────────

function RepBadge({ spots, repCount }: { spots: string[]; repCount: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!spots.length) { setVisible(false); return; }
    const t = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(t);
  }, [spots, repCount]);

  if (!spots.length) return null;
  return (
    <div className={`absolute top-20 left-4 z-20 max-w-[66%] pointer-events-none transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <div className="bg-amber-500/12 border border-amber-400/25 backdrop-blur-md px-3 py-2.5 rounded-xl space-y-1.5">
        <p className="text-amber-400/60 text-[9px] uppercase tracking-widest">Focus here</p>
        {spots.map((s, i) => (
          <p key={i} className="text-white/85 text-[11px] font-semibold leading-snug">{i + 1}. {s}</p>
        ))}
      </div>
    </div>
  );
}

// ── Settings panel ────────────────────────────────────────────────────────────

function SettingsPanel({ pendingStage, onStageChange, onClose }: {
  pendingStage: RunStage; onStageChange: (s: RunStage) => void; onClose: () => void;
}) {
  const STAGES: { id: RunStage; emoji: string; label: string; sub: string }[] = [
    { id: 'slow', emoji: '🐢', label: 'Slow run', sub: '½× · no music · counts on' },
    { id: 'full', emoji: '🔥', label: 'Full run', sub: '1× · with music' },
  ];
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end" onClick={onClose}>
      <div className="bg-[#0f0f14] border-t border-white/10 rounded-t-3xl p-6 space-y-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-base">Next loop settings</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors"><ChevronDown className="w-5 h-5" /></button>
        </div>
        <div className="space-y-2">
          {STAGES.map(s => (
            <button key={s.id} onClick={() => onStageChange(s.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                pendingStage === s.id ? 'bg-violet-500/20 border-violet-500/50 text-white' : 'bg-white/5 border-white/8 text-white/50 hover:border-white/20'
              }`}>
              <span className="text-xl">{s.emoji}</span>
              <div>
                <p className="text-sm font-semibold">{s.label}</p>
                <p className="text-[10px] text-white/30 mt-0.5">{s.sub}</p>
              </div>
              {pendingStage === s.id && <span className="ml-auto text-violet-400 text-xs">✓</span>}
            </button>
          ))}
        </div>
        <p className="text-white/25 text-xs text-center">Changes apply at start of next loop</p>
        <button onClick={onClose} className="w-full py-3 bg-white/8 hover:bg-white/15 text-white/70 font-semibold rounded-xl transition-all">Done</button>
      </div>
    </div>
  );
}

// ── FullRunThrough ─────────────────────────────────────────────────────────────

export function FullRunThrough({
  videoSrc, startTimeMs, endTimeMs, bpm = 120, rangeCounts,
  referencePoses, poseDetection, onClose,
}: FullRunThroughProps) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const cleanupLeadIn = useRef<(() => void) | null>(null);
  const loadedSrcRef  = useRef('');
  const poseRef       = useRef(poseDetection);

  const [loopPhase, setLoopPhase_]    = useState<LoopPhase>('lead_in');
  const [activeStage, setActiveStage] = useState<RunStage>('slow');
  const [pendingStage, setPendingStage] = useState<RunStage>('slow');
  const [leadInCount, setLeadInCount]   = useState<number | null>(null);
  const [loopCount, setLoopCount]       = useState(0);
  const [progress, setProgress]         = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [weakSpots, setWeakSpots]       = useState<string[]>([]);
  const [displayCount, setDisplayCount] = useState<number | null>(null);

  const jointAccRef     = useRef<Record<string, { sum: number; count: number }>>({});
  const loopPhaseRef    = useRef<LoopPhase>('lead_in');
  const pendingStageRef = useRef<RunStage>('slow');
  const activeStageRef  = useRef<RunStage>('slow');
  const lastCountRef    = useRef<number | null>(null);

  useEffect(() => { poseRef.current = poseDetection; }, [poseDetection]);

  const setLoopPhase = useCallback((p: LoopPhase) => {
    loopPhaseRef.current = p;
    setLoopPhase_(p);
  }, []);

  const beatDurationMs = (60 / bpm) * 1000;
  const durationMs     = endTimeMs - startTimeMs;

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new AudioContext(); } catch { /* no audio */ }
    }
    return audioCtxRef.current;
  }, []);

  // ── Progress bar ────────────────────────────────────────────────────────────

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTU = () => {
      if (durationMs > 0) setProgress(Math.min(1, Math.max(0, (v.currentTime * 1000 - startTimeMs) / durationMs)));
    };
    v.addEventListener('timeupdate', onTU);
    return () => v.removeEventListener('timeupdate', onTU);
  }, [startTimeMs, durationMs]);

  // ── End-of-range detector ───────────────────────────────────────────────────

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTU = () => {
      if (loopPhaseRef.current !== 'playing') return;
      if (v.currentTime * 1000 >= endTimeMs) {
        v.pause();
        const pd = poseRef.current;
        if (pd) {
          const sorted = Object.entries(jointAccRef.current)
            .map(([name, { sum, count }]) => ({ name, avg: sum / count }))
            .filter(j => j.avg < 70 && JOINT_FIX[j.name])
            .sort((a, b) => a.avg - b.avg)
            .slice(0, MAX_WEAK_SPOTS)
            .map(j => JOINT_FIX[j.name]);
          setWeakSpots(sorted);
          pd.finishAttempt().catch(() => {});
          jointAccRef.current = {};
        }
        setLoopPhase('lead_in');
      }
    };
    v.addEventListener('timeupdate', onTU);
    return () => v.removeEventListener('timeupdate', onTU);
  }, [endTimeMs, setLoopPhase]);

  // ── Lead-in ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (loopPhase !== 'lead_in') return;
    activeStageRef.current = pendingStageRef.current;
    setActiveStage(activeStageRef.current);
    const ctx = getAudioCtx();
    if (ctx) {
      cleanupLeadIn.current = playLeadIn(ctx, beatDurationMs, setLeadInCount, () => {
        setLoopCount(n => n + 1);
        setLoopPhase('playing');
      });
    } else {
      const t = setTimeout(() => { setLoopCount(n => n + 1); setLoopPhase('playing'); }, 800);
      cleanupLeadIn.current = () => clearTimeout(t);
    }
    return () => { cleanupLeadIn.current?.(); cleanupLeadIn.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopPhase]);

  // ── Playing ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (loopPhase !== 'playing') return;
    const v = videoRef.current;
    if (!v) return;
    const isSlow = activeStageRef.current === 'slow';
    v.muted        = isSlow;
    v.playbackRate = isSlow ? 0.5 : 1;
    const startSec = startTimeMs / 1000;
    const doSeekAndPlay = () => {
      v.playbackRate = isSlow ? 0.5 : 1;
      if (Math.abs(v.currentTime - startSec) < 0.05) {
        if (loopPhaseRef.current === 'playing') v.play().catch(() => {});
        return;
      }
      const onSeeked = () => {
        v.removeEventListener('seeked', onSeeked);
        if (loopPhaseRef.current === 'playing') v.play().catch(() => {});
      };
      v.addEventListener('seeked', onSeeked);
      v.currentTime = startSec;
    };
    if (loadedSrcRef.current !== videoSrc) {
      loadedSrcRef.current = videoSrc;
      v.src = videoSrc; v.load();
      v.addEventListener('loadedmetadata', doSeekAndPlay, { once: true });
      return () => v.removeEventListener('loadedmetadata', doSeekAndPlay);
    } else {
      doSeekAndPlay();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopPhase]);

  // ── Pose ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (referencePoses?.length && poseDetection) poseDetection.loadReference(referencePoses);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referencePoses]);

  useEffect(() => {
    if (loopPhase !== 'playing' || !poseDetection?.isWorkerReady) return;
    jointAccRef.current = {};
    let animId: number;
    const loop = () => {
      const w = poseRef.current?.webcamRef.current;
      const v = videoRef.current;
      if (w && v && w.readyState >= 2) {
        const tMs = v.currentTime * 1000;
        poseRef.current!.processFrame(w, tMs, 'arms');
        for (const j of (poseRef.current?.jointScores ?? [])) {
          if (!JOINT_FIX[j.name]) continue;
          const acc = jointAccRef.current[j.name] ?? { sum: 0, count: 0 };
          acc.sum += j.score; acc.count += 1;
          jointAccRef.current[j.name] = acc;
        }
      }
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopPhase, poseDetection?.isWorkerReady]);

  // ── Count caption rAF ────────────────────────────────────────────────────────

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let animId: number;
    const tick = () => {
      const t = v.currentTime;
      let count: number | null = null;
      if (rangeCounts && rangeCounts.length > 0) {
        let found: { count: number; time: number } | null = null;
        for (const c of rangeCounts) { if (c.time <= t + 0.05) found = c; else break; }
        count = found?.count ?? null;
      } else {
        const elapsed = t - startTimeMs / 1000;
        if (elapsed >= 0) count = (Math.floor(elapsed / (60 / bpm)) % 8) + 1;
      }
      if (count !== null && count !== lastCountRef.current) {
        lastCountRef.current = count;
        setDisplayCount(count);
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeCounts, bpm, startTimeMs]);

  // ── Pause / resume ──────────────────────────────────────────────────────────

  const handlePauseResume = useCallback(() => {
    if (loopPhaseRef.current === 'paused') {
      setLoopPhase('lead_in');
    } else {
      cleanupLeadIn.current?.(); cleanupLeadIn.current = null;
      videoRef.current?.pause();
      setLeadInCount(null);
      setLoopPhase('paused');
    }
  }, [setLoopPhase]);

  const handleStageChange = useCallback((s: RunStage) => {
    pendingStageRef.current = s;
    setPendingStage(s);
  }, []);

  useEffect(() => () => { cleanupLeadIn.current?.(); videoRef.current?.pause(); }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  const isSlow   = activeStage === 'slow';
  const isLeadIn = loopPhase === 'lead_in';
  const isPaused = loopPhase === 'paused';

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col overflow-hidden">

      <video ref={videoRef} className="absolute inset-0 w-full h-full object-contain" playsInline muted={isSlow} />

      {poseDetection && <RepBadge spots={weakSpots} repCount={loopCount} />}

      {/* Count caption — slow stage only */}
      {loopPhase === 'playing' && isSlow && displayCount !== null && (
        <div className="absolute bottom-28 inset-x-0 flex items-center justify-center pointer-events-none z-10">
          <span className="font-black tabular-nums leading-none select-none"
            style={{ fontSize: '5rem', color: 'rgba(255,255,255,0.92)', textShadow: '0 0 12px rgba(0,0,0,0.9),0 2px 4px rgba(0,0,0,0.8)' }}>
            {displayCount}
          </span>
        </div>
      )}

      {/* Lead-in */}
      {isLeadIn && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="flex items-end gap-4">
            {[5, 6, 7, 8].map(n => (
              <span key={n} className={`font-black tabular-nums transition-all duration-75 select-none ${
                leadInCount === n ? 'text-white text-8xl drop-shadow-[0_0_24px_rgba(255,255,255,0.9)]'
                  : leadInCount !== null && n < leadInCount ? 'text-white/20 text-5xl' : 'text-white/10 text-5xl'
              }`}>{n}</span>
            ))}
          </div>
        </div>
      )}

      {isPaused && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-white/10 backdrop-blur-md rounded-full w-20 h-20 flex items-center justify-center">
            <Pause className="w-8 h-8 text-white" />
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="relative z-20 flex items-center justify-between px-4 pt-10 pb-2">
        <button onClick={onClose} className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/10">
          <X className="w-5 h-5" />
        </button>
        <div className="bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
          <span className="text-white/70 text-xs font-semibold">{isSlow ? '🐢 Slow run' : '🔥 Full run'}</span>
          <span className="text-violet-400/70 text-[10px] font-bold">FULL RUN</span>
          {loopCount > 0 && <span className="text-white/30 text-xs">· #{loopCount}</span>}
        </div>
        <button onClick={() => setShowSettings(s => !s)} className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/10">
          <SlidersHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="relative z-20 px-4 mt-1">
        <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
          {loopPhase === 'playing' && <div className="h-full bg-violet-400 rounded-full transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />}
          {isLeadIn && <div className="h-full bg-white/30 rounded-full w-full animate-pulse" />}
        </div>
      </div>

      {/* Bottom controls */}
      <div className="relative z-20 mt-auto pb-10 px-4 flex flex-col items-center gap-3">
        <p className="text-white/30 text-xs tracking-widest uppercase">
          {isPaused ? 'Paused — tap to resume' : isLeadIn ? 'Get ready…' : isSlow ? '½× · counts on' : '1× · full music'}
        </p>
        <button onClick={handlePauseResume} className="w-16 h-16 rounded-full bg-white/12 hover:bg-white/20 border border-white/15 flex items-center justify-center transition-all active:scale-95">
          {isPaused ? <Play className="w-7 h-7 text-white ml-1" /> : <Pause className="w-7 h-7 text-white" />}
        </button>
      </div>

      {showSettings && <SettingsPanel pendingStage={pendingStage} onStageChange={handleStageChange} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
