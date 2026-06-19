import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Share2, ArrowLeft, Camera, Video } from 'lucide-react';

export default function Share() {
  const navigate = useNavigate();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMode, setExportMode] = useState<'skeleton' | 'silhouette' | 'score'>('skeleton');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || isExporting) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    const draw = () => {
      if (!canvasRef.current) return;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, 1280, 720);

      if (exportMode === 'skeleton' || exportMode === 'silhouette') {
        // Draw mock skeletons
        ctx.strokeStyle = exportMode === 'silhouette' ? '#ff00ff' : '#ffffff';
        ctx.lineWidth = exportMode === 'silhouette' ? 8 : 3;
        ctx.beginPath();
        ctx.moveTo(300, 300 + Math.sin(frame * 0.1) * 50);
        ctx.lineTo(400, 400);
        ctx.lineTo(500, 300 + Math.cos(frame * 0.1) * 50);
        ctx.stroke();

        ctx.strokeStyle = exportMode === 'silhouette' ? '#00ffff' : '#00ff00';
        ctx.beginPath();
        ctx.moveTo(700, 300 + Math.cos(frame * 0.1) * 50);
        ctx.lineTo(800, 400);
        ctx.lineTo(900, 300 + Math.sin(frame * 0.1) * 50);
        ctx.stroke();
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 48px sans-serif';
      ctx.fillText(`Score: 89%`, 50, 100);
      
      ctx.fillStyle = '#888888';
      ctx.font = '24px sans-serif';
      ctx.fillText('Taal', 1180, 680);

      frame++;
      requestAnimationFrame(draw);
    };
    draw();
  }, [exportMode, isExporting]);

  const handleExport = async () => {
    if (!canvasRef.current) return;
    setIsExporting(true);
    setVideoUrl(null);

    const stream = (canvasRef.current as any).captureStream(30);
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      setVideoUrl(URL.createObjectURL(blob));
      setIsExporting(false);
    };

    mediaRecorder.start();
    
    // Record for 5 seconds
    setTimeout(() => {
      mediaRecorder.stop();
    }, 5000);
  };

  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `Taal-Practice-${new Date().getTime()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleShare = async () => {
    if (navigator.share && videoUrl) {
      try {
        const response = await fetch(videoUrl);
        const blob = await response.blob();
        const file = new File([blob], 'taal-dance.webm', { type: 'video/webm' });
        
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'My Taal Practice',
            text: 'Check out my dance practice accuracy score on Taal! Add original music to this clip.',
            files: [file]
          });
        } else {
          await navigator.share({
            title: 'My Taal Practice',
            text: 'Check out my dance practice accuracy score on Taal!',
            url: window.location.origin
          });
        }
      } catch (err) {
        console.log('Error sharing:', err);
      }
    } else {
      alert("Web Share API is not supported in your browser or video not recorded. Use the download button instead.");
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
              Note: Export does not contain audio. Add the original music inside TikTok or Reels after uploading to avoid copyright flags.
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
                  onClick={handleShare}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-3 rounded-xl transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)] flex items-center justify-center gap-2"
                >
                  <Share2 className="w-5 h-5" />
                  Share via System
                </button>
              </>
            )}

            <div className="pt-4 border-t border-white/10 flex justify-center gap-4">
              <button className="w-12 h-12 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 flex items-center justify-center text-white hover:opacity-90 transition-opacity">
                <Camera className="w-6 h-6" />
              </button>
              {/* Mock TikTok button */}
              <button className="w-12 h-12 rounded-full bg-black border border-white/20 flex items-center justify-center text-white hover:bg-white/5 transition-colors font-bold tracking-tighter">
                <span className="text-[10px] leading-tight text-center">Tik<br/>Tok</span>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
