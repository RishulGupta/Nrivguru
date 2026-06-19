import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Camera, VideoOff } from 'lucide-react';
import { initializePoseLandmarker } from '../utils/poseExtractor';
import SkeletonCanvas from '../components/SkeletonCanvas';
import type { PoseLandmark } from '../components/SkeletonCanvas';
import ScoreDisplay from '../components/ScoreDisplay';

export default function Practice() {
  const { id, chunkId } = useParams();
  const navigate = useNavigate();

  const webcamRef = useRef<HTMLVideoElement>(null);
  const refVideoRef = useRef<HTMLVideoElement>(null);
  
  const [hasWebcam, setHasWebcam] = useState(false);
  const [webcamError, setWebcamError] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  
  const [userLandmarks, setUserLandmarks] = useState<PoseLandmark[] | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [jointScores, setJointScores] = useState<Record<number, number>>({});

  useEffect(() => {
    let active = true;

    async function setupCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
          audio: false
        });
        
        if (webcamRef.current) {
          webcamRef.current.srcObject = stream;
          webcamRef.current.play();
          setHasWebcam(true);
        }
      } catch (err: any) {
        setWebcamError('Could not access webcam. Please allow camera permissions.');
      }
    }

    async function initMediaPipe() {
      await initializePoseLandmarker();
      if (active) setIsInitializing(false);
    }

    setupCamera();
    initMediaPipe();

    return () => {
      active = false;
      if (webcamRef.current?.srcObject) {
        const stream = webcamRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Practice Loop using useRef
  const animationRef = useRef<number>(0);
  const landmarkerRef = useRef<any>(null);
  
  useEffect(() => {
    async function getLandmarker() {
      landmarkerRef.current = await initializePoseLandmarker();
    }
    getLandmarker();

    const loop = () => {
      if (webcamRef.current && landmarkerRef.current && hasWebcam && webcamRef.current.videoWidth > 0) {
        const startTimeMs = performance.now();
        const results = landmarkerRef.current.detectForVideo(webcamRef.current, startTimeMs);
        
        if (results.landmarks && results.landmarks[0]) {
          setUserLandmarks(results.landmarks[0]);
          
          // Mock scoring calculation for UI demonstration
          // In real implementation, this runs FastDTW against reference PoseFrames
          const mockScore = 70 + Math.random() * 25;
          setScore(mockScore);
          
          if (mockScore > 85) {
            setCombo(prev => prev + 1);
          } else if (mockScore < 70) {
            setCombo(0);
          }

          // Mock joint coloring
          const joints: Record<number, number> = {};
          for (let i = 0; i < 33; i++) {
            joints[i] = mockScore - 10 + Math.random() * 20;
          }
          setJointScores(joints);
        }
      }
      animationRef.current = requestAnimationFrame(loop);
    };

    if (hasWebcam && !isInitializing) {
      loop();
    }

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [hasWebcam, isInitializing]);

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
        
        <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
          <span className="text-white font-semibold font-outfit">Practicing: Chunk {chunkId}</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row w-full h-screen overflow-hidden">
        {/* Left: Reference Video */}
        <div className="flex-1 relative bg-gray-900 border-r border-white/10">
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground opacity-50 z-10">
            <VideoOff className="w-16 h-16 mb-4" />
            <p>Mock Reference Video</p>
          </div>
          <video 
            ref={refVideoRef}
            className="w-full h-full object-cover opacity-50"
            loop
            muted
            playsInline
          />
        </div>

        {/* Right: User Webcam */}
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
          
          <video 
            ref={webcamRef}
            className="w-full h-full object-cover scale-x-[-1]"
            playsInline
            muted
          />
          
          <div className="absolute inset-0 pointer-events-none scale-x-[-1]">
            {userLandmarks && (
              <SkeletonCanvas 
                landmarks={userLandmarks} 
                width={webcamRef.current?.videoWidth || 1280} 
                height={webcamRef.current?.videoHeight || 720} 
                jointScores={jointScores}
              />
            )}
          </div>

          <div className="absolute bottom-8 right-8 z-30">
            <ScoreDisplay 
              score={score} 
              combo={combo} 
              jointAccuracy={{
                upperBody: score - 5,
                lowerBody: score + 2,
                core: score
              }} 
            />
          </div>
        </div>
      </main>
    </div>
  );
}
