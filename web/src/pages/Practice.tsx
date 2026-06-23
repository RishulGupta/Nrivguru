import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Camera, SkipForward, SkipBack, ChevronLeft, ChevronRight } from 'lucide-react';
import SkeletonCanvas from '../components/SkeletonCanvas';
import ScoreDisplay from '../components/ScoreDisplay';
import { PreparationTimer } from '../components/PreparationTimer';
import { ImprovementPhase } from '../components/ImprovementPhase';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useStore';
import type { Chunk, Routine, FinalScore } from '@taal/shared/types/routine';
import type { PoseFrame } from '@taal/shared/types/pose';
import { usePracticeSession } from '../hooks/usePracticeSession';
import type { FocusArea } from '@taal/shared/utils/CorrectionEngine';
import { CorrectionEngine } from '@taal/shared/utils/CorrectionEngine';
import { usePoseDetection } from '../hooks/usePoseDetection';
import { speechManager } from '@taal/shared/utils/SpeechManager';
import { countingSystem } from '@taal/shared/utils/CountingSystem';
import { TeachPhase } from '../components/TeachPhase';
import { extractKeyframes } from '@taal/shared/utils/KeyframeExtractor';
import { BeatIndicator } from '../components/BeatIndicator';
import { TeacherPersonality } from '@taal/shared/utils/TeacherPersonality';
import { sessionMemory } from '@taal/shared/utils/SessionMemory';
import { DifficultyScaler } from '@taal/shared/utils/DifficultyScaler';
import { getStyleConfig } from '@taal/shared/utils/StyleConfig';
import { getOriginalVideoUrl } from '../utils/videoStore';

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

  // ── State machine ──
  const {
    phase,
    attemptCount: _attemptCount,
    isSeatedMode,
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
    clearUserStopped
  } = usePoseDetection();

  const [finalScore, setFinalScore] = useState<FinalScore | null>(null);
  const [attemptComplete, setAttemptComplete] = useState(false);
  const [referencePoses, setReferencePoses] = useState<PoseFrame[]>([]);
  const [keyframes, setKeyframes] = useState<PoseFrame[]>([]);
  const [showImprovement, setShowImprovement] = useState(false);

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
      speechManager.speak("Now practice just the arms. Follow the video at half speed.", "normal");
    } else if (phase === 'arms') {
      // Practice started after prep timer
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
  useEffect(() => {
    if (routine) {
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
    setShowImprovement(false);
    setProprioQuestion(null);
    lastBreathingCueIndex.current = -1;

    // Load pre-extracted poses
    if (c?.pose_slice_json) {
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

        // Determine starting chunk
        let startIdx = 0;
        if (chunkId && chunkId !== 'full') {
          const found = chunks.findIndex(
            (ch: Chunk) => ch.id === chunkId || String(ch.chunk_index) === chunkId
          );
          if (found >= 0) startIdx = found;
        }
        switchToChunk(chunks, startIdx);
      }
      setLoadingData(false);
    }
    loadRoutine();
  }, [id, chunkId, session, switchToChunk]);

  // ── Camera setup ──
  useEffect(() => {
    let active = true;
    let retryCount = 0;
    const retrySetup = () => {
      if (retryCount < 10 && !cameraStreamRef.current) {
        retryCount++;
        setTimeout(() => setupCamera(), 200);
      }
    };
    async function setupCamera() {
      if (!webcamRef.current) { retrySetup(); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false
        });
        cameraStreamRef.current = stream;
        if (webcamRef.current && active) {
          webcamRef.current.srcObject = stream;
          await webcamRef.current.play();
          setHasWebcam(true);
        }
      } catch {
        setWebcamError('Could not access webcam. Please allow camera permissions.');
      }
    }
    setupCamera();
    return () => {
      active = false;
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
        cameraStreamRef.current = null;
      }
    };
  }, []);

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

      if (isPractice && !attemptComplete && !pendingAdjustment) {
        v.play().catch(e => console.warn("Auto-play prevented", e));
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
          sendSessionEvent({ type: 'PHASE_COMPLETE' });
        } else if (isPractice) {
          handleScoredAttemptFinished();
        }
      }
    };

    v.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    v.addEventListener('timeupdate', onTimeUpdate);
    v.load();

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
    difficultyScaler.evaluateAttempt(score.overallScore);

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

    // Show improvement phase automatically after combine/full
    if (phase === 'combine' || phase === 'full') {
      setTimeout(() => {
        sendSessionEvent({ type: 'GO_TO_IMPROVEMENT' });
        setShowImprovement(true);
      }, 500);
    }
  };

  // ── Preparation timer done ──
  const handlePrepDone = useCallback(() => {
    sendSessionEvent({ type: 'PREPARATION_DONE' });
    speechManager.speak("5, 6, 7, 8", 'urgent');
  }, [sendSessionEvent]);

  // ── Dynamic navigation ──
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
  const currentRefPose = referencePoses.length > 0 && refVideoRef.current
    ? referencePoses.find(p => p.timestamp_ms >= refVideoRef.current!.currentTime * 1000)?.landmarks
    : undefined;

  // ── Determine dynamic score display value ──
  const displayScore = focusArea === 'arms' ? currentArmScore
    : focusArea === 'legs' ? currentLegScore
    : (currentArmScore + currentLegScore) / 2;

  // ── View constants ──
  const totalChunks = _allChunks.length || 1;
  const hasAllChunks = _allChunks.length > 0;

  // ── Warm-up prompt (Step 0) ──
      {/* ── Loading overlay ── */}
      {(loadingData || !isWorkerReady) && (
        <div className="fixed inset-0 z-[100] bg-neutral-900 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-emerald-400">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-white text-lg">🎬 Getting ready...</p>
            <p className="text-gray-500 text-sm">Starting camera & AI tracker</p>
          </div>
        </div>
      )}

      {/* ── Preparation Timer (Step 1) ── */}
      {isPreparation && (
        <PreparationTimer
          onReady={handlePrepDone}
          onCancel={handlePrevPhase}
          playbackRate={effectivePlaybackRate}
          duration={6}
          phaseLabel={phaseLabel}
        />
      )}

      {/* ── Teach Phase (Step 2) ── */}
      {phase === 'teach' && (
        <TeachPhase
          keyframes={keyframes}
          onComplete={() => sendSessionEvent({ type: 'PHASE_COMPLETE' })}
        />
      )}

      {/* ── Improvement Phase (Step 6) ── */}
      {showImprovement && finalScore && (
        <ImprovementPhase
          finalScore={finalScore}
          referencePoses={referencePoses}
          userPose={userPose}
          jointScores={jointScores}
          chunkIndex={currentChunkIndex}
          totalChunks={totalChunks}
          onRetry={() => {
            setShowImprovement(false);
            setAttemptComplete(false);
            setFinalScore(null);
            sendSessionEvent({ type: 'RETURN_TO_PRACTICE' });
          }}
          onNextChunk={nextChunk}
          onPrevChunk={currentChunkIndex > 0 ? prevChunk : undefined}
          onFinishSession={handleFinishSession}
        />
      )}

      {/* ── Top bar (Dynamic Navigation) ── */}
      {!isPreparation && !showImprovement && (
        <header className={`absolute top-0 left-0 w-full z-50 px-6 py-4 flex items-center justify-between
          ${phase === 'teach' ? 'hidden' : ''}`}
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
      )}

      {/* ── Main area ── */}
      {!showImprovement && (
        <main className="flex-1 flex flex-col lg:flex-row w-full h-full relative">
          {/* ── LEFT: Reference video ── */}
          <div className="flex-1 relative bg-gray-900 border-r border-white/10 overflow-hidden">
            <video
              ref={refVideoRef}
              className="w-full h-full object-contain"
              muted
              playsInline
            />
            {videoError && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90 z-20">
                <div className="text-center p-6">
                  <p className="text-4xl mb-3">🎥</p>
                  <p className="text-red-400 text-sm font-medium">{videoError}</p>
                </div>
              </div>
            )}
            <div className="absolute inset-0 pointer-events-none">
              {currentRefPose && !videoError && (
                <SkeletonCanvas
                  landmarks={currentRefPose}
                  width={1280}
                  height={720}
                />
              )}
            </div>
          </div>

          {/* ── RIGHT: User webcam ── */}
          <div className="flex-1 relative bg-gray-950">
            {!hasWebcam && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black">
                <Camera className="w-16 h-16 text-destructive mb-4" />
                <p className="text-white font-semibold mb-4">{webcamError || '📷 Allow camera access'}</p>
                <button
                  onClick={handleRetryCamera}
                  disabled={retryingCam}
                  className="bg-primary hover:bg-primary/90 text-white font-bold px-6 py-3 rounded-xl transition-all"
                >
                  {retryingCam ? '⏳' : '📷 Start Camera'}
                </button>
              </div>
            )}

            {/* Visibility warning */}
            {visibleWarning && !showImprovement && (
              <div className="absolute inset-x-0 top-1/3 flex justify-center z-30">
                <div className="bg-yellow-500/20 border border-yellow-500/50 backdrop-blur-md px-4 py-3 rounded-2xl text-center flex items-center gap-3">
                  <p className="text-yellow-400 font-bold">👀 Step back!</p>
                  <button onClick={() => setVisibleWarning(false)} className="text-yellow-400/60 hover:text-yellow-400 text-lg">✕</button>
                </div>
              </div>
            )}

            {/* User stopped */}
            {userStopped && !attemptComplete && isPractice && (
              <div className="absolute inset-x-0 top-1/3 flex justify-center z-30">
                <div className="bg-blue-500/20 border border-blue-500/50 backdrop-blur-md px-6 py-4 rounded-2xl text-center space-y-3">
                  <p className="text-blue-400 font-bold text-lg">🐢 Slow it down?</p>
                  <p className="text-blue-300/70 text-sm">Taking it slower helps you learn.</p>
                  <div className="flex gap-3 justify-center">
                    <button onClick={handleSlowDown} className="bg-blue-500/80 hover:bg-blue-500 text-white font-bold px-6 py-3 rounded-xl transition-colors text-base">
                      🐢 Yes
                    </button>
                    <button onClick={clearUserStopped} className="bg-white/10 hover:bg-white/20 text-white font-bold px-6 py-3 rounded-xl transition-colors text-base">
                      ▶️ Keep going
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Frustration avoidance */}
            {isFrustrated && !attemptComplete && (
              <div className="absolute inset-x-0 bottom-4 flex justify-center z-30">
                <div className="bg-orange-500/20 border border-orange-500/40 backdrop-blur-md px-4 py-2 rounded-full text-center">
                  <p className="text-orange-300 text-sm">💪 Take your time — no rush!</p>
                </div>
              </div>
            )}

            {/* Processing status */}
            {hasWebcam && isPractice && !attemptComplete && (
              <div className="absolute top-4 right-4 z-30">
                <div className={`px-2 py-1 rounded-full text-xs font-bold backdrop-blur-md border flex items-center gap-1.5 ${
                  processingActive
                    ? 'bg-green-500/20 border-green-500/30 text-green-300'
                    : 'bg-yellow-500/20 border-yellow-500/30 text-yellow-300'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${processingActive ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
                  {processingActive ? 'Tracking' : 'Starting...'}
                </div>
              </div>
            )}

            {/* No pose data warning */}
            {hasWebcam && referencePoses.length === 0 && isPractice && !attemptComplete && (
              <div className="absolute top-16 right-4 z-30">
                <div className="bg-yellow-500/10 border border-yellow-500/20 backdrop-blur-md px-3 py-2 rounded-xl">
                  <p className="text-yellow-400/70 text-[10px]">⚠️ No reference poses — scores unavailable</p>
                </div>
              </div>
            )}

            <video
              ref={webcamRef}
              className={`w-full h-full object-cover ${isMirrorMode ? 'scale-x-[-1]' : ''}`}
              playsInline
              muted
            />

            <div className={`absolute inset-0 pointer-events-none ${isMirrorMode ? 'scale-x-[-1]' : ''}`}>
              {userPose && (
                <SkeletonCanvas
                  landmarks={userPose}
                  refLandmarks={currentRefPose}
                  focusArea={phase as any}
                  showArrows={isPractice || !!pendingAdjustment}
                  width={640}
                  height={480}
                  jointScores={jointScores.length > 0 ? Object.fromEntries(jointScores.map(j => [j.name, j.score])) as any : undefined}
                />
              )}
            </div>

            {/* Physical Adjustment Overlay */}
            {pendingAdjustment && (
              <div className="absolute inset-x-0 top-1/4 flex justify-center z-40 pointer-events-none">
                <div className="bg-red-500/20 border border-red-500/50 backdrop-blur-md px-6 py-4 rounded-2xl animate-pulse text-center">
                  <h3 className="text-red-400 font-bold text-xl mb-1">⏸️ Freeze!</h3>
                  <p className="text-white text-sm">
                    Move your <b className="text-red-300">{pendingAdjustment.jointId.replace('_', ' ')}</b> into the green zone.
                  </p>
                </div>
              </div>
            )}

            <BeatIndicator isPlaying={isPractice && !attemptComplete && !pendingAdjustment} playbackRate={effectivePlaybackRate} />

            {/* Green chime */}
            {showChime && (
              <div className="absolute top-4 left-4 z-30 animate-bounce">
                <div className="bg-green-500/30 border border-green-400/50 backdrop-blur-md px-4 py-2 rounded-full text-center">
                  <p className="text-green-300 font-bold text-sm">✨ Nice!</p>
                </div>
              </div>
            )}

            {/* Real-time Score Display */}
            {isPractice && !attemptComplete && (
              <div className="absolute bottom-16 right-8 z-30">
                <ScoreDisplay
                  score={displayScore}
                  jointAccuracy={{
                    upperBody: currentArmScore,
                    lowerBody: currentLegScore,
                    core: (currentArmScore + currentLegScore) / 2
                  }}
                />
              </div>
            )}
          </div>
        </main>
      )}

      {/* ── Completion AAR overlay (existing, non-improvement) ── */}
      {attemptComplete && finalScore && !showImprovement && (
        <div className="fixed inset-0 z-40 bg-black/85 backdrop-blur-sm flex items-center justify-center p-8">
          <div className="bg-white/5 backdrop-blur-xl p-8 rounded-3xl border border-white/10 max-w-sm w-full text-center space-y-6">
            <p className="text-white/60 text-sm uppercase tracking-widest">Phase Complete</p>
            <div className="text-6xl font-outfit font-bold text-primary neon-text">
              {Math.round(finalScore.overallScore)}%
            </div>
            <div className="flex justify-center gap-6 text-sm mt-2">
              <div className="text-center">
                <p className="text-2xl mb-1">💪</p>
                <p className="text-green-400 font-bold">{Math.round(finalScore.armScore)}%</p>
              </div>
              <div className="text-center">
                <p className="text-2xl mb-1">🦵</p>
                <p className="text-green-400 font-bold">{Math.round(finalScore.legScore)}%</p>
              </div>
              <div className="text-center">
                <p className="text-2xl mb-1">⏱️</p>
                <p className="text-green-400 font-bold">{Math.round(finalScore.timingScore)}%</p>
              </div>
            </div>

            {/* Weaker side indicator */}
            {finalScore.weakerSide && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2">
                <p className="text-amber-300 text-xs font-medium">
                  ⚠️ Focus on your <b>{finalScore.weakerSide}</b> side
                </p>
              </div>
            )}

            {/* Proprioceptive Questioning */}
            {proprioQuestion && (
              <div className="bg-primary/20 border border-primary/40 rounded-xl p-4">
                <p className="text-white font-medium text-sm">{proprioQuestion}</p>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => setProprioQuestion(null)} className="flex-1 bg-white/10 hover:bg-white/20 text-white text-xs py-2 rounded-lg transition-colors">
                    Not really
                  </button>
                  <button onClick={() => setProprioQuestion(null)} className="flex-1 bg-primary/80 hover:bg-primary text-white text-xs py-2 rounded-lg transition-colors">
                    Yes! 👍
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button onClick={handleRetry} className="flex-1 bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl transition-all text-base">
                🔄 Again
              </button>
              <button onClick={handleNextPhase} className="flex-1 bg-primary hover:bg-primary/90 text-white font-bold py-3 rounded-xl transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)] text-base">
                {phase === 'combine' || phase === 'full' ? '🤖 Improve' : '➡️ Next'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
