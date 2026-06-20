import { useEffect, useRef, useState } from 'react';
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
    loadReference,
    processFrame,
    finishAttempt 
  } = usePoseDetection();

  const [finalScore, setFinalScore] = useState<FinalScore | null>(null);
  const [attemptComplete, setAttemptComplete] = useState(false);
  const [referencePoses, setReferencePoses] = useState<PoseFrame[]>([]);
  const [keyframes, setKeyframes] = useState<PoseFrame[]>([]);

  // Phase 3 Modules
  const difficultyScaler = useRef(new DifficultyScaler()).current;
  const teacherPersonality = useRef(new TeacherPersonality()).current;

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
    
    v.src = chunk.clip_url || '';
    v.load();
    v.playbackRate = effectivePlaybackRate;
    
    // Playback loop for the chunk
    const startMs = chunk.start_time_ms || 0;
    const endMs = chunk.end_time_ms || v.duration * 1000;
    
    v.currentTime = startMs / 1000;
    
    if (phase !== 'teach' && phase !== 'idle' && !attemptComplete) {
       v.play().catch(e => console.warn("Auto-play prevented", e));
       countingSystem.start(endMs - startMs, effectivePlaybackRate);
    } else {
       v.pause();
       countingSystem.stop();
    }
    
    const onTimeUpdate = () => {
      if (v.currentTime * 1000 >= endMs) {
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
      
      if (v && w && !v.paused && phase !== 'watch' && phase !== 'teach') {
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

  const handleScoredAttemptFinished = async () => {
     setAttemptComplete(true);
     const score = await finishAttempt();
     setFinalScore(score);
     
     // Adapt Difficulty
     difficultyScaler.evaluateAttempt(score.overallScore);
     
     // Musicality Coach (Phase 3)
     // To be implemented using Web Worker pose history
     
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
     sendSessionEvent({ type: 'PHASE_COMPLETE' });
  };
  
  const handleRetry = () => {
     setAttemptComplete(false);
     setFinalScore(null);
     sendSessionEvent({ type: 'RESTART_CHUNK' });
  };

  if (loadingData || !isWorkerReady) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
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
          <video ref={webcamRef} className="w-full h-full object-cover scale-x-[-1]" playsInline muted />
          
          <div className="absolute inset-0 pointer-events-none scale-x-[-1]">
            {userPose && (
              <SkeletonCanvas 
                 landmarks={userPose} 
                 refLandmarks={currentRefPose}
                 focusArea={phase as any}
                 showArrows={phase === 'arms' || phase === 'legs' || phase === 'combine' || phase === 'full'}
                 width={640} 
                 height={480} 
                 jointScores={jointScores.length > 0 ? Object.fromEntries(jointScores.map(j => [j.name, j.score])) as any : undefined} 
              />
            )}
          </div>

          <BeatIndicator isPlaying={phase !== 'teach' && phase !== 'idle' && !attemptComplete} playbackRate={playbackRate} />

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
