import { useEffect, useRef, useState } from 'react';
import type { PoseFrame } from '@taal/shared/types/pose';
import { speechManager } from '@taal/shared/utils/SpeechManager';

interface TeachPhaseProps {
  keyframes: PoseFrame[];
  onComplete: () => void;
}

// Maps keyframe index to a short arm cue
const ARM_CUES = [
  'Watch the arm position here',
  'Notice where the arms go',
  'Follow the arm movement',
  'Remember this final shape',
];

export function TeachPhase({ keyframes, onComplete }: TeachPhaseProps) {
  const [step, setStep] = useState<'intro' | 'frames' | 'done'>('intro');
  const [currentIdx, setCurrentIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // If no keyframes, skip immediately
  useEffect(() => {
    if (keyframes.length === 0) {
      onComplete();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Intro → frames after 1.5s
  useEffect(() => {
    if (step !== 'intro') return;
    speechManager.speak('Watch the arm positions carefully', 'normal');
    const t = setTimeout(() => setStep('frames'), 1500);
    return () => clearTimeout(t);
  }, [step]);

  // Advance frames automatically
  useEffect(() => {
    if (step !== 'frames') return;
    const cue = ARM_CUES[Math.min(currentIdx, ARM_CUES.length - 1)];
    speechManager.speak(cue, 'normal');

    const t = setTimeout(() => {
      if (currentIdx + 1 >= keyframes.length) {
        setStep('done');
      } else {
        setCurrentIdx(i => i + 1);
      }
    }, 2200);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, currentIdx]);

  // Done → auto-proceed
  useEffect(() => {
    if (step !== 'done') return;
    const t = setTimeout(onComplete, 800);
    return () => clearTimeout(t);
  }, [step, onComplete]);

  const totalSteps = keyframes.length;
  const currentPose = keyframes[currentIdx]?.landmarks;
  const canvasW = containerRef.current?.clientWidth || 280;
  const canvasH = containerRef.current?.clientHeight || 400;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center gap-6 p-6">
      {/* Header */}
      <div className="text-center">
        <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Study the moves</p>
        <p className="text-white text-2xl font-bold">Watch the arm positions</p>
      </div>

      {/* Pose display area — arm silhouette only on neutral bg */}
      <div
        ref={containerRef}
        className="relative w-full max-w-[280px] aspect-[9/16] bg-gray-900/80 rounded-2xl overflow-hidden border border-white/10"
      >
        {currentPose && (
          <ArmOnlyPreview
            landmarks={currentPose}
            width={canvasW}
            height={canvasH}
          />
        )}

        {/* Step label */}
        <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-400 ${
                i === currentIdx ? 'w-6 bg-violet-400' : 'w-1.5 bg-white/20'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Cue text */}
      <p className="text-white/60 text-sm text-center">
        {step === 'frames' ? ARM_CUES[Math.min(currentIdx, ARM_CUES.length - 1)] : ''}
      </p>

      {/* Skip */}
      <button
        onClick={onComplete}
        className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white/70 rounded-full text-sm transition-all"
      >
        Skip ⏭
      </button>
    </div>
  );
}

// Draw only the arm skeleton on a canvas — no full body noise for beginner
import { useEffect as useE, useRef as useR } from 'react';
import type { PoseLandmark } from '@taal/shared/types/pose';

function ArmOnlyPreview({ landmarks, width, height }: {
  landmarks: PoseLandmark[];
  width: number;
  height: number;
}) {
  const ref = useR<HTMLCanvasElement>(null);

  useE(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const px = (x: number) => x * width;
    const py = (y: number) => y * height;

    const ARM_CONNS: [number, number][] = [
      [11, 13], [13, 15], [12, 14], [14, 16], [11, 12],
    ];

    // Blue arm lines
    ctx.strokeStyle = 'rgba(130,180,255,0.9)';
    ctx.lineWidth = 5;
    ctx.shadowBlur = 14;
    ctx.shadowColor = 'rgba(130,180,255,0.5)';

    for (const [i, j] of ARM_CONNS) {
      const p1 = landmarks[i], p2 = landmarks[j];
      if (!p1 || !p2 || (p1.visibility ?? 1) < 0.35 || (p2.visibility ?? 1) < 0.35) continue;
      ctx.beginPath();
      ctx.moveTo(px(p1.x), py(p1.y));
      ctx.lineTo(px(p2.x), py(p2.y));
      ctx.stroke();
    }

    // Joint dots
    ctx.shadowBlur = 0;
    for (const idx of [11, 12, 13, 14, 15, 16]) {
      const p = landmarks[idx];
      if (!p || (p.visibility ?? 1) < 0.35) continue;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(px(p.x), py(p.y), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [landmarks, width, height]);

  return <canvas ref={ref} width={width} height={height} className="absolute inset-0 w-full h-full" />;
}
