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

  // Feature State
  const [practiceAttempt, setPracticeAttempt] = useState(1);
  const [seatedMode, setSeatedMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');

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

  // Voice Commands
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    
    recognition.onresult = (event: any) => {
      const current = event.resultIndex;
      const t = event.results[current][0].transcript.toLowerCase();
      setTranscript(t);
      
      if (t.includes('start') || t.includes('play')) refVideoRef.current?.play();
      if (t.includes('stop') || t.includes('pause')) refVideoRef.current?.pause();
      if (t.includes('reset')) {
        if (refVideoRef.current) refVideoRef.current.currentTime = 0;
        setPracticeAttempt(1);
      }
      if (t.includes('seated mode on')) setSeatedMode(true);
      if (t.includes('seated mode off')) setSeatedMode(false);
    };

    recognition.start();
    return () => recognition.stop();
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
          let mockScore = 70 + Math.random() * 25;
          setScore(mockScore);
          
          if (mockScore > 85) {
            setCombo(prev => prev + 1);
          } else if (mockScore < 70) {
            setCombo(0);
          }

          // Mock joint coloring - mask out legs if seated
          const joints: Record<number, number> = {};
          for (let i = 0; i < 33; i++) {
            // If seated mode, don't color joints >= 23 (hips, knees, ankles)
            if (seatedMode && i >= 23) continue;
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
  }, [hasWebcam, isInitializing, seatedMode]);

  // Track attempts
  useEffect(() => {
    const v = refVideoRef.current;
    if (!v) return;
    const handleLoop = () => setPracticeAttempt(prev => prev + 1);
    v.addEventListener('ended', handleLoop);
    v.addEventListener('loop', handleLoop); // some browsers don't fire ended if looping
    
    // hack for looping video since `loop` event is not standard everywhere
    let lastTime = 0;
    const timeUpdate = () => {
      if (v.currentTime < lastTime - 0.5) {
        handleLoop();
      }
      lastTime = v.currentTime;
    };
    v.addEventListener('timeupdate', timeUpdate);
    
    return () => {
      v.removeEventListener('ended', handleLoop);
      v.removeEventListener('loop', handleLoop);
      v.removeEventListener('timeupdate', timeUpdate);
    };
  }, []);

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
            Seated Mode {seatedMode ? 'ON' : 'OFF'}
          </button>

          {/* Voice Command Indicator */}
          <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isListening ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
            <span className="text-white text-xs font-semibold">{isListening ? 'Listening...' : 'Mic Off'}</span>
            {transcript && <span className="text-white/50 text-xs ml-2 italic">"{transcript}"</span>}
          </div>

          <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
            <span className="text-white font-semibold font-outfit">Practicing: Chunk {chunkId}</span>
          </div>
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
            {userLandmarks && practiceAttempt >= 2 && (
              <SkeletonCanvas 
                landmarks={userLandmarks} 
                width={webcamRef.current?.videoWidth || 1280} 
                height={webcamRef.current?.videoHeight || 720} 
                jointScores={jointScores}
              />
            )}
          </div>

          {practiceAttempt >= 3 && (
            <div className="absolute bottom-8 right-8 z-30">
              <ScoreDisplay 
                score={score} 
                combo={combo} 
                jointAccuracy={{
                  upperBody: score - 5,
                  lowerBody: seatedMode ? 100 : score + 2,
                  core: score
                }} 
              />
            </div>
          )}

          {/* Progressive Feedback Indicator Overlay */}
          <div className="absolute bottom-8 left-8 z-30 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl p-4 max-w-sm">
            <h3 className="text-white font-bold font-outfit mb-1 text-lg">Attempt {practiceAttempt}</h3>
            <p className="text-muted-foreground text-sm">
              {practiceAttempt === 1 && "Focus on observing the reference video."}
              {practiceAttempt === 2 && "Follow along. We are tracking your joints."}
              {practiceAttempt >= 3 && "Scoring is active! Try to beat your high score."}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
