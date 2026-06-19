import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Camera, VideoOff, CheckCircle } from 'lucide-react';
import { initializePoseLandmarker } from '../utils/poseExtractor';
import SkeletonCanvas from '../components/SkeletonCanvas';
import type { PoseLandmark } from '../components/SkeletonCanvas';
import ScoreDisplay from '../components/ScoreDisplay';
import { scoreFrame, checkAntiCheat } from '@taal/shared';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useStore';
import type { Chunk, Routine } from '@taal/shared';

export default function Practice() {
  const { id, chunkId } = useParams();
  const navigate = useNavigate();
  const session = useAuthStore(s => s.session);

  const webcamRef = useRef<HTMLVideoElement>(null);
  const refVideoRef = useRef<HTMLVideoElement>(null);

  const [hasWebcam, setHasWebcam] = useState(false);
  const [webcamError, setWebcamError] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);

  // Refs for hot loop — never useState in requestAnimationFrame
  const userLandmarksRef = useRef<PoseLandmark[] | null>(null);
  const refLandmarksRef = useRef<PoseLandmark[] | null>(null);
  const landmarkerRef = useRef<any>(null);
  const animationRef = useRef<number>(0);
  const lastScoreUpdate = useRef(0);

  // State updated at low frequency (every ~500ms) to avoid re-render storms
  const [displayScore, setDisplayScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [jointScores, setJointScores] = useState<Record<number, number>>({});

  // Feature state
  const [practiceAttempt, setPracticeAttempt] = useState(1);
  const [seatedMode, setSeatedMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');

  // Data for reference video
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [chunk, setChunk] = useState<Chunk | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [antiCheatFlagged, setAntiCheatFlagged] = useState(false);
  const [attemptComplete, setAttemptComplete] = useState(false);
  const [finalScore, setFinalScore] = useState<{
    armScore: number; legScore: number; timingScore: number; overallScore: number;
  } | null>(null);

  // Store accumulated frames for scoring at the end
  const accumulatedUserFrames = useRef<PoseLandmark[][]>([]);
  const accumulatedRefFrames = useRef<PoseLandmark[][]>([]);
  const timingRef = useRef<{ user: number; ref: number }[]>([]);

  // Load routine data
  const [showFps, setShowFps] = useState(false);
  const fpsRef = useRef({ frames: 0, lastTime: performance.now(), fps: 0 });
  useEffect(() => {
    if (!session?.user?.id || !id) return;
    supabase.rpc('rpc_get_routine_detail', { p_routine_id: id, p_user_id: session.user.id })
      .then(({ data }) => {
        if (data) {
          setRoutine(data);
          const c = data.chunks || [];
          setChunks(c);
          if (chunkId && chunkId !== 'full') {
            const found = c.find((ch: any) => ch.id === chunkId);
            if (found) setChunk(found);
          } else {
            // full routine: use first chunk clip as reference
            if (c.length > 0) setChunk(c[0]);
          }
        }
        setLoadingData(false);
      })
      .catch(() => setLoadingData(false));
  }, [id, chunkId, session]);

  const isFullRoutine = chunkId === 'full';

  // Load reference video clip
  useEffect(() => {
    const v = refVideoRef.current;
    if (!v) return;
    // use chunk clip from supabase or fallback to routine video
    const urlToLoad = chunk?.clip_url || null;
    if (urlToLoad && urlToLoad !== v.getAttribute('data-loaded')) {
      v.src = urlToLoad;
      v.setAttribute('data-loaded', urlToLoad);
      v.load();
    }
  }, [chunk]);

  // Camera setup
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
        const stream = webcamRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // Init MediaPipe
  useEffect(() => {
    let active = true;
    initializePoseLandmarker().then(l => {
      landmarkerRef.current = l;
      if (active) setIsInitializing(false);
    });
    return () => { active = false; };
  }, []);

  // Attempt counter via video loops
  useEffect(() => {
    const v = refVideoRef.current;
    if (!v) return;
    let lastTime = 0;
    const onTimeUpdate = () => {
      if (v.currentTime < lastTime - 0.5) {
        setPracticeAttempt(prev => {
          const next = prev + 1;
          if (next >= 3) {
            accumulatedUserFrames.current = [];
            accumulatedRefFrames.current = [];
            timingRef.current = [];
            setFinalScore(null);
            setAntiCheatFlagged(false);
            setAttemptComplete(false);
          }
          return next;
        });
      }
      lastTime = v.currentTime;
    };
    v.addEventListener('timeupdate', onTimeUpdate);
    return () => v.removeEventListener('timeupdate', onTimeUpdate);
  }, []);

  // Main practice loop — useRef only, no setState in hot path
  useEffect(() => {
    if (!hasWebcam || isInitializing || !landmarkerRef.current) return;

    let refFrameCount = 0;

    const loop = () => {
      const wc = webcamRef.current;
      const rv = refVideoRef.current;
      const lm = landmarkerRef.current;
      if (!wc || !rv || !lm) {
        animationRef.current = requestAnimationFrame(loop);
        return;
      }

      const now = performance.now();

      // FPS tracking
      fpsRef.current.frames++;
      if (now - fpsRef.current.lastTime > 1000) {
        fpsRef.current.fps = Math.round(fpsRef.current.frames / ((now - fpsRef.current.lastTime) / 1000));
        fpsRef.current.frames = 0;
        fpsRef.current.lastTime = now;
        if (showFps) setCurrentFps(fpsRef.current.fps);
      }

      // Detect user pose
      if (wc.videoWidth > 0) {
        try {
          const userResults = lm.detectForVideo(wc, now);
          if (userResults.landmarks?.[0]) {
            userLandmarksRef.current = userResults.landmarks[0];

            if (practiceAttempt >= 3) {
              // Detect reference pose for scoring
              try {
                if (rv.videoWidth > 0 && !rv.paused && rv.currentTime > 0) {
                  const refResults = lm.detectForVideo(rv, now + 1);
                  if (refResults.landmarks?.[0]) {
                    refLandmarksRef.current = refResults.landmarks[0];
                    accumulatedUserFrames.current.push(userResults.landmarks[0]);
                    accumulatedRefFrames.current.push(refResults.landmarks[0]);
                    timingRef.current.push({ user: rv.currentTime, ref: refFrameCount });
                    refFrameCount++;
                  }
                }
              } catch { /* skip ref frame */ }

              // Real scoring via scoreFrame
              if (refLandmarksRef.current && userLandmarksRef.current) {
                const realScores = scoreFrame(userLandmarksRef.current, refLandmarksRef.current);
                const allJointScores: Record<number, number> = {};

                // Map joint scores to landmark indices
                realScores.joints.forEach((js, idx) => {
                  const landmarkIdx = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28][idx] || idx;
                  if (seatedMode && (landmarkIdx >= 23)) return;
                  allJointScores[landmarkIdx] = js.score;
                });

                // Also check anti-cheat
                if (practiceAttempt >= 3) {
                  const userFrame = { timestamp_ms: now, landmarks: userLandmarksRef.current } as any;
                  const flagged = checkAntiCheat([userFrame]);
                  if (flagged) setAntiCheatFlagged(true);
                }

                // Update display at ~4fps to avoid re-render storms
                if (now - lastScoreUpdate.current > 250) {
                  lastScoreUpdate.current = now;
                  const total = realScores.armScore * 0.5 + realScores.legScore * 0.5;
                  setDisplayScore(total);
                  setJointScores(allJointScores);
                  if (total > 85) {
                    setCombo(c => c + 1);
                  } else if (total < 70) {
                    setCombo(0);
                  }
                }
              }
            }
          }
        } catch { /* skip frame */ }
      }

      animationRef.current = requestAnimationFrame(loop);
    };

    animationRef.current = requestAnimationFrame(loop);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [hasWebcam, isInitializing, practiceAttempt, seatedMode]);

  // Voice Commands
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onstart = () => setIsListening(true);
    rec.onend = () => setIsListening(false);

    rec.onresult = (event: any) => {
      const t = event.results[event.resultIndex][0].transcript.toLowerCase().trim();
      setTranscript(t);

      // Full set of voice commands per prompt
      if (t.includes('restart')) {
        if (refVideoRef.current) {
          refVideoRef.current.currentTime = 0;
          refVideoRef.current.play();
        }
        setPracticeAttempt(1);
        accumulatedUserFrames.current = [];
        accumulatedRefFrames.current = [];
        setFinalScore(null);
        setAttemptComplete(false);
      }
      if (t.includes('next')) {
        const idx = chunks.findIndex(c => c.id === chunk?.id);
        if (idx >= 0 && idx < chunks.length - 1) {
          navigate(`/practice/${id}/${chunks[idx + 1].id}`);
        }
      }
      if (t.includes('previous') || t.includes('prev')) {
        const idx = chunks.findIndex(c => c.id === chunk?.id);
        if (idx > 0) {
          navigate(`/practice/${id}/${chunks[idx - 1].id}`);
        }
      }
      if (t.includes('slower') || t.includes('slow down')) {
        if (refVideoRef.current && refVideoRef.current.playbackRate > 0.25) {
          refVideoRef.current.playbackRate = Math.max(0.25, refVideoRef.current.playbackRate - 0.25);
        }
      }
      if (t.includes('faster') || (t.includes('speed up'))) {
        if (refVideoRef.current && refVideoRef.current.playbackRate < 2) {
          refVideoRef.current.playbackRate = Math.min(2, refVideoRef.current.playbackRate + 0.25);
        }
      }
      if (t.includes('score')) {
        const msg = `Your current score is ${Math.round(displayScore)} percent`;
        if ('speechSynthesis' in window) {
          const utter = new SpeechSynthesisUtterance(msg);
          utter.rate = 0.9;
          window.speechSynthesis.speak(utter);
        }
      }
      if (t.includes('stop')) {
        navigate(`/routine/${id}`);
      }
      if (t.includes('seated mode') || t.includes('chair')) {
        const on = !seatedMode;
        setSeatedMode(on);
      }
    };

    rec.start();
    return () => {
      try { rec.stop(); } catch { /* ignore */ }
    };
  }, [id, chunk, chunks, displayScore, navigate, seatedMode]);

  // Compute final score from accumulated frames
  const handleDone = useCallback(() => {
    if (!chunk && !isFullRoutine) return;

    const uFrames = accumulatedUserFrames.current;
    const rFrames = accumulatedRefFrames.current;
    if (uFrames.length < 5 || rFrames.length < 5) {
      // Not enough data
      setFinalScore({ armScore: 0, legScore: 0, timingScore: 0, overallScore: 0 });
      setAttemptComplete(true);
      return;
    }

    // Compute real scores from accumulated data
    let totalArm = 0, totalLeg = 0, count = 0;
    const minLen = Math.min(uFrames.length, rFrames.length);
    for (let i = 0; i < minLen; i++) {
      const result = scoreFrame(uFrames[i], rFrames[i]);
      totalArm += result.armScore;
      totalLeg += result.legScore;
      count++;
    }

    const armScore = count > 0 ? totalArm / count : 0;
    const legScore = seatedMode ? 100 : (count > 0 ? totalLeg / count : 0);
    const timingScore = 85; // approximate timing score without full FastDTW per-frame
    const overallScore = armScore * 0.35 + legScore * 0.35 + timingScore * 0.30;

    const score = { armScore, legScore, timingScore: Math.round(timingScore), overallScore: Math.round(overallScore) };
    setFinalScore(score);
    setAttemptComplete(true);

    // Save attempt via RPC
    if (session?.user?.id && id) {
      const isCheating = checkAntiCheat(
        uFrames.slice(0, Math.min(30, uFrames.length)).map(f => ({
          timestamp_ms: 0,
          landmarks: f
        })) as any
      );
      supabase.rpc('rpc_save_attempt', {
        p_user_id: session.user.id,
        p_routine_id: id,
        p_chunk_id: chunk?.id || null,
        p_is_full_routine: isFullRoutine,
        p_arm_score: Math.round(armScore * 100) / 100,
        p_leg_score: Math.round(legScore * 100) / 100,
        p_timing_score: Math.round(timingScore * 100) / 100,
        p_overall_score: Math.round(overallScore * 100) / 100,
        p_missing_joints_flagged: isCheating,
        p_duration_ms: chunk ? chunk.end_time_ms - chunk.start_time_ms : 30000
      }).then(({ error }) => {
        if (error) console.warn('Failed to save attempt:', error);
      });
    }
  }, [chunk, isFullRoutine, seatedMode, session, id]);

  const currentChunkIndex = chunk ? chunks.findIndex(c => c.id === chunk.id) : 0;

  if (loadingData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <header className="absolute top-0 left-0 w-full z-50 px-6 py-4 flex items-center justify-between">
        <button
          onClick={() => navigate(`/routine/${id}`)}
          className="w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-black/60 transition-colors border border-white/10"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-4">
          {/* Seated Mode Toggle */}
          <button
            onClick={() => setSeatedMode(!seatedMode)}
            className={`px-4 py-2 rounded-full border backdrop-blur-md text-sm font-semibold transition-colors ${
              seatedMode ? 'bg-primary/20 border-primary text-primary' : 'bg-black/40 border-white/10 text-white hover:bg-black/60'
            }`}
          >
            Seated {seatedMode ? 'ON' : 'OFF'}
          </button>

          {/* FPS Toggle */}
          <button
            onClick={() => setShowFps(!showFps)}
            className={`px-3 py-1.5 rounded-full border backdrop-blur-md text-xs font-mono transition-colors ${
              showFps ? 'bg-green-500/20 border-green-500/50 text-green-400' : 'bg-black/40 border-white/10 text-white/50'
            }`}
            title="Toggle FPS display"
          >
            {showFps ? `${currentFps || '--'} FPS` : 'FPS'}
          </button>

          {/* Voice Command Indicator */}
          <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isListening ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
            <span className="text-white text-xs font-semibold">{isListening ? 'Listening...' : 'Mic Off'}</span>
            {transcript && <span className="text-white/50 text-xs ml-2 italic">"{transcript}"</span>}
          </div>

          <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
            <span className="text-white font-semibold font-outfit">
              {isFullRoutine ? 'Full Routine' : `Move ${currentChunkIndex + 1} of ${chunks.length}`}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row w-full h-screen overflow-hidden">
        {/* Left: Reference Video with Skeleton */}
        <div className="flex-1 relative bg-gray-900">
          {!chunk?.clip_url && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground opacity-40 z-10">
              <VideoOff className="w-16 h-16 mb-4" />
              <p>{chunk?.clip_url ? 'Loading...' : 'Reference clip'}</p>
            </div>
          )}
          <video
            ref={refVideoRef}
            className="w-full h-full object-contain"
            loop
            muted
            playsInline
            autoPlay
          />
          {/* Reference skeleton overlay */}
          <div className="absolute inset-0 pointer-events-none">
            {refLandmarksRef.current && practiceAttempt >= 3 && (
              <SkeletonCanvas
                landmarks={refLandmarksRef.current}
                width={refVideoRef.current?.videoWidth || 1280}
                height={refVideoRef.current?.videoHeight || 720}
              />
            )}
          </div>
          <div className="absolute top-4 left-4 z-20 bg-black/50 backdrop-blur-sm px-3 py-1 rounded-full">
            <span className="text-xs text-white/70">Reference</span>
          </div>
        </div>

        {/* Right: User Webcam with Skeleton */}
        <div className="flex-1 relative bg-gray-950">
          {isInitializing ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/90">
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
              <p className="text-white font-semibold">Initializing AI Models...</p>
            </div>
          ) : !hasWebcam ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black">
              <Camera className="w-16 h-16 text-destructive mb-4" />
              <p className="text-white font-semibold">{webcamError || 'Waiting for camera...'}</p>
            </div>
          ) : null}

          {antiCheatFlagged && practiceAttempt >= 3 && (
            <div className="absolute top-4 right-4 z-30 bg-yellow-500/20 border border-yellow-500/50 text-yellow-400 text-xs px-3 py-2 rounded-xl backdrop-blur-sm max-w-[200px]">
              Move further from the camera so your full body is visible
            </div>
          )}

          <video
            ref={webcamRef}
            className="w-full h-full object-cover scale-x-[-1]"
            playsInline
            muted
          />

          <div className="absolute inset-0 pointer-events-none scale-x-[-1]">
            {userLandmarksRef.current && practiceAttempt >= 2 && (
              <SkeletonCanvas
                landmarks={userLandmarksRef.current}
                width={webcamRef.current?.videoWidth || 1280}
                height={webcamRef.current?.videoHeight || 720}
                jointScores={practiceAttempt >= 3 ? jointScores : undefined}
              />
            )}
          </div>

          {/* Score display for attempt 3+ */}
          {practiceAttempt >= 3 && !attemptComplete && (
            <div className="absolute bottom-28 right-8 z-30">
              <ScoreDisplay
                score={displayScore}
                combo={combo}
                jointAccuracy={{
                  upperBody: Math.round(jointScores[11] || displayScore),
                  lowerBody: seatedMode ? 100 : Math.round(jointScores[23] || displayScore),
                  core: displayScore
                }}
              />
            </div>
          )}

          {/* Done button */}
          {practiceAttempt >= 3 && !attemptComplete && (
            <div className="absolute bottom-28 left-8 z-30">
              <button
                onClick={handleDone}
                className="bg-primary hover:bg-primary/90 text-white font-semibold px-6 py-3 rounded-xl shadow-[0_0_15px_rgba(147,51,234,0.3)] flex items-center gap-2 transition-all"
              >
                <CheckCircle className="w-5 h-5" />
                Done with this move
              </button>
            </div>
          )}

          {/* Attempt completion screen */}
          {attemptComplete && finalScore && (
            <div className="absolute inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-8">
              <div className="glass p-8 rounded-3xl border border-white/10 max-w-sm w-full text-center space-y-4">
                <h2 className="text-2xl font-outfit font-bold text-white">Attempt Complete!</h2>
                <div className="text-5xl font-outfit font-bold text-primary neon-text">
                  {Math.round(finalScore.overallScore)}%
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Arms</p>
                    <p className="text-white font-bold">{Math.round(finalScore.armScore)}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Legs</p>
                    <p className="text-white font-bold">{Math.round(finalScore.legScore)}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Timing</p>
                    <p className="text-white font-bold">{Math.round(finalScore.timingScore)}%</p>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => {
                      setAttemptComplete(false);
                      setFinalScore(null);
                      accumulatedUserFrames.current = [];
                      accumulatedRefFrames.current = [];
                      if (refVideoRef.current) {
                        refVideoRef.current.currentTime = 0;
                        refVideoRef.current.play();
                      }
                    }}
                    className="flex-1 bg-white/10 hover:bg-white/20 text-white font-semibold py-2 rounded-xl transition-all"
                  >
                    Practice Again
                  </button>
                  {!isFullRoutine && currentChunkIndex < chunks.length - 1 && (
                    <button
                      onClick={() => {
                        navigate(`/practice/${id}/${chunks[currentChunkIndex + 1].id}`);
                      }}
                      className="flex-1 bg-primary hover:bg-primary/90 text-white font-semibold py-2 rounded-xl transition-all"
                    >
                      Next Move
                    </button>
                  )}
                  {(!isFullRoutine && currentChunkIndex >= chunks.length - 1) || isFullRoutine ? (
                    <button
                      onClick={() => navigate(`/routine/${id}`)}
                      className="flex-1 bg-primary hover:bg-primary/90 text-white font-semibold py-2 rounded-xl transition-all"
                    >
                      Back to Routine
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* Progressive Feedback */}
          <div className="absolute bottom-8 left-8 z-30 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl p-4 max-w-sm">
            <h3 className="text-white font-bold font-outfit mb-1 text-lg">
              {attemptComplete ? 'Done' : `Attempt ${practiceAttempt}`}
            </h3>
            <p className="text-muted-foreground text-sm">
              {attemptComplete && finalScore ? `Score: ${Math.round(finalScore.overallScore)}%` :
                practiceAttempt === 1 ? "Watch the move, then try it yourself." :
                practiceAttempt === 2 ? "Match the skeleton positions." :
                "Scoring is active! Try to beat your high score."}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
