import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, AlertTriangle, CameraOff, SkipForward, ArrowRight } from 'lucide-react';
import { speechManager } from '@taal/shared/utils/SpeechManager';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

type WarmUpPhase = 'intro' | 'neck' | 'shoulders' | 'arms' | 'back' | 'legs' | 'done';

interface ExerciseConfig {
  emoji: string;
  title: string;
  instruction: string;
  repsNeeded: number;
  videoUrl: string;
}

const PHASE_CONFIG: Record<Exclude<WarmUpPhase, 'intro' | 'done'>, ExerciseConfig> = {
  neck: {
    emoji: '🔄',
    title: 'Neck Rolls',
    instruction: "Gently roll your head from side to side in a slow circle.",
    repsNeeded: 4,
    videoUrl: 'https://www.youtube.com/embed/NZHdC0aeJIs?autoplay=1&loop=1&mute=1&playlist=NZHdC0aeJIs&rel=0',
  },
  shoulders: {
    emoji: '🙆',
    title: 'Shoulder Shrugs',
    instruction: "Lift your shoulders up toward your ears, then release down.",
    repsNeeded: 6,
    videoUrl: 'https://www.youtube.com/embed/X7NtgY9kCCM?autoplay=1&loop=1&mute=1&playlist=X7NtgY9kCCM&rel=0',
  },
  arms: {
    emoji: '💪',
    title: 'Arm Circles',
    instruction: "Extend your arms out and make slow, controlled circles.",
    repsNeeded: 6,
    videoUrl: 'https://www.youtube.com/embed/hL6yIbjMsTM?autoplay=1&loop=1&mute=1&playlist=hL6yIbjMsTM&rel=0',
  },
  back: {
    emoji: '🧘',
    title: 'Back Stretch',
    instruction: "Twist your torso from side to side in a gentle stretch.",
    repsNeeded: 4,
    videoUrl: 'https://www.youtube.com/embed/BzYBkAvdCJY?autoplay=1&loop=1&mute=1&playlist=BzYBkAvdCJY&rel=0',
  },
  legs: {
    emoji: '🦵',
    title: 'Leg Swings',
    instruction: "Swing your leg forward and back to loosen the hips.",
    repsNeeded: 6,
    videoUrl: 'https://www.youtube.com/embed/DBke4X8-HkE?autoplay=1&loop=1&mute=1&playlist=DBke4X8-HkE&rel=0',
  },
};

