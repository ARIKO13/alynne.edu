import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Clock, CreditCard, Loader2, CheckCircle, XCircle, Crown, X, Sparkles } from 'lucide-react';

interface SubStatus {
  hasAccess: boolean;
  isAdmin: boolean;
  status: string;
  daysRemaining: number;
  trialEndsAt: string | null;
  expiresAt: string | null;
}

interface PaymentWallProps {
  subStatus: SubStatus;
  onPaymentSuccess?: () => void;
}

/**
 * Call create-transaction API then redirect to Midtrans VT-Web payment page
 */
async function redirectToPayment(options: {
  onError: (msg: string) => void;
}) {
  const { onError } = options;
  let res: Response;
  try {
    res = await fetch('/api/payment/create-transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    });
  } catch {
    onError('Gagal terhubung ke server. Periksa koneksi internet.');
    return;
  }
  let data: any;
  try {
    const text = await res.text();
    try { data = JSON.parse(text); } catch {
      onError('Server error: ' + res.status + '. Refresh halaman.');
      return;
    }
  } catch {
    onError('Gagal membaca respons server.');
    return;
  }
  if (!res.ok || data.error) {
    if (res.status === 401) onError('Sesi expired. Login ulang.');
    else onError(data.error || ('Error ' + res.status));
    return;
  }
  // Use VT-Web redirect URL with snap token
  const snapToken = data.snapToken;
  if (snapToken) {
    window.location.href = 'https://app.midtrans.com/snap/v2/vtweb/' + snapToken;
  } else {
    onError('Token pembayaran tidak ditemukan.');
  }
}

export function PaymentWall({ subStatus, onPaymentSuccess }: PaymentWallProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const pay = useCallback(async () => {
    setLoading(true); setError('');
    await redirectToPayment({
      onError: (msg) => { setError(msg); setLoading(false); },
    });
  }, []);

  const isExpired = subStatus.status === 'expired' || subStatus.status === 'none';
  const isTrial = subStatus.status === 'trial';
  const isTrialEnding = isTrial && subStatus.daysRemaining <= 3;

  if (isTrialEnding && !isExpired) {
    return (
      <div className="mb-4 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
        <div className="flex items-start gap-3">
          <Clock className="h-5 w-5 text-violet-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-violet-200">Masa trial tersisa {subStatus.daysRemaining} hari lagi</p>
            <p className="text-xs text-violet-400/70 mt-1">Berlangganan Rp 69.000 untuk tetap akses semua fitur.</p>
            <Button onClick={pay} disabled={loading} className="mt-3 h-8 text-xs bg-violet-500 hover:bg-violet-600 text-black font-semibold rounded-lg gap-1.5">
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <CreditCard className="h-3 w-3" />} Berlangganan
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (isTrial && !isTrialEnding) {
    return (
      <div className="mb-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-[11px] text-zinc-500">Percobaan gratis, tersisa {subStatus.daysRemaining} hari. Berlangganan Rp 69.000 setelah habis.</span>
      </div>
    );
  }
  if (subStatus.status === 'active') return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] glass-card p-8 text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-[#B794F6]/10 flex items-center justify-center"><Crown className="h-8 w-8 text-[#B794F6]" /></div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-white">Masa Percobaan Habis</h2>
          <p className="text-sm text-zinc-400">Berlangganan untuk melanjutkan akses ke semua fitur ALYNNE.EDU.</p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">Berlangganan 30 Hari</span>
            <span className="text-lg font-bold text-white">Rp 69.000</span>
          </div>
          <div className="space-y-1.5 text-left">
            <div className="flex items-center gap-2 text-xs text-zinc-500"><CheckCircle className="h-3.5 w-3.5 text-green-500" /><span>Semua fitur tanpa batas</span></div>
            <div className="flex items-center gap-2 text-xs text-zinc-500"><CheckCircle className="h-3.5 w-3.5 text-green-500" /><span>Speech to Text + Modul PDF + AI Assistant</span></div>
            <div className="flex items-center gap-2 text-xs text-zinc-500"><CheckCircle className="h-3.5 w-3.5 text-green-500" /><span>Dashboard & Sertifikat</span></div>
          </div>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
            <XCircle className="h-3.5 w-3.5 shrink-0" />{error}
          </div>
        )}
        <Button onClick={pay} disabled={loading} className="w-full h-11 rounded-xl bg-gradient-to-r from-[#B794F6] to-[#a57ce8] hover:shadow-[0_0_20px_rgba(183,148,246,0.3)] hover:brightness-110 text-white font-semibold text-sm gap-2">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Memproses...</> : <><CreditCard className="h-4 w-4" />Bayar Rp 69.000</>}
        </Button>
        <p className="text-[10px] text-zinc-600">Pembayaran aman via Midtrans</p>
      </div>
    </div>
  );
}

