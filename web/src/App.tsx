import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useOnboardingStore, useAuthStore } from './store/useStore';
import { supabase } from './lib/supabase';

import AgeGate from './pages/AgeGate';
import BiometricConsent from './pages/BiometricConsent';
import Auth from './pages/Auth';
import Home from './pages/Home';
import Upload from './pages/Upload';
import RoutineDetail from './pages/RoutineDetail';
import Practice from './pages/Practice';
import Share from './pages/Share';
import Credits from './pages/Credits';
import History from './pages/History';
import InstructorPortal from './pages/InstructorPortal';
import Settings from './pages/Settings';
import WarmUp from './pages/WarmUp';
import SegmentPhases from './pages/SegmentPhases';
import ChapterPlayer from './pages/ChapterPlayer';

// Route Guards
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { ageVerified, biometricConsent } = useOnboardingStore();
  const session = useAuthStore((state) => state.session);
  const isGuest = useAuthStore((state) => state.isGuest);

  // Hydration fallback: check localStorage directly if Zustand persist hasn't rehydrated yet
  const guestFromStorage = typeof window !== 'undefined'
    ? (() => { try { const a = JSON.parse(localStorage.getItem('taal-auth') || '{}'); return a?.state?.isGuest === true; } catch { return false; } })()
    : false;
  const onboardingFromStorage = typeof window !== 'undefined'
    ? (() => { try { const o = JSON.parse(localStorage.getItem('taal-onboarding') || '{}'); return o?.state?.ageVerified === true && o?.state?.biometricConsent === true; } catch { return false; } })()
    : false;

  const effectiveAge = ageVerified || onboardingFromStorage;
  const effectiveConsent = biometricConsent || onboardingFromStorage;
  const effectiveAuth = session || isGuest || guestFromStorage;

  if (!effectiveAge) return <Navigate to="/age-gate" replace />;
  if (!effectiveConsent) return <Navigate to="/consent" replace />;
  if (!effectiveAuth) return <Navigate to="/auth" replace />;

  return <>{children}</>;
}

function OnboardingRoute({ children }: { children: React.ReactNode }) {
  const { ageVerified } = useOnboardingStore();
  if (ageVerified) return <Navigate to="/consent" replace />;
  return <>{children}</>;
}

function ConsentRoute({ children }: { children: React.ReactNode }) {
  const { ageVerified, biometricConsent } = useOnboardingStore();
  if (!ageVerified) return <Navigate to="/age-gate" replace />;
  if (biometricConsent) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { ageVerified, biometricConsent } = useOnboardingStore();
  const session = useAuthStore((state) => state.session);
  
  if (!ageVerified) return <Navigate to="/age-gate" replace />;
  if (!biometricConsent) return <Navigate to="/consent" replace />;
  if (session) return <Navigate to="/home" replace />;
  
  return <>{children}</>;
}

function App() {
  const setSession = useAuthStore((state) => state.setSession);

  useEffect(() => {
    const fetchProfileData = async (userId: string, email?: string, metadata?: any) => {
      let { data } = await supabase.rpc('rpc_get_profile', { p_user_id: userId });
      if (!data) {
        // Auto-create profile if missing
        await supabase.rpc('rpc_upsert_profile', {
          p_user_id: userId,
          p_display_name: metadata?.username || email?.split('@')[0] || 'User'
        });
        await supabase.rpc('rpc_complete_onboarding', { p_user_id: userId });
        const res = await supabase.rpc('rpc_get_profile', { p_user_id: userId });
        data = res.data;
      }
      if (data) {
        useAuthStore.getState().setProfile(data);
        useAuthStore.getState().setCredits(data.credit_balance || 0);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfileData(session.user.id, session.user.email, session.user.user_metadata);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchProfileData(session.user.id, session.user.email, session.user.user_metadata);
      } else {
        useAuthStore.getState().setProfile(null);
        useAuthStore.getState().setCredits(0);
      }
    });

    return () => subscription.unsubscribe();
  }, [setSession]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        
        <Route path="/age-gate" element={
          <OnboardingRoute>
            <AgeGate />
          </OnboardingRoute>
        } />
        
        <Route path="/consent" element={
          <ConsentRoute>
            <BiometricConsent />
          </ConsentRoute>
        } />
        
        <Route path="/auth" element={
          <AuthRoute>
            <Auth />
          </AuthRoute>
        } />
        
        <Route path="/home" element={
          <ProtectedRoute>
            <Home />
          </ProtectedRoute>
        } />
        
        <Route path="/upload" element={
          <ProtectedRoute>
            <Upload />
          </ProtectedRoute>
        } />

        <Route path="/routine/:id" element={
          <ProtectedRoute>
            <RoutineDetail />
          </ProtectedRoute>
        } />

        <Route path="/warmup/:id/:chunkId" element={
          <ProtectedRoute>
            <WarmUp />
          </ProtectedRoute>
        } />

        <Route path="/segment-phases/:routineId/:chunkId" element={
          <ProtectedRoute>
            <SegmentPhases />
          </ProtectedRoute>
        } />

        <Route path="/practice/:id/:chunkId" element={
          <ProtectedRoute>
            <Practice />
          </ProtectedRoute>
        } />

        <Route path="/chapter-player/:id" element={
          <ProtectedRoute>
            <ChapterPlayer />
          </ProtectedRoute>
        } />

        <Route path="/share" element={
          <ProtectedRoute>
            <Share />
          </ProtectedRoute>
        } />

        <Route path="/credits" element={
          <ProtectedRoute>
            <Credits />
          </ProtectedRoute>
        } />

        <Route path="/history" element={
          <ProtectedRoute>
            <History />
          </ProtectedRoute>
        } />

        <Route path="/instructor" element={
          <ProtectedRoute>
            <InstructorPortal />
          </ProtectedRoute>
        } />

        <Route path="/settings" element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        } />
        
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
