import { useNavigate } from 'react-router-dom';
import { useOnboardingStore, useAuthStore } from '../store/useStore';
import { Activity, ShieldCheck, VideoOff } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function BiometricConsent() {
  const navigate = useNavigate();
  const setBiometricConsent = useOnboardingStore((state) => state.setBiometricConsent);
  const session = useAuthStore((state) => state.session);

  const handleConsent = () => {
    setBiometricConsent(true);
    // Store consent timestamp in Supabase if session exists
    if (session?.user?.id) {
      supabase.rpc('rpc_upsert_profile', {
        p_user_id: session.user.id,
        p_display_name: session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'User',
        p_avatar_url: null
      }).catch(() => {});
    }
    navigate('/auth');
  };

  const handleDecline = () => {
    alert("Biometric analysis is required to provide AI feedback. You cannot use Taal's core features without this consent.");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass p-8 rounded-2xl max-w-lg w-full relative overflow-hidden">
        <div className="absolute -top-32 -left-32 w-64 h-64 bg-accent/10 rounded-full blur-[60px] pointer-events-none"></div>

        <div className="flex justify-center mb-6 relative">
          <div className="p-4 bg-accent/10 rounded-full neon-border">
            <Activity className="w-8 h-8 text-accent" />
          </div>
        </div>

        <h1 className="text-3xl text-center mb-6 font-outfit font-bold neon-text text-white">How We Use Your Data</h1>
        
        <div className="space-y-6 mb-8">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-white/5 rounded-lg shrink-0 mt-1">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Local AI Processing</h3>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                Your body movements are analyzed locally on your device. We extract structural "landmarks" (joint positions) to compare your timing and accuracy.
              </p>
            </div>
          </div>
          
          <div className="flex items-start gap-4">
            <div className="p-2 bg-white/5 rounded-lg shrink-0 mt-1">
              <VideoOff className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h3 className="font-semibold text-white">No Video Uploads</h3>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                Your camera feed never leaves your device. We do not record or send video to our servers. Only the anonymous skeletal scores are saved.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="p-2 bg-white/5 rounded-lg shrink-0 mt-1">
              <ShieldCheck className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Your Privacy First</h3>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                You can withdraw this consent at any time from the settings menu. Doing so will disable the AI scoring feature.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleConsent}
            className="w-full bg-accent hover:bg-accent/90 text-accent-foreground font-semibold py-3 rounded-xl transition-all shadow-[0_0_15px_rgba(236,72,153,0.3)] hover:shadow-[0_0_25px_rgba(236,72,153,0.5)]"
          >
            I Understand & Agree
          </button>
          <button
            onClick={handleDecline}
            className="w-full bg-transparent border border-white/10 hover:bg-white/5 text-muted-foreground font-semibold py-3 rounded-xl transition-all"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
