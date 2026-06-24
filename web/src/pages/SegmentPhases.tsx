import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useStore';

interface PhaseCard {
  id: 'upper_body' | 'lower_body' | 'full_body' | 'full_speed';
  emoji: string;
  title: string;
  subtitle: string;
  color: string;
  borderColor: string;
}

const PHASES: PhaseCard[] = [
  {
    id: 'upper_body',
    emoji: '💪',
    title: 'Upper Body',
    subtitle: 'Arms & shoulders · Half speed',
    color: 'from-violet-600/20 to-violet-800/10',
    borderColor: 'border-violet-500/30',
  },
  {
    id: 'lower_body',
    emoji: '🦵',
    title: 'Lower Body',
    subtitle: 'Legs & hips · Half speed',
    color: 'from-blue-600/20 to-blue-800/10',
    borderColor: 'border-blue-500/30',
  },
  {
    id: 'full_body',
    emoji: '🕺',
    title: 'Combined',
    subtitle: 'Full body · Three-quarter speed',
    color: 'from-emerald-600/20 to-emerald-800/10',
    borderColor: 'border-emerald-500/30',
  },
  {
    id: 'full_speed',
    emoji: '⚡',
    title: 'Full Speed',
    subtitle: 'Everything · Full speed',
    color: 'from-amber-600/20 to-amber-800/10',
    borderColor: 'border-amber-500/30',
  },
];

export default function SegmentPhases() {
  const { routineId, chunkId } = useParams();
  const navigate = useNavigate();
  const session = useAuthStore(s => s.session);

  const [routine, setRoutine] = useState<any>(null);
  const [chunk, setChunk]     = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!routineId) { setLoading(false); return; }

      let data: any = null;
      if (session?.user?.id) {
        const res = await supabase.rpc('rpc_get_routine_detail', {
          p_routine_id: routineId,
          p_user_id: session.user.id,
        });
        if (res.data) data = res.data;
      }
      if (!data) {
        try {
          const stored = localStorage.getItem(`taal-local-routine-${routineId}`);
          if (stored) data = JSON.parse(stored);
        } catch { /* ignore */ }
      }

      if (data) {
        setRoutine(data);
        const chunks: any[] = data.chunks || [];
        const found = chunks.find(
          (c: any) => c.id === chunkId || String(c.chunk_index) === chunkId
        );
        setChunk(found ?? chunks[0] ?? null);
      }
      setLoading(false);
    }
    load();
  }, [routineId, chunkId, session]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-white/40">
        Loading…
      </div>
    );
  }

  const handlePhaseSelect = (phase: PhaseCard) => {
    navigate(`/practice/${routineId}/${chunkId || 'full'}`, {
      state: { mode: phase.id, skipModeSelector: true },
    });
  };

  const chunkLabel = chunk
    ? chunk.description || chunk.name || `Segment ${(chunk.chunk_index ?? 0) + 1}`
    : 'Segment';

  return (
    <div className="min-h-screen bg-black">
      {/* ── Header ── */}
      <div className="relative px-6 pt-12 pb-8">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-white transition-colors mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <p className="text-white/40 text-xs uppercase tracking-widest mb-1">
          {routine?.title ?? 'Practice'}
        </p>
        <h1 className="text-3xl font-bold text-white">{chunkLabel}</h1>
        <p className="text-white/40 text-sm mt-1">
          {chunk?.start_time_ms !== undefined
            ? `${Math.round(chunk.start_time_ms / 1000)}s – ${Math.round(chunk.end_time_ms / 1000)}s`
            : 'Select a phase to begin'}
        </p>
      </div>

      {/* ── Phase cards ── */}
      <main className="px-6 pb-12 space-y-4">
        <p className="text-white/50 text-sm mb-6">Choose where to start:</p>

        {PHASES.map((phase, index) => (
          <button
            key={phase.id}
            onClick={() => handlePhaseSelect(phase)}
            className={`w-full bg-gradient-to-r ${phase.color} border ${phase.borderColor} rounded-2xl p-5 flex items-center justify-between group hover:scale-[1.01] active:scale-[0.99] transition-all`}
          >
            <div className="flex items-center gap-4">
              {/* Number badge */}
              <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-white/30 font-bold text-sm group-hover:bg-white/10 transition-colors shrink-0">
                {index + 1}
              </div>

              <div className="text-left">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{phase.emoji}</span>
                  <h3 className="text-white font-bold text-lg">{phase.title}</h3>
                </div>
                <p className="text-white/40 text-sm">{phase.subtitle}</p>
              </div>
            </div>

            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-white/20 transition-colors shrink-0">
              <Play className="w-4 h-4 text-white ml-0.5" />
            </div>
          </button>
        ))}

        {/* Info card */}
        <div className="mt-8 bg-white/3 border border-white/8 rounded-2xl p-5 text-center">
          <p className="text-white/40 text-xs leading-relaxed">
            Start with <span className="text-violet-400 font-medium">Upper Body</span> to learn the arm
            positions first, then add legs, then combine everything at full speed.
          </p>
        </div>
      </main>
    </div>
  );
}
