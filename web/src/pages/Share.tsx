import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Share2, ArrowLeft, Camera, Video } from 'lucide-react';

export default function Share() {
  const navigate = useNavigate();
  // Mock recorded blob URL that would be passed via state or context in a real app
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    // Generate a mock blob to satisfy the UI without a real recording
    const blob = new Blob(["mock video content"], { type: "video/webm" });
    setVideoUrl(URL.createObjectURL(blob));
  }, []);

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
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'My Taal Practice',
          text: 'Check out my dance practice accuracy score on Taal!',
          url: window.location.origin
        });
      } catch (err) {
        console.log('Error sharing:', err);
      }
    } else {
      alert("Web Share API is not supported in your browser. Use the download button instead.");
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
          <div className="aspect-[9/16] w-full max-w-sm bg-black rounded-2xl overflow-hidden relative border border-white/5">
            {/* Mock video container */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
              <Video className="w-12 h-12 mb-4 opacity-50" />
              <p>Your recorded performance</p>
            </div>
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
        </div>

        <div className="flex-1 flex flex-col justify-center space-y-6">
          <div>
            <h2 className="text-3xl font-outfit font-bold text-white mb-2">Awesome job!</h2>
            <p className="text-muted-foreground">
              Your session achieved a peak combo of <strong className="text-primary">12x</strong> and an overall score of <strong className="text-green-400">89%</strong>.
            </p>
          </div>

          <div className="glass p-6 rounded-2xl border border-white/10 space-y-4">
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
