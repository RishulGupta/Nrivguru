import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Pause, Play, SlidersHorizontal, ChevronDown } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DrillStage = 'slow_marked' | 'counts_speedup' | 'music';

export interface BeatRange {
  startCount:  number;
  endCount:    number;
  startTimeMs: number;
  endTimeMs:   number;
}

export interface RangeCount { count: number; time: number; }

interface DrillLoopProps {
  videoSrc:     string;
  beatRange:    BeatRange;
  bpm?:         number;         // from beat_grid_json; defaults to 120
  rangeCounts?: RangeCount[];   // beat timestamps + count numbers for caption
  onClose:      () => void;
}

// ── CountCaption ──────────────────────────────────────────────────────────────
// Displays the current beat count (1-8) synced to beat timestamps via rAF.

function CountCaption({
  videoRef, rangeCounts, bpm, beatRange,
}: {
  videoRef:    React.RefObject<HTMLVideoElement>;
  rangeCounts: RangeCount[] | undefined;
  bpm:         number;
  beatRange:   BeatRange;
}) {
  const [displayCount, setDisplayCount] = useState<number | null>(null);
  const [flash, setFlash]               = useState(false);
  const lastCountRef  = useRef<number | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let animId: number;

    const tick = () => {
      const t = v.currentTime;
      let count: number | null = null;

      if (rangeCounts && rangeCounts.length > 0) {
        // Last beat whose timestamp is at or just before current time
        let found: RangeCount | null = null;
        for (const c of rangeCounts) {
          if (c.time <= t + 0.05) found = c;
          else break;
        }
        count = found?.count ?? null;
      } else {
        // BPM fallback when no timestamps available
        const elapsed = t - beatRange.startTimeMs / 1000;
        if (elapsed >= 0) count = (Math.floor(elapsed / (60 / bpm)) % 8) + 1;
      }

      if (count !== null && count !== lastCountRef.current) {
        lastCountRef.current = count;
        setDisplayCount(count);
        setFlash(true);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setFlash(false), 120);
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(animId);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, [videoRef, rangeCounts, bpm, beatRange.startTimeMs]);

  if (displayCount === null) return null;

  return (
    <div className="absolute bottom-28 inset-x-0 flex justify-center pointer-events-none z-10">
      <span
        className={`font-black tabular-nums leading-none select-none transition-transform duration-75 ${flash ? 'scale-125' : 'scale-100'}`}
        style={{
          fontSize: '5rem',
          color: 'rgba(255,255,255,0.92)',
          textShadow: '0 0 12px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.8)',
          display: 'block',
          willChange: 'transform',
        }}
      >
        {displayCount}
      </span>
    </div>
  );
}

type LoopPhase = 'lead_in' | 'playing' | 'paused';

// ── Stage config ──────────────────────────────────────────────────────────────

const STAGES: {
  id:           DrillStage;
  label:        string;
  emoji:        string;
  defaultSpeed: number;
  muted:        boolean;
}[] = [
  { id: 'slow_marked',    label: 'Slow · No music',  emoji: '🐢', defaultSpeed: 0.5,  muted: true  },
  { id: 'counts_speedup', label: 'Building speed',   emoji: '⏫', defaultSpeed: 0.75, muted: true  },
  { id: 'music',          label: 'With music',       emoji: '🎵', defaultSpeed: 1.0,  muted: false },
];

const SPEEDS = [0.5, 0.75, 1.0];
const SPEED_LABEL: Record<number, string> = { 0.5: '½×', 0.75: '¾×', 1.0: '1×' };

// ── Lead-in audio ─────────────────────────────────────────────────────────────
// Plays 4 oscillator tones ("5 6 7 8") before each loop repeat.

