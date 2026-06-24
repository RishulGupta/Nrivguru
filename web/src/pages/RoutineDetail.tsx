import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, ListVideo, ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useStore';

const MOCK_ROUTINE = {
  id: '1',
  title: 'Beginner Hip Hop',
  instructor: 'Alex M.',
  duration: '2:30',
  difficulty: 'Beginner',
  thumbnail: 'https://images.unsplash.com/photo-1547153760-18fc86324498?auto=format&fit=crop&q=80&w=1200',
  chunks: [
    { id: 'c1', name: 'Intro Groove', start: 0, end: 15, difficulty: 'Beginner' },
    { id: 'c2', name: 'The Bounce', start: 15, end: 35, difficulty: 'Beginner' },
    { id: 'c3', name: 'Arm Wave Combo', start: 35, end: 60, difficulty: 'Intermediate' }
  ]
};

export default function RoutineDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const session = useAuthStore(state => state.session);
  const [routine, setRoutine] = useState<any>(null);

  useEffect(() => {
    async function loadRoutine() {
      if (!id) return;
      // Try Supabase first
      if (session?.user?.id) {
        const { data } = await supabase.rpc('rpc_get_routine_detail', { p_routine_id: id, p_user_id: session.user.id });
        if (data) { setRoutine(data); return; }
      }
      // Fallback: localStorage (guest/offline mode)
      try {
        const stored = localStorage.getItem(`taal-local-routine-${id}`);
        if (stored) { setRoutine(JSON.parse(stored)); return; }
      } catch { /* ignore */ }
      // Ultimate fallback: mock routines
      setRoutine(MOCK_ROUTINE);
    }
    loadRoutine();
  }, [id, session]);

  if (!routine) return <div className="min-h-screen bg-background flex items-center justify-center text-white">Loading...</div>;

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Header */}
      <div className="relative h-[40vh] min-h-[300px]">
        <div className="absolute inset-0">
          <img src={routine.thumbnail} alt={routine.title} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent"></div>
        </div>
        
        <div className="absolute top-6 left-6 z-10">
          <button 
            onClick={() => navigate('/home')}
            className="w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-black/60 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        </div>

        <div className="absolute bottom-0 left-0 w-full p-8">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-3 mb-2">
              <span className="bg-primary/20 text-primary border border-primary/30 px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase">
                {routine.style_tag || routine.difficulty || 'Dance'}
              </span>
              <span className="text-muted-foreground text-sm font-semibold">
                {routine.duration_seconds ? `${Math.round(routine.duration_seconds / 60)}:${String(routine.duration_seconds % 60).padStart(2, '0')}` : routine.duration || ''}
              </span>
            </div>
            <h1 className="text-4xl md:text-5xl font-outfit font-bold text-white mb-2">{routine.title}</h1>
            <p className="text-xl text-gray-300">{routine.instructor ? `Instructor: ${routine.instructor}` : `${routine.chunk_count || routine.chunks?.length || 0} moves`}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <ListVideo className="w-6 h-6 text-primary" />
            Practice Segments
          </h2>
          <button 
            onClick={() => navigate(`/practice/${routine.id}/full`, { state: { mode: 'full_body', skipModeSelector: true } })}
            className="bg-white text-black hover:bg-gray-200 font-semibold px-6 py-2 rounded-xl transition-all flex items-center gap-2"
          >
            <Play className="w-4 h-4 fill-current" />
            Full Routine
          </button>
        </div>

        <div className="space-y-4">
          {routine.chunks.map((chunk: any, index: number) => (
            <div 
              key={chunk.id} 
              className="glass p-6 rounded-2xl border border-white/5 hover:border-primary/50 transition-all flex items-center justify-between group cursor-pointer"
              onClick={() => navigate(`/segment-phases/${routine.id}/${chunk.id || chunk.chunk_index}`)}
            >
              <div className="flex items-center gap-6">
                <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center font-outfit font-bold text-xl text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors">
                  {index + 1}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white group-hover:text-primary transition-colors">{chunk.name || chunk.description || `Segment ${index + 1}`}</h3>
                  <p className="text-sm text-muted-foreground">
                    {chunk.start_time_ms !== undefined 
                      ? `${Math.round(chunk.start_time_ms/1000)}s - ${Math.round(chunk.end_time_ms/1000)}s` 
                      : `${chunk.start}s - ${chunk.end}s`} • {chunk.difficulty || 'Beginner'}
                  </p>
                </div>
              </div>
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-primary transition-colors">
                <Play className="w-4 h-4 text-white ml-1 group-hover:fill-current" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
