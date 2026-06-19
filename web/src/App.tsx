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

// Route Guards
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { ageVerified, biometricConsent } = useOnboardingStore();
  const session = useAuthStore((state) => state.session);

  if (!ageVerified) return <Navigate to="/age-gate" replace />;
  if (!biometricConsent) return <Navigate to="/consent" replace />;
  if (!session) return <Navigate to="/auth" replace />;

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
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
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

        <Route path="/practice/:id/:chunkId" element={
          <ProtectedRoute>
            <Practice />
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
        
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
