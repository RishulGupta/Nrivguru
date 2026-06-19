import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Activity, Target, Trophy, TrendingUp } from 'lucide-react';

const MOCK_HISTORY = [
  { id: 1, routine: 'Beginner Hip Hop', chunk: 'Arm Wave Combo', score: 85, date: 'Today' },
  { id: 2, routine: 'Beginner Hip Hop', chunk: 'The Bounce', score: 92, date: 'Yesterday' },
  { id: 3, routine: 'Salsa Basics', chunk: 'Basic Step', score: 78, date: '2 days ago' },
  { id: 4, routine: 'Beginner Hip Hop', chunk: 'Intro Groove', score: 88, date: '3 days ago' },
];

export default function History() {
  const navigate = useNavigate();

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

        {/* Custom SVG Progress Chart Mock */}
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
              {/* Plot points */}
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

        {/* Recent Sessions List */}
        <div>
          <h3 className="text-lg font-bold text-white mb-4">Recent Sessions</h3>
          <div className="space-y-3">
            {MOCK_HISTORY.map((session) => (
              <div key={session.id} className="glass p-4 rounded-xl border border-white/5 flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-white">{session.chunk}</h4>
                  <p className="text-sm text-muted-foreground">{session.routine} • {session.date}</p>
                </div>
                <div className={`font-outfit font-bold text-xl ${
                  session.score >= 85 ? 'text-green-400' : 
                  session.score >= 70 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {session.score}%
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