function playLeadInTones(
  audioCtx: AudioContext,
  beatDurationMs: number,
  onCountUpdate: (n: number | null) => void,
  onDone: () => void,
): () => void {
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const counts = [5, 6, 7, 8];
  const beatSec = beatDurationMs / 1000;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;

  counts.forEach((count, i) => {
    const t    = audioCtx.currentTime + i * beatSec;
    const freq = i === 0 ? 880 : 660; // accent on "5"

    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.15);

    timers.push(setTimeout(() => {
      if (!cancelled) onCountUpdate(count);
    }, i * beatDurationMs));
  });

  timers.push(setTimeout(() => {
    if (!cancelled) { onCountUpdate(null); onDone(); }
  }, counts.length * beatDurationMs + 80));

  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
    onCountUpdate(null);
  };
}

// ── Settings panel ────────────────────────────────────────────────────────────

function SettingsPanel({
  currentStage, currentSpeed, pendingStage, pendingSpeed,
  onStageChange, onSpeedChange, onClose,
}: {
  currentStage:  DrillStage;
  currentSpeed:  number;
  pendingStage:  DrillStage;
  pendingSpeed:  number;
  onStageChange: (s: DrillStage) => void;
  onSpeedChange: (sp: number) => void;
  onClose:       () => void;
}) {
  const changed = pendingStage !== currentStage || pendingSpeed !== currentSpeed;

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end" onClick={onClose}>
      <div
        className="bg-[#0f0f14] border-t border-white/10 rounded-t-3xl p-6 space-y-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-base">Next loop settings</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <ChevronDown className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-white/40 text-[10px] uppercase tracking-widest">Stage</p>
          <div className="flex flex-col gap-2">
            {STAGES.map(s => (
              <button
                key={s.id}
                onClick={() => onStageChange(s.id)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                  pendingStage === s.id
                    ? 'bg-violet-500/20 border-violet-500/50 text-white'
                    : 'bg-white/5 border-white/8 text-white/50 hover:border-white/20'
                }`}
              >
                <span className="text-lg">{s.emoji}</span>
                <span className="text-sm font-semibold">{s.label}</span>
                {pendingStage === s.id && <span className="ml-auto text-violet-400 text-xs">✓</span>}
              </button>
            ))}
          </div>
        </div>

        {pendingStage !== 'music' && (
          <div className="space-y-2">
            <p className="text-white/40 text-[10px] uppercase tracking-widest">Speed</p>
            <div className="flex gap-2">
              {SPEEDS.map(sp => (
                <button
                  key={sp}
                  onClick={() => onSpeedChange(sp)}
                  className={`flex-1 py-2.5 rounded-xl border text-sm font-bold transition-all ${
                    pendingSpeed === sp
                      ? 'bg-violet-500/20 border-violet-500/50 text-white'
                      : 'bg-white/5 border-white/8 text-white/40 hover:border-white/20'
                  }`}
                >
                  {SPEED_LABEL[sp]}
                </button>
              ))}
            </div>
          </div>
        )}

        {changed && (
          <p className="text-white/30 text-xs text-center">
            Changes apply at the start of the next loop
          </p>
        )}

        <button
          onClick={onClose}
          className="w-full py-3 bg-white/8 hover:bg-white/15 text-white/70 font-semibold rounded-xl transition-all"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ── DrillLoop ─────────────────────────────────────────────────────────────────

export function DrillLoop({ videoSrc, beatRange, bpm = 120, rangeCounts, onClose }: DrillLoopProps) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const cleanupLeadIn = useRef<(() => void) | null>(null);
  const loadedSrcRef  = useRef('');

  // Display state
  const [loopPhase, setLoopPhase_]      = useState<LoopPhase>('lead_in');
  const [activeStage, setActiveStage]   = useState<DrillStage>('slow_marked');
  const [activeSpeed, setActiveSpeed]   = useState(0.5);
  const [leadInCount, setLeadInCount]   = useState<number | null>(null);
  const [loopCount, setLoopCount]       = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);

  // Pending config (queued until next lead-in)
  const [pendingStage, setPendingStage] = useState<DrillStage>('slow_marked');
  const [pendingSpeed, setPendingSpeed] = useState(0.5);

  // Refs for stable closures (avoid stale values in timeupdate handlers)
  const loopPhaseRef    = useRef<LoopPhase>('lead_in');
  const pendingStageRef = useRef<DrillStage>('slow_marked');
  const pendingSpeedRef = useRef(0.5);
  const activeConfigRef = useRef<{ stage: DrillStage; speed: number }>({ stage: 'slow_marked', speed: 0.5 });

  const setLoopPhase = useCallback((p: LoopPhase) => {
    loopPhaseRef.current = p;
    setLoopPhase_(p);
  }, []);

  const beatDurationMs = (60 / bpm) * 1000;

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new AudioContext(); } catch { /* no audio */ }
    }
    return audioCtxRef.current;
  }, []);

  // ── Video progress ──────────────────────────────────────────────────────────

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const span = beatRange.endTimeMs - beatRange.startTimeMs;
    const onTU = () => {
      if (span <= 0) return;
      setVideoProgress(Math.min(1, Math.max(0, (v.currentTime * 1000 - beatRange.startTimeMs) / span)));
    };
    v.addEventListener('timeupdate', onTU);
    return () => v.removeEventListener('timeupdate', onTU);
  }, [beatRange]);

  // ── End-of-chunk detector ───────────────────────────────────────────────────

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTU = () => {
      if (loopPhaseRef.current !== 'playing') return;
      if (v.currentTime * 1000 >= beatRange.endTimeMs) {
        v.pause();
        setLoopPhase('lead_in');
      }
    };
    v.addEventListener('timeupdate', onTU);
    return () => v.removeEventListener('timeupdate', onTU);
  }, [beatRange.endTimeMs, setLoopPhase]);

  // ── Lead-in phase ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (loopPhase !== 'lead_in') return;

    // Snapshot pending config into active config for this loop
    activeConfigRef.current = { stage: pendingStageRef.current, speed: pendingSpeedRef.current };
    setActiveStage(activeConfigRef.current.stage);
    setActiveSpeed(activeConfigRef.current.speed);

    const ctx = getAudioCtx();
    if (ctx) {
      cleanupLeadIn.current = playLeadInTones(ctx, beatDurationMs, setLeadInCount, () => {
        setLoopCount(n => n + 1);
        setLoopPhase('playing');
      });
    } else {
      const t = setTimeout(() => {
        setLoopCount(n => n + 1);
        setLoopPhase('playing');
      }, 800);
      cleanupLeadIn.current = () => clearTimeout(t);
    }

    return () => { cleanupLeadIn.current?.(); cleanupLeadIn.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopPhase]);

  // ── Playing phase — seek + play ─────────────────────────────────────────────

  useEffect(() => {
    if (loopPhase !== 'playing') return;
    const v = videoRef.current;
    if (!v) return;

    const { stage, speed } = activeConfigRef.current;
    v.muted        = stage !== 'music';
    v.playbackRate = speed;

    const startSec = beatRange.startTimeMs / 1000;

    const doSeekAndPlay = () => {
      v.playbackRate = speed;
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
      v.src = videoSrc;
      v.load();
      v.addEventListener('loadedmetadata', doSeekAndPlay, { once: true });
      return () => v.removeEventListener('loadedmetadata', doSeekAndPlay);
    } else {
      doSeekAndPlay();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopPhase]);

  // ── Pause / resume ──────────────────────────────────────────────────────────

  const handlePauseResume = useCallback(() => {
    if (loopPhaseRef.current === 'paused') {
      setLoopPhase('lead_in');
    } else {
      cleanupLeadIn.current?.();
      cleanupLeadIn.current = null;
      videoRef.current?.pause();
      setLeadInCount(null);
      setLoopPhase('paused');
    }
  }, [setLoopPhase]);

  // ── Settings ────────────────────────────────────────────────────────────────

  const handleStageChange = useCallback((s: DrillStage) => {
    pendingStageRef.current = s;
    setPendingStage(s);
    const def = STAGES.find(st => st.id === s)?.defaultSpeed ?? 0.5;
    pendingSpeedRef.current = def;
    setPendingSpeed(def);
  }, []);

  const handleSpeedChange = useCallback((sp: number) => {
    pendingSpeedRef.current = sp;
    setPendingSpeed(sp);
  }, []);

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cleanupLeadIn.current?.();
      videoRef.current?.pause();
    };
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  const stageInfo = STAGES.find(s => s.id === activeStage) ?? STAGES[0];
  const isLeadIn  = loopPhase === 'lead_in';
  const isPaused  = loopPhase === 'paused';

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col overflow-hidden">

      {/* Video — fills screen */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        playsInline
        muted={activeStage !== 'music'}
      />

      {/* Beat count caption — visible during playing phase only */}
      {loopPhase === 'playing' && (
        <CountCaption
          videoRef={videoRef}
          rangeCounts={rangeCounts}
          bpm={bpm}
          beatRange={beatRange}
        />
      )}

      {/* Lead-in count display */}
      {isLeadIn && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="flex items-end gap-4">
            {[5, 6, 7, 8].map(n => (
              <span
                key={n}
                className={`font-black tabular-nums transition-all duration-75 select-none ${
                  leadInCount === n
                    ? 'text-white text-8xl drop-shadow-[0_0_24px_rgba(255,255,255,0.9)]'
                    : leadInCount !== null && n < leadInCount
                    ? 'text-white/20 text-5xl'
                    : 'text-white/10 text-5xl'
                }`}
              >
                {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Paused overlay */}
      {isPaused && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-white/10 backdrop-blur-md rounded-full w-20 h-20 flex items-center justify-center">
            <Pause className="w-8 h-8 text-white" />
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="relative z-20 flex items-center justify-between px-4 pt-10 pb-2">
        <button
          onClick={onClose}
          className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
          <span>{stageInfo.emoji}</span>
          <span className="text-white/70 text-xs font-semibold">{stageInfo.label}</span>
          {loopCount > 0 && <span className="text-white/30 text-xs">· #{loopCount}</span>}
        </div>

        <button
          onClick={() => setShowSettings(s => !s)}
          className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/10"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* Loop / lead-in progress bar */}
      <div className="relative z-20 px-4 mt-1">
        <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
          {loopPhase === 'playing' && (
            <div
              className="h-full bg-violet-400 rounded-full transition-[width] duration-300"
              style={{ width: `${videoProgress * 100}%` }}
            />
          )}
          {isLeadIn && (
            <div className="h-full bg-white/30 rounded-full w-full animate-pulse" />
          )}
        </div>
      </div>

      {/* Bottom controls */}
      <div className="relative z-20 mt-auto pb-10 px-4 flex flex-col items-center gap-3">
        <p className="text-white/30 text-xs tracking-widest uppercase">
          {isPaused ? 'Paused — tap to resume' : isLeadIn ? 'Get ready…' : `${SPEED_LABEL[activeSpeed]} · Counts ${beatRange.startCount}–${beatRange.endCount}`}
        </p>

        <button
          onClick={handlePauseResume}
          className="w-16 h-16 rounded-full bg-white/12 hover:bg-white/20 border border-white/15 flex items-center justify-center transition-all active:scale-95"
        >
          {isPaused
            ? <Play className="w-7 h-7 text-white ml-1" />
            : <Pause className="w-7 h-7 text-white" />}
        </button>
      </div>

      {/* Settings sheet */}
      {showSettings && (
        <SettingsPanel
          currentStage={activeStage}
          currentSpeed={activeSpeed}
          pendingStage={pendingStage}
          pendingSpeed={pendingSpeed}
          onStageChange={handleStageChange}
          onSpeedChange={handleSpeedChange}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
