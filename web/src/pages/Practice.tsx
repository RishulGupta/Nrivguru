import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Loader2, Camera, SkipForward, SkipBack, ChevronLeft, ChevronRight } from 'lucide-react';
import SkeletonCanvas from '../components/SkeletonCanvas';
import { PreparationTimer } from '../components/PreparationTimer';
import { DrillLoop, type BeatRange } from '../components/DrillLoop';

// ── ResultsOverlay ─────────────────────────────────────────────────────────────
// Unified results screen — replaces both Phase Complete overlay and ImprovementPhase.
// Shows celebration → score → one specific arm fix → two action buttons.
const JOINT_LABEL: Record<string, string> = {
  left_shoulder: 'left shoulder', right_shoulder: 'right shoulder',
  left_elbow: 'left elbow',       right_elbow: 'right elbow',
  left_wrist: 'left wrist',       right_wrist: 'right wrist',
};
const JOINT_FIX: Record<string, string> = {
  left_shoulder:  'Raise your left shoulder higher',
  right_shoulder: 'Raise your right shoulder higher',
  left_elbow:     'Straighten your left arm a bit more',
  right_elbow:    'Straighten your right arm a bit more',
  left_wrist:     'Lead with your left wrist',
  right_wrist:    'Lead with your right wrist',
};

