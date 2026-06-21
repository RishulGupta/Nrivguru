import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Camera } from 'lucide-react';
import SkeletonCanvas from '../components/SkeletonCanvas';
import ScoreDisplay from '../components/ScoreDisplay';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useStore';
import type { Chunk, Routine, FinalScore } from '@taal/shared/types/routine';
import type { PoseFrame } from '@taal/shared/types/pose';
import { usePracticeSession } from '../hooks/usePracticeSession';
import type { FocusArea } from '@taal/shared/utils/CorrectionEngine';
import { usePoseDetection } from '../hooks/usePoseDetection';
import { speechManager } from '@taal/shared/utils/SpeechManager';
import { countingSystem } from '@taal/shared/utils/CountingSystem';
import { TeachPhase } from '../components/TeachPhase';
import { extractKeyframes } from '@taal/shared/utils/KeyframeExtractor';
import { BeatIndicator } from '../components/BeatIndicator';
import { TeacherPersonality } from '@taal/shared/utils/TeacherPersonality';
import { sessionMemory } from '@taal/shared/utils/SessionMemory';
import { DifficultyScaler } from '@taal/shared/utils/DifficultyScaler';
import { getOriginalVideoUrl } from '../utils/videoStore';

export default function Practice() {
  const { id, chunkId } = useParams();
  const navigate = useNavigate();
  const session = useAuthStore(s => s.session);

  const webcamRef = useRef<HTMLVideoElement>(null);
  const refVideoRef = useRef<HTMLVideoElement>(null);

  const [hasWebcam, setHasWebcam] = useState(false);
  const [webcamError, setWebcamError] = useState('');
  const [isMirrorMode, setIsMirrorMode] = useState(true);
  
  // Data
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [chunk, setChunk] = useState<Chunk | null>(null);
  const [_chunks, setChunks] = useState<Chunk[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // New hooks
    const { 
      phase, 
      attemptCount: _attemptCount, 
      isSeatedMode, 
      playbackRate, 
      focusArea, 
      send: sendSessionEvent 
    } = usePracticeSession();

  const { 
    isWorkerReady, 
    userPose, 
    jointScores, 
    currentArmScore, 
    currentLegScore,
    pendingAdjustment,
    lowVisibility,
    userStopped,
    loadReference,
    processFrame,
    finishAttempt,
    clearUserStopped
  } = usePoseDetection();

  const [finalScore, setFinalScore] = useState<FinalScore | null>(null);
  const [attemptComplete, setAttemptComplete] = useState(false);
  const [referencePoses, setReferencePoses] = useState<PoseFrame[]>([]);
  const [keyframes, setKeyframes] = useState<PoseFrame[]>([]);

  // Phase 3 & 4 Modules
  const difficultyScaler = useRef(new DifficultyScaler()).current;
  const teacherPersonality = useRef(new TeacherPersonality()).current;
  const [proprioQuestion, setProprioQuestion] = useState<string | null>(null);
  
  const lastBreathingCueIndex = useRef(-1);

  const consecutiveGreenFrames = useRef(0);
  const lastChimeTime = useRef(0);

  // Load session memory & style
  useEffect(() => {
    if (routine) {
       sessionMemory.getLastSessionForRoutine(routine.id).then(lastSession => {
         if (lastSession && lastSession.worstJoints.length > 0) {
           speechManager.speak(`Welcome back! Let's focus on those ${lastSession.worstJoints[0].jointId.replace('_', ' ')}s today.`, "normal");
         }
       });
    }
  }, [routine, teacherPersonality]);

  const effectivePlaybackRate = (phase === 'full' || phase === 'full_speed') 
    ? difficultyScaler.getPlaybackRate() 
    : playbackRate;

  // Load routine data
  useEffect(() => {
    async function loadRoutine() {
      if (!id) { setLoadingData(false); return; }
      let data = null;
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
        const c = data.chunks || [];
        setChunks(c);
        let activeChunk = c[0];
        if (chunkId && chunkId !== 'full') {
          const found = c.find((ch: any) => ch.id === chunkId || String(ch.chunk_index) === chunkId);
          if (found) activeChunk = found;
        }
        setChunk(activeChunk);
        
        // Load pre-extracted poses if available
        if (activeChunk?.pose_slice_json) {
          try {
            const poses = typeof activeChunk.pose_slice_json === 'string' 
              ? JSON.parse(activeChunk.pose_slice_json) 
              : activeChunk.pose_slice_json;
            setReferencePoses(poses);
            loadReference(poses);
            setKeyframes(extractKeyframes(poses, 4));
          } catch(e) {
             console.error("Failed to parse pose_slice_json", e);
          }
        }
      }
      setLoadingData(false);
      
      // Auto-start chunk
      if (data) {
         sendSessionEvent({ type: 'START_CHUNK', chunkIndex: 0 });
      }
    }
    loadRoutine();
  }, [id, chunkId, session, loadReference, sendSessionEvent]);

  // Camera
  useEffect(() => {
    let active = true;
    async function setupCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false
        });
        if (webcamRef.current) {
          webcamRef.current.srcObject = stream;
          await webcamRef.current.play();
          if (active) setHasWebcam(true);
        }
      } catch {
        setWebcamError('Could not access webcam. Please allow camera permissions.');
      }
    }
    setupCamera();
    return () => { 
      active = false; 
      if (webcamRef.current?.srcObject) {
        (webcamRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // Sync reference video with chunk and phase
  useEffect(() => {
    const v = refVideoRef.current;
    if (!v || !chunk) return;
    
    // Resolve the video source: chunks don't have individual clip_urls,
    // they use time-range seeking on the original video.
    const videoSrc = chunk.clip_url 
      || getOriginalVideoUrl() 
      || routine?.video_blob_url 
      || '';
    v.src = videoSrc;
    v.load();
    v.playbackRate = effectivePlaybackRate;
    
    // Playback loop for the chunk
    const startMs = chunk.start_time_ms || 0;
    const endMs = chunk.end_time_ms || v.duration * 1000;
    
    v.currentTime = startMs / 1000;
    
    if (phase !== 'teach' && phase !== 'idle' && !attemptComplete && !pendingAdjustment) {
       v.play().catch(e => console.warn("Auto-play prevented", e));
       countingSystem.start(endMs - startMs, effectivePlaybackRate);
    } else {
       v.pause();
       countingSystem.stop();
    }
    
    const onTimeUpdate = () => {
       const currentMs = v.currentTime * 1000;
       
       // Phase 4: Breathing Cues
       if (chunk.breathing_cues && !speechManager.isSpeaking && phase === 'full') {
         const nextCueIdx = lastBreathingCueIndex.current + 1;
         if (nextCueIdx < chunk.breathing_cues.length) {
            const cue = chunk.breathing_cues[nextCueIdx];
            if (currentMs >= cue.timestamp_ms - 200) { // Trigger slightly before
               speechManager.speak(cue.type, 'urgent'); // "inhale" or "exhale"
               lastBreathingCueIndex.current = nextCueIdx;
            }
         }
       }

       if (currentMs >= endMs) {
          // Reached end of chunk
         v.pause();
         countingSystem.stop();
         
         if (phase === 'watch') {
           sendSessionEvent({ type: 'PHASE_COMPLETE' });
         } else if (phase !== 'teach' && phase !== 'idle') {
           handleScoredAttemptFinished();
         }
      }
    };
    
    v.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      v.removeEventListener('timeupdate', onTimeUpdate);
      countingSystem.stop();
    };
  }, [chunk, routine, phase, effectivePlaybackRate, attemptComplete, sendSessionEvent]);

  // Main processing loop
  useEffect(() => {
    let animationId: number;
    
    const loop = () => {
      const v = refVideoRef.current;
      const w = webcamRef.current;
      
      // If pendingAdjustment, we continue to process frames even though v is paused!
      if (v && w && (!v.paused || pendingAdjustment) && phase !== 'watch' && phase !== 'teach') {
        // We only process if video is playing and we are in a scored phase
        // The worker expects the timestamp of the reference video to align the poses
        processFrame(w, v.currentTime * 1000, focusArea as FocusArea);
      }
      
      animationId = requestAnimationFrame(loop);
    };
    
    if (isWorkerReady && hasWebcam) {
      animationId = requestAnimationFrame(loop);
    }
    
    return () => cancelAnimationFrame(animationId);
  }, [isWorkerReady, hasWebcam, phase, focusArea, processFrame]);

  // Green score chime
  useEffect(() => {
    if (currentArmScore > 85 && currentLegScore > 85 && phase !== 'teach' && phase !== 'idle' && phase !== 'watch') {
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
        } catch { /* ignore */ }
      }
    } else {
      consecutiveGreenFrames.current = 0;
    }
  }, [currentArmScore, currentLegScore, phase]);

  const handleScoredAttemptFinished = async () => {
     setAttemptComplete(true);
     const score = await finishAttempt();
     setFinalScore(score);
     
     // Adapt Difficulty
     difficultyScaler.evaluateAttempt(score.overallScore);
     
     // Proprioceptive Questioning (Phase 4)
     if (session?.user?.id && id) {
       const improvement = await sessionMemory.getOverallImprovement(id, score.overallScore);
       if (improvement && improvement > 15) {
          setProprioQuestion(`Massive improvement! You scored ${Math.round(improvement)}% higher. Could you feel the difference in your alignment?`);
       } else {
          setProprioQuestion(null);
       }
     }
     
     // Musicality Coach (Phase 3)
     if (score.timingFeedback) {
       speechManager.speak(score.timingFeedback, 'normal');
     }

     // Asymmetrical Feedback Adaptation (Feature 6)
     if (score.weakerSide) {
       speechManager.speak(`Your ${score.weakerSide} side needs more work. Let's focus there next time.`, 'normal');
     }
      
     // Provide verbal feedback
     if (score.overallScore > 85) {
       speechManager.speak("Excellent run! That was really accurate.", "praise");
     } else if (score.overallScore > 70) {
       speechManager.speak("Good effort. Let's look at the breakdown.", "normal");
     } else {
       speechManager.speak("That was tough, but you're getting there.", "normal");
     }
     
     // Save attempt...
     if (session?.user?.id && id) {
        supabase.rpc('rpc_save_attempt', {
          p_user_id: session.user.id, p_routine_id: id, p_chunk_id: chunk?.id || null,
          p_is_full_routine: false,
          p_arm_score: score.armScore, p_leg_score: score.legScore,
          p_timing_score: score.timingScore, p_overall_score: score.overallScore,
          p_missing_joints_flagged: false,
          p_duration_ms: chunk ? chunk.end_time_ms - chunk.start_time_ms : 0,
        }).then(() => {}, () => {});
        
        // Save to SessionMemory
        sessionMemory.saveSession({
          date: new Date().toISOString(),
          routineId: id,
          overallScore: score.overallScore,
          worstJoints: [], // We can pull this from score breakdown
          bestJoints: []
        });
     }
  };

  const handleNextPhase = () => {
     setAttemptComplete(false);
     setFinalScore(null);
     setProprioQuestion(null);
     // Dynamic bypass: if score > 85% in combine phase, skip directly to full speed
     if (phase === 'combine' && finalScore && finalScore.overallScore > 85) {
       speechManager.speak("Excellent! You've nailed this. Let's go full speed.", 'praise');
       sendSessionEvent({ type: 'SKIP_TO_FULL' });
     } else {
       sendSessionEvent({ type: 'PHASE_COMPLETE' });
     }
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

  if (loadingData || !isWorkerReady) {
    return (
      <div className="min-h-screen bg-neutral-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-emerald-400">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p>Loading session data... (Data: {!loadingData ? 'Ready' : 'Pending'}, Worker: {isWorkerReady ? 'Ready' : 'Pending'})</p>
        </div>
      </div>
    );
  }

  // Determine current skeleton to show on reference
  const currentRefPose = referencePoses.length > 0 && refVideoRef.current
    ? referencePoses.find(p => p.timestamp_ms >= refVideoRef.current!.currentTime)?.landmarks
    : undefined;

  return (
    <div className="min-h-screen bg-black flex flex-col relative overflow-hidden">
      
      {/* ── Phase 0: Teach Mode ── */}
      {phase === 'teach' && (
        <TeachPhase 
          keyframes={keyframes} 
          onComplete={() => sendSessionEvent({ type: 'PHASE_COMPLETE' })} 
        />
      )}

      {/* ── Top bar ── */}
      <header className="absolute top-0 left-0 w-full z-50 px-6 py-4 flex items-center justify-between">
        <button onClick={() => navigate(`/routine/${id}`)} className="w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-black/60 transition-colors border border-white/10">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3">
          <div className="bg-primary/20 backdrop-blur-md px-4 py-1.5 rounded-full border border-primary/30">
            <span className="text-primary text-xs font-bold tracking-wider uppercase">{phase} PHASE</span>
          </div>
          <button onClick={() => sendSessionEvent({ type: 'TOGGLE_SEATED' })} className={`px-3 py-1.5 rounded-full border backdrop-blur-md text-xs font-semibold transition-colors ${isSeatedMode ? 'bg-primary/20 border-primary text-primary' : 'bg-black/40 border-white/10 text-white'}`}>
            Seated {isSeatedMode ? 'ON' : 'OFF'}
          </button>
          <button onClick={() => setIsMirrorMode(!isMirrorMode)} className={`px-3 py-1.5 rounded-full border backdrop-blur-md text-xs font-semibold transition-colors ${isMirrorMode ? 'bg-primary/20 border-primary text-primary' : 'bg-black/40 border-white/10 text-white'}`}>
            Mirror {isMirrorMode ? 'ON' : 'OFF'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row w-full h-full relative">
        {/* ── LEFT: Reference video ── */}
        <div className="flex-1 relative bg-gray-900 border-r border-white/10 overflow-hidden">
          <video ref={refVideoRef} className={`w-full h-full object-contain transition-transform ${isMirrorMode ? 'scale-x-[-1]' : ''}`} muted playsInline />
          <div className={`absolute inset-0 pointer-events-none transition-transform ${isMirrorMode ? 'scale-x-[-1]' : ''}`}>
            {currentRefPose && (
              <SkeletonCanvas landmarks={currentRefPose} width={1280} height={720} />
            )}
          </div>
        </div>

        {/* ── RIGHT: User webcam ── */}
        <div className="flex-1 relative bg-gray-950">
          {!hasWebcam && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black">
              <Camera className="w-16 h-16 text-destructive mb-4" />
              <p className="text-white font-semibold">{webcamError || 'Waiting for camera...'}</p>
            </div>
          )}

          {lowVisibility && (
            <div className="absolute inset-x-0 top-1/3 flex justify-center z-30 pointer-events-none">
              <div className="bg-yellow-500/20 border border-yellow-500/50 backdrop-blur-md px-6 py-4 rounded-2xl animate-pulse text-center">
                <p className="text-yellow-400 font-semibold">Step back — I can&apos;t see your full body!</p>
              </div>
            </div>
          )}

          {userStopped && !attemptComplete && (
            <div className="absolute inset-x-0 top-1/3 flex justify-center z-35">
              <div className="bg-blue-500/20 border border-blue-500/50 backdrop-blur-md px-6 py-4 rounded-2xl text-center space-y-3">
                <p className="text-blue-400 font-semibold">You&apos;ve stopped moving. Slow it down?</p>
                <div className="flex gap-3">
                  <button onClick={handleSlowDown} className="bg-blue-500/80 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors">Slow it down</button>
                  <button onClick={clearUserStopped} className="bg-white/10 hover:bg-white/20 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors">Continue</button>
                </div>
              </div>
            </div>
          )}
          <video ref={webcamRef} className="w-full h-full object-cover scale-x-[-1]" playsInline muted />
          
          <div className="absolute inset-0 pointer-events-none scale-x-[-1]">
            {userPose && (
              <SkeletonCanvas 
                 landmarks={userPose} 
                 refLandmarks={currentRefPose}
                 focusArea={phase as any}
                 showArrows={phase === 'arms' || phase === 'legs' || phase === 'combine' || phase === 'full' || !!pendingAdjustment}
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
                  <h3 className="text-red-500 font-bold text-lg mb-1">Freeze!</h3>
                  <p className="text-white text-sm">Move your <b>{pendingAdjustment.jointId.replace('_', ' ')}</b> into the green zone.</p>
               </div>
            </div>
          )}

          <BeatIndicator isPlaying={phase !== 'teach' && phase !== 'idle' && !attemptComplete && !pendingAdjustment} playbackRate={playbackRate} />

          {/* Real-time Score Display */}
          {(phase === 'arms' || phase === 'legs' || phase === 'combine' || phase === 'full') && !attemptComplete && (
            <div className="absolute bottom-16 right-8 z-30">
               <ScoreDisplay 
                 score={focusArea === 'arms' ? currentArmScore : focusArea === 'legs' ? currentLegScore : (currentArmScore+currentLegScore)/2} 
                 combo={0} 
                 jointAccuracy={{
                   upperBody: currentArmScore,
                   lowerBody: currentLegScore,
                   core: (currentArmScore+currentLegScore)/2
                 }} 
               />
            </div>
          )}
        </div>
      </main>

      {/* ── Completion screen (AAR) ── */}
      {attemptComplete && finalScore && (
        <div className="absolute inset-0 z-40 bg-black/85 backdrop-blur-sm flex items-center justify-center p-8">
          <div className="glass p-8 rounded-3xl border border-white/10 max-w-md w-full text-center space-y-4">
            <h2 className="text-2xl font-outfit font-bold text-white">Attempt Complete</h2>
            <div className="text-5xl font-outfit font-bold text-primary neon-text">{Math.round(finalScore.overallScore)}%</div>
            <div className="grid grid-cols-3 gap-4 text-sm mt-4">
              <div className="bg-white/5 p-3 rounded-lg"><p className="text-muted-foreground">Arms</p><p className="text-white font-bold">{Math.round(finalScore.armScore)}%</p></div>
              <div className="bg-white/5 p-3 rounded-lg"><p className="text-muted-foreground">Legs</p><p className="text-white font-bold">{Math.round(finalScore.legScore)}%</p></div>
              <div className="bg-white/5 p-3 rounded-lg"><p className="text-muted-foreground">Timing</p><p className="text-white font-bold">{Math.round(finalScore.timingScore)}%</p></div>
            </div>

            {/* Proprioceptive Questioning */}
            {proprioQuestion && (
              <div className="bg-primary/20 border border-primary/40 rounded-xl p-4 mt-4 animate-in fade-in slide-in-from-bottom-4">
                <p className="text-white font-medium text-sm">{proprioQuestion}</p>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => setProprioQuestion(null)} className="flex-1 bg-white/10 hover:bg-white/20 text-white text-xs py-2 rounded-lg transition-colors">No, it felt the same</button>
                  <button onClick={() => setProprioQuestion(null)} className="flex-1 bg-primary/80 hover:bg-primary text-white text-xs py-2 rounded-lg transition-colors">Yes, I felt it!</button>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-6">
              <button onClick={handleRetry} className="flex-1 bg-white/10 hover:bg-white/20 text-white font-semibold py-3 rounded-xl transition-all">
                Retry ({playbackRate}x)
              </button>
              <button onClick={handleNextPhase} className="flex-1 bg-primary hover:bg-primary/90 text-white font-semibold py-3 rounded-xl transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)]">
                {phase === 'full' ? 'Finish Chunk' : 'Next Phase'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
