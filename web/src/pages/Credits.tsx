import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ShieldCheck, Zap } from 'lucide-react';


const PACKAGES = [
  { id: 'starter', name: 'Starter Pack', credits: 10, price: '$4.99', popular: false },
  { id: 'pro', name: 'Pro Pack', credits: 50, price: '$19.99', popular: true },
  { id: 'master', name: 'Master Pack', credits: 150, price: '$49.99', popular: false },
];

export default function Credits() {
  const navigate = useNavigate();
  // Mock global user credits using local state for demo purposes
  const [userCredits, setUserCredits] = useState(0); 
  
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [success, setSuccess] = useState(false);

  const handlePurchase = async () => {
    if (!selectedPack) return;
    setIsProcessing(true);
    setSuccess(false);

    // Mock API call to Stripe/Razorpay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const pack = PACKAGES.find(p => p.id === selectedPack);
    if (pack) {
      setUserCredits(prev => prev + pack.credits);
    }
    
    setIsProcessing(false);
    setSuccess(true);
    setSelectedPack(null);

    // Reset success message after 3 seconds
    setTimeout(() => setSuccess(false), 3000);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <header className="max-w-5xl mx-auto flex items-center justify-between mb-12">
        <button 
          onClick={() => navigate('/home')}
          className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-white transition-colors border border-white/10"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 bg-primary/20 border border-primary/30 px-4 py-2 rounded-full">
          <Zap className="w-4 h-4 text-primary" />
          <span className="text-white font-bold">{userCredits} Credits Available</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-outfit font-bold text-white mb-4">Fuel Your Practice</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Purchase credits to analyze routines, get AI-powered skeletal feedback, and unlock advanced scoring. No subscription required.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          {PACKAGES.map((pkg) => (
            <div 
              key={pkg.id}
              onClick={() => setSelectedPack(pkg.id)}
              className={`relative glass rounded-3xl p-8 cursor-pointer transition-all border-2 ${
                selectedPack === pkg.id 
                  ? 'border-primary shadow-[0_0_30px_rgba(147,51,234,0.3)] bg-primary/5' 
                  : 'border-white/5 hover:border-white/20'
              }`}
            >
              {pkg.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-primary to-pink-500 text-white text-xs font-bold px-4 py-1 rounded-full uppercase tracking-wider">
                  Most Popular
                </div>
              )}
              
              <h3 className="text-2xl font-bold text-white mb-2">{pkg.name}</h3>
              <div className="flex items-baseline gap-2 mb-6">
                <span className="text-4xl font-outfit font-bold text-white">{pkg.price}</span>
              </div>
              
              <ul className="space-y-4 mb-8">
                <li className="flex items-center gap-3 text-gray-300">
                  <Check className="w-5 h-5 text-primary shrink-0" />
                  <span><strong>{pkg.credits}</strong> routine analyses</span>
                </li>
                <li className="flex items-center gap-3 text-gray-300">
                  <Check className="w-5 h-5 text-primary shrink-0" />
                  <span>Unlimited video exports</span>
                </li>
                <li className="flex items-center gap-3 text-gray-300">
                  <Check className="w-5 h-5 text-primary shrink-0" />
                  <span>Detailed history tracking</span>
                </li>
              </ul>
              
              <div className={`w-full py-3 rounded-xl font-semibold text-center transition-colors ${
                selectedPack === pkg.id 
                  ? 'bg-primary text-white' 
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}>
                {selectedPack === pkg.id ? 'Selected' : 'Select Package'}
              </div>
            </div>
          ))}
        </div>

        {selectedPack && (
          <div className="max-w-md mx-auto glass p-6 rounded-2xl border border-primary/50 text-center animate-in fade-in slide-in-from-bottom-4">
            <h4 className="text-xl font-bold text-white mb-4">Complete Checkout</h4>
            <button 
              onClick={handlePurchase}
              disabled={isProcessing}
              className="w-full bg-white text-black hover:bg-gray-200 font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? (
                'Processing Payment...'
              ) : (
                <>
                  Pay {PACKAGES.find(p => p.id === selectedPack)?.price} securely
                </>
              )}
            </button>
            <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground mt-4">
              <ShieldCheck className="w-4 h-4" />
              Secured by Stripe / Razorpay (Mock)
            </p>
          </div>
        )}

        {success && (
          <div className="max-w-md mx-auto mt-4 p-4 bg-green-500/20 border border-green-500/50 text-green-400 rounded-xl text-center font-semibold animate-in fade-in zoom-in">
            Purchase successful! Credits added to your account.
          </div>
        )}
      </main>
    </div>
  );
}
