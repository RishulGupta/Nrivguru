import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboardingStore } from '../store/useStore';
import { Calendar } from 'lucide-react';

export default function AgeGate() {
  const navigate = useNavigate();
  const setAgeVerified = useOnboardingStore((state) => state.setAgeVerified);
  const [year, setYear] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const currentYear = new Date().getFullYear();
    const birthYear = parseInt(year, 10);
    
    if (!birthYear || birthYear < 1900 || birthYear > currentYear) {
      setError('Please enter a valid year.');
      return;
    }
    
    if (currentYear - birthYear < 13) {
      setError('This app requires parental consent for users under 13. Please ask a parent or guardian to set up your account.');
      return;
    }
    
    setAgeVerified(true);
    navigate('/consent');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass p-8 rounded-2xl max-w-md w-full relative overflow-hidden">
        {/* Neon glow effect behind the card */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-primary/20 rounded-full blur-[50px] pointer-events-none"></div>
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-accent/20 rounded-full blur-[50px] pointer-events-none"></div>

        <div className="flex justify-center mb-6">
          <div className="p-4 bg-primary/10 rounded-full">
            <Calendar className="w-8 h-8 text-primary" />
          </div>
        </div>
        
        <h1 className="text-3xl text-center mb-2 neon-text">Welcome to Taal</h1>
        <p className="text-muted-foreground text-center mb-8">Please enter your birth year to continue.</p>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <input
              type="number"
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                setError('');
              }}
              placeholder="YYYY"
              className="w-full bg-input/50 border border-white/10 rounded-xl px-4 py-3 text-center text-2xl font-outfit tracking-widest focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            />
          </div>
          
          {error && <p className="text-destructive text-sm text-center">{error}</p>}
          
          <button
            type="submit"
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-3 rounded-xl transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)] hover:shadow-[0_0_25px_rgba(147,51,234,0.5)]"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
