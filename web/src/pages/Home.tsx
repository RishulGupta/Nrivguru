import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useStore';
import { supabase } from '../lib/supabase';
import { Upload, Play } from 'lucide-react';

export default function Home() {
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const credits = useAuthStore((state) => state.credits);

  const [myRoutines, setMyRoutines] = useState<any[]>([]);

  useEffect(() => {
    async function loadRoutines() {
      if (session?.user?.id) {
        const { data } = await supabase.rpc('rpc_get_my_routines', { p_user_id: session.user.id });
        if (data && data.length > 0) { setMyRoutines(data); return; }
      }
      try {
        const stored = localStorage.getItem('taal-local-routines');
        if (stored) setMyRoutines(JSON.parse(stored));
      } catch { /* ignore */ }
    }
    loadRoutines();
  }, [session]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 glass border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center neon-border">
            <span className="font-outfit font-bold text-white text-xl">T</span>
          </div>
          <span className="font-outfit font-bold text-xl tracking-wider text-white">TAAL</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-secondary px-3 py-1.5 rounded-full flex items-center gap-1 border border-white/10">
            <span className="text-yellow-400">⭐</span>
            <span className="text-sm font-semibold text-white">{credits}</span>
          </div>
          <button onClick={() => navigate('/settings')} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white hover:bg-white/10 transition-colors text-lg">
            ⚙️
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Welcome Banner */}
        <section className="mb-12 relative overflow-hidden rounded-3xl glass p-8 border border-white/10">
          <div className="absolute top-0 right-0 w-96 h-96 bg-primary/20 rounded-full blur-[80px] pointer-events-none -translate-y-1/2 translate-x-1/3"></div>

          <div className="relative z-10 max-w-2xl">
            <p className="text-5xl mb-4">🕺</p>
            <h1 className="text-4xl md:text-5xl font-outfit font-bold mb-4 text-white">
              Ready to dance?
            </h1>
            <button
              onClick={() => navigate('/upload')}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-8 py-4 rounded-xl transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)] hover:shadow-[0_0_25px_rgba(147,51,234,0.5)] flex items-center gap-2 text-lg"
            >
              <Upload className="w-5 h-5" />
              📹 Upload
            </button>
          </div>
        </section>

        {/* Library Grid */}
        {myRoutines && myRoutines.length > 0 ? (
          <section className="mb-12">
            <h2 className="text-2xl font-outfit font-bold text-white mb-6">📚 Your Routines</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {myRoutines.map((routine) => (
                <div
                  key={routine.id}
                  onClick={() => navigate(`/routine/${routine.id}`)}
                  className="group glass rounded-2xl overflow-hidden border border-white/5 hover:border-primary/50 transition-all hover:shadow-[0_0_20px_rgba(147,51,234,0.15)] cursor-pointer"
                >
                  <div className="relative aspect-video overflow-hidden">
                    <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors z-10"></div>
                    {routine.thumbnail_url ? (
                      <img
                        src={routine.thumbnail_url}
                        alt={routine.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                        <Play className="w-8 h-8 text-white/50" />
                      </div>
                    )}
                    <div className="absolute top-2 left-2 z-20">
                      {routine.style_tag && (
                        <span className="bg-primary/20 text-primary border border-primary/30 text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                          {routine.style_tag}
                        </span>
                      )}
                    </div>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play className="w-5 h-5 text-white ml-1" />
                    </div>
                  </div>
                  <div className="p-5">
                    <h3 className="font-semibold text-lg text-white group-hover:text-primary transition-colors">{routine.title}</h3>
                    <div className="flex items-center justify-between mt-4">
                      <span className="text-sm text-muted-foreground">{routine.chunk_count} moves</span>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                        routine.last_score ? (routine.last_score >= 80 ? 'bg-green-500/20 text-green-400' : routine.last_score >= 50 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400') : 'bg-white/5 text-gray-300'
                      }`}>
                        {routine.last_score ? `${routine.last_score}% Best` : '🆕 New'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="mb-12 glass p-12 rounded-3xl border border-white/5 text-center">
            <p className="text-5xl mb-4">💃</p>
            <h2 className="text-2xl font-outfit font-bold text-white mb-2">Upload your first dance!</h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto text-sm">
              Upload a video and Taal will split it into steps with AI feedback.
            </p>
            <button
              onClick={() => navigate('/upload')}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-8 py-4 rounded-xl transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)] inline-flex items-center gap-2 text-lg"
            >
              <Upload className="w-5 h-5" />
              📹 Upload
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
