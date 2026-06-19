import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useStore';
import { supabase } from '../lib/supabase';
import { LogOut, Play, Upload, Star, Clock } from 'lucide-react';

const MOCK_ROUTINES = [
  { id: '1', title: 'Beginner Hip Hop', instructor: 'Alex M.', duration: '2:30', difficulty: 'Beginner', plays: 1250, thumbnail: 'https://images.unsplash.com/photo-1547153760-18fc86324498?auto=format&fit=crop&q=80&w=800' },
  { id: '2', title: 'Bollywood Basics', instructor: 'Priya S.', duration: '3:15', difficulty: 'Beginner', plays: 3420, thumbnail: 'https://images.unsplash.com/photo-1516997184976-54a4f89d3810?auto=format&fit=crop&q=80&w=800' },
  { id: '3', title: 'Advanced Popping', instructor: 'Marcus T.', duration: '1:45', difficulty: 'Advanced', plays: 890, thumbnail: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&q=80&w=800' },
];

export default function Home() {
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const credits = useAuthStore((state) => state.credits);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    clearAuth();
    navigate('/auth');
  };

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
        
        <div className="flex items-center gap-4">
          <div className="bg-secondary px-4 py-1.5 rounded-full flex items-center gap-2 border border-white/10">
            <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
            <span className="text-sm font-semibold">{credits} Credits</span>
          </div>
          <button 
            onClick={handleLogout}
            className="p-2 hover:bg-white/10 rounded-full transition-colors text-muted-foreground"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Welcome Banner */}
        <section className="mb-12 relative overflow-hidden rounded-3xl glass p-8 border border-white/10">
          <div className="absolute top-0 right-0 w-96 h-96 bg-primary/20 rounded-full blur-[80px] pointer-events-none -translate-y-1/2 translate-x-1/3"></div>
          
          <div className="relative z-10 max-w-2xl">
            <h1 className="text-4xl md:text-5xl font-outfit font-bold mb-4 neon-text text-white">
              Ready to perfect your <br/> rhythm?
            </h1>
            <p className="text-lg text-muted-foreground mb-8">
              Upload a new routine to extract steps and practice with real-time AI feedback.
            </p>
            <button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-8 py-3 rounded-xl transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)] hover:shadow-[0_0_25px_rgba(147,51,234,0.5)] flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Upload Video
            </button>
          </div>
        </section>

        {/* Library Grid */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-outfit font-bold text-white">Your Library</h2>
            <button className="text-primary hover:text-primary/80 text-sm font-semibold">View All</button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {MOCK_ROUTINES.map((routine) => (
              <div key={routine.id} className="group glass rounded-2xl overflow-hidden border border-white/5 hover:border-primary/50 transition-all hover:shadow-[0_0_20px_rgba(147,51,234,0.15)] cursor-pointer">
                <div className="relative aspect-video overflow-hidden">
                  <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors z-10"></div>
                  <img 
                    src={routine.thumbnail} 
                    alt={routine.title} 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play className="w-5 h-5 text-white ml-1" />
                  </div>
                  <div className="absolute bottom-3 right-3 z-20 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-md flex items-center gap-1 text-xs text-white">
                    <Clock className="w-3 h-3" />
                    {routine.duration}
                  </div>
                </div>
                
                <div className="p-5">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-lg text-white group-hover:text-primary transition-colors">{routine.title}</h3>
                  </div>
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-sm text-muted-foreground">{routine.instructor}</span>
                    <span className="text-xs font-medium px-2 py-1 bg-white/5 rounded-full text-gray-300">{routine.difficulty}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
