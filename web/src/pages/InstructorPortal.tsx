import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Video, LayoutDashboard, PlusCircle, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '../store/useStore';
import { supabase } from '../lib/supabase';
// The is_instructor flag update only happens via RPC now, but we read it from the profile

export default function InstructorPortal() {
  const navigate = useNavigate();
  const profile = useAuthStore((state) => state.profile);
  const [dashboardData, setDashboardData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const isInstructor = profile?.is_instructor || false;

  useEffect(() => {
    if (isInstructor && profile) {
      const fetchDashboard = async () => {
        const { data } = await supabase.rpc('rpc_get_instructor_dashboard', {
          p_instructor_id: profile.id
        });
        if (data) setDashboardData(data);
        setLoading(false);
      };
      fetchDashboard();
    } else {
      setLoading(false);
    }
  }, [isInstructor, profile]);

  const handleUpgrade = async () => {
    // Mock Razorpay flow (real integration in v2)
    alert('Mock Razorpay Payment: ₹1,999/month for Instructor Access');
    // Set is_instructor to true via RPC
    if (profile) {
      await supabase.rpc('rpc_upsert_profile', {
        p_user_id: profile.id,
        p_display_name: profile.display_name || 'User',
        p_avatar_url: profile.avatar_url
      });
      useAuthStore.getState().setProfile({ ...profile, is_instructor: true });
    }
  };

  if (!isInstructor) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center">
        <header className="absolute top-0 left-0 w-full p-6">
          <button 
            onClick={() => navigate('/home')}
            className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-white transition-colors border border-white/10"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        </header>

        <div className="max-w-md w-full glass p-8 rounded-3xl border border-white/10 text-center space-y-6">
          <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Users className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-3xl font-outfit font-bold text-white neon-text">Become an Instructor</h1>
          <p className="text-muted-foreground text-sm">
            Upgrade your account to unlock the B2B Instructor Portal. Assign routines to your students, add custom feedback notes, and track their AI-scored progress in real-time.
          </p>

          <ul className="text-left space-y-3 my-6">
            <li className="flex items-center gap-3 text-sm text-gray-300">
              <CheckCircle2 className="w-5 h-5 text-green-400" /> Unlimited routine processing
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-300">
              <CheckCircle2 className="w-5 h-5 text-green-400" /> Student assignment dashboard
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-300">
              <CheckCircle2 className="w-5 h-5 text-green-400" /> Per-chunk automated progress insights
            </li>
          </ul>

          <div className="pt-4 border-t border-white/10">
            <p className="text-xs text-muted-foreground mb-4">India: ₹1,999/month | Global: $24.99/month</p>
            <button 
              onClick={handleUpgrade}
              className="w-full bg-primary hover:bg-primary/90 text-white font-semibold py-3 rounded-xl transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)]"
            >
              Upgrade to Instructor
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <header className="max-w-6xl mx-auto flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/home')}
            className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-white transition-colors border border-white/10"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-outfit font-bold text-white flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-primary" />
            Instructor Dashboard
          </h1>
        </div>
        
        <button 
          onClick={() => alert('Assign Routine Flow (Select routine from library, add notes, generate code)')}
          className="bg-primary hover:bg-primary/90 text-white font-semibold px-4 py-2 rounded-xl transition-all shadow-[0_0_10px_rgba(147,51,234,0.3)] flex items-center gap-2 text-sm"
        >
          <PlusCircle className="w-4 h-4" />
          Assign Routine
        </button>
      </header>

      <main className="max-w-6xl mx-auto space-y-6">
        {loading ? (
          <div className="text-center py-20 text-muted-foreground">Loading dashboard...</div>
        ) : dashboardData.length === 0 ? (
          <div className="glass p-12 rounded-3xl border border-white/10 text-center">
            <Video className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h2 className="text-xl font-bold text-white mb-2">No Active Assignments</h2>
            <p className="text-muted-foreground">Assign your first routine to a student to start tracking their progress.</p>
          </div>
        ) : (
          <div className="glass rounded-3xl border border-white/10 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 border-b border-white/10 text-muted-foreground">
                <tr>
                  <th className="p-4 font-semibold">Student</th>
                  <th className="p-4 font-semibold">Routine</th>
                  <th className="p-4 font-semibold">Assigned On</th>
                  <th className="p-4 font-semibold">Progress Snapshot</th>
                  <th className="p-4 font-semibold text-right">Invite Code</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {dashboardData.map((row: any) => (
                  <tr key={row.assignment_id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="p-4 text-white font-medium">
                      {row.student_name || <span className="text-yellow-500 text-xs italic">Pending Invite Acceptance</span>}
                    </td>
                    <td className="p-4 text-gray-300">{row.routine_title}</td>
                    <td className="p-4 text-muted-foreground">{new Date(row.assigned_at).toLocaleDateString()}</td>
                    <td className="p-4">
                      {row.chunk_scores ? (
                        <div className="flex items-center gap-1">
                          {row.chunk_scores.map((cs: any) => (
                            <div 
                              key={cs.chunk_index} 
                              className={`w-4 h-4 rounded-sm ${cs.best_score > 80 ? 'bg-green-500' : cs.best_score > 50 ? 'bg-yellow-500' : cs.best_score > 0 ? 'bg-red-500' : 'bg-gray-700'}`}
                              title={`Chunk ${cs.chunk_index}: ${cs.best_score || 0}%`}
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No attempts yet</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <code className="bg-black/40 px-2 py-1 rounded text-primary text-xs font-mono border border-white/5">
                        {row.invite_code}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
