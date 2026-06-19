import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield, Video, Moon } from 'lucide-react';
import { useAuthStore } from '../store/useStore';
import { supabase } from '../lib/supabase';

export default function Settings() {
  const navigate = useNavigate();
  const profile = useAuthStore((state) => state.profile);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  const [darkMode, setDarkMode] = useState(true);
  const [modelQuality, setModelQuality] = useState('full');
  const [saveLocalData, setSaveLocalData] = useState(true);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    clearAuth();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-background p-6">
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
        <section className="glass p-6 rounded-3xl border border-white/10 space-y-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <UserIcon className="w-5 h-5 text-primary" />
            Account
          </h2>
          
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-medium">{profile?.display_name || 'User'}</p>
              <p className="text-sm text-muted-foreground">Logged in with Supabase Auth</p>
            </div>
            <button 
              onClick={handleLogout}
              className="px-4 py-2 bg-red-500/10 text-red-500 border border-red-500/20 rounded-lg text-sm font-semibold hover:bg-red-500/20 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </section>

        <section className="glass p-6 rounded-3xl border border-white/10 space-y-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Video className="w-5 h-5 text-primary" />
            AI & Processing
          </h2>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">MediaPipe Quality</p>
                <p className="text-sm text-muted-foreground">Lower quality improves performance on older devices.</p>
              </div>
              <select 
                value={modelQuality}
                onChange={(e) => setModelQuality(e.target.value)}
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-primary transition-colors text-sm"
              >
                <option value="lite">Lite (Fastest)</option>
                <option value="full">Full (Balanced)</option>
                <option value="heavy">Heavy (Most Accurate)</option>
              </select>
            </div>
          </div>
        </section>

        <section className="glass p-6 rounded-3xl border border-white/10 space-y-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Moon className="w-5 h-5 text-primary" />
            Appearance
          </h2>
          
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-medium">Dark Mode</p>
              <p className="text-sm text-muted-foreground">Taal is designed for dark mode.</p>
            </div>
            <button 
              onClick={() => setDarkMode(!darkMode)}
              className={`w-12 h-6 rounded-full transition-colors relative ${darkMode ? 'bg-primary' : 'bg-white/10'}`}
            >
              <div className={`absolute top-1 bottom-1 w-4 bg-white rounded-full transition-transform ${darkMode ? 'right-1' : 'left-1'}`} />
            </button>
          </div>
        </section>

        <section className="glass p-6 rounded-3xl border border-white/10 space-y-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Data Privacy
          </h2>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">Save Local Data</p>
                <p className="text-sm text-muted-foreground max-w-[280px] sm:max-w-md">Store biometric movement data in IndexedDB for faster loading. If disabled, routines must be re-processed.</p>
              </div>
              <button 
                onClick={() => setSaveLocalData(!saveLocalData)}
                className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${saveLocalData ? 'bg-primary' : 'bg-white/10'}`}
              >
                <div className={`absolute top-1 bottom-1 w-4 bg-white rounded-full transition-transform ${saveLocalData ? 'right-1' : 'left-1'}`} />
              </button>
            </div>
            
            <div className="pt-4 border-t border-white/5">
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

// Inline UserIcon to avoid adding more imports
function UserIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
