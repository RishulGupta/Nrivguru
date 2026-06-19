import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OnboardingState {
  ageVerified: boolean;
  biometricConsent: boolean;
  setAgeVerified: (val: boolean) => void;
  setBiometricConsent: (val: boolean) => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      ageVerified: false,
      biometricConsent: false,
      setAgeVerified: (val) => set({ ageVerified: val }),
      setBiometricConsent: (val) => set({ biometricConsent: val }),
    }),
    {
      name: 'taal-onboarding',
    }
  )
);

interface AuthState {
  session: any | null; // Will type as Session from @supabase/supabase-js later
  profile: any | null;
  credits: number;
  isGuest: boolean;
  setSession: (session: any) => void;
  setProfile: (profile: any) => void;
  setCredits: (credits: number) => void;
  setGuest: (val: boolean) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      session: null,
      profile: null,
      credits: 10,
      isGuest: false,
      setSession: (session) => set({ session }),
      setProfile: (profile) => set({ profile }),
      setCredits: (credits) => set({ credits }),
      setGuest: (val) => set({ isGuest: val, credits: val ? 10 : 0, session: val ? {} as any : null }),
      clearAuth: () => set({ session: null, profile: null, credits: 0, isGuest: false }),
    }),
    { name: 'taal-auth' }
  )
);
