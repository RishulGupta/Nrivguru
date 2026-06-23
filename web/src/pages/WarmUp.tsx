import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SkipForward, ArrowRight, Play } from 'lucide-react';

type WarmUpPhase = 'intro' | 'neck' | 'shoulders' | 'arms' | 'back' | 'legs' | 'done';

interface ExerciseConfig {
  emoji: string;
  title: string;
  instruction: string;
  videoUrl: string;
}

const PHASES: ExerciseConfig[] = [
  {
    emoji: '🔄',
    title: 'Neck Rolls',
    instruction: 'Gently roll your head from side to side in a slow circle.',
    videoUrl: 'https://www.youtube.com/embed/NZHdC0aeJIs?autoplay=1&loop=1&mute=1&playlist=NZHdC0aeJIs&rel=0',
  },
  {
    emoji: '🙆',
    title: 'Shoulder Shrugs',
    instruction: 'Lift your shoulders up toward your ears, then release down.',
    videoUrl: 'https://www.youtube.com/embed/X7NtgY9kCCM?autoplay=1&loop=1&mute=1&playlist=X7NtgY9kCCM&rel=0',
  },
  {
    emoji: '💪',
    title: 'Arm Circles',
    instruction: 'Extend your arms out and make slow, controlled circles.',
    videoUrl: 'https://www.youtube.com/embed/hL6yIbjMsTM?autoplay=1&loop=1&mute=1&playlist=hL6yIbjMsTM&rel=0',
  },
  {
    emoji: '🧘',
    title: 'Back Stretch',
    instruction: 'Twist your torso from side to side in a gentle stretch.',
    videoUrl: 'https://www.youtube.com/embed/BzYBkAvdCJY?autoplay=1&loop=1&mute=1&playlist=BzYBkAvdCJY&rel=0',
  },
  {
    emoji: '🦵',
    title: 'Leg Swings',
    instruction: 'Swing your leg forward and back to loosen the hips.',
    videoUrl: 'https://www.youtube.com/embed/DBke4X8-HkE?autoplay=1&loop=1&mute=1&playlist=DBke4X8-HkE&rel=0',
  },
];

export default function WarmUp() {
  const { id, chunkId } = useParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<number>(-1); // -1 = intro, 0-4 = exercises, 5 = done
  const [videoReady, setVideoReady] = useState(false);

  const goToPractice = () => {
    navigate(`/practice/${id}/${chunkId || 'full'}`, { state: { warmupDone: true } });
  };

  const start = () => {
    setPhase(0);
    setVideoReady(false);
  };

  const next = () => {
    if (phase < PHASES.length - 1) {
      setPhase(phase + 1);
      setVideoReady(false);
    } else {
      setPhase(5);
      setTimeout(goToPractice, 1500);
    }
  };

  const ex = phase >= 0 && phase < PHASES.length ? PHASES[phase] : null;

  return (
    <div className="h-screen w-screen bg-black flex flex-col overflow-hidden">

      {/* ── INTRO ── */}
      {phase === -1 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
          <p className="text-5xl">🏋️</p>
          <h1 className="text-3xl font-outfit font-bold text-white">Warm up first!</h1>
          <p className="text-gray-400 text-sm">Prevent injuries — 5 quick exercises</p>
          <div className="flex justify-center gap-3 text-2xl">
            {PHASES.map(p => <span key={p.title}>{p.emoji}</span>)}
          </div>
          <div className="flex flex-col gap-3 w-full max-w-xs pt-4">
            <button onClick={start} className="w-full py-4 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold shadow-[0_0_20px_rgba(147,51,234,0.4)] transition-all text-lg flex items-center justify-center gap-2">
              <Play className="w-5 h-5" /> Start
            </button>
            <button onClick={goToPractice} className="w-full py-4 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl font-medium transition-all">
              ⏭️ Skip warm-up
            </button>
          </div>
        </div>
      )}

      {/* ── DONE ── */}
      {phase === 5 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-5xl">✅</p>
          <h2 className="text-3xl font-outfit font-bold text-green-400">All Set!</h2>
          <p className="text-white">Starting practice...</p>
        </div>
      )}

      {/* ── EXERCISE ── */}
      {ex && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-black/80 border-b border-white/5 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xl">{ex.emoji}</span>
              <h2 className="text-base font-outfit font-bold text-white">{ex.title}</h2>
            </div>
            <div className="flex gap-1.5">
              {PHASES.map((_, i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${
                  i < phase ? 'w-3 bg-green-500' : i === phase ? 'w-5 bg-primary' : 'w-1.5 bg-gray-700'
                }`} />
              ))}
            </div>
          </div>

          {/* Video fills the screen */}
          <div className="flex-1 relative bg-black">
            <iframe
              key={phase}
              src={ex.videoUrl}
              className="absolute inset-0 w-full h-full"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              onLoad={() => setVideoReady(true)}
              title={ex.title}
            />
            {/* Instruction overlay */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
              <p className="text-sm text-gray-200">{ex.instruction}</p>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="flex items-center justify-between px-4 py-3 bg-black/80 border-t border-white/5 shrink-0">
            <button onClick={goToPractice} className="text-xs text-gray-600 hover:text-white transition-colors">
              End warm-up
            </button>
            <button onClick={next} className="flex items-center gap-1.5 px-5 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-all">
              {phase < PHASES.length - 1 ? <>Next <ArrowRight className="w-4 h-4" /></> : 'Done ✅'}
            </button>
            <button onClick={() => { setPhase(Math.min(phase + 1, PHASES.length - 1)); setVideoReady(false); }} className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-gray-300 rounded-lg text-xs transition-colors">
              <SkipForward className="w-3.5 h-3.5" /> Skip
            </button>
          </div>
        </>
      )}
    </div>
  );
}