export function TrialWelcomePopup({ subStatus, onClose, onPaymentSuccess }: {
  subStatus: SubStatus;
  onClose: () => void;
  onPaymentSuccess?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onPaymentSuccessRef = useRef(onPaymentSuccess);
  onPaymentSuccessRef.current = onPaymentSuccess;

  const isTrial = subStatus.status === 'trial';
  const isActive = subStatus.status === 'active';
  const isExpired = subStatus.status === 'expired' || subStatus.status === 'none';

  const handlePay = async () => {
    setLoading(true); setError('');
    console.log('[popup] handlePay clicked - redirecting to VT-Web');
    await redirectToPayment({
      onError: (msg) => { console.error('[popup] error:', msg); setError(msg); setLoading(false); },
    });
  };

  if (isActive || subStatus.isAdmin) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] glass-card overflow-hidden">
        <div className="bg-gradient-to-br from-[#B794F6]/20 to-[#B794F6]/5 px-6 pt-6 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[#B794F6]" />
              <span className="text-xs font-semibold text-[#B794F6] tracking-wide uppercase">ALYNNE.EDU</span>
            </div>
            <button onClick={onClose} className="p-1 rounded-md hover:bg-white/[0.06] transition-colors"><X className="h-4 w-4 text-zinc-500" /></button>
          </div>
        </div>
        <div className="px-6 pb-6 pt-2 space-y-4">
          {isTrial ? (
            <>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white">Selamat Datang!</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Kamu sedang dalam masa <span className="text-violet-400 font-medium">percobaan gratis 7 hari</span>. Selama masa trial, kamu bisa menggunakan semua fitur ALYNNE.EDU secara gratis.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Sisa waktu trial</span>
                  <span className="text-white font-semibold">{subStatus.daysRemaining} hari lagi</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-violet-400 transition-all" style={{ width: Math.max(5, (subStatus.daysRemaining / 7) * 100) + '%' }} />
                </div>
              </div>
              <div className="space-y-1.5 text-xs text-zinc-500">
                <p>Setelah masa trial habis, berlangganan seharga <span className="text-white font-medium">Rp 69.000 per 30 hari</span>.</p>
                <p className="text-zinc-600">Langganan sekarang juga biar nggak kepotong akses!</p>
              </div>
              {error && (
                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2"><XCircle className="h-3.5 w-3.5 shrink-0" />{error}</div>
              )}
              <Button onClick={handlePay} disabled={loading} className="w-full h-10 rounded-xl bg-gradient-to-r from-[#B794F6] to-[#a57ce8] hover:shadow-[0_0_20px_rgba(183,148,246,0.3)] hover:brightness-110 text-white font-semibold text-sm gap-2">
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Memproses...</> : <><CreditCard className="h-4 w-4" />Langganan Sekarang</>}
              </Button>
              <button onClick={onClose} className="w-full text-center text-xs text-zinc-600 hover:text-zinc-400 transition-colors">Nanti saja, lanjutkan trial</button>
            </>
          ) : isExpired ? (
            <>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white">Masa Percobaan Habis</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">Masa trial 7 hari sudah berakhir. Berlangganan untuk melanjutkan akses.</p>
              </div>
              {error && (
                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2"><XCircle className="h-3.5 w-3.5 shrink-0" />{error}</div>
              )}
              <Button onClick={handlePay} disabled={loading} className="w-full h-10 rounded-xl bg-gradient-to-r from-[#B794F6] to-[#a57ce8] hover:shadow-[0_0_20px_rgba(183,148,246,0.3)] hover:brightness-110 text-white font-semibold text-sm gap-2">
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Memproses...</> : <><CreditCard className="h-4 w-4" />Bayar Rp 69.000</>}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