// ─── Pose connections for skeleton drawing ───
const POSE_CONNECTIONS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [12, 14], [14, 16], [11, 13], [13, 15],
  [24, 26], [26, 28], [23, 25], [25, 27],
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
];

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: { x: number; y: number; z?: number; visibility?: number }[],
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);

  const toX = (x: number) => (1 - x) * width; // mirror
  const toY = (y: number) => y * height;

  // Bones
  ctx.lineWidth = 3;
  for (const [i, j] of POSE_CONNECTIONS) {
    const a = landmarks[i];
    const b = landmarks[j];
    if (!a || !b) continue;
    if ((a.visibility ?? 1) < 0.4 || (b.visibility ?? 1) < 0.4) continue;
    ctx.strokeStyle = `hsla(${280 + j * 8}, 80%, 65%, 0.85)`;
    ctx.beginPath();
    ctx.moveTo(toX(a.x), toY(a.y));
    ctx.lineTo(toX(b.x), toY(b.y));
    ctx.stroke();
  }

  // Joints with glow on key points
  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    if (!p || (p.visibility ?? 1) < 0.4) continue;
    const cx = toX(p.x);
    const cy = toY(p.y);

    if ([11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].includes(i)) {
      ctx.fillStyle = 'rgba(168,85,247,0.2)';
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#c084fc';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

type MotionState = { phase: 'waiting' | 'moving' | 'recovered'; prevY: number; prevX: number; count: number };

function analyzeMotion(
  landmarks: { x: number; y: number; z?: number; visibility?: number }[],
  exercise: WarmUpPhase,
  motionRef: React.MutableRefObject<MotionState>,
): { rep: boolean; feedback: string } {
  if (!landmarks || landmarks.length < 33) return { rep: false, feedback: '' };

  const v = (i: number) => landmarks[i]?.visibility ?? 0;

  switch (exercise) {
    case 'neck': {
      if (v(0) < 0.4 || v(11) < 0.3 || v(12) < 0.3) return { rep: false, feedback: 'Face the camera' };
      const nose = landmarks[0];
      const sMidX = (landmarks[11].x + landmarks[12].x) / 2;
      const sMidY = (landmarks[11].y + landmarks[12].y) / 2;
      const dx = nose.x - sMidX;
      const dy = nose.y - sMidY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.02) {
        motionRef.current = { ...motionRef.current, phase: 'waiting' };
        return { rep: false, feedback: 'Move your head around' };
      }
      const angle = Math.atan2(dy, dx);
      const prevAngle = Math.atan2(motionRef.current.prevY - sMidY, motionRef.current.prevX - sMidX);
      let angleDiff = angle - prevAngle;
      if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      if (motionRef.current.phase === 'moving' && Math.abs(angleDiff) > 1.5) {
        motionRef.current.count++;
        motionRef.current.phase = 'recovered';
        motionRef.current.prevX = nose.x;
        motionRef.current.prevY = nose.y;
        return { rep: true, feedback: motionRef.current.count >= 4 ? '' : 'Great roll!' };
      }
      motionRef.current.phase = 'moving';
      motionRef.current.prevX = nose.x;
      motionRef.current.prevY = nose.y;
      return { rep: false, feedback: dist > 0.05 ? 'Good motion' : 'Keep rolling' };
    }

    case 'shoulders': {
      if (v(11) < 0.3 || v(12) < 0.3) return { rep: false, feedback: 'Face the camera' };
      const avgY = (landmarks[11].y + landmarks[12].y) / 2;
      const diff = motionRef.current.prevY - avgY;
      if (diff > 0.025) {
        if (motionRef.current.phase === 'waiting') motionRef.current.phase = 'moving';
        motionRef.current.prevY = avgY;
        return { rep: false, feedback: 'Shrug up!' };
      } else if (diff < -0.015 && motionRef.current.phase === 'moving') {
        motionRef.current.count++;
        motionRef.current.phase = 'recovered';
        motionRef.current.prevY = avgY;
        return { rep: true, feedback: motionRef.current.count >= 6 ? '' : 'Down' };
      }
      motionRef.current.prevY = avgY;
      if (motionRef.current.phase === 'recovered' && Math.abs(diff) < 0.01) motionRef.current.phase = 'waiting';
      return { rep: false, feedback: 'Lift your shoulders up' };
    }

    case 'arms': {
      if (v(15) < 0.3 && v(16) < 0.3) return { rep: false, feedback: 'Extend your arms' };
      const wrist = v(15) > v(16) ? landmarks[15] : landmarks[16];
      const shX = (landmarks[11].x + landmarks[12].x) / 2;
      const shY = (landmarks[11].y + landmarks[12].y) / 2;
      const dx2 = wrist.x - shX;
      const dy2 = wrist.y - shY;
      const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      if (dist2 < 0.05) return { rep: false, feedback: 'Extend your arms out' };
      const angle2 = Math.atan2(dy2, dx2);
      const prevAngle2 = Math.atan2(motionRef.current.prevY - shY, motionRef.current.prevX - shX);
      let angleDiff2 = angle2 - prevAngle2;
      if (angleDiff2 > Math.PI) angleDiff2 -= Math.PI * 2;
      if (angleDiff2 < -Math.PI) angleDiff2 += Math.PI * 2;
      if (motionRef.current.phase === 'moving' && Math.abs(angleDiff2) > 1.2) {
        motionRef.current.count++;
        motionRef.current.phase = 'recovered';
        motionRef.current.prevX = wrist.x;
        motionRef.current.prevY = wrist.y;
        return { rep: true, feedback: motionRef.current.count >= 6 ? '' : 'Nice circle!' };
      }
      motionRef.current.phase = 'moving';
      motionRef.current.prevX = wrist.x;
      motionRef.current.prevY = wrist.y;
      return { rep: false, feedback: dist2 > 0.15 ? 'Good' : 'Make bigger circles' };
    }

    case 'back': {
      if (v(11) < 0.3 || v(12) < 0.3) return { rep: false, feedback: 'Face the camera' };
      const shoulderDelta = landmarks[11].x - landmarks[12].x;
      const absDelta = Math.abs(shoulderDelta);
      if (absDelta > 0.08) {
        if (motionRef.current.phase === 'waiting') motionRef.current.phase = 'moving';
        motionRef.current.prevX = shoulderDelta;
        return { rep: false, feedback: 'Twist more' };
      } else if (absDelta < 0.03 && motionRef.current.phase === 'moving') {
        if (Math.abs(motionRef.current.prevX) > 0.05) {
          motionRef.current.count++;
          motionRef.current.phase = 'recovered';
          motionRef.current.prevX = 0;
          return { rep: true, feedback: motionRef.current.count >= 4 ? '' : 'Center' };
        }
      }
      motionRef.current.prevX = shoulderDelta;
      if (motionRef.current.phase === 'recovered' && motionRef.current.count < 4) {
        if (absDelta < 0.02) motionRef.current.phase = 'waiting';
      }
      return { rep: false, feedback: absDelta > 0.04 ? 'Good twist!' : 'Twist your torso' };
    }

    case 'legs': {
      if (v(27) < 0.3 && v(28) < 0.3) return { rep: false, feedback: 'Face the camera' };
      const ankle = v(27) > v(28) ? landmarks[27] : landmarks[28];
      const hip = landmarks[23];
      const dx3 = ankle.x - hip.x;
      if (Math.abs(dx3) > 0.06) {
        if (motionRef.current.phase === 'waiting') motionRef.current.phase = 'moving';
        motionRef.current.prevX = dx3;
        return { rep: false, feedback: 'Swing!' };
      } else if (Math.abs(dx3) < 0.02 && motionRef.current.phase === 'moving') {
        if (Math.abs(motionRef.current.prevX) > 0.05) {
          motionRef.current.count++;
          motionRef.current.phase = 'recovered';
          motionRef.current.prevX = dx3;
          return { rep: true, feedback: motionRef.current.count >= 6 ? '' : 'Back' };
        }
      }
      motionRef.current.prevX = dx3;
      if (motionRef.current.phase === 'recovered' && Math.abs(dx3) < 0.01) motionRef.current.phase = 'waiting';
      return { rep: false, feedback: 'Swing your leg' };
    }

    default:
      return { rep: false, feedback: '' };
  }
}

