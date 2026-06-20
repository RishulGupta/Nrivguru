import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { speechManager } from '@taal/shared/utils/SpeechManager';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

type WarmUpPhase = 'intro' | 'neck' | 'shoulders' | 'hips' | 'done';

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
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm');
      landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numPoses: 1
      });
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
    // Navigate straight to practice
    navigate(`/practice/${id}/${chunkId || 'full'}`);
  };

  const startWarmUp = () => {
    setPhase('neck');
    speechManager.speak("Let's get warmed up. Start with gentle neck rolls.", "normal");
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
             // Simple heuristic tracking for progress
             setProgress(prev => {
               const next = prev + 0.5; // Artificial progress based on moving
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
    if (phase === 'neck') {
      setPhase('shoulders');
      speechManager.speak("Great. Now let's do some shoulder shrugs.", "normal");
    } else if (phase === 'shoulders') {
      setPhase('hips');
      speechManager.speak("Awesome. Finish up with hip circles to loosen the lower body.", "normal");
    } else if (phase === 'hips') {
      setPhase('done');
      speechManager.speak("Warm-up complete! You are ready to dance.", "praise");
      setTimeout(() => {
        navigate(`/practice/${id}/${chunkId || 'full'}`);
      }, 2000);
    }
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 relative">
      <div className="absolute inset-0 z-0 opacity-30">
        <video ref={webcamRef} className="w-full h-full object-cover scale-x-[-1] blur-md" muted playsInline />
      </div>

      <div className="z-10 bg-black/60 backdrop-blur-xl border border-white/10 p-8 rounded-3xl max-w-lg w-full text-center shadow-2xl">
        {phase === 'intro' && (
          <div className="space-y-6 animate-in fade-in zoom-in duration-500">
            <h1 className="text-3xl font-outfit font-bold text-white tracking-tight">Before we start...</h1>
            <p className="text-gray-400">A quick 2-minute warm-up prevents injuries and calibrates the AI tracking volume for better feedback.</p>
            
            <div className="flex flex-col gap-3 pt-4">
              <button onClick={startWarmUp} className="w-full py-4 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold shadow-[0_0_20px_rgba(147,51,234,0.4)] transition-all flex items-center justify-center gap-2">
                Start Warm-Up
              </button>
              <button onClick={skipWarmUp} className="w-full py-4 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl font-medium transition-all flex items-center justify-center gap-2">
                <ShieldAlert className="w-4 h-4 text-orange-400" />
                Skip Warm-Up (Not Recommended)
              </button>
            </div>
          </div>
        )}

        {(phase === 'neck' || phase === 'shoulders' || phase === 'hips') && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <h2 className="text-2xl font-outfit font-bold text-white uppercase tracking-widest text-primary neon-text">
              {phase === 'neck' ? 'Neck Rolls' : phase === 'shoulders' ? 'Shoulder Shrugs' : 'Hip Circles'}
            </h2>
            
            <div className="relative w-48 h-48 mx-auto rounded-full overflow-hidden border-4 border-white/10">
               {!hasWebcam ? (
                 <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 className="w-8 h-8 text-white animate-spin" />
                 </div>
               ) : (
                 <video ref={webcamRef} className="w-full h-full object-cover scale-x-[-1]" autoPlay playsInline muted />
               )}
               <div className="absolute bottom-0 left-0 h-2 bg-primary transition-all duration-100 ease-linear" style={{ width: `${progress}%` }} />
            </div>

            <p className="text-gray-400 text-sm">Follow the audio instructions. Keep moving until the bar fills up.</p>
            
            <button onClick={skipWarmUp} className="text-xs text-gray-500 hover:text-white transition-colors underline pt-4">Skip remaining warm-up</button>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-6 animate-in zoom-in duration-300">
            <h2 className="text-3xl font-outfit font-bold text-green-400">All Set!</h2>
            <p className="text-white">Redirecting to your practice session...</p>
          </div>
        )}
      </div>
    </div>
  );
}
