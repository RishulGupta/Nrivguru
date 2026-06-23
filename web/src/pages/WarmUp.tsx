import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { speechManager } from '@taal/shared/utils/SpeechManager';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

type WarmUpPhase = 'intro' | 'neck' | 'shoulders' | 'arms' | 'back' | 'legs' | 'done';

const PHASE_CONFIG: Record<WarmUpPhase, { emoji: string; title: string; instruction: string } | null> = {
  intro: null,
  neck: {
    emoji: '🔄',
    title: 'Neck Rolls',
    instruction: "Let's warm up the neck. Gently roll your head from side to side."
  },
  shoulders: {
    emoji: '🙆',
    title: 'Shoulder Shrugs',
    instruction: "Great. Now let's do shoulder shrugs — lift and roll your shoulders back."
  },
  arms: {
    emoji: '💪',
    title: 'Arm Circles',
    instruction: "Now arm circles. Extend your arms and make slow, controlled circles."
  },
  back: {
    emoji: '🧘',
    title: 'Back Stretch',
    instruction: "Awesome. Now a gentle back stretch — twist your torso from side to side."
  },
  legs: {
    emoji: '🦵',
    title: 'Leg Swings',
    instruction: "Last one! Swing your legs forward and back to loosen the hips and hamstrings."
  },
  done: null
};

export default function WarmUp() {
  const { id, chunkId } = useParams();
  const navigate = useNavigate();
  const webcamRef = useRef<HTMLVideoElement>(null);

  const [hasWebcam, setHasWebcam] = useState(false);
  const [phase, setPhase] = useState<WarmUpPhase>('intro');
  const [progress, setProgress] = useState(0);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);

  useEffect(() => {
    async function initCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (webcamRef.current) {
          webcamRef.current.srcObject = stream;
          webcamRef.current.play();
          setHasWebcam(true);
        }
      } catch (e) {
        console.error('Camera access required for warm-up tracking.', e);
      }
    }

    async function initModel() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );
        landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numPoses: 1
        });
      } catch (e) {
        console.warn('Warm-up model init failed, continuing without tracking', e);
      }
    }

    initCamera();
    initModel();

    return () => {
      if (webcamRef.current?.srcObject) {
        (webcamRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const skipWarmUp = () => {
    navigate(`/practice/${id}/${chunkId || 'full'}`);
  };

  const startWarmUp = () => {
    setPhase('neck');
    const cfg = PHASE_CONFIG.neck;
    if (cfg) speechManager.speak(cfg.instruction, "normal");
  };

  // Tracking loop
  useEffect(() => {
    if (!hasWebcam || phase === 'intro' || phase === 'done') return;

    let animationId: number;
    const loop = () => {
      if (webcamRef.current && landmarkerRef.current) {
        try {
          const result = landmarkerRef.current.detectForVideo(webcamRef.current, performance.now());
          if (result.landmarks && result.landmarks.length > 0) {
            setProgress(prev => {
              const next = prev + 0.4;
              if (next >= 100) {
                handlePhaseComplete();
                return 0;
              }
              return next;
            });
          }
        } catch (e) {}
      }
      animationId = requestAnimationFrame(loop);
    };

    animationId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationId);
  }, [hasWebcam, phase]);

  const handlePhaseComplete = () => {
    const phaseOrder: WarmUpPhase[] = ['neck', 'shoulders', 'arms', 'back', 'legs'];
    const currentIdx = phaseOrder.indexOf(phase);
    if (currentIdx >= 0 && currentIdx < phaseOrder.length - 1) {
      const nextPhase = phaseOrder[currentIdx + 1];
      setPhase(nextPhase);
      const cfg = PHASE_CONFIG[nextPhase];
      if (cfg) speechManager.speak(cfg.instruction, "normal");
    } else if (currentIdx === phaseOrder.length - 1) {
      setPhase('done');
      speechManager.speak("Warm-up complete! You are ready to dance.", "praise");
      setTimeout(() => {
        navigate(`/practice/${id}/${chunkId || 'full'}`);
      }, 2000);
    }
  };

  const config = PHASE_CONFIG[phase];

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 relative">
      <div className="absolute inset-0 z-0 opacity-30">
        <video ref={webcamRef} className="w-full h-full object-cover scale-x-[-1] blur-md" muted playsInline />
      </div>

      <div className="z-10 bg-black/60 backdrop-blur-xl border border-white/10 p-8 rounded-3xl max-w-md w-full text-center shadow-2xl">
        {phase === 'intro' && (
          <div className="space-y-6 animate-in fade-in zoom-in duration-500">
            <p className="text-5xl mb-4">🏋️</p>
            <h1 className="text-3xl font-outfit font-bold text-white">Warm up first!</h1>
            <p className="text-gray-400 text-sm">1 minute to prevent injuries & calibrate tracking.</p>
            <p className="text-gray-500 text-xs">5 phases: Neck → Shoulders → Arms → Back → Legs</p>

            {/* Phase preview */}
            <div className="flex justify-center gap-3 text-2xl">
              <span>🔄</span>
              <span>🙆</span>
              <span>💪</span>
              <span>🧘</span>
              <span>🦵</span>
            </div>

            <div className="flex flex-col gap-3 pt-4">
              <button onClick={startWarmUp} className="w-full py-4 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold shadow-[0_0_20px_rgba(147,51,234,0.4)] transition-all text-lg">
                🔥 Start
              </button>
              <button onClick={skipWarmUp} className="w-full py-4 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl font-medium transition-all text-base">
                ⏭️ Skip
              </button>
            </div>
          </div>
        )}

        {config && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <p className="text-5xl mb-2">{config.emoji}</p>
            <h2 className="text-2xl font-outfit font-bold text-white">{config.title}</h2>

            {/* Phase progress dots */}
            <div className="flex justify-center gap-2">
              {(['neck', 'shoulders', 'arms', 'back', 'legs'] as WarmUpPhase[]).map((p, i) => {
                const order = ['neck', 'shoulders', 'arms', 'back', 'legs'];
                const currentIdx = order.indexOf(phase);
                const pIdx = order.indexOf(p);
                return (
                  <div
                    key={p}
                    className={`h-2 rounded-full transition-all duration-300 ${
                      pIdx < currentIdx ? 'w-4 bg-green-500' :
                      pIdx === currentIdx ? 'w-6 bg-primary' :
                      'w-2 bg-gray-700'
                    }`}
                  />
                );
              })}
            </div>

            <div className="relative w-40 h-40 mx-auto rounded-full overflow-hidden border-4 border-white/10">
              {!hasWebcam ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                </div>
              ) : (
                <video ref={webcamRef} className="w-full h-full object-cover scale-x-[-1]" autoPlay playsInline muted />
              )}
              <div className="absolute bottom-0 left-0 h-2 bg-primary transition-all duration-100 ease-linear" style={{ width: `${progress}%` }} />
            </div>

            <p className="text-gray-500 text-xs">Move until the bar fills up</p>
            <button onClick={skipWarmUp} className="text-xs text-gray-600 hover:text-white transition-colors underline">
              Skip to practice
            </button>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-4 animate-in zoom-in duration-300">
            <p className="text-5xl">✅</p>
            <h2 className="text-3xl font-outfit font-bold text-green-400">All Set!</h2>
            <p className="text-white">Starting practice...</p>
          </div>
        )}
      </div>
    </div>
  );
}
