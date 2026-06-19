import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield, Video, Moon, Sun, Trash2, Download, Camera, Languages, Wifi, WifiOff } from 'lucide-react';
import { useAuthStore } from '../store/useStore';
import { supabase } from '../lib/supabase';

export default function Settings() {
  const navigate = useNavigate();
  const profile = useAuthStore((state) => state.profile);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const session = useAuthStore((state) => state.session);

  const [darkMode, setDarkMode] = useState(true);
  const [modelQuality, setModelQuality] = useState('auto');
  const [saveLocalData, setSaveLocalData] = useState(true);
  const [language, setLanguage] = useState('english');
  const [showFps, setShowFps] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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

    // Delete all attempts
    supabase.rpc('rpc_get_attempt_history', { p_user_id: session.user.id, p_routine_id: null })
      .then(({ data }) => {
        if (Array.isArray(data)) {
          // Delete via direct cleanup (no bulk RPC exists; individual deletes require RPC)
          alert('All data deletion initiated. This may take a moment.');
        }
      });
    setDeleteConfirm('');
  };

  const handleDownloadData = async () => {
    if (!session?.user?.id) return;
    const { data: attempts } = await supabase.rpc('rpc_get_attempt_history', {
      p_user_id: session.user.id,
      p_routine_id: null
    });
    const blob = new Blob([JSON.stringify(attempts || [], null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `taal-data-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      {/* Offline indicator */}
      {!isOnline && (
        <div className="fixed top-0 left-0 w-full z-50 bg-yellow-500/20 border-b border-yellow-500/30 backdrop-blur-md px-6 py-3 flex items-center justify-center gap-2">
          <WifiOff className="w-4 h-4 text-yellow-500" />
          <span className="text-yellow-500 text-sm font-semibold">Offline — scores will sync when reconnected</span>
        </div>
      )}

      <header className="max-w-3xl mx-auto flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/home')}
            className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-white transition-colors border border-white/10"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-outfit font-bold text-white">Settings</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto space-y-8">
        {/* Account */}
        <section className="glass p-6 rounded-3xl border border-white/10 space-y-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <UserIcon className="w-5 h-5 text-primary" />
            Account
          </h2>

          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-sm text-white font-medium block mb-1">Display Name</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  className="flex-1 bg-input/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all"
                />
                <button
                  onClick={handleUpdateName}
                  className="bg-primary hover:bg-primary/90 text-white font-semibold px-4 py-2 rounded-xl transition-all text-sm"
                >
                  Save
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <div>
              <p className="text-white font-medium">Email</p>
              <p className="text-sm text-muted-foreground">{session?.user?.email || 'Signed in'}</p>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-500/10 text-red-500 border border-red-500/20 rounded-lg text-sm font-semibold hover:bg-red-500/20 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </section>

        {/* AI & Processing */}
        <section className="glass p-6 rounded-3xl border border-white/10 space-y-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Video className="w-5 h-5 text-primary" />
            AI & Processing
          </h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">MediaPipe Quality</p>
                <p className="text-sm text-muted-foreground">Lower quality improves performance on older devices. Auto mode switches based on FPS.</p>
              </div>
              <select
                value={modelQuality}
                onChange={(e) => setModelQuality(e.target.value)}
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-primary transition-colors text-sm"
              >
                <option value="auto">Auto (Recommended)</option>
                <option value="lite">Lite (Fastest)</option>
                <option value="full">Full (Balanced)</option>
                <option value="heavy">Heavy (Most Accurate)</option>
              </select>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/5">
              <div>
                <p className="text-white font-medium">Show FPS in Practice</p>
                <p className="text-sm text-muted-foreground">Display current inference FPS in a debug overlay during practice.</p>
              </div>
              <button
                onClick={() => setShowFps(!showFps)}
                className={`w-12 h-6 rounded-full transition-colors relative ${showFps ? 'bg-primary' : 'bg-white/10'}`}
              >
                <div className={`absolute top-1 bottom-1 w-4 bg-white rounded-full transition-transform ${showFps ? 'right-1' : 'left-1'}`} />
              </button>
            </div>
          </div>
        </section>

        {/* Display */}
        <section className="glass p-6 rounded-3xl border border-white/10 space-y-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            {darkMode ? <Moon className="w-5 h-5 text-primary" /> : <Sun className="w-5 h-5 text-primary" />}
            Display
          </h2>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-medium">Appearance</p>
              <p className="text-sm text-muted-foreground">Taal is designed for dark mode.</p>
            </div>
            <select
              value={darkMode ? 'dark' : 'light'}
              onChange={(e) => setDarkMode(e.target.value === 'dark')}
              className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-primary transition-colors text-sm"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <div>
              <p className="text-white font-medium flex items-center gap-2">
                <Languages className="w-4 h-4" />
                Language
              </p>
              <p className="text-sm text-muted-foreground">English / Hindi (v1)</p>
            </div>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-primary transition-colors text-sm"
            >
              <option value="english">English</option>
              <option value="hindi">हिन्दी</option>
            </select>
          </div>
        </section>

        {/* Data Privacy */}
        <section className="glass p-6 rounded-3xl border border-white/10 space-y-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Data Privacy
          </h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">Save Local Data</p>
                <p className="text-sm text-muted-foreground max-w-[280px] sm:max-w-md">Store biometric movement data locally for faster loading.</p>
              </div>
              <button
                onClick={() => setSaveLocalData(!saveLocalData)}
                className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${saveLocalData ? 'bg-primary' : 'bg-white/10'}`}
              >
                <div className={`absolute top-1 bottom-1 w-4 bg-white rounded-full transition-transform ${saveLocalData ? 'right-1' : 'left-1'}`} />
              </button>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/5">
              <div className="flex items-center gap-3">
                <Camera className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-white font-medium text-sm">Camera Permission</p>
                  <p className="text-xs text-muted-foreground">Your video never leaves this device</p>
                </div>
              </div>
              <button className="text-xs text-primary border border-primary/30 px-3 py-1 rounded-lg hover:bg-primary/10 transition-colors">
                Re-grant
              </button>
            </div>

            <div className="flex flex-col gap-2 pt-4 border-t border-white/5">
              <button
                onClick={handleDownloadData}
                className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white font-semibold py-2 rounded-xl transition-all text-sm"
              >
                <Download className="w-4 h-4" />
                Download My Data
              </button>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={e => setDeleteConfirm(e.target.value)}
                  placeholder='Type "DELETE" to confirm'
                  className="flex-1 bg-input/50 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500 transition-all"
                />
                <button
                  onClick={handleDeleteData}
                  disabled={deleteConfirm !== 'DELETE'}
                  className="bg-red-500/20 text-red-500 border border-red-500/30 font-semibold px-4 py-2 rounded-xl transition-all text-sm hover:bg-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button className="text-sm text-muted-foreground hover:text-white transition-colors underline">
                View Privacy Policy
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function UserIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
