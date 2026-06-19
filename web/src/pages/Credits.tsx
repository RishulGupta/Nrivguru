import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ShieldCheck, Zap, HistoryIcon } from 'lucide-react';
import { useAuthStore } from '../store/useStore';
import { supabase } from '../lib/supabase';

interface Pack {
  id: string;
  name: string;
  credits: number;
  priceINR: string;
  priceUSD: string;
  popular: boolean;
  badge?: string;
  features: string[];
}

const PACKS: Pack[] = [
  { id: 'starter', name: 'Starter Pack', credits: 3, priceINR: '₹199', priceUSD: '$2.99', popular: false, features: ['3 routine unlocks'] },
  { id: 'practice', name: 'Practice Pack', credits: 10, priceINR: '₹499', priceUSD: '$6.99', popular: true, features: ['10 routine unlocks', 'Priority processing'], badge: 'Recommended' },
  { id: 'event', name: 'Event Pack', credits: 25, priceINR: '₹999', priceUSD: '$12.99', popular: false, features: ['25 routine unlocks', 'Shareable invite link for 5 friends'], badge: 'Most Popular' },
];

export default function Credits() {
  const navigate = useNavigate();
  const credits = useAuthStore(s => s.credits);
  const session = useAuthStore(s => s.session);
  const [detectedIndia, setDetectedIndia] = useState(true);
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [txHistory, setTxHistory] = useState<any[]>([]);

  useEffect(() => {
    // Detect India via navigator.language
    const lang = navigator.language || '';
    setDetectedIndia(lang === 'hi' || lang.startsWith('hi') || lang === 'en-IN');
  }, []);

  useEffect(() => {
    if (session?.user?.id) {
      supabase.rpc('rpc_get_credit_history', { p_user_id: session.user.id })
        .then(({ data }) => {
          if (data) setTxHistory(Array.isArray(data) ? data : []);
        });
    }
  }, [session]);

  const handlePurchase = async () => {
    if (!selectedPack) return;
    setIsProcessing(true);
    setSuccess(false);

    // Mock payment — in production calls Razorpay (India) or Stripe (global)
    await new Promise(r => setTimeout(r, 2000));

    const pack = PACKS.find(p => p.id === selectedPack);
    if (pack && session?.user?.id) {
      const { data } = await supabase.rpc('rpc_add_credits', {
        p_user_id: session.user.id,
        p_amount: pack.credits,
        p_reason: `purchase_${pack.id}`,
        p_payment_id: `mock_${Date.now()}`
      });
      if (data) {
        useAuthStore.getState().setCredits(data);
      }
    }

    setIsProcessing(false);
    setSuccess(true);
    setSelectedPack(null);
    setTimeout(() => setSuccess(false), 3000);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <header className="max-w-5xl mx-auto flex items-center justify-between mb-8">
        <button
          onClick={() => navigate('/home')}
          className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-white transition-colors border border-white/10"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 bg-primary/20 border border-primary/30 px-4 py-2 rounded-full">
          <Zap className="w-4 h-4 text-primary" />
          <span className="text-white font-bold">{credits} Credits Available</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-outfit font-bold text-white mb-4">Fuel Your Practice</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Purchase credits to analyze routines, get AI-powered skeletal feedback, and unlock advanced scoring. No subscription required.
          </p>
        </div>

        {/* Free tier note */}
        <div className="max-w-lg mx-auto mb-10 glass p-4 rounded-2xl border border-white/10 text-center">
          <p className="text-sm text-muted-foreground">
            <strong className="text-white">Free Tier:</strong> First 30 seconds of any routine free &bull; First chunk of any routine free &bull; 1 free routine on account creation
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          {PACKS.map((pkg) => {
            const price = detectedIndia ? pkg.priceINR : pkg.priceUSD;
            const currency = detectedIndia ? 'INR' : 'USD';
            return (
              <div
                key={pkg.id}
                onClick={() => setSelectedPack(pkg.id)}
                className={`relative glass rounded-3xl p-8 cursor-pointer transition-all border-2 ${
                  selectedPack === pkg.id
                    ? 'border-primary shadow-[0_0_30px_rgba(147,51,234,0.3)] bg-primary/5'
                    : 'border-white/5 hover:border-white/20'
                }`}
              >
                {pkg.badge && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-primary to-pink-500 text-white text-xs font-bold px-4 py-1 rounded-full uppercase tracking-wider">
                    {pkg.badge}
                  </div>
                )}

                <h3 className="text-2xl font-bold text-white mb-2">{pkg.name}</h3>
                <div className="flex items-baseline gap-2 mb-6">
                  <span className="text-4xl font-outfit font-bold text-white">{price}</span>
                  <span className="text-sm text-muted-foreground">{currency}</span>
                </div>

                <div className="flex items-center gap-2 mb-6">
                  <span className="text-sm text-muted-foreground">via</span>
                  <span className="text-xs font-bold px-2 py-1 rounded bg-white/10 text-white">
                    {detectedIndia ? 'UPI / Cards / Netbanking' : 'Card / Wallet'}
                  </span>
                </div>

                <ul className="space-y-3 mb-8">
                  {pkg.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-3 text-gray-300">
                      <Check className="w-5 h-5 text-primary shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <div className={`w-full py-3 rounded-xl font-semibold text-center transition-colors ${
                  selectedPack === pkg.id
                    ? 'bg-primary text-white'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}>
                  {selectedPack === pkg.id ? 'Selected' : `Buy with ${detectedIndia ? 'UPI' : 'Card'}`}
                </div>
              </div>
            );
          })}
        </div>

        {selectedPack && (
          <div className="max-w-md mx-auto glass p-6 rounded-2xl border border-primary/50 text-center mb-8">
            <h4 className="text-xl font-bold text-white mb-4">Complete Checkout</h4>
            <button
              onClick={handlePurchase}
              disabled={isProcessing}
              className="w-full bg-white text-black hover:bg-gray-200 font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? 'Processing Payment...' : `Pay ${detectedIndia ? 'via Razorpay' : 'via Stripe'}`}
            </button>
            <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground mt-4">
              <ShieldCheck className="w-4 h-4" />
              {detectedIndia ? 'Secured by Razorpay' : 'Secured by Stripe'}
            </p>
          </div>
        )}

        {success && (
          <div className="max-w-md mx-auto mb-8 p-4 bg-green-500/20 border border-green-500/50 text-green-400 rounded-xl text-center font-semibold">
            Purchase successful! Credits added to your account.
          </div>
        )}

        {/* Transaction history */}
        {txHistory.length > 0 && (
          <div className="max-w-2xl mx-auto glass p-6 rounded-3xl border border-white/10">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
              <HistoryIcon className="w-5 h-5 text-primary" />
              Transaction History
            </h3>
            <div className="space-y-2">
              {txHistory.slice(0, 10).map((tx: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm py-2 border-b border-white/5 last:border-0">
                  <div>
                    <p className="text-white">{tx.reason?.replace(/_/g, ' ') || 'Transaction'}</p>
                    <p className="text-muted-foreground text-xs">{tx.created_at ? new Date(tx.created_at).toLocaleDateString() : ''}</p>
                  </div>
                  <span className={`font-bold ${tx.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {tx.delta > 0 ? '+' : ''}{tx.delta}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
