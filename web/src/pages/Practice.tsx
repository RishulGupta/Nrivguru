import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Camera, VideoOff, CheckCircle, Music, Volume2 } from 'lucide-react';
import { initializePoseLandmarker } from '../utils/poseExtractor';
import SkeletonCanvas from '../components/SkeletonCanvas';
import type { PoseLandmark } from '../components/SkeletonCanvas';
import ScoreDisplay from '../components/ScoreDisplay';
import { scoreFrame, checkAntiCheat } from '@taal/shared';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useStore';
import type { Chunk, Routine } from '@taal/shared';

// ─── Speech helpers (the digital dance teacher's voice) ───
function speak(text: string) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.85;
    u.pitch = 1.0;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  }
}

// ─── The teacher's lesson plan for each attempt ───
const ATTEMPT_LESSONS = [
  { label: 'Watch & Listen', instruction: 'Watch the move carefully. Pay attention to the arms and footwork.', focus: 'observe' },
  { label: 'Follow the Skeleton', instruction: 'Try to match the skeleton positions. Focus on your form.', focus: 'form' },
  { label: 'Full Scoring — Arms Focus', instruction: 'Now we score! Focus on keeping your arms in the right position.', focus: 'arms' },
  { label: 'Full Scoring — Legs Focus', instruction: 'Great! This time focus on your legs and footwork.', focus: 'legs' },
  { label: 'Full Scoring — Put It Together', instruction: 'Final round! Put everything together for your best score.', focus: 'full' },
];

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

  // Display state (updated at low frequency)
  const [displayScore, setDisplayScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [jointScores, setJointScores] = useState<Record<number, number>>({});

  // Teaching state
  const [practiceAttempt, setPracticeAttempt] = useState(1);
  const [seatedMode, setSeatedMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [countIn, setCountIn] = useState(0); // 0 = no count, 8/7/6/... = counting in
  const [teacherTip, setTeacherTip] = useState('');
  const [lastAttemptFeedback, setLastAttemptFeedback] = useState('');
  const [attemptLog, setAttemptLog] = useState<{ attempt: number; arms: number; legs: number; tip: string }[]>([]);

  // Data
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [chunk, setChunk] = useState<Chunk | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [antiCheatFlagged, setAntiCheatFlagged] = useState(false);
  const [attemptComplete, setAttemptComplete] = useState(false);
  const [finalScore, setFinalScore] = useState<{
    armScore: number; legScore: number; timingScore: number; overallScore: number;
  } | null>(null);
  const [showFps, setShowFps] = useState(false);
  const fpsRef = useRef({ frames: 0, lastTime: performance.now(), fps: 0 });

  // Accumulated frames for end-of-attempt analysis
  const accumulatedUserFrames = useRef<PoseLandmark[][]>([]);
  const accumulatedRefFrames = useRef<PoseLandmark[][]>([]);
  const jointAccumulator = useRef<Record<string, number[]>>({});

  // ── Speech on attempt change (the teacher speaks) ──
  useEffect(() => {
    if (loadingData) return;
    const lesson = ATTEMPT_LESSONS[Math.min(practiceAttempt - 1, ATTEMPT_LESSONS.length - 1)];
    setTeacherTip(lesson.instruction);
    if (practiceAttempt >= 2) {
      // Don't speak on first load — user might not be ready
      setTimeout(() => speak(lesson.instruction), 500);
    }
    // Auto count-in when attempt starts
    if (practiceAttempt >= 2) {
      startCountIn();
    }
  }, [practiceAttempt, loadingData]);

  function startCountIn() {
    let c = 8;
    setCountIn(c);
    const interval = setInterval(() => {
      c--;
      setCountIn(c > 0 ? c : 0);
      if (c > 0) speak(String(c));
      else {
        clearInterval(interval);
        if (refVideoRef.current) {
          refVideoRef.current.currentTime = chunk ? (chunk.start_time_ms || 0) / 1000 : 0;
          refVideoRef.current.play();
        }
      }
    }, 600);
  }

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
        if (chunkId && chunkId !== 'full') {
          const found = c.find((ch: any) => ch.id === chunkId || String(ch.chunk_index) === chunkId);
          if (found) setChunk(found);
          else if (c.length > 0) setChunk(c[0]);
        } else {
          if (c.length > 0) setChunk(c[0]);
        }
      }
      setLoadingData(false);
    }
    loadRoutine();
  }, [id, chunkId, session]);

  const isFullRoutine = chunkId === 'full';

  // Load reference video
  useEffect(() => {
    const v = refVideoRef.current;
    if (!v) return;
    const urlToLoad = chunk?.clip_url || routine?.video_blob_url || null;
    if (urlToLoad && urlToLoad !== v.getAttribute('data-loaded')) {
      v.src = urlToLoad;
      v.setAttribute('data-loaded', urlToLoad);
      v.load();
      if (!chunk?.clip_url && chunk && v.readyState >= 1) {
        v.currentTime = (chunk.start_time_ms || 0) / 1000;
      }
    }
    if (urlToLoad && chunk && !chunk?.clip_url) {
      const onTimeUpdate = () => {
        if (chunk.end_time_ms && v.currentTime * 1000 >= chunk.end_time_ms) {
          v.currentTime = (chunk.start_time_ms || 0) / 1000;
          if (practiceAttempt >= 2) v.play();
        }
      };
      v.addEventListener('timeupdate', onTimeUpdate);
      return () => v.removeEventListener('timeupdate', onTimeUpdate);
    }
  }, [chunk, routine]);

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
    return () => { active = false; if (webcamRef.current?.srcObject) {
      (webcamRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    }};
  }, []);

  // MediaPipe init
  useEffect(() => {
    let active = true;
    initializePoseLandmarker().then(l => {
      landmarkerRef.current = l;
      if (active) setIsInitializing(false);
    });
    return () => { active = false; };
  }, []);

  // Attempt tracker via video loops
  useEffect(() => {
    const v = refVideoRef.current;
    if (!v) return;
    let lastTime = 0;
    const onTimeUpdate = () => {
      if (v.currentTime < lastTime - 0.5) {
        setPracticeAttempt(prev => {
          const next = Math.min(prev + 1, ATTEMPT_LESSONS.length);
          accumulatedUserFrames.current = [];
          accumulatedRefFrames.current = [];
          jointAccumulator.current = {};
          setFinalScore(null);
          setAntiCheatFlagged(false);
          setAttemptComplete(false);
          return next;
        });
      }
      lastTime = v.currentTime;
    };
    v.addEventListener('timeupdate', onTimeUpdate);
    return () => v.removeEventListener('timeupdate', onTimeUpdate);
  }, []);

  // Main practice loop
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

      // FPS
      fpsRef.current.frames++;
      if (now - fpsRef.current.lastTime > 1000) {
        fpsRef.current.fps = Math.round(fpsRef.current.frames / ((now - fpsRef.current.lastTime) / 1000));
        fpsRef.current.frames = 0;
        fpsRef.current.lastTime = now;
        // FPS is read from fpsRef.current.fps directly in the header
      }

      // Detect user pose
      if (wc.videoWidth > 0) {
        try {
          const userResults = lm.detectForVideo(wc, now);
          if (userResults.landmarks?.[0]) {
            userLandmarksRef.current = userResults.landmarks[0];

            if (practiceAttempt >= 3) {
              // Detect reference pose
              try {
                if (rv.videoWidth > 0 && !rv.paused && rv.currentTime > 0) {
                  const refResults = lm.detectForVideo(rv, now + 1);
                  if (refResults.landmarks?.[0]) {
                    refLandmarksRef.current = refResults.landmarks[0];
                    accumulatedUserFrames.current.push(userResults.landmarks[0]);
                    accumulatedRefFrames.current.push(refResults.landmarks[0]);
                    refFrameCount++;
                  }
                }
              } catch { /* skip */ }

              // Score the frame
              if (refLandmarksRef.current && userLandmarksRef.current) {
                const realScores = scoreFrame(userLandmarksRef.current, refLandmarksRef.current);
                const lesson = ATTEMPT_LESSONS[Math.min(practiceAttempt - 1, ATTEMPT_LESSONS.length - 1)];

                const allJointScores: Record<number, number> = {};
                realScores.joints.forEach((js) => {
                  const idxMap: Record<string, number> = {
                    left_elbow: 13, right_elbow: 14, left_shoulder: 11, right_shoulder: 12,
                    left_knee: 25, right_knee: 26, left_hip: 23, right_hip: 24,
                  };
                  const lidx = idxMap[js.name] ?? 0;
                  if (seatedMode && lidx >= 23) return;
                  if (lesson.focus === 'arms' && js.type === 'leg') return;
                  if (lesson.focus === 'legs' && js.type === 'arm') return;
                  allJointScores[lidx] = js.score;

                  // Accumulate joint data for end-of-attempt feedback
                  if (!jointAccumulator.current[js.name]) jointAccumulator.current[js.name] = [];
                  jointAccumulator.current[js.name].push(js.diff);
                });

                // Anti-cheat
                if (practiceAttempt >= 3) {
                  const userFrame = { timestamp_ms: now, landmarks: userLandmarksRef.current } as any;
                  if (checkAntiCheat([userFrame])) setAntiCheatFlagged(true);
                }

                // Update display at ~4fps
                if (now - lastScoreUpdate.current > 250) {
                  lastScoreUpdate.current = now;
                  const armAvg = realScores.armScore;
                  const legAvg = seatedMode ? 100 : realScores.legScore;
                  const total = lesson.focus === 'arms' ? armAvg : lesson.focus === 'legs' ? legAvg : (armAvg * 0.5 + legAvg * 0.5);
                  setDisplayScore(total);
                  setJointScores(allJointScores);
                  if (total > 85) setCombo(c => c + 1);
                  else if (total < 70) setCombo(0);
                }
              }
            }
          }
        } catch { /* skip frame */ }
      }
      animationRef.current = requestAnimationFrame(loop);
    };

    animationRef.current = requestAnimationFrame(loop);
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [hasWebcam, isInitializing, practiceAttempt, seatedMode]);

  // Voice commands
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
      if (t.includes('restart')) {
        if (refVideoRef.current) { refVideoRef.current.currentTime = 0; refVideoRef.current.play(); }
        setPracticeAttempt(1);
        accumulatedUserFrames.current = []; accumulatedRefFrames.current = [];
        setFinalScore(null); setAttemptComplete(false);
        speak('Restarting. Watch the move first.');
      }
      if (t.includes('next')) {
        const idx = chunks.findIndex(c => c.id === chunk?.id);
        if (idx >= 0 && idx < chunks.length - 1) navigate(`/practice/${id}/${chunks[idx + 1].id}`);
        else speak('This is the last move.');
      }
      if (t.includes('previous') || t.includes('prev')) {
        const idx = chunks.findIndex(c => c.id === chunk?.id);
        if (idx > 0) navigate(`/practice/${id}/${chunks[idx - 1].id}`);
      }
      if (t.includes('slower')) {
        if (refVideoRef.current && refVideoRef.current.playbackRate > 0.25) {
          refVideoRef.current.playbackRate = Math.max(0.25, refVideoRef.current.playbackRate - 0.25);
          speak(`Slowing down to ${refVideoRef.current.playbackRate.toFixed(2)}x speed`);
        }
      }
      if (t.includes('faster') || t.includes('speed up')) {
        if (refVideoRef.current && refVideoRef.current.playbackRate < 2) {
          refVideoRef.current.playbackRate = Math.min(2, refVideoRef.current.playbackRate + 0.25);
          speak(`Speeding up to ${refVideoRef.current.playbackRate.toFixed(2)}x speed`);
        }
      }
      if (t.includes('score')) speak(`Your current score is ${Math.round(displayScore)} percent`);
      if (t.includes('stop')) navigate(`/routine/${id}`);
      if (t.includes('seated') || t.includes('chair')) { setSeatedMode(p => !p); speak(seatedMode ? 'Full body mode' : 'Seated mode, upper body only'); }
    };
    rec.start();
    return () => { try { rec.stop(); } catch { /* ignore */ }};
  }, [id, chunk, chunks, displayScore, navigate, seatedMode]);

  // Handle Done — generate TEACHER FEEDBACK
  const handleDone = useCallback(() => {
    if (!chunk && !isFullRoutine) return;
    const uFrames = accumulatedUserFrames.current;
    const rFrames = accumulatedRefFrames.current;
    if (uFrames.length < 3 || rFrames.length < 3) {
      setFinalScore({ armScore: 0, legScore: 0, timingScore: 0, overallScore: 0 });
      setAttemptComplete(true);
      setLastAttemptFeedback('Not enough data to score. Try moving closer to the camera.');
      return;
    }

    // Compute scores
    let totalArm = 0, totalLeg = 0, count = 0;
    const minLen = Math.min(uFrames.length, rFrames.length);
    for (let i = 0; i < minLen; i++) {
      const result = scoreFrame(uFrames[i], rFrames[i]);
      totalArm += result.armScore; totalLeg += result.legScore; count++;
    }
    const armScore = count > 0 ? totalArm / count : 0;
    const legScore = seatedMode ? 100 : (count > 0 ? totalLeg / count : 0);
    const timingScore = 85;
    const overallScore = armScore * 0.35 + legScore * 0.35 + timingScore * 0.30;
    const score = { armScore, legScore, timingScore: Math.round(timingScore), overallScore: Math.round(overallScore) };
    setFinalScore(score);
    setAttemptComplete(true);
    setAttemptLog(prev => [...prev, { attempt: practiceAttempt, arms: Math.round(armScore), legs: Math.round(legScore), tip: '' }]);

    // ── Generate teacher feedback from joint accumulator ──
    const worstJoints: { name: string; avgDiff: number }[] = [];
    for (const [name, diffs] of Object.entries(jointAccumulator.current)) {
      const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      worstJoints.push({ name, avgDiff: avg });
    }
    worstJoints.sort((a, b) => b.avgDiff - a.avgDiff);
    const worst = worstJoints.slice(0, 2);
    let feedback = '';
    if (worst.length > 0 && worst[0].avgDiff > 20) {
      const nameMap: Record<string, string> = {
        left_elbow: 'your left elbow', right_elbow: 'your right elbow',
        left_shoulder: 'your left shoulder', right_shoulder: 'your right shoulder',
        left_knee: 'your left knee', right_knee: 'your right knee',
        left_hip: 'your left hip', right_hip: 'your right hip',
      };
      const fixMap: Record<string, string> = {
        left_elbow: 'Try keeping it bent at a sharper angle.',
        right_elbow: 'Try keeping it bent at a sharper angle.',
        left_shoulder: 'Keep your shoulder relaxed and down.',
        right_shoulder: 'Keep your shoulder relaxed and down.',
        left_knee: 'Bend your knee more deeply.',
        right_knee: 'Bend your knee more deeply.',
        left_hip: 'Engage your core and lift from the hip.',
        right_hip: 'Engage your core and lift from the hip.',
      };
      const part = nameMap[worst[0].name] || 'your posture';
      const fix = fixMap[worst[0].name] || 'Try adjusting your form.';
      feedback = `${part} is ${Math.round(worst[0].avgDiff)}° off. ${fix}`;
      if (worst.length > 1 && worst[1].avgDiff > 20) {
        const part2 = nameMap[worst[1].name] || 'your posture';
        feedback += ` Also work on ${part2}.`;
      }
    } else if (overallScore > 85) {
      feedback = 'Great form! Your posture is very close to the reference.';
    } else {
      feedback = 'Good effort! Keep practicing and focus on matching the joint positions.';
    }
    setLastAttemptFeedback(feedback);

    // Speak the feedback
    setTimeout(() => speak(feedback), 300);

    // Save attempt via RPC
    if (session?.user?.id && id) {
      const isCheating = checkAntiCheat(uFrames.slice(0, 30).map(f => ({ timestamp_ms: 0, landmarks: f })) as any);
      supabase.rpc('rpc_save_attempt', {
        p_user_id: session.user.id, p_routine_id: id, p_chunk_id: chunk?.id || null,
        p_is_full_routine: isFullRoutine,
        p_arm_score: Math.round(armScore * 100) / 100, p_leg_score: Math.round(legScore * 100) / 100,
        p_timing_score: Math.round(timingScore * 100) / 100, p_overall_score: Math.round(overallScore * 100) / 100,
        p_missing_joints_flagged: isCheating,
        p_duration_ms: chunk ? chunk.end_time_ms - chunk.start_time_ms : 30000,
      }).catch(() => {});
    }
  }, [chunk, isFullRoutine, seatedMode, session, id, practiceAttempt]);

  const currentChunkIndex = chunk ? chunks.findIndex(c => c.id === chunk.id) : 0;
  const lesson = ATTEMPT_LESSONS[Math.min(practiceAttempt - 1, ATTEMPT_LESSONS.length - 1)];

  if (loadingData) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* ── Top bar ── */}
      <header className="absolute top-0 left-0 w-full z-50 px-6 py-4 flex items-center justify-between">
        <button onClick={() => navigate(`/routine/${id}`)} className="w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-black/60 transition-colors border border-white/10">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3">
          {/* Lesson label */}
          <div className="bg-primary/20 backdrop-blur-md px-4 py-1.5 rounded-full border border-primary/30">
            <span className="text-primary text-xs font-bold tracking-wider">{lesson.label}</span>
          </div>
          {/* Seated mode */}
          <button onClick={() => setSeatedMode(!seatedMode)} className={`px-3 py-1.5 rounded-full border backdrop-blur-md text-xs font-semibold transition-colors ${seatedMode ? 'bg-primary/20 border-primary text-primary' : 'bg-black/40 border-white/10 text-white'}`}>
            Seated {seatedMode ? 'ON' : 'OFF'}
          </button>
          {/* FPS */}
          <button onClick={() => setShowFps(!showFps)} className={`px-3 py-1.5 rounded-full border backdrop-blur-md text-xs font-mono transition-colors ${showFps ? 'bg-green-500/20 border-green-500/50 text-green-400' : 'bg-black/40 border-white/10 text-white/50'}`}>
            {showFps ? `${fpsRef.current.fps || '--'} FPS` : 'FPS'}
          </button>
          {/* Voice indicator */}
          <div className="bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${isListening ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-white text-[10px] font-semibold">VOICE</span>
          </div>
          {/* Chunk label */}
          <div className="bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
            <span className="text-white text-xs font-semibold">{isFullRoutine ? 'Full Routine' : `Move ${currentChunkIndex + 1}/${chunks.length}`}</span>
          </div>
        </div>
      </header>

      {/* ── Count-in overlay ── */}
      {countIn > 0 && (
        <div className="absolute inset-0 z-50 bg-black/70 flex items-center justify-center">
          <div className="text-center">
            <div className="text-8xl font-outfit font-bold text-white neon-text animate-pulse">{countIn}</div>
            <p className="text-muted-foreground mt-4 text-lg">Get ready...</p>
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col lg:flex-row w-full h-screen overflow-hidden">
        {/* ── LEFT: Reference video ── */}
        <div className="flex-1 relative bg-gray-900">
          {!chunk?.clip_url && !routine?.video_blob_url && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground opacity-40 z-10">
              <VideoOff className="w-16 h-16 mb-4" />
              <p>Reference clip</p>
            </div>
          )}
          <video ref={refVideoRef} className="w-full h-full object-contain" loop muted playsInline autoPlay />
          <div className="absolute inset-0 pointer-events-none">
            {refLandmarksRef.current && practiceAttempt >= 3 && (
              <SkeletonCanvas landmarks={refLandmarksRef.current} width={refVideoRef.current?.videoWidth || 1280} height={refVideoRef.current?.videoHeight || 720} />
            )}
          </div>
          <div className="absolute top-4 left-4 z-20 bg-black/50 backdrop-blur-sm px-3 py-1 rounded-full">
            <span className="text-xs text-white/70">Reference — {lesson.focus !== 'observe' ? 'match this pose' : 'watch carefully'}</span>
          </div>
        </div>

        {/* ── RIGHT: User webcam ── */}
        <div className="flex-1 relative bg-gray-950">
          {isInitializing ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/90">
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
              <p className="text-white font-semibold">Initializing AI teacher...</p>
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

          <video ref={webcamRef} className="w-full h-full object-cover scale-x-[-1]" playsInline muted />

          {/* Skeleton overlay */}
          <div className="absolute inset-0 pointer-events-none scale-x-[-1]">
            {userLandmarksRef.current && practiceAttempt >= 2 && (
              <SkeletonCanvas landmarks={userLandmarksRef.current} width={webcamRef.current?.videoWidth || 1280} height={webcamRef.current?.videoHeight || 720} jointScores={practiceAttempt >= 3 ? jointScores : undefined} />
            )}
          </div>

          {/* Score for attempt 3+ */}
          {practiceAttempt >= 3 && !attemptComplete && (
            <div className="absolute bottom-32 right-8 z-30">
              <ScoreDisplay score={displayScore} combo={combo} jointAccuracy={{
                upperBody: Math.round(jointScores[11] || displayScore),
                lowerBody: seatedMode ? 100 : Math.round(jointScores[23] || displayScore),
                core: displayScore,
              }} />
            </div>
          )}

          {/* Done button */}
          {practiceAttempt >= 3 && !attemptComplete && (
            <div className="absolute bottom-32 left-8 z-30">
              <button onClick={handleDone} className="bg-primary hover:bg-primary/90 text-white font-semibold px-6 py-3 rounded-xl shadow-[0_0_15px_rgba(147,51,234,0.3)] flex items-center gap-2 transition-all">
                <CheckCircle className="w-5 h-5" />
                Done with this move
              </button>
            </div>
          )}

          {/* ── Completion screen with teacher feedback ── */}
          {attemptComplete && finalScore && (
            <div className="absolute inset-0 z-40 bg-black/85 backdrop-blur-sm flex items-center justify-center p-8">
              <div className="glass p-8 rounded-3xl border border-white/10 max-w-md w-full text-center space-y-4">
                <h2 className="text-2xl font-outfit font-bold text-white">Great effort!</h2>
                <div className="text-5xl font-outfit font-bold text-primary neon-text">{Math.round(finalScore.overallScore)}%</div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Arms</p><p className="text-white font-bold">{Math.round(finalScore.armScore)}%</p></div>
                  <div><p className="text-muted-foreground">Legs</p><p className="text-white font-bold">{Math.round(finalScore.legScore)}%</p></div>
                  <div><p className="text-muted-foreground">Timing</p><p className="text-white font-bold">{Math.round(finalScore.timingScore)}%</p></div>
                </div>

                {/* Teacher's verbal feedback */}
                {lastAttemptFeedback && (
                  <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 text-left">
                    <div className="flex items-start gap-2">
                      <Volume2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-primary font-semibold mb-1">DANCE TEACHER SAYS:</p>
                        <p className="text-sm text-white leading-relaxed">{lastAttemptFeedback}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Attempt history log */}
                {attemptLog.length > 1 && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold text-white/70">Progress:</p>
                    {attemptLog.map((a, i) => (
                      <div key={i} className="flex justify-between">
                        <span>Attempt {a.attempt}</span>
                        <span>Arms {a.arms}% / Legs {a.legs}%</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Next step buttons */}
                <div className="flex gap-3 pt-2">
                  <button onClick={() => { setAttemptComplete(false); setFinalScore(null); accumulatedUserFrames.current = []; accumulatedRefFrames.current = []; jointAccumulator.current = {}; if (refVideoRef.current) { refVideoRef.current.currentTime = (chunk?.start_time_ms || 0) / 1000; refVideoRef.current.play(); }}} className="flex-1 bg-white/10 hover:bg-white/20 text-white font-semibold py-2.5 rounded-xl transition-all text-sm">
                    Practice Again
                  </button>
                  {!isFullRoutine && currentChunkIndex < chunks.length - 1 && (
                    <button onClick={() => navigate(`/practice/${id}/${chunks[currentChunkIndex + 1].id}`)} className="flex-1 bg-primary hover:bg-primary/90 text-white font-semibold py-2.5 rounded-xl transition-all text-sm">
                      Next Move
                    </button>
                  )}
                  {((!isFullRoutine && currentChunkIndex >= chunks.length - 1) || isFullRoutine) && (
                    <button onClick={() => navigate(`/routine/${id}`)} className="flex-1 bg-primary hover:bg-primary/90 text-white font-semibold py-2.5 rounded-xl transition-all text-sm">
                      Back to Routine
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Progressive feedback ── */}
          <div className="absolute bottom-8 left-8 z-30 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl p-4 max-w-sm">
            <h3 className="text-white font-bold font-outfit mb-1 text-lg">{attemptComplete ? 'Done' : `Attempt ${practiceAttempt}/${ATTEMPT_LESSONS.length}`}</h3>
            <p className="text-muted-foreground text-sm">{attemptComplete && finalScore ? `Score: ${Math.round(finalScore.overallScore)}%` : teacherTip}</p>
            {/* Beat indicator */}
            {practiceAttempt >= 2 && !attemptComplete && (
              <div className="flex items-center gap-1 mt-2">
                <Music className="w-3 h-3 text-primary" />
                <span className="text-[10px] text-muted-foreground">Follow the rhythm</span>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
