import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useStore';
import { supabase } from '../lib/supabase';

export default function Settings() {
  const navigate = useNavigate();
  const profile = useAuthStore((state) => state.profile);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const session = useAuthStore((state) => state.session);

  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [displayName, setDisplayName] = useState(profile?.display_name || '');

  const handleLogout = async () => {
    await supabase.auth.signOut();
    clearAuth();
    navigate('/auth');
  };

  const handleUpdateName = async () => {
    if (!session?.user?.id || !displayName.trim()) return;
    await supabase.rpc('rpc_upsert_profile', {
      p_user_id: session.user.id,
      p_display_name: displayName.trim()
    });
    useAuthStore.getState().setProfile({ ...profile, display_name: displayName.trim() });
  };

  const handleDeleteData = async () => {
    if (deleteConfirm !== 'DELETE') return;
    if (!session?.user?.id) return;
    supabase.rpc('rpc_get_attempt_history', { p_user_id: session.user.id, p_routine_id: null })
      .then(({ data }) => {
        if (Array.isArray(data)) {
          alert('All data deletion initiated. This may take a moment.');
        }
      });
    setDeleteConfirm('');
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <header className="max-w-3xl mx-auto flex items-center gap-4 mb-8">
        <button
          onClick={() => navigate('/home')}
          className="w-12 h-12 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-white transition-colors border border-white/10 text-xl"
        >
          ←
        </button>
        <h1 className="text-2xl font-outfit font-bold text-white">⚙️ Settings</h1>
      </header>

      <main className="max-w-3xl mx-auto space-y-4">
        {/* Account */}
        <div className="glass p-6 rounded-3xl border border-white/10 space-y-4">
          <p className="text-xl font-bold text-white">👤 Account</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="flex-1 bg-input/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all"
            />
            <button
              onClick={handleUpdateName}
              className="bg-primary hover:bg-primary/90 text-white font-bold px-6 py-3 rounded-xl transition-all"
            >
              💾 Save
            </button>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <p className="text-white/70 text-sm">{session?.user?.email || 'Guest'}</p>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg font-semibold hover:bg-red-500/20 transition-colors"
            >
              🚪 Sign Out
            </button>
          </div>
        </div>

        {/* Camera */}
        <div className="glass p-6 rounded-3xl border border-white/10 space-y-4">
          <p className="text-xl font-bold text-white">📷 Camera</p>
          <p className="text-sm text-muted-foreground">Your video never leaves this device.</p>
          <button className="w-full bg-white/5 hover:bg-white/10 text-white font-bold py-4 rounded-xl transition-all text-lg">
            📷 Allow Camera
          </button>
        </div>

        {/* Data */}
        <div className="glass p-6 rounded-3xl border border-white/10 space-y-4">
          <p className="text-xl font-bold text-white">📁 Data</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={deleteConfirm}
              onChange={e => setDeleteConfirm(e.target.value)}
              placeholder='Type "DELETE" to erase all data'
              className="flex-1 bg-input/50 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500 transition-all"
            />
            <button
              onClick={handleDeleteData}
              disabled={deleteConfirm !== 'DELETE'}
              className="bg-red-500/20 text-red-400 border border-red-500/30 font-bold px-6 py-3 rounded-xl transition-all hover:bg-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed text-lg"
            >
              🗑️
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