function ResultsOverlay({ score, prevScore, jointScores, phase, onRetry, onNext, isLastChunk, referencePoses, capturedUserPoses }: {
  score: FinalScore;
  prevScore: number | null;
  jointScores: JointScore[];
  phase: string;
  onRetry: () => void;
  onNext: () => void;
  isLastChunk: boolean;
  referencePoses: import('@taal/shared/types/pose').PoseFrame[];
  capturedUserPoses: import('@taal/shared/types/pose').PoseLandmark[][];
}) {
  const pct   = Math.round(score.armScore);
  const delta = prevScore !== null ? Math.round(score.overallScore - prevScore) : null;
  const great = pct >= 80;
  const ok    = pct >= 55;

  const worstArmJoint = jointScores
    .filter(j => j.type === 'arm' && j.score >= 0 && JOINT_LABEL[j.name])
    .sort((a, b) => a.score - b.score)[0];

  // Animate pose sequences in the 2×2 grid
  const refFrames  = referencePoses.length > 0 ? referencePoses.map(f => f.landmarks) : null;
  const userFrames = capturedUserPoses.length > 0 ? capturedUserPoses : null;
  const refPose  = usePoseReplay(refFrames, 5, true);
  const userPose = usePoseReplay(userFrames, 5, true);

  return (
    <div className="fixed inset-0 z-40 bg-black flex flex-col p-4 gap-3 animate-in fade-in duration-300 overflow-hidden">

      {/* Score header */}
      <div className="flex items-center justify-between shrink-0 pt-8 px-2">
        <div>
          <p className="text-white/40 text-xs uppercase tracking-widest">Your score</p>
          <div className={`text-5xl font-bold tabular-nums ${great ? 'text-green-400' : ok ? 'text-violet-400' : 'text-white'}`}>
            {pct}<span className="text-2xl font-normal text-white/30">%</span>
          </div>
          {delta !== null && (
            <p className={`text-xs font-semibold mt-0.5 ${delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-white/30'}`}>
              {delta > 0 ? `+${delta}` : delta} from last try
            </p>
          )}
        </div>
        <div className="text-5xl">{great ? '🔥' : ok ? '💪' : '🌱'}</div>
      </div>

      {/* 2×2 stickman comparison grid */}
      <div className="grid grid-cols-2 grid-rows-2 gap-2 flex-1 min-h-0">
        {/* [0,0] Reference stickman */}
        <div className="relative rounded-2xl overflow-hidden bg-[#0a0a12] border border-white/8">
          {refPose ? (
            <StickmanCanvas landmarks={refPose} mode="upper_body" smooth={false} width={300} height={200} color="rgba(167,139,250,0.9)" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center"><p className="text-white/20 text-xs">No reference</p></div>
          )}
          <span className="absolute top-2 left-2 text-[9px] text-violet-300/60 bg-black/50 px-1.5 py-0.5 rounded">Dancer</span>
        </div>

        {/* [0,1] User stickman */}
        <div className="relative rounded-2xl overflow-hidden bg-[#0a120a] border border-white/8">
          {userPose ? (
            <StickmanCanvas landmarks={userPose} mode="upper_body" smooth={false} width={300} height={200}
              jointScores={jointScores.length > 0
                ? Object.fromEntries(jointScores.map(j => [JOINT_NAME_TO_IDX[j.name] ?? j.name, j.score])) as any
                : undefined}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center"><p className="text-white/20 text-xs">No data</p></div>
          )}
          <span className="absolute top-2 left-2 text-[9px] text-emerald-300/60 bg-black/50 px-1.5 py-0.5 rounded">You</span>
        </div>

        {/* [1,0] Fix tip */}
        <div className="rounded-2xl bg-violet-500/8 border border-violet-500/20 flex flex-col justify-center p-4">
          {!great && worstArmJoint ? (
            <>
              <p className="text-violet-300/50 text-[9px] uppercase tracking-widest mb-1">Fix this</p>
              <p className="text-white font-semibold text-sm leading-tight">
                {JOINT_FIX[worstArmJoint.name] ?? `Work on your ${JOINT_LABEL[worstArmJoint.name]}`}
              </p>
            </>
          ) : (
            <>
              <p className="text-green-400/60 text-[9px] uppercase tracking-widest mb-1">Looking great</p>
              <p className="text-white font-semibold text-sm">Arms are on point 🎯</p>
            </>
          )}
          {score.weakerSide && (
            <p className="text-amber-300/60 text-[10px] mt-2">{score.weakerSide} side needs more focus</p>
          )}
        </div>

        {/* [1,1] Actions */}
        <div className="flex flex-col gap-2 justify-center">
          <button onClick={onRetry} className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-3.5 rounded-2xl transition-all text-sm">
            🔄 Try again
          </button>
          <button onClick={onNext} className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-3.5 rounded-2xl transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)] text-sm">
            {isLastChunk && (phase === 'combine' || phase === 'full') ? '✅ Finish' : '➡️ Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Inline micro-components — too small to deserve their own files
// ponytail: no separate file for 10-line components
function AmbientScore({ armScore }: { armScore: number }) {
  const color = armScore > 75 ? '#4ade80' : armScore > 50 ? '#fbbf24' : '#f87171';
  const glow  = armScore > 75 ? '#4ade8066' : armScore > 50 ? '#fbbf2466' : '#f8717166';
  return (
    <div
      className="w-5 h-5 rounded-full transition-colors duration-700"
      style={{ backgroundColor: color, boxShadow: `0 0 12px 4px ${glow}` }}
    />
  );
}

function ChunkProgressBar({
  startMs, endMs, videoRef,
}: { startMs: number; endMs: number; videoRef: React.RefObject<HTMLVideoElement> }) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || endMs <= startMs) return;
    const tick = () => {
      const p = Math.min(1, Math.max(0, (v.currentTime * 1000 - startMs) / (endMs - startMs)));
      setPct(p * 100);
    };
    v.addEventListener('timeupdate', tick);
    return () => v.removeEventListener('timeupdate', tick);
  }, [startMs, endMs, videoRef]);
  return (
    <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/10 z-30">
      <div
        className="h-full bg-violet-400 transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useStore';
import type { Chunk, Routine, FinalScore, JointScore } from '@taal/shared/types/routine';
import type { PoseFrame } from '@taal/shared/types/pose';
import { usePracticeSession } from '../hooks/usePracticeSession';
import type { FocusArea } from '@taal/shared/utils/CorrectionEngine';
import { CorrectionEngine } from '@taal/shared/utils/CorrectionEngine';
import { usePoseDetection } from '../hooks/usePoseDetection';
import { speechManager } from '@taal/shared/utils/SpeechManager';
import { countingSystem } from '@taal/shared/utils/CountingSystem';
import { TeachPhase } from '../components/TeachPhase';
import { StickmanCanvas, usePoseReplay } from '../components/StickmanCanvas';
import { PracticeModeSelector } from '../components/PracticeModeSelector';
import { extractKeyframes } from '@taal/shared/utils/KeyframeExtractor';
import { BeatIndicator } from '../components/BeatIndicator';
import { TeacherPersonality } from '@taal/shared/utils/TeacherPersonality';
import { sessionMemory } from '@taal/shared/utils/SessionMemory';
import { DifficultyScaler } from '@taal/shared/utils/DifficultyScaler';
import { getStyleConfig } from '@taal/shared/utils/StyleConfig';
import { getOriginalVideoUrl } from '../utils/videoStore';

// ponytail: vertex joint index for each scored joint name — fixes name→index mismatch
const JOINT_NAME_TO_IDX: Record<string, number> = {
  left_shoulder: 11, right_shoulder: 12,
  left_elbow: 13,    right_elbow: 14,
  left_wrist: 15,    right_wrist: 16,
  left_hip: 23,      right_hip: 24,
  left_knee: 25,     right_knee: 26,
  left_ankle: 27,    right_ankle: 28,
};

export default function Practice() {
  const { id, chunkId } = useParams();
  const navigate = useNavigate();
  const session = useAuthStore(s => s.session);

  const webcamRef          = useRef<HTMLVideoElement>(null); // persistent, always in DOM
  const practiceWebcamRef  = useRef<HTMLVideoElement>(null); // split-screen right panel
  const refVideoRef        = useRef<HTMLVideoElement>(null);
  const cameraStreamRef    = useRef<MediaStream | null>(null);
  const loadedVideoSrcRef  = useRef(''); // tracks which src is currently loaded in refVideoRef — avoids redundant load() calls that reset currentTime

  const [hasWebcam, setHasWebcam] = useState(false);
  const [webcamError, setWebcamError] = useState('');
  const [isMirrorMode, setIsMirrorMode] = useState(true);

  // ── Data ──
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [_allChunks, setAllChunks] = useState<Chunk[]>([]);
  const [chunk, setChunk] = useState<Chunk | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  // ── Chunk loop ──
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);

  // If SegmentPhases passed a mode via location state, skip the selector entirely
  const locationState = (useLocation().state as any) ?? {};
  const [showModeSelector, setShowModeSelector] = useState(
    !locationState?.skipModeSelector
  );

  // ── Announcement screen (blank + countdown before video and tutorial) ──
  // 'video' = "Watching video now", 'tutorial' = "Tutorial now", null = normal
  const [announcement, setAnnouncement] = useState<'video' | 'tutorial' | null>(null);
  const [announceCd, setAnnounceCd]     = useState(3); // countdown value

  // ── State machine ──
  const {
    phase,
    attemptCount: _attemptCount,
    isSeatedMode,
    mode,
    playbackRate,
    focusArea,
    isPreparation,
    isPractice,
    phaseLabel,
    send: sendSessionEvent
  } = usePracticeSession();

  // ── Pose detection ──
  const {
    isWorkerReady,
    userPose,
    jointScores,
    currentArmScore,
    currentLegScore,
    pendingAdjustment,
    lowVisibility,
    loadReference,
    processFrame,
    finishAttempt,
    captureReferenceFrame
  } = usePoseDetection();

  const [finalScore, setFinalScore] = useState<FinalScore | null>(null);
  const [attemptComplete, setAttemptComplete] = useState(false);
  const [referencePoses, setReferencePoses] = useState<PoseFrame[]>([]);
  const [keyframes, setKeyframes] = useState<PoseFrame[]>([]);
  const [showWatchOverlay, setShowWatchOverlay] = useState(false);
  const [refVideoPlaying, setRefVideoPlaying] = useState(false);
  // Capture user pose frames during practice for 2×2 results replay
  const capturedUserPosesRef = useRef<import('@taal/shared/types/pose').PoseLandmark[][]>([]);
  const captureFrameCounterRef = useRef(0);

  // ── Modules ──
  const difficultyScaler = useRef(new DifficultyScaler()).current;
  const teacherPersonality = useRef(new TeacherPersonality()).current;
  const correctionEngine = useRef<CorrectionEngine | null>(null);
  const [proprioQuestion, setProprioQuestion] = useState<string | null>(null);
  const [visibleWarning, setVisibleWarning] = useState(false);
  const [savedScores, setSavedScores] = useState<number[]>([]);

  const lastBreathingCueIndex = useRef(-1);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Style config for scoring weights ──
  const styleConfig = useMemo(() => {
    return routine?.style_tag ? getStyleConfig(routine.style_tag) : getStyleConfig('general');
  }, [routine]);

  // Apply style config + personality to correction engine
  useEffect(() => {
    // The correction engine lives in the worker, but we configure it at init
    // We also keep a local instance for the UI layer
    const ce = new CorrectionEngine();
    try {
      ce.setConfig(styleConfig, teacherPersonality.getProfile());
    } catch {}
    correctionEngine.current = ce;
  }, [styleConfig]);

  // ── Sync camera stream to split-screen video element when entering practice ──
  useEffect(() => {
    if (!isPractice) return;
    const v = practiceWebcamRef.current;
    const stream = cameraStreamRef.current;
    if (v && stream) {
      v.srcObject = stream;
      v.play().catch(() => {});
    }
  }, [isPractice]);

  // ── Pre-move audio ticks (fires 500ms before each velocity onset in reference) ──
  const onsetTimesRef = useRef<number[]>([]);
  const firedOnsetsRef = useRef(new Set<number>());

  // Compute onsets when reference poses load
  useEffect(() => {
    if (referencePoses.length < 5) return;
    // ponytail: inline velocity then simple peak detection — no imported helper needed
    const vels: number[] = [0];
    for (let i = 1; i < referencePoses.length; i++) {
      const prev = referencePoses[i - 1].landmarks;
      const curr = referencePoses[i].landmarks;
      let v = 0;
      for (const idx of [11, 12, 13, 14, 15, 16]) {
        const p = prev[idx], c = curr[idx];
        if (!p || !c) continue;
        v += Math.sqrt((c.x - p.x) ** 2 + (c.y - p.y) ** 2);
      }
      vels.push(v);
    }
    const mean = vels.reduce((a, b) => a + b, 0) / vels.length;
    const max  = Math.max(...vels);
    const thresh = mean + (max - mean) * 0.4;
    const onsets: number[] = [];
    for (let i = 1; i < vels.length - 1; i++) {
      if (vels[i] >= vels[i-1] && vels[i] >= vels[i+1] && vels[i] >= thresh) {
        if (!onsets.length || i - onsets[onsets.length - 1] > 3) {
          onsets.push(referencePoses[i].timestamp_ms);
        }
      }
    }
    onsetTimesRef.current = onsets;
    firedOnsetsRef.current.clear();
  }, [referencePoses]);

  // During practice, poll for upcoming onsets and play a tick
  useEffect(() => {
    if (!isPractice || !chunk) return;
    const interval = setInterval(() => {
      const v = refVideoRef.current;
      if (!v) return;
      const nowMs = v.currentTime * 1000;
      for (const t of onsetTimesRef.current) {
        // Fire 500ms before the onset
        if (!firedOnsetsRef.current.has(t) && t - nowMs > 0 && t - nowMs < 500) {
          firedOnsetsRef.current.add(t);
          playTone(440, 0.05, 0.08); // very subtle click
        }
      }
    }, 50);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPractice, chunk]);

  // ── Visibility warning auto-dismiss ──
  useEffect(() => {
    if (lowVisibility) {
      setVisibleWarning(true);
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = setTimeout(() => setVisibleWarning(false), 4000);
    }
  }, [lowVisibility]);

  // ── Announcement countdown — fires before watch and teach phases ──
  // Shows a blank screen: "Watching video now  3-2-1" or "Tutorial now  3-2-1"
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    if (prevPhaseRef.current === phase) return;
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;

    if (phase === 'watch') {
      setAnnouncement('video');
      setAnnounceCd(3);
    } else if (phase === 'teach') {
      setAnnouncement('tutorial');
      setAnnounceCd(3);
    }
  }, [phase]);

  // Countdown tick for announcement
  useEffect(() => {
    if (!announcement) return;
    if (announceCd <= 0) {
      // Countdown done — clear overlay and let normal phase rendering take over
      setAnnouncement(null);
      return;
    }
    const t = setTimeout(() => setAnnounceCd(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [announcement, announceCd]);

  // ── Phase transition spoken cues ──
  useEffect(() => {
    if (phase === 'watch') {
      // Speech fired after announcement clears
    } else if (phase === 'prep_arms') {
      // PrepTimeSelector handles its own speech
    } else if (phase === 'arms') {
      speechManager.speak("Focus on your upper body at half speed. You've got this!", "praise");
    } else if (phase === 'prep_legs') {
      speechManager.speak("Now practice just the legs. Focus on matching foot and knee positions.", "normal");
    } else if (phase === 'prep_combine') {
      speechManager.speak("Great! Now put it all together — arms and legs.", "praise");
    } else if (phase === 'prep_full') {
      speechManager.speak("Final round at full speed! You've got this.", "praise");
    } else if (phase === 'improvement') {
      speechManager.speak("Let's review and improve. Check your scores and try the suggestions.", "normal");
    }
  }, [phase]);

  // Apply mode from SegmentPhases location state
  useEffect(() => {
    if (locationState?.mode && locationState?.skipModeSelector) {
      sendSessionEvent({ type: 'SET_MODE', mode: locationState.mode });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Session memory (welcome back cue only — no warm-up prompt) ──
  useEffect(() => {
    if (!routine || locationState?.skipModeSelector) return;
    sessionMemory.getLastSessionForRoutine(routine.id).then(lastSession => {
      if (lastSession?.worstJoints?.length > 0) {
        speechManager.speak(
          `Welcome back! Let's work on those ${lastSession.worstJoints[0].jointId.replace('_', ' ')}s.`,
          'normal',
        );
      }
    });
  }, [routine]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Switch chunk ──
  const switchToChunk = useCallback((chunks: Chunk[], idx: number) => {
    if (idx < 0 || idx >= chunks.length) return;
    const c = chunks[idx];
    setChunk(c);
    setCurrentChunkIndex(idx);
    setAttemptComplete(false);
    setFinalScore(null);
    setShowWatchOverlay(false);
    setProprioQuestion(null);
    lastBreathingCueIndex.current = -1;

    // Load pre-extracted poses — handle both JSON string and already-parsed array
    const rawPoses = c?.pose_slice_json;
    let poses: any[] | null = null;
    if (rawPoses) {
      try {
        poses = typeof rawPoses === 'string' ? JSON.parse(rawPoses) : rawPoses;
        if (!Array.isArray(poses) || poses.length === 0) poses = null;
      } catch (e) {
        console.error("Failed to parse pose_slice_json", e);
        poses = null;
      }
    }

    if (poses && poses.length > 0) {
      setReferencePoses(poses);
      loadReference(poses);
      // Need ≥2 frames for keyframes — with fewer, use what we have
      const kf = extractKeyframes(poses, Math.min(4, Math.max(1, Math.floor(poses.length / 3))));
      setKeyframes(kf.length > 0 ? kf : poses.slice(0, 1));
    } else {
      setReferencePoses([]);
      setKeyframes([]);
      loadReference([]);
      console.warn('No pose_slice_json for chunk', idx, '— teach phase will be skipped');
    }

    // Start chunk in state machine
    sendSessionEvent({ type: 'START_CHUNK', chunkIndex: idx });
  }, [loadReference, sendSessionEvent]);

  // ── Load routine data ──
  useEffect(() => {
    async function loadRoutine() {
      if (!id) { setLoadingData(false); return; }
      let data: Routine | null = null;
      if (session?.user?.id) {
        const res = await supabase.rpc('rpc_get_routine_detail', { p_routine_id: id, p_user_id: session.user.id });
        if (res.data) data = res.data;
      }
      if (!data) {
        try {
          const stored = localStorage.getItem(`taal-local-routine-${id}`);
          if (stored) data = JSON.parse(stored);
        } catch { /* ignore */ }
      }

      if (data) {
        setRoutine(data);
        const chunks = data.chunks || [];
        setAllChunks(chunks);
      }
      setLoadingData(false);
    }
    loadRoutine();
  }, [id, chunkId, session]);

  // ── Start first chunk after mode is selected and data is loaded ──
  const startedRef = useRef(false);
  useEffect(() => {
    if (showModeSelector || loadingData || !_allChunks.length || startedRef.current) return;
    startedRef.current = true;
    let startIdx = 0;
    if (chunkId && chunkId !== 'full') {
      const found = _allChunks.findIndex(
        (ch: Chunk) => ch.id === chunkId || String(ch.chunk_index) === chunkId
      );
      if (found >= 0) startIdx = found;
    }
    switchToChunk(_allChunks, startIdx);
  }, [showModeSelector, loadingData, _allChunks, chunkId, switchToChunk]);

  // ── Camera setup (extracted so mode selector can trigger it) ──
  const setupCamera = useCallback(async () => {
    if (!webcamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (webcamRef.current) {
        webcamRef.current.srcObject = stream;
        await webcamRef.current.play();
        setHasWebcam(true);
      }
    } catch {
      setWebcamError('Could not access webcam. Please allow camera permissions.');
    }
  }, []);

  // ── Camera init when warm-up/mode-selector dismissed ──
  useEffect(() => {
    if (showModeSelector) return;
    let active = true;
    (async () => {
      if (!active) return;
      await setupCamera();
    })();
    return () => { active = false; };
  }, [showModeSelector, setupCamera]);

  // ── Effective playback rate ──
  // Arms phase always 0.5×; DifficultyScaler only applies in full phase
  const effectivePlaybackRate = phase === 'full'
    ? difficultyScaler.getPlaybackRate()
    : playbackRate;

  // Announce speed changes in full phase
  const prevRateRef = useRef(effectivePlaybackRate);
  useEffect(() => {
    const prev = prevRateRef.current;
    prevRateRef.current = effectivePlaybackRate;
    if (phase !== 'full' || Math.abs(prev - effectivePlaybackRate) < 0.04) return;
    if (effectivePlaybackRate < prev) {
      speechManager.speak('Slowing down a bit — nail those arm positions', 'normal');
    } else {
      speechManager.speak('Looking good — picking up the pace', 'normal');
    }
  }, [effectivePlaybackRate, phase]);

  // ── Reference video sync with chunk + phase ──
  const [videoError, setVideoError] = useState('');
  useEffect(() => {
    const v = refVideoRef.current;
    if (!v || !chunk) return;

    const videoSrc = chunk.clip_url
      || getOriginalVideoUrl()
      || routine?.video_blob_url
      || '';

    if (!videoSrc) {
      setVideoError('No video source available');
      return;
    }
    setVideoError('');

    const rawStartMs = chunk.start_time_ms || 0;
    const rawEndMs = chunk.end_time_ms || 0;
    // clip_url is a pre-cut file that starts at 0; full video uses absolute timestamps
    const isClip = !!chunk.clip_url;
    const startMs = isClip ? 0 : rawStartMs;
    const endMs   = isClip ? rawEndMs - rawStartMs : rawEndMs;

    let cleanedUp = false;

    const onTimeUpdate = () => {
      if (cleanedUp) return;
      const currentMs = v.currentTime * 1000;
      const effectiveEndMs = endMs > 0 ? endMs : v.duration * 1000;

      // Breathing cues
      if (chunk.breathing_cues && !speechManager.isSpeaking && phase === 'full') {
        const nextCueIdx = lastBreathingCueIndex.current + 1;
        if (nextCueIdx < chunk.breathing_cues.length) {
          const cue = chunk.breathing_cues[nextCueIdx];
          if (currentMs >= cue.timestamp_ms - 200) {
            speechManager.speak(cue.type, 'urgent');
            lastBreathingCueIndex.current = nextCueIdx;
          }
        }
      }

      if (currentMs >= effectiveEndMs && effectiveEndMs > 0) {
        v.pause();
        countingSystem.stop();
        if (phase === 'watch') setShowWatchOverlay(true);
        else if (isPractice) handleScoredAttemptFinished();
      }
    };

    const doPlay = () => {
      if (cleanedUp) return;
      v.play().then(() => { v.playbackRate = effectivePlaybackRate; }).catch(e => console.warn('autoplay blocked', e));
      if (isPractice && !attemptComplete && !pendingAdjustment && endMs > 0) {
        countingSystem.start(endMs, effectivePlaybackRate);
      }
    };

    // Seek to startMs, then play if appropriate. Waits for the `seeked` event so
    // the browser has actually repositioned the decode head before playback begins.
    const seekAndMaybePlay = () => {
      if (cleanedUp) return;
      v.playbackRate = effectivePlaybackRate;
      const targetSec = startMs / 1000;

      // Already at target — play immediately (seeked won't fire)
      if (Math.abs(v.currentTime - targetSec) < 0.05) {
        if (phase === 'watch' || (isPractice && !attemptComplete && !pendingAdjustment)) doPlay();
        return;
      }

      const onSeeked = () => {
        v.removeEventListener('seeked', onSeeked);
        if (cleanedUp) return;
        if (phase === 'watch' || (isPractice && !attemptComplete && !pendingAdjustment)) doPlay();
      };
      v.addEventListener('seeked', onSeeked);
      v.currentTime = targetSec;
    };

    v.addEventListener('timeupdate', onTimeUpdate);

    if (loadedVideoSrcRef.current !== videoSrc) {
      // New source — full reload required
      loadedVideoSrcRef.current = videoSrc;
      v.src = videoSrc;
      v.load();
      v.addEventListener('loadedmetadata', seekAndMaybePlay, { once: true });

      return () => {
        cleanedUp = true;
        v.removeEventListener('loadedmetadata', seekAndMaybePlay);
        v.removeEventListener('timeupdate', onTimeUpdate);
        countingSystem.stop();
      };
    } else {
      // Same source — seek directly without reloading (avoids resetting currentTime to 0)
      seekAndMaybePlay();

      return () => {
        cleanedUp = true;
        v.removeEventListener('timeupdate', onTimeUpdate);
        countingSystem.stop();
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunk, routine, phase, effectivePlaybackRate, attemptComplete, pendingAdjustment, isPractice]);

  // ── Main processing loop ──
  useEffect(() => {
    let animationId: number;
    const loop = () => {
      const v = refVideoRef.current;
      const w = webcamRef.current;

      if (v && w && isPractice && !attemptComplete) {
        if (v.paused && !pendingAdjustment) v.play().catch(() => {});
        if ((!v.paused || pendingAdjustment) && w.readyState >= 2) {
          processFrame(w, v.currentTime * 1000, focusArea as FocusArea);
        }
        // Sample user pose at ~5fps for results replay
        captureFrameCounterRef.current++;
        if (captureFrameCounterRef.current % 6 === 0 && userPose) {
          capturedUserPosesRef.current.push([...userPose]);
        }
      }
      animationId = requestAnimationFrame(loop);
    };
    if (isWorkerReady && hasWebcam && isPractice) {
      animationId = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(animationId);
  }, [isWorkerReady, hasWebcam, phase, isPractice, focusArea, processFrame, attemptComplete, pendingAdjustment]);

  // ── Live reference capture from video during watch (when no pre-extracted poses) ──
  const captureFrameCount = useRef(0);
  useEffect(() => {
    if (phase !== 'watch' || referencePoses.length > 0 || !isWorkerReady) return;
    const v = refVideoRef.current;
    if (!v) return;

    captureFrameCount.current = 0;
    let animId: number;

    const capture = () => {
      if (v!.paused || v!.ended) {
        animId = requestAnimationFrame(capture);
        return;
      }
      captureFrameCount.current++;
      // Sample at ~3fps (every 10th frame at 30fps)
      if (captureFrameCount.current % 10 === 0) {
        captureReferenceFrame(v!, v!.currentTime * 1000);
      }
      animId = requestAnimationFrame(capture);
    };
    animId = requestAnimationFrame(capture);

    return () => cancelAnimationFrame(animId);
  }, [phase, referencePoses.length, isWorkerReady, captureReferenceFrame]);

  // ── Single AudioContext for all in-session sounds (ponytail: one instance, not one per event) ──
  const audioCtxRef = useRef<AudioContext | null>(null);
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new AudioContext(); } catch { /* ignore */ }
    }
    return audioCtxRef.current;
  }, []);

  const playTone = useCallback((freq: number, vol: number, dur: number) => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(); osc.stop(ctx.currentTime + dur);
  }, [getAudioCtx]);

  // ── Green score chime ──
  const consecutiveGreenFrames = useRef(0);
  const lastChimeTime = useRef(0);
  const [showChime, setShowChime] = useState(false);

  useEffect(() => {
    if (currentArmScore > 85 && currentLegScore > 85 && isPractice) {
      consecutiveGreenFrames.current++;
      if (consecutiveGreenFrames.current >= 4 && Date.now() - lastChimeTime.current > 5000) {
        playTone(880, 0.15, 0.3);
        lastChimeTime.current = Date.now();
        consecutiveGreenFrames.current = 0;
        setShowChime(true);
        setTimeout(() => setShowChime(false), 1500);
      }
    } else {
      consecutiveGreenFrames.current = 0;
    }
  }, [currentArmScore, currentLegScore, isPractice]);

  // ── Handle scored attempt finished ──
  const handleScoredAttemptFinished = async () => {
    setAttemptComplete(true);
    const score = await finishAttempt();
    setFinalScore(score);

    // Track scores across phases for positive reinforcement
    setSavedScores(prev => [...prev, score.overallScore]);

    // Check for >20% improvement (PRAISE condition)
    if (savedScores.length >= 1) {
      const prevScore = savedScores[savedScores.length - 1];
      const improvement = score.overallScore - prevScore;
      if (improvement > 20) {
        speechManager.speak("Amazing improvement! That's over 20 percent better!", "praise");
      }
    }

    // Adapt Difficulty
    difficultyScaler.evaluateAttempt(score.armScore, score.legScore, score.timingScore);

    // Proprioceptive Questioning
    if (session?.user?.id && id) {
      const improvement = await sessionMemory.getOverallImprovement(id, score.overallScore);
      if (improvement && improvement > 15) {
        setProprioQuestion(
          `Massive improvement! You scored ${Math.round(improvement)}% higher. Could you feel the difference?`
        );
      } else {
        setProprioQuestion(null);
      }
    }

    // Musicality Coach feedback
    if (score.timingFeedback) {
      speechManager.speak(score.timingFeedback, 'normal');
    }

    // Asymmetrical Feedback Adaptation
    if (score.weakerSide) {
      speechManager.speak(`Your ${score.weakerSide} side needs more work. Let's focus there next time.`, 'normal');
    }

    // Verbal feedback
    if (score.overallScore > 85) {
      speechManager.speak("Excellent run! That was really accurate.", "praise");
    } else if (score.overallScore > 70) {
      speechManager.speak("Good effort. Let's look at the breakdown.", "normal");
    } else if (score.overallScore > 50) {
      speechManager.speak("You're getting there. Let's see what to fix.", "normal");
    } else {
      speechManager.speak("That was tough, but you're getting there.", "normal");
    }

    // Save attempt
    if (session?.user?.id && id) {
      supabase.rpc('rpc_save_attempt', {
        p_user_id: session.user.id, p_routine_id: id, p_chunk_id: chunk?.id || null,
        p_is_full_routine: false,
        p_arm_score: score.armScore, p_leg_score: score.legScore,
        p_timing_score: score.timingScore, p_overall_score: score.overallScore,
        p_missing_joints_flagged: false,
        p_duration_ms: chunk ? chunk.end_time_ms - chunk.start_time_ms : 0,
      }).then(() => {}, () => {});

      sessionMemory.saveSession({
        date: new Date().toISOString(),
        routineId: id,
        overallScore: score.overallScore,
        worstJoints: [],
        bestJoints: []
      });
    }

    // ResultsOverlay is shown automatically when attemptComplete && finalScore
    if (phase === 'combine' || phase === 'full') {
      sendSessionEvent({ type: 'GO_TO_IMPROVEMENT' });
    }
  };

  // ── Preparation timer done ──
  const handlePrepDone = useCallback(() => {
    sendSessionEvent({ type: 'PREPARATION_DONE' });
  }, [sendSessionEvent]);

  // ── Dynamic navigation ──
  const handleTeachComplete = useCallback(() => {
    sendSessionEvent({ type: 'PHASE_COMPLETE' });
  }, [sendSessionEvent]);

  // Skip teach phase entirely if no keyframes available
  useEffect(() => {
    if (phase === 'teach' && keyframes.length === 0) {
      sendSessionEvent({ type: 'PHASE_COMPLETE' });
    }
  }, [phase, keyframes.length, sendSessionEvent]);

  const handleNextPhase = () => {
    setAttemptComplete(false);
    setFinalScore(null);
    setProprioQuestion(null);

    if (phase === 'combine' && finalScore && finalScore.overallScore > 85) {
      speechManager.speak("Excellent! You've nailed this. Let's go full speed.", 'praise');
      sendSessionEvent({ type: 'SKIP_TO_FULL' });
    } else {
      sendSessionEvent({ type: 'PHASE_COMPLETE' });
    }
  };

  const handlePrevPhase = () => {
    setAttemptComplete(false);
    setFinalScore(null);
    setProprioQuestion(null);
    sendSessionEvent({ type: 'PREV_PHASE' });
  };

  const handleRetry = () => {
    setAttemptComplete(false);
    setFinalScore(null);
    setProprioQuestion(null);
    lastBreathingCueIndex.current = -1;
    capturedUserPosesRef.current = [];
    captureFrameCounterRef.current = 0;
    sendSessionEvent({ type: 'RESTART_CHUNK' });
  };


  // ── Chunk navigation ──
  const nextChunk = useCallback(() => {
    if (!_allChunks || !routine) return;
    const nextIdx = currentChunkIndex + 1;
    if (nextIdx < _allChunks.length) {
      switchToChunk(_allChunks, nextIdx);
    } else {
      // All chunks done — navigate to routine detail
      navigate(`/routine/${id}`);
    }
  }, [_allChunks, routine, currentChunkIndex, switchToChunk, navigate, id]);

  const prevChunk = useCallback(() => {
    if (!_allChunks) return;
    const prevIdx = currentChunkIndex - 1;
    if (prevIdx >= 0) {
      switchToChunk(_allChunks, prevIdx);
    }
  }, [_allChunks, currentChunkIndex, switchToChunk]);

  const handleFinishSession = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }
    navigate(`/routine/${id}`);
  }, [navigate, id]);

  // ── Camera retry ──
  const [retryingCam, setRetryingCam] = useState(false);
  const handleRetryCamera = useCallback(async () => {
    setRetryingCam(true);
    setWebcamError('');
    try {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
        cameraStreamRef.current = null;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false
      });
      cameraStreamRef.current = stream;
      if (webcamRef.current) {
        webcamRef.current.srcObject = stream;
        await webcamRef.current.play();
        setHasWebcam(true);
      }
    } catch {
      setWebcamError('Camera blocked. Please allow camera access in your browser settings.');
    }
    setRetryingCam(false);
  }, []);

  // ── Current reference skeleton ──
  // ponytail: closest frame by absolute distance, not first-after; forgives ≤500ms timing errors
  const currentRefPose = useMemo(() => {
    if (!referencePoses.length || !refVideoRef.current) return undefined;
    const tMs = refVideoRef.current.currentTime * 1000;
    let best = referencePoses[0], bestDist = Math.abs(tMs - best.timestamp_ms);
    for (const p of referencePoses) {
      const d = Math.abs(tMs - p.timestamp_ms);
      if (d < bestDist) { bestDist = d; best = p; }
      if (p.timestamp_ms > tMs + 500) break; // early exit once we've passed
    }
    return best.landmarks;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referencePoses, refVideoRef.current?.currentTime]);

  // ── Determine dynamic score display value ──
  const displayScore = focusArea === 'arms' ? currentArmScore
    : focusArea === 'legs' ? currentLegScore
    : (currentArmScore + currentLegScore) / 2;

  // ── View constants ──
  const totalChunks = _allChunks.length || 1;
  const isLastChunk = currentChunkIndex >= totalChunks - 1;
  const hasAllChunks = _allChunks.length > 0;

  // ── Beat-based drill loop (Step 5+) ──────────────────────────────────────────
  // When RoutineDetail passes a beatRange in location state, render DrillLoop
  // instead of the legacy phase system. The legacy system remains intact for
  // routines without a beat grid.
  const beatRange = locationState?.beatRange as BeatRange | undefined;
  if (beatRange) {
    const videoSrc = chunk?.clip_url || getOriginalVideoUrl() || routine?.video_blob_url || '';
    const bpm = (routine as any)?.beat_grid_json?.bpm as number | undefined;
    return (
      <DrillLoop
        videoSrc={videoSrc}
        beatRange={beatRange}
        bpm={bpm}
        rangeCounts={locationState?.rangeCounts}
        onClose={() => navigate(-1)}
      />
    );
  }

  // Mode selector — only shown if user arrives directly (not via SegmentPhases)
  if (showModeSelector) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
        <PracticeModeSelector
          onSelect={(selectedMode) => {
            sendSessionEvent({ type: 'SET_MODE', mode: selectedMode });
            setShowModeSelector(false);
            setupCamera();
          }}
          onCancel={() => navigate(-1)}
        />
      </div>
    );
  }

  return (
    <div className="h-dvh bg-black flex flex-col overflow-hidden">

      {/* ── Persistent camera video (always in DOM so src stays alive) ── */}
      {/* Hidden during watch (reference video shows instead) and during practice (split-screen panel used) */}
      <video
        ref={webcamRef}
        className={`${
          isPractice || phase === 'watch' ? 'hidden' : 'fixed inset-0 w-full h-full object-cover z-0'
        } ${isMirrorMode ? 'scale-x-[-1]' : ''}`}
        playsInline
        muted
      />


      {/* ── Cold start overlay — show camera behind, warm-up message on top ── */}
      {/* ponytail: camera shows immediately; only AI tracker message, no spinner blocking view */}
      {!isWorkerReady && (
        <div className="fixed inset-0 z-[100] pointer-events-none flex flex-col items-center justify-end pb-16">
          <div className="bg-black/60 backdrop-blur-md px-6 py-3 rounded-2xl border border-white/10 flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin text-violet-400 flex-shrink-0" />
            <p className="text-white text-sm font-medium">Warming up AI tracker…</p>
          </div>
        </div>
      )}

      {/* ── Preparation Timer — shows camera, gates on body detection ── */}
      {isPreparation && (
        <PreparationTimer
          onReady={handlePrepDone}
          onCancel={handlePrevPhase}
          playbackRate={effectivePlaybackRate}
          phaseLabel={phaseLabel}
          userLandmarks={userPose}
        />
      )}

      {/* ── Watch Again overlay ── */}
      {phase === 'watch' && showWatchOverlay && (
        <div className="fixed inset-0 z-40 bg-black/85 backdrop-blur-sm flex items-center justify-center p-8">
          <div className="bg-white/5 backdrop-blur-xl p-8 rounded-3xl border border-white/10 max-w-sm w-full text-center space-y-6">
            <p className="text-5xl">👀</p>
            <h2 className="text-2xl font-bold text-white">Did you get that?</h2>
            <p className="text-gray-400 text-sm">
              Watch the upper body movements one more time, or move on when you're ready.
            </p>
            <div className="flex flex-col gap-3 pt-2">
              <button
                onClick={() => {
                  const v = refVideoRef.current;
                  if (v && chunk) {
                    setShowWatchOverlay(false);
                    // clip_url is pre-cut → start at 0; full video → seek to chunk offset
                    v.currentTime = chunk.clip_url ? 0 : (chunk.start_time_ms || 0) / 1000;
                    v.play().then(() => { v.playbackRate = effectivePlaybackRate; }).catch(() => {});
                  }
                }}
                className="w-full py-4 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-all text-lg"
              >
                🔄 Watch again
              </button>
              <button
                onClick={() => {
                  setShowWatchOverlay(false);
                  sendSessionEvent({ type: 'PHASE_COMPLETE' });
                }}
                className="w-full py-4 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)] text-lg"
              >
                ➡️ I'm ready
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Announcement screen — blank bg + countdown before video and tutorial ── */}
      {announcement && (
        <div className="fixed inset-0 z-[90] bg-black flex flex-col items-center justify-center gap-8">
          <p className="text-white/40 text-sm uppercase tracking-widest">
            {announcement === 'video' ? 'Getting ready to watch' : 'Getting ready for tutorial'}
          </p>
          <h1 className="text-4xl font-bold text-white text-center px-8">
            {announcement === 'video' ? '🎬 Watching video now' : '📖 Tutorial now'}
          </h1>
          {announceCd > 0 ? (
            <div className="text-8xl font-bold text-white/80 tabular-nums animate-in zoom-in duration-200">
              {announceCd}
            </div>
          ) : (
            <div className="text-4xl animate-in zoom-in duration-200">▶️</div>
          )}
        </div>
      )}

      {/* ── Teach Phase (Step 2) — manual tap-to-advance, body diagram ── */}
      {phase === 'teach' && !announcement && (
        <TeachPhase
          keyframes={keyframes}
          onComplete={handleTeachComplete}
          videoSrc={chunk?.clip_url || getOriginalVideoUrl() || routine?.video_blob_url || ''}
          startMs={chunk?.start_time_ms}
          endMs={chunk?.end_time_ms}
        />
      )}

      {/* ── Top bar (Dynamic Navigation) ── */}
      <header className={`w-full z-50 px-6 py-4 flex items-center justify-between ${
        isPreparation ? 'hidden' : ''
      } ${phase === 'teach' ? 'hidden' : ''}`}
        >
          <button
            onClick={handleFinishSession}
            className="w-12 h-12 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors border border-white/10 text-xl"
          >
            ←
          </button>

          {/* Phase indicator + chunk progress */}
          <div className="flex items-center gap-2">
            <div className="bg-black/50 backdrop-blur-md px-3 py-2 rounded-full border border-white/10 flex items-center gap-3">
              <span className="text-white text-sm font-bold">{phaseLabel}</span>
              {hasAllChunks && (
                <span className="text-white/40 text-xs">
                  {currentChunkIndex + 1}/{totalChunks}
                </span>
              )}
            </div>

            {/* Skip back / forward nav */}
            {isPractice && (
              <div className="flex gap-1">
                <button
                  onClick={handlePrevPhase}
                  className="w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-black/60 transition-colors border border-white/10"
                  title="Previous phase"
                >
                  <SkipBack className="w-4 h-4" />
                </button>
                <button
                  onClick={handleNextPhase}
                  className="w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-black/60 transition-colors border border-white/10"
                  title="Skip phase"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
              </div>
            )}

            <button
              onClick={() => sendSessionEvent({ type: 'TOGGLE_SEATED' })}
              className={`px-3 py-2 rounded-full border backdrop-blur-md text-sm font-semibold transition-colors ${
                isSeatedMode
                  ? 'bg-purple-500/30 border-purple-400 text-purple-300'
                  : 'bg-black/40 border-white/10 text-white'
              }`}
            >
              {isSeatedMode ? '🪑 On' : '🪑 Off'}
            </button>
            <button
              onClick={() => setIsMirrorMode(!isMirrorMode)}
              className={`px-3 py-2 rounded-full border backdrop-blur-md text-sm font-semibold transition-colors ${
                isMirrorMode
                  ? 'bg-purple-500/30 border-purple-400 text-purple-300'
                  : 'bg-black/40 border-white/10 text-white'
              }`}
            >
              {isMirrorMode ? '🪞 On' : '🪞 Off'}
            </button>
          </div>

          {/* Chunk navigation arrows */}
          {hasAllChunks && (
            <div className="flex gap-1">
              <button
                onClick={prevChunk}
                disabled={currentChunkIndex <= 0}
                className="w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white/60 hover:text-white disabled:opacity-20 transition-colors border border-white/10"
                title="Previous chunk"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={nextChunk}
                disabled={currentChunkIndex >= totalChunks - 1}
                className="w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white/60 hover:text-white disabled:opacity-20 transition-colors border border-white/10"
                title="Next chunk"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </header>

      {/* ── Main area: flex-row split screen ── */}
      {/* Reference video (left) + camera (right) always in DOM — CSS controls visibility/sizing */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ── Reference video — full width during watch, half width during practice ── */}
        <div className={`relative bg-black overflow-hidden transition-all ${
          phase === 'watch' ? 'flex-1 z-10' : isPractice ? 'flex-1 border-r border-white/5' : 'hidden'
        }`}>
          <video
            ref={refVideoRef}
            className="absolute inset-0 w-full h-full object-contain"
            muted
            playsInline
            onPlay={() => setRefVideoPlaying(true)}
            onPause={() => setRefVideoPlaying(false)}
            onClick={() => {
              const v = refVideoRef.current;
              if (v && v.paused && phase === 'watch') v.play().catch(() => {});
            }}
          />
          {videoError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
              <div className="text-center gap-3 flex flex-col items-center">
                <p className="text-white/40 text-sm">No video available</p>
                <button
                  onClick={() => sendSessionEvent({ type: 'PHASE_COMPLETE' })}
                  className="text-violet-400 text-sm underline"
                >
                  Skip to tutorial →
                </button>
              </div>
            </div>
          )}
          {/* Tap-to-play — only when video is paused (not playing) */}
          {phase === 'watch' && !showWatchOverlay && !videoError && !refVideoPlaying && (
            <button
              onClick={() => { refVideoRef.current?.play().catch(() => {}); }}
              className="absolute inset-0 z-10 flex items-center justify-center bg-black/20"
              aria-label="Tap to play"
            >
              <div className="w-16 h-16 rounded-full bg-white/15 backdrop-blur flex items-center justify-center">
                <span className="text-3xl ml-1">▶</span>
              </div>
            </button>
          )}
          {phase === 'watch' && (
            <div className="absolute top-3 right-3 z-20 bg-black/40 text-white/40 text-xs px-2 py-1 rounded-lg pointer-events-none">
              {effectivePlaybackRate < 1 ? `${effectivePlaybackRate}×` : 'Full speed'}
            </div>
          )}
          {isPractice && (
            <>
              <div className="absolute top-2 right-2 z-10 bg-black/40 text-white/30 text-[10px] px-2 py-0.5 rounded-md">
                Reference · {effectivePlaybackRate === 0.5 ? '½×' : effectivePlaybackRate === 0.75 ? '¾×' : '1×'}
              </div>
              <ChunkProgressBar
                startMs={chunk?.start_time_ms ?? 0}
                endMs={chunk?.end_time_ms ?? 0}
                videoRef={refVideoRef}
              />
            </>
          )}
        </div>

        {/* ── Camera — hidden during watch, half width during practice ── */}
        <div className={`relative bg-black overflow-hidden ${
          isPractice ? 'flex-1' : 'hidden'
        }`}>
          <video
            ref={practiceWebcamRef}
            className={`absolute inset-0 w-full h-full object-cover ${isMirrorMode ? 'scale-x-[-1]' : ''}`}
            playsInline
            muted
          />
          <div className="absolute top-2 left-2 z-10 bg-black/40 text-white/25 text-[10px] px-2 py-0.5 rounded-md">
            You
          </div>

          {!hasWebcam && (
            <div className="absolute inset-0 z-20 bg-black flex flex-col items-center justify-center gap-3">
              <Camera className="w-12 h-12 text-white/30" />
              <p className="text-white text-sm">{webcamError || '📷 Allow camera'}</p>
              <button onClick={handleRetryCamera} disabled={retryingCam}
                className="bg-primary text-white font-bold px-5 py-2 rounded-xl text-sm">
                {retryingCam ? '⏳' : '📷 Start'}
              </button>
            </div>
          )}

          {/* Stickman overlay — user pose with reference ghost behind */}
          {userPose && (
            <div className="absolute inset-0 pointer-events-none">
              <StickmanCanvas
                landmarks={userPose}
                ghostLandmarks={isMirrorMode && currentRefPose
                  ? currentRefPose.map(lm => ({ ...lm, x: 1 - lm.x }))
                  : currentRefPose ?? undefined}
                mode={focusArea === 'legs' ? 'full_body' : 'upper_body'}
                smooth={true}
                width={640}
                height={480}
                jointScores={jointScores.length > 0
                  ? Object.fromEntries(jointScores.map(j => [JOINT_NAME_TO_IDX[j.name] ?? j.name, j.score])) as any
                  : undefined}
              />
            </div>
          )}

          {/* Ambient score dot */}
          {!attemptComplete && (
            <div className="absolute bottom-4 right-4 z-30">
              <AmbientScore armScore={currentArmScore} />
            </div>
          )}

          {showChime && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none animate-in zoom-in duration-200">
              <div className="bg-green-500/30 border border-green-400/50 backdrop-blur-md px-5 py-2 rounded-full">
                <p className="text-green-300 font-bold text-sm">✨ Keep going!</p>
              </div>
            </div>
          )}

          {visibleWarning && (
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
              <div className="bg-yellow-500/20 border border-yellow-500/30 backdrop-blur-md px-4 py-1.5 rounded-full">
                <p className="text-yellow-300 text-xs">Step back — show shoulders</p>
              </div>
            </div>
          )}
        </div>

        <BeatIndicator isPlaying={isPractice && !attemptComplete} playbackRate={effectivePlaybackRate} />
      </div>

      {/* ── Unified results overlay — shown after every scored attempt ── */}
      {attemptComplete && finalScore && (
        <ResultsOverlay
          score={finalScore}
          prevScore={savedScores.length >= 2 ? savedScores[savedScores.length - 2] : null}
          jointScores={jointScores}
          phase={phase}
          onRetry={handleRetry}
          onNext={handleNextPhase}
          isLastChunk={isLastChunk}
          referencePoses={referencePoses}
          capturedUserPoses={capturedUserPosesRef.current}
        />
      )}
    </div>
  );
}