export default function WarmUp() {
  const { id, chunkId } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [hasWebcam, setHasWebcam] = useState(false);
  const [webcamError, setWebcamError] = useState('');
  const [phase, setPhase] = useState<WarmUpPhase>('intro');
  const [progress, setProgress] = useState(0);
  const [reps, setReps] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [landmarks, setLandmarks] = useState<{ x: number; y: number; z?: number; visibility?: number }[] | null>(null);
  const [feedback, setFeedback] = useState('');
  const [modelLoading, setModelLoading] = useState(false);
  const [modelFailed, setModelFailed] = useState(false);
  const [videoError, setVideoError] = useState<Record<string, boolean>>({});

  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const animFrameRef = useRef<number>(0);
  const motionStateRef = useRef<MotionState>({ phase: 'waiting', prevY: 0, prevX: 0, count: 0 });
  const progressRef = useRef(0);
  const repsRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  // ── Camera init with timeout ──
  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled && !hasWebcam) {
        setWebcamError('Camera timed out. Check camera is not in use by another app.');
      }
    }, 10000);

    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        clearTimeout(timeout);
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          // Play may reject if browser needs user gesture; muted helps
          try { await v.play(); } catch (playErr) {
            console.warn('WarmUp: video play() needed user gesture', playErr);
            // Still usable — detectForVideo works with or without play()
          }
          if (!cancelled) setHasWebcam(true);
        }
      } catch (e: any) {
        clearTimeout(timeout);
        const msg = e?.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access in browser settings.'
          : e?.name === 'NotFoundError'
            ? 'No camera found. Connect a webcam.'
            : `Camera error: ${e?.message || 'unknown'}`;
        console.error('WarmUp: camera init failed', e);
        if (!cancelled) setWebcamError(msg);
      }
    }
    init();
    return () => { cancelled = true; clearTimeout(timeout); if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); };
  }, []);

  // ── Model init with GPU→CPU fallback ──
  useEffect(() => {
    let cancelled = false;
    async function initModel() {
      setModelLoading(true);
      const delegates: ('GPU' | 'CPU')[] = ['GPU', 'CPU'];
      for (const delegate of delegates) {
        if (cancelled) return;
        try {
          const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
          );
          landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
              delegate: delegate as 'GPU' | 'CPU',
            },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.3,
            minPosePresenceConfidence: 0.3,
            minTrackingConfidence: 0.3,
          });
          if (!cancelled) {
            setModelReady(true);
            setModelLoading(false);
            console.log(`WarmUp: PoseLandmarker initialized with ${delegate} delegate`);
            return;
          }
        } catch (e) {
          console.warn(`WarmUp: ${delegate} delegate failed`, e);
        }
      }
      if (!cancelled) {
        setModelFailed(true);
        setModelLoading(false);
      }
    }
    initModel();
    return () => { cancelled = true; };
  }, []);

  // ── Canvas + tracking loop ──
  useEffect(() => {
    if (!hasWebcam || !modelReady || phase === 'intro' || phase === 'done') return;

    let lastDetectTime = 0;
    const MIN_INTERVAL = 50;

    const loop = (now: number) => {
      const video = videoRef.current;
      const model = landmarkerRef.current;
      if (!video || !model || video.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(loop);
        return;
      }

      if (now - lastDetectTime < MIN_INTERVAL) {
        animFrameRef.current = requestAnimationFrame(loop);
        return;
      }
      lastDetectTime = now;

      try {
        const result = model.detectForVideo(video, now);
        if (result.landmarks && result.landmarks.length > 0) {
          const lm = result.landmarks[0] as { x: number; y: number; z?: number; visibility?: number }[];

          const avgVis = ([0, 11, 12, 23, 24].reduce((s, i) => s + (lm[i]?.visibility ?? 0), 0) / 5);
          if (avgVis < 0.35) {
            setFeedback('Move into frame');
            setLandmarks(null);
            animFrameRef.current = requestAnimationFrame(loop);
            return;
          }

          setLandmarks(lm);

          // Draw skeleton
          const canvas = canvasRef.current;
          if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) drawSkeleton(ctx, lm, canvas.width, canvas.height);
          }

          // Analyze motion
          const exPhase = phase as Exclude<WarmUpPhase, 'intro' | 'done'>;
          const { rep, feedback: fb } = analyzeMotion(lm, exPhase, motionStateRef);
          if (fb) setFeedback(fb);

          if (rep) {
            const newReps = repsRef.current + 1;
            repsRef.current = newReps;
            setReps(newReps);

            const config = PHASE_CONFIG[exPhase];
            const newProgress = Math.min(100, Math.round((newReps / config.repsNeeded) * 100));
            progressRef.current = newProgress;
            setProgress(newProgress);

            if (newReps >= config.repsNeeded) {
              setFeedback('✨');
              nextPhase();
              animFrameRef.current = requestAnimationFrame(loop);
              return;
            }
          }
        } else {
          setLandmarks(null);
          const canvas = canvasRef.current;
          if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
          setFeedback('Strike a pose');
        }
      } catch (e) {
        // detection error — continue
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      // Clear canvas on cleanup
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWebcam, modelReady, phase]);

  const nextPhase = useCallback(() => {
    const phaseOrder: WarmUpPhase[] = ['neck', 'shoulders', 'arms', 'back', 'legs'];
    const currentIdx = phaseOrder.indexOf(phase as WarmUpPhase);
    if (currentIdx < 0) return;

    motionStateRef.current = { phase: 'waiting', prevY: 0, prevX: 0, count: 0 };
    repsRef.current = 0;
    setReps(0);
    setProgress(0);

    if (currentIdx < phaseOrder.length - 1) {
      const next = phaseOrder[currentIdx + 1];
      setPhase(next);
      const cfg = PHASE_CONFIG[next];
      if (cfg) {
        setFeedback(cfg.instruction);
        setTimeout(() => speechManager.speak(cfg.instruction, 'normal'), 300);
      }
    } else {
      setPhase('done');
      speechManager.speak('Warm-up complete! You are ready to dance.', 'praise');
      setTimeout(() => {
        navigate(`/practice/${id}/${chunkId || 'full'}`);
      }, 2000);
    }
  }, [phase, navigate, id, chunkId]);

  const skipPhase = useCallback(() => {
    nextPhase();
  }, [nextPhase]);

  const startWarmUp = () => {
    setPhase('neck');
    repsRef.current = 0;
    progressRef.current = 0;
    setReps(0);
    setProgress(0);
    motionStateRef.current = { phase: 'waiting', prevY: 0, prevX: 0, count: 0 };
    const cfg = PHASE_CONFIG.neck;
    if (cfg) {
      setFeedback(cfg.instruction);
      speechManager.speak(cfg.instruction, 'normal');
    }
  };

  const skipToPractice = () => {
    navigate(`/practice/${id}/${chunkId || 'full'}`);
  };

  const handleVideoError = (exercise: string) => {
    setVideoError(prev => ({ ...prev, [exercise]: true }));
  };

  const config = phase !== 'intro' && phase !== 'done' ? PHASE_CONFIG[phase] : null;
  const phaseOrder: WarmUpPhase[] = ['neck', 'shoulders', 'arms', 'back', 'legs'];
  const currentPhaseIdx = phaseOrder.indexOf(phase as WarmUpPhase);

  return (
    <div className="h-screen w-screen bg-black flex flex-col overflow-hidden">
      {/* ── Webcam video: ALWAYS rendered so ref exists on mount ── */}
      <video
        ref={videoRef}
        className={`absolute inset-0 w-full h-full object-cover scale-x-[-1] ${phase === 'intro' ? 'opacity-0 pointer-events-none' : ''}`}
        autoPlay playsInline muted
      />

      {/* ── Header bar ── */}
      {config && (
        <div className="z-20 flex items-center justify-between px-4 py-2 bg-black/80 backdrop-blur border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xl">{config.emoji}</span>
            <h2 className="text-base font-outfit font-bold text-white">{config.title}</h2>
          </div>
          <div className="flex items-center gap-2">
            {/* Phase dots */}
            <div className="flex gap-1.5">
              {phaseOrder.map((p, i) => (
                <div
                  key={p}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i < currentPhaseIdx ? 'w-3 bg-green-500' : i === currentPhaseIdx ? 'w-5 bg-primary' : 'w-1.5 bg-gray-700'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN: Full split screen ── */}
      {phase === 'intro' ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
          <p className="text-5xl">🏋️</p>
          <h1 className="text-3xl font-outfit font-bold text-white">Warm up first!</h1>
          <p className="text-gray-400 text-sm">Prevent injuries &amp; calibrate tracking — 5 quick exercises</p>
          <div className="flex justify-center gap-3 text-2xl">
            <span>🔄</span><span>🙆</span><span>💪</span><span>🧘</span><span>🦵</span>
          </div>
          {webcamError && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-900/40 border border-red-500/30 rounded-xl text-red-300 text-sm">
              <CameraOff className="w-4 h-4 shrink-0" />
              {webcamError}
            </div>
          )}
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button
              onClick={startWarmUp}
              disabled={!hasWebcam}
              className="w-full py-4 bg-primary hover:bg-primary/90 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-xl font-bold shadow-[0_0_20px_rgba(147,51,234,0.4)] transition-all text-lg flex items-center justify-center gap-2"
            >
              {!hasWebcam ? <><Loader2 className="w-5 h-5 animate-spin" /> Starting camera...</> : '🔥 Start'}
            </button>
            <button onClick={skipToPractice} className="w-full py-4 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl font-medium transition-all">
              ⏭️ Skip warm-up
            </button>
          </div>
        </div>
      ) : phase === 'done' ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-5xl">✅</p>
          <h2 className="text-3xl font-outfit font-bold text-green-400">All Set!</h2>
          <p className="text-white">Starting practice...</p>
          <Loader2 className="w-6 h-6 text-white animate-spin" />
        </div>
      ) : config ? (
        <>
          {/* Full-screen split: left = reference video, right = webcam */}
          <div className="flex-1 flex flex-col sm:flex-row min-h-0">
            {/* ─── LEFT HALF: Reference exercise video ─── */}
            <div className="flex-1 relative bg-gray-900 min-h-[30vh] sm:min-h-0 flex flex-col items-center justify-center">
              <span className="absolute top-2 left-3 z-10 text-xs text-gray-400 uppercase tracking-wider bg-black/50 px-2 py-0.5 rounded">
                Reference
              </span>
              {videoError[phase] ? (
                <div className="flex flex-col items-center gap-2 text-gray-500 p-4">
                  <CameraOff className="w-8 h-8" />
                  <span className="text-xs">Video unavailable</span>
                  <span className="text-xs text-gray-600">{config.instruction}</span>
                </div>
              ) : (
                <iframe
                  key={phase}
                  src={config.videoUrl}
                  className="w-full h-full"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  onError={() => handleVideoError(phase)}
                  title={config.title}
                />
              )}
            </div>

            {/* ─── RIGHT HALF: Webcam + skeleton overlay ─── */}
            <div className="flex-1 relative min-h-[30vh] sm:min-h-0">
              <span className="absolute top-2 left-3 z-10 text-xs text-gray-400 uppercase tracking-wider bg-black/50 px-2 py-0.5 rounded">
                You
              </span>

              {/* Skeleton overlay — right half is transparent so the absolute video behind shows */}
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
                width={640}
                height={480}
              />

              {/* Detection info overlay */}
              <div className="absolute bottom-3 left-3 right-3 flex flex-col gap-1.5">
                {/* Progress bar */}
                <div className="w-full h-2 bg-gray-800/80 rounded-full overflow-hidden backdrop-blur">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-200 ease-linear"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                {/* Status row */}
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-gray-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                    Reps: {reps}/{config.repsNeeded}
                  </span>
                  <span className="flex items-center gap-1 text-gray-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                    {landmarks ? (
                      <><span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Active</>
                    ) : modelLoading ? (
                      <><Loader2 className="w-2.5 h-2.5 animate-spin" /> Loading AI...</>
                    ) : modelFailed ? (
                      <><AlertTriangle className="w-2.5 h-2.5 text-yellow-400" /> No AI</>
                    ) : (
                      <><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" /> Waiting...</>
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Bottom controls bar ── */}
          <div className="z-20 flex items-center justify-between px-4 py-2.5 bg-black/80 backdrop-blur border-t border-white/5 shrink-0">
            {/* Feedback */}
            <div className="flex-1 min-w-0">
              {feedback && (
                <p className="text-sm text-gray-200 truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                  {feedback}
                </p>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={skipPhase}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-gray-300 rounded-lg text-xs font-medium transition-colors"
              >
                <SkipForward className="w-3.5 h-3.5" />
                Skip
              </button>
              <button
                onClick={skipToPractice}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-500 rounded-lg text-xs transition-colors"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                End warm-up
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
