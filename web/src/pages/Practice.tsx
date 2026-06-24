import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Loader2, Camera, SkipForward, SkipBack, ChevronLeft, ChevronRight } from 'lucide-react';
import SkeletonCanvas from '../components/SkeletonCanvas';
import { PreparationTimer } from '../components/PreparationTimer';

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

function ResultsOverlay({ score, prevScore, jointScores, phase, onRetry, onNext, isLastChunk }: {
  score: FinalScore;
  prevScore: number | null;
  jointScores: JointScore[];
  phase: string;
  onRetry: () => void;
  onNext: () => void;
  isLastChunk: boolean;
}) {
  const pct    = Math.round(score.armScore); // arms phase: show arm score prominently
  const delta  = prevScore !== null ? Math.round(score.overallScore - prevScore) : null;
  const great  = pct >= 80;
  const ok     = pct >= 55;

  // One worst arm joint to fix
  const worstArmJoint = jointScores
    .filter(j => j.type === 'arm' && j.score >= 0 && JOINT_LABEL[j.name])
    .sort((a, b) => a.score - b.score)[0];

  return (
    <div className="fixed inset-0 z-40 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 gap-5 animate-in fade-in duration-300">

      {/* Celebration / emoji */}
      <div className="text-6xl animate-in zoom-in duration-400">
        {great ? '🔥' : ok ? '💪' : '🌱'}
      </div>

      {/* Score */}
      <div className="text-center">
        <div className={`text-7xl font-bold tabular-nums ${great ? 'text-green-400' : ok ? 'text-violet-400' : 'text-white'}`}>
          {pct}<span className="text-3xl font-normal text-white/40">%</span>
        </div>
        {delta !== null && (
          <p className={`text-sm font-semibold mt-1 ${delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-white/40'}`}>
            {delta > 0 ? `+${delta}` : delta} pts from last try
          </p>
        )}
        {delta === null && (
          <p className="text-white/40 text-sm mt-1">
            {great ? 'Great start!' : ok ? 'Nice effort!' : 'Keep going!'}
          </p>
        )}
      </div>

      {/* One specific fix — only if not great */}
      {!great && worstArmJoint && (
        <div className="bg-violet-500/10 border border-violet-500/20 rounded-2xl px-5 py-4 text-center max-w-xs w-full">
          <p className="text-white/50 text-[10px] uppercase tracking-widest mb-1">One thing to fix</p>
          <p className="text-white font-medium text-sm">
            {JOINT_FIX[worstArmJoint.name] ?? `Work on your ${JOINT_LABEL[worstArmJoint.name]}`}
          </p>
        </div>
      )}

      {/* Weaker side — only surface if significant */}
      {score.weakerSide && (
        <p className="text-amber-300/70 text-xs">
          Your {score.weakerSide} side is lagging — focus there
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-3 w-full max-w-xs pt-2">
        <button
          onClick={onRetry}
          className="flex-1 bg-white/10 hover:bg-white/20 text-white font-bold py-4 rounded-2xl transition-all text-base"
        >
          🔄 Again
        </button>
        <button
          onClick={onNext}
          className="flex-1 bg-primary hover:bg-primary/90 text-white font-bold py-4 rounded-2xl transition-all shadow-[0_0_20px_rgba(147,51,234,0.3)] text-base"
        >
          {isLastChunk && (phase === 'combine' || phase === 'full') ? '✅ Finish' : '➡️ Next'}
        </button>
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

  const webcamRef = useRef<HTMLVideoElement>(null);
  const refVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

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
  const [showWarmUpPrompt, setShowWarmUpPrompt] = useState(false);
  const [showModeSelector, setShowModeSelector] = useState(true);

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
    userStopped,
    isFrustrated,
    loadReference,
    processFrame,
    finishAttempt,
    clearUserStopped,
    captureReferenceFrame
  } = usePoseDetection();

  const [finalScore, setFinalScore] = useState<FinalScore | null>(null);
  const [attemptComplete, setAttemptComplete] = useState(false);
  const [referencePoses, setReferencePoses] = useState<PoseFrame[]>([]);
  const [keyframes, setKeyframes] = useState<PoseFrame[]>([]);
  const [showWatchOverlay, setShowWatchOverlay] = useState(false);

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

  // ── Visibility warning auto-dismiss ──
  useEffect(() => {
    if (lowVisibility) {
      setVisibleWarning(true);
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = setTimeout(() => setVisibleWarning(false), 4000);
    }
  }, [lowVisibility]);

  // ── Phase transition spoken cues ──
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    if (prevPhaseRef.current === phase) return;
    prevPhaseRef.current = phase;
    if (phase === 'watch') {
      speechManager.speak("Watch the full routine. Notice the arm and leg positions.", "normal");
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

  // ── Session memory & warm-up prompt ──
  const location = useLocation();
  const warmupDone = (location.state as any)?.warmupDone;
  useEffect(() => {
    if (routine) {
      // If user just came from warm-up page, skip the prompt
      if (warmupDone) {
        setShowWarmUpPrompt(false);
        return;
      }
      sessionMemory.getLastSessionForRoutine(routine.id).then(lastSession => {
        if (lastSession && lastSession.worstJoints.length > 0) {
          speechManager.speak(
            `Welcome back! Let's focus on those ${lastSession.worstJoints[0].jointId.replace('_', ' ')}s today.`,
            "normal"
          );
        } else {
          // No prior session — suggest warm-up (Step 0)
          setShowWarmUpPrompt(true);
        }
      });
    }
  }, [routine]);

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

    // Load pre-extracted poses
    if (c?.pose_slice_json && Array.isArray(c.pose_slice_json) && c.pose_slice_json.length > 0) {
      try {
        const poses = typeof c.pose_slice_json === 'string'
          ? JSON.parse(c.pose_slice_json)
          : c.pose_slice_json;
        setReferencePoses(poses);
        loadReference(poses);
        setKeyframes(extractKeyframes(poses, 4));
      } catch (e) {
        console.error("Failed to parse pose_slice_json", e);
      }
    } else {
      // No pose data — skip teach phase, user will watch video instead
      setReferencePoses([]);
      setKeyframes([]);
      loadReference([]);
      console.warn("No pose_slice_json for chunk", idx);
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
    if (showWarmUpPrompt || showModeSelector) return;
    let active = true;
    (async () => {
      if (!active) return;
      await setupCamera();
    })();
    return () => { active = false; };
  }, [showWarmUpPrompt, showModeSelector, setupCamera]);

  // ── Effective playback rate (uses DifficultyScaler for full speed) ──
  const effectivePlaybackRate = phase === 'full'
    ? difficultyScaler.getPlaybackRate()
    : playbackRate;

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

    const startMs = chunk.start_time_ms || 0;
    const endMs = chunk.end_time_ms || 0;

    v.src = videoSrc;
    v.playbackRate = effectivePlaybackRate;

    const onLoadedMetadata = () => {
      v.currentTime = startMs / 1000;

      const doPlay = () => {
        v.play().then(() => {
          // Must set playbackRate AFTER play() starts — browser resets it otherwise
          v.playbackRate = effectivePlaybackRate;
        }).catch(e => console.warn("Auto-play prevented", e));
      };

      if (phase === 'watch') {
        doPlay();
      } else if (isPractice && !attemptComplete && !pendingAdjustment) {
        doPlay();
        if (endMs > startMs) countingSystem.start(endMs - startMs, effectivePlaybackRate);
      }
    };

    const onTimeUpdate = () => {
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

        if (phase === 'watch') {
          setShowWatchOverlay(true);
        } else if (isPractice) {
          handleScoredAttemptFinished();
        }
      }
    };

    v.addEventListener('loadedmetadata', onLoadedMetadata);
    v.addEventListener('timeupdate', onTimeUpdate);
    v.load();

    // Fallback: if already loaded (cached), fire handler directly
    if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      onLoadedMetadata();
    }

    return () => {
      v.removeEventListener('loadedmetadata', onLoadedMetadata);
      v.removeEventListener('timeupdate', onTimeUpdate);
      countingSystem.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunk, routine, phase, effectivePlaybackRate, attemptComplete, pendingAdjustment, isPractice]);

  // ── Main processing loop ──
  const [processingActive, setProcessingActive] = useState(false);
  const processedFrames = useRef(0);

  // Check if frames are being received
  useEffect(() => {
    if (isPractice) {
      const prev = processedFrames.current;
      const timeout = setTimeout(() => {
        setProcessingActive(processedFrames.current !== prev);
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [phase, isPractice]);

  useEffect(() => {
    let animationId: number;
    const loop = () => {
      const v = refVideoRef.current;
      const w = webcamRef.current;

      if (v && w && isPractice && !attemptComplete) {
        if (v.paused && !pendingAdjustment) v.play().catch(() => {});
        if (!v.paused || pendingAdjustment) {
          processedFrames.current++;
          processFrame(w, v.currentTime * 1000, focusArea as FocusArea);
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

  // ── Green score chime ──
  const consecutiveGreenFrames = useRef(0);
  const lastChimeTime = useRef(0);
  const [showChime, setShowChime] = useState(false);

  useEffect(() => {
    if (currentArmScore > 85 && currentLegScore > 85 && isPractice) {
      consecutiveGreenFrames.current++;
      if (consecutiveGreenFrames.current >= 4 && Date.now() - lastChimeTime.current > 5000) {
        try {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 880;
          osc.type = 'sine';
          gain.gain.setValueAtTime(0.15, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.3);
          lastChimeTime.current = Date.now();
          consecutiveGreenFrames.current = 0;
          setShowChime(true);
          setTimeout(() => setShowChime(false), 1500);
        } catch { /* ignore */ }
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
    sendSessionEvent({ type: 'RESTART_CHUNK' });
  };

  const handleSlowDown = useCallback(() => {
    difficultyScaler.forceSlowDown();
    clearUserStopped();
    sendSessionEvent({ type: 'RESTART_CHUNK' });
  }, [difficultyScaler, sendSessionEvent, clearUserStopped]);

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

  // ── Warm-up prompt (only before first segment) ──
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  // ── Practice mode selector (after warm-up, before practice) ──
  if (showModeSelector && !showWarmUpPrompt) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
        <PracticeModeSelector
          onSelect={(selectedMode) => {
            sendSessionEvent({ type: 'SET_MODE', mode: selectedMode });
            setShowModeSelector(false);
            // Camera setup + start practice
            setupCamera();
          }}
          onCancel={() => setShowWarmUpPrompt(true)}
        />
      </div>
    );
  }

  if (showWarmUpPrompt && !loadingData && currentChunkIndex === 0) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="bg-black/60 backdrop-blur-xl border border-white/10 p-8 rounded-3xl max-w-md w-full text-center shadow-2xl space-y-6 animate-in fade-in zoom-in duration-500">
          <p className="text-5xl">🏋️</p>
          <h1 className="text-3xl font-outfit font-bold text-white">Warm up first?</h1>
          <p className="text-gray-400 text-sm">
            A quick 1-minute warm-up helps prevent injuries and calibrates your camera tracking.
          </p>

          {showSkipConfirm ? (
            <div className="space-y-4 pt-4">
              <p className="text-yellow-400 text-sm font-medium">Are you sure you want to skip the warm-up?</p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowSkipConfirm(false);
                    setShowWarmUpPrompt(false);
                    setShowModeSelector(true);
                  }}
                  className="flex-1 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded-xl font-medium transition-all text-sm"
                >
                  Yes, skip
                </button>
                <button
                  onClick={() => setShowSkipConfirm(false)}
                  className="flex-1 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition-all text-sm"
                >
                  No, go back
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 pt-4">
              <button
                onClick={() => navigate(`/warmup/${id}/${chunk?.chunk_index || 'full'}`)}
                className="w-full py-4 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold shadow-[0_0_20px_rgba(147,51,234,0.4)] transition-all text-lg"
              >
                🔥 Start warm-up
              </button>
              <button
                onClick={() => setShowSkipConfirm(true)}
                className="w-full py-4 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl font-medium transition-all text-base"
              >
                ⏭️ Skip — I'm ready
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh bg-black flex flex-col overflow-hidden">

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
          webcamRef={webcamRef}
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
                    v.currentTime = (chunk.start_time_ms || 0) / 1000;
                    v.play().then(() => {
                      v.playbackRate = effectivePlaybackRate;
                    }).catch(() => {});
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

      {/* ── Teach Phase (Step 2) ── */}
      {phase === 'teach' && (
        <TeachPhase
          keyframes={keyframes}
          onComplete={handleTeachComplete}
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

      {/* ── Main area: fullscreen camera + PiP reference ── */}
      <div className="flex-1 min-h-0 relative">

        {/* Fullscreen user camera */}
        <video
          ref={webcamRef}
          className={`absolute inset-0 w-full h-full object-cover ${isMirrorMode ? 'scale-x-[-1]' : ''}`}
          playsInline
          muted
        />

        {/* No camera prompt */}
        {!hasWebcam && (
          <div className="absolute inset-0 z-20 bg-black flex flex-col items-center justify-center gap-4">
            <Camera className="w-16 h-16 text-white/40" />
            <p className="text-white font-semibold">{webcamError || '📷 Allow camera access'}</p>
            <button
              onClick={handleRetryCamera}
              disabled={retryingCam}
              className="bg-primary hover:bg-primary/90 text-white font-bold px-6 py-3 rounded-xl transition-all"
            >
              {retryingCam ? '⏳' : '📷 Start Camera'}
            </button>
          </div>
        )}

        {/* Skeleton overlay — mirrored to match camera */}
        <div className={`absolute inset-0 pointer-events-none ${isMirrorMode ? 'scale-x-[-1]' : ''}`}>
          {userPose && (
            <SkeletonCanvas
              landmarks={userPose}
              refLandmarks={currentRefPose}
              focusArea={phase as any}
              showArrows={false}
              width={640}
              height={480}
              jointScores={jointScores.length > 0 ? Object.fromEntries(jointScores.map(j => [JOINT_NAME_TO_IDX[j.name] ?? j.name, j.score])) as any : undefined}
            />
          )}
        </div>

        {/* Reference video: fullscreen during watch, PiP during practice */}
        <div className={
          phase === 'watch'
            ? 'absolute inset-0 z-10 bg-black'
            : isPractice
              ? 'absolute top-16 left-3 z-20 w-[28%] max-w-[140px] rounded-xl overflow-hidden border border-white/20 shadow-2xl bg-black'
              : 'hidden'
        }>
          <video
            ref={refVideoRef}
            className={phase === 'watch' ? 'w-full h-full object-contain' : 'w-full aspect-video object-contain bg-black'}
            muted
            playsInline
          />
          {videoError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80">
              <p className="text-red-400 text-[10px] text-center px-2">{videoError}</p>
            </div>
          )}
          {isPractice && !videoError && (
            <div className="absolute bottom-1 right-1 bg-black/60 text-white/70 text-[9px] px-1.5 py-0.5 rounded-md">
              {effectivePlaybackRate === 0.5 ? '½×' : effectivePlaybackRate === 0.75 ? '¾×' : '1×'}
            </div>
          )}
        </div>

        {/* Chunk progress bar — thin line at very top */}
        {isPractice && !attemptComplete && (
          <ChunkProgressBar
            startMs={chunk?.start_time_ms ?? 0}
            endMs={chunk?.end_time_ms ?? 0}
            videoRef={refVideoRef}
          />
        )}

        {/* Ambient score indicator — coloured dot, no numbers */}
        {isPractice && !attemptComplete && (
          <div className="absolute bottom-6 right-5 z-30">
            <AmbientScore armScore={currentArmScore} />
          </div>
        )}

        {/* "Nice!" flash when doing great */}
        {showChime && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 animate-in zoom-in duration-200">
            <div className="bg-green-500/30 border border-green-400/50 backdrop-blur-md px-5 py-2 rounded-full">
              <p className="text-green-300 font-bold text-base">✨ Keep going!</p>
            </div>
          </div>
        )}

        {/* Visibility warning — minimal, self-dismissing */}
        {visibleWarning && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
            <div className="bg-yellow-500/20 border border-yellow-500/30 backdrop-blur-md px-4 py-2 rounded-full text-center">
              <p className="text-yellow-300 text-sm font-medium">Step back — show your shoulders</p>
            </div>
          </div>
        )}

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
        />
      )}
    </div>
  );
}
