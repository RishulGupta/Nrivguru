import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Share2, ArrowLeft, Camera, Video } from 'lucide-react';
import { CanvasRecorder } from '../utils/canvasRecorder';

// Mock skeleton pose data for visualization
const POSE_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],
  [9,10],[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],
  [12,14],[14,16],[16,18],[16,20],[16,22],[11,23],[12,24],
  [23,24],[23,25],[25,27],[27,29],[29,31],[27,31],
  [24,26],[26,28],[28,30],[30,32],[28,32]
];

function generateSkeletonPose(frame: number, centerX: number, centerY: number, scale: number) {
  const t = frame * 0.05;
  return Array.from({ length: 33 }, (_, i) => ({
    x: centerX + Math.sin(t + i * 0.3) * scale * 0.3,
    y: centerY + Math.cos(t * 0.7 + i * 0.2) * scale * 0.5,
    z: 0,
  }));
}

export default function Share() {
  const navigate = useNavigate();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMode, setExportMode] = useState<'skeleton' | 'silhouette' | 'score'>('skeleton');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<CanvasRecorder | null>(null);
  const frameRef = useRef(0);
  const trailHistory = useRef<{ x: number; y: number }[][]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isExporting) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, 1280, 720);

      const frame = frameRef.current;
      const refSkeleton = generateSkeletonPose(frame, 350, 360, 200);
      const userSkeleton = generateSkeletonPose(frame + 10, 900, 360, 200);

      // Track motion trails
      trailHistory.current.push(userSkeleton.map(p => ({ x: p.x, y: p.y })));
      if (trailHistory.current.length > 5) trailHistory.current.shift();

      if (exportMode === 'skeleton' || exportMode === 'silhouette') {
        const lineW = exportMode === 'silhouette' ? 8 : 3;
        const glowSize = exportMode === 'silhouette' ? 12 : 4;

        // Draw motion trails (last 5 frames, decreasing opacity)
        trailHistory.current.forEach((trail, trailIdx) => {
          const alpha = (trailIdx + 1) / trailHistory.current.length * 0.3;
          ctx.strokeStyle = `rgba(147, 51, 234, ${alpha})`;
          ctx.lineWidth = lineW * 0.5;
          POSE_CONNECTIONS.forEach(([i, j]) => {
            const p1 = trail[i], p2 = trail[j];
            if (p1 && p2) {
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.stroke();
            }
          });
        });

        // Draw reference skeleton (left) — white
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = lineW;
        ctx.shadowColor = exportMode === 'silhouette' ? '#ff00ff' : 'rgba(255,255,255,0.3)';
        ctx.shadowBlur = glowSize;
        POSE_CONNECTIONS.forEach(([i, j]) => {
          const p1 = refSkeleton[i], p2 = refSkeleton[j];
          if (p1 && p2) {
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        });

        // Draw user skeleton (right) — colored by mock accuracy
        const userColor = exportMode === 'silhouette' ? '#00ffff' : '#22c55e';
        ctx.strokeStyle = userColor;
        ctx.shadowColor = exportMode === 'silhouette' ? '#00ffff' : 'rgba(34,197,94,0.3)';
        ctx.shadowBlur = glowSize;
        POSE_CONNECTIONS.forEach(([i, j]) => {
          const p1 = userSkeleton[i], p2 = userSkeleton[j];
          if (p1 && p2) {
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        });

        // Labels
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Reference', 350, 580);
        ctx.fillText('You', 900, 580);
      }

      // Score overlay
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 48px JetBrains Mono, monospace';
      ctx.fillText(`Score: 89%`, 50, 100);

      ctx.fillStyle = '#888888';
      ctx.font = '16px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('Taal', 1260, 690);

      frameRef.current++;
      requestAnimationFrame(draw);
    };
    draw();
  }, [exportMode, isExporting]);

  const handleExport = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsExporting(true);
    setVideoUrl(null);

    try {
      recorderRef.current = new CanvasRecorder(canvas, 30);
      recorderRef.current.start();

      // Record for 5 seconds
      await new Promise(r => setTimeout(r, 5000));

      const blob = await recorderRef.current.stop();
      setVideoUrl(URL.createObjectURL(blob));
    } catch (e) {
      console.error('Export failed:', e);
    }
    setIsExporting(false);
  };

  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `Taal-Practice-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleShare = async (target?: string) => {
    if (!videoUrl) return;

    const shareText = target === 'whatsapp'
      ? 'Check out my dance practice accuracy score on Taal! Add original music to this clip.'
      : 'I practiced on Taal! Check out my dance accuracy score.';

    if (target === 'whatsapp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
      return;
    }

    if (navigator.share) {
      try {
        const response = await fetch(videoUrl);
        const blob = await response.blob();
        const file = new File([blob], 'taal-dance.webm', { type: 'video/webm' });
        await navigator.share({
          title: 'My Taal Practice',
          text: shareText,
          files: [file]
        });
      } catch (err) {
        // User cancelled or API unavailable — fallback
        await navigator.share({
          title: 'My Taal Practice',
          text: shareText,
          url: window.location.origin
        }).then(() => {}, () => {});
      }
    } else {
      alert(`Share via ${target || 'system'} is not supported. Use the download button instead.`);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <header className="max-w-4xl mx-auto flex items-center justify-between mb-12">
        <button
          onClick={() => navigate('/home')}
          className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-white transition-colors border border-white/10"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-outfit font-bold text-white neon-text">Export Session</h1>
        <div className="w-10" />
      </header>

      <main className="max-w-4xl mx-auto flex flex-col md:flex-row gap-8">
        <div className="flex-1 glass p-4 rounded-3xl border border-white/10 flex flex-col items-center">
          <div className="aspect-video w-full bg-black rounded-2xl overflow-hidden relative border border-white/5">
            <canvas
              ref={canvasRef}
              width={1280}
              height={720}
              className={`w-full h-full object-cover ${videoUrl ? 'hidden' : 'block'}`}
            />
            {isExporting && (
              <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-10">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-white font-semibold">Rendering Export...</p>
              </div>
            )}
            {videoUrl && (
              <video
                src={videoUrl}
                className="w-full h-full object-cover"
                controls
                autoPlay
                loop
                muted
              />
            )}
          </div>

          <div className="flex items-center gap-4 mt-6">
            <button
              onClick={() => setExportMode('skeleton')}
              className={`px-4 py-2 rounded-full border text-sm font-semibold transition-colors ${exportMode === 'skeleton' ? 'bg-primary border-primary text-white' : 'bg-white/5 border-white/10 text-muted-foreground'}`}
            >
              Skeleton
            </button>
            <button
              onClick={() => setExportMode('silhouette')}
              className={`px-4 py-2 rounded-full border text-sm font-semibold transition-colors ${exportMode === 'silhouette' ? 'bg-primary border-primary text-white' : 'bg-white/5 border-white/10 text-muted-foreground'}`}
            >
              Silhouette
            </button>
            <button
              onClick={() => setExportMode('score')}
              className={`px-4 py-2 rounded-full border text-sm font-semibold transition-colors ${exportMode === 'score' ? 'bg-primary border-primary text-white' : 'bg-white/5 border-white/10 text-muted-foreground'}`}
            >
              Score Only
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center space-y-6">
          <div>
            <h2 className="text-3xl font-outfit font-bold text-white mb-2">Awesome job!</h2>
            <p className="text-muted-foreground">
              Your session achieved a peak combo of <strong className="text-primary">12x</strong> and an overall score of <strong className="text-green-400">89%</strong>.
            </p>
            <p className="text-xs text-yellow-500 mt-2">
              Your clip is ready! Add the original music inside TikTok or Reels after uploading to avoid copyright flags.
            </p>
          </div>

          <div className="glass p-6 rounded-2xl border border-white/10 space-y-4">
            {!videoUrl ? (
              <button
                onClick={handleExport}
                disabled={isExporting}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-3 rounded-xl transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)] flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Video className="w-5 h-5" />
                {isExporting ? 'Generating Clip...' : 'Generate 5s Export Clip'}
              </button>
            ) : (
              <>
                <button
                  onClick={handleDownload}
                  className="w-full bg-white text-black hover:bg-gray-200 font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Download className="w-5 h-5" />
                  Save to Device
                </button>

                <button
                  onClick={() => handleShare()}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-3 rounded-xl transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)] flex items-center justify-center gap-2"
                >
                  <Share2 className="w-5 h-5" />
                  Share via System
                </button>
              </>
            )}

            <div className="pt-4 border-t border-white/10 space-y-2">
              <p className="text-xs text-muted-foreground text-center">Share directly to:</p>
              <div className="flex justify-center gap-4">
                <button
                  onClick={() => handleShare('whatsapp')}
                  className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center text-white hover:bg-green-600 transition-colors"
                  title="Share to WhatsApp"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                </button>
                <button
                  className="w-12 h-12 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 flex items-center justify-center text-white hover:opacity-90 transition-opacity"
                  title="Share to Instagram Reels"
                >
                  <Camera className="w-5 h-5" />
                </button>
                <button
                  className="w-12 h-12 rounded-full bg-black border border-white/20 flex items-center justify-center text-white hover:bg-white/5 transition-colors"
                  title="Share to TikTok"
                >
                  <span className="text-[10px] leading-tight text-center font-bold">Tik<br/>Tok</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
