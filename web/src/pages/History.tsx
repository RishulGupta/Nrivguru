import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Activity, Target, Trophy, TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useStore';

const MOCK_HISTORY = [
  { id: 1, routine: 'Beginner Hip Hop', chunk: 'Arm Wave Combo', score: 85, date: 'Today' },
  { id: 2, routine: 'Beginner Hip Hop', chunk: 'The Bounce', score: 92, date: 'Yesterday' },
  { id: 3, routine: 'Salsa Basics', chunk: 'Basic Step', score: 78, date: '2 days ago' },
  { id: 4, routine: 'Beginner Hip Hop', chunk: 'Intro Groove', score: 88, date: '3 days ago' },
];

export default function History() {
  const navigate = useNavigate();
  const session = useAuthStore(state => state.session);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    if (session?.user?.id) {
      // Use RPC only — get routines, then get attempts per routine
      supabase.rpc('rpc_get_my_routines', { p_user_id: session.user.id })
        .then(({ data: routines }) => {
          if (routines && Array.isArray(routines) && routines.length > 0) {
            // Get attempts for first routine to show data
            const firstId = routines[0].id;
            supabase.rpc('rpc_get_attempt_history', {
              p_user_id: session.user.id,
              p_routine_id: firstId
            }).then(({ data: attempts }) => {
              if (attempts && Array.isArray(attempts) && attempts.length > 0) {
                setHistory(attempts.map((a: any) => ({
                  id: a.id,
                  routine: routines[0]?.title || 'Routine',
                  chunk: a.is_full_routine ? 'Full Routine' : 'Segment',
                  score: a.overall_score || 0,
                  date: new Date(a.created_at).toLocaleDateString()
                })));
              } else {
                setHistory(MOCK_HISTORY);
              }
            });
          } else {
            setHistory(MOCK_HISTORY);
          }
        })
        .catch(() => setHistory(MOCK_HISTORY));
    } else {
      setHistory(MOCK_HISTORY);
    }
  }, [session]);

  return (
    <div className="min-h-screen bg-background p-6">
      <header className="max-w-4xl mx-auto flex items-center justify-between mb-8">
        <button
          onClick={() => navigate('/home')}
          className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-white transition-colors border border-white/10"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-outfit font-bold text-white neon-text">Your Progress</h1>
        <div className="w-10" />
      </header>

      <main className="max-w-4xl mx-auto">
        {/* Top Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="glass p-6 rounded-2xl border border-white/5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
              <Activity className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Avg Accuracy</p>
              <p className="text-2xl font-bold text-white">85.7%</p>
            </div>
          </div>

          <div className="glass p-6 rounded-2xl border border-white/5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
              <Target className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Highest Combo</p>
              <p className="text-2xl font-bold text-white">24x</p>
            </div>
          </div>

          <div className="glass p-6 rounded-2xl border border-white/5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center">
              <Trophy className="w-6 h-6 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Routines Learned</p>
              <p className="text-2xl font-bold text-white">3</p>
            </div>
          </div>
        </div>

        {/* Progress Chart */}
        <div className="glass p-8 rounded-3xl border border-white/5 mb-8">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              Recent Performance
            </h2>
          </div>

          <div className="relative w-full h-48">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
              <path
                d="M 0,80 C 20,70 40,30 60,40 S 80,10 100,20"
                fill="none"
                stroke="#9333ea"
                strokeWidth="2"
                style={{ filter: 'drop-shadow(0px 10px 10px rgba(147,51,234,0.4))' }}
              />
              <circle cx="0" cy="80" r="2" fill="#ec4899" />
              <circle cx="30" cy="50" r="2" fill="#ec4899" />
              <circle cx="60" cy="40" r="2" fill="#ec4899" />
              <circle cx="100" cy="20" r="2" fill="#ec4899" />
            </svg>
            <div className="absolute inset-0 flex justify-between items-end opacity-50 text-xs mt-4">
              <span>Mon</span>
              <span>Tue</span>
              <span>Wed</span>
              <span>Thu</span>
              <span>Today</span>
            </div>
          </div>
        </div>

        {/* Recent Sessions */}
        <div>
          <h3 className="text-lg font-bold text-white mb-4">Recent Sessions</h3>
          <div className="space-y-3">
            {history.map((s) => (
              <div key={s.id} className="glass p-4 rounded-xl border border-white/5 flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-white">{s.chunk}</h4>
                  <p className="text-sm text-muted-foreground">{s.routine} • {s.date}</p>
                </div>
                <div className={`font-outfit font-bold text-xl ${
                  s.score >= 85 ? 'text-green-400' :
                  s.score >= 70 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {s.score}%
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
