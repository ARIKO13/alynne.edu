import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Loader2,
  ShieldCheck,
  Sparkles,
  Lock,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  BILLING_TIERS,
  BILLING_PAYMENT_METHODS,
  TAX_RATE,
  formatIDR,
  type BillingTier,
  type BillingPaymentMethod,
} from '@/lib/billing-models';

type Step = 1 | 2 | 3;

/**
 * Tailwind accent classes per tier — kept in the component (not the data
 * file) so the data stays framework-agnostic.
 */
const ACCENT: Record<
  BillingTier['accent'],
  { ring: string; bg: string; text: string; badge: string; check: string }
> = {
  emerald: {
    ring: 'ring-emerald-500',
    bg: 'bg-emerald-500/[0.06]',
    text: 'text-emerald-300',
    badge: 'bg-emerald-500',
    check: 'text-emerald-400',
  },
  violet: {
    ring: 'ring-[#8B5CF6]',
    bg: 'bg-[#8B5CF6]/[0.08]',
    text: 'text-[#8B5CF6]',
    badge: 'bg-[#8B5CF6]',
    check: 'text-[#8B5CF6]',
  },
  amber: {
    ring: 'ring-amber-500',
    bg: 'bg-amber-500/[0.06]',
    text: 'text-amber-300',
    badge: 'bg-amber-500',
    check: 'text-amber-400',
  },
  rose: {
    ring: 'ring-rose-500',
    bg: 'bg-rose-500/[0.06]',
    text: 'text-rose-300',
    badge: 'bg-rose-500',
    check: 'text-rose-400',
  },
};

interface CheckoutResponse {
  snapToken: string;
  redirectUrl: string;
  orderId: string;
  tier: { id: string; name: string; price: number; durationDays: number };
  paymentMethod: { id: string; label: string };
}

export function BillingFlow() {
  const [step, setStep] = useState<Step>(1);
  const [tier, setTier] = useState<BillingTier | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<BillingPaymentMethod | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtotal = tier?.price ?? 0;
  const tax = useMemo(() => Math.round(subtotal * TAX_RATE), [subtotal]);
  const total = subtotal + tax;

  const canAdvance = (s: Step): boolean => {
    if (s === 1) return tier !== null;
    if (s === 2) return paymentMethod !== null;
    return true;
  };

  const handleNext = () => {
    setError(null);
    if (!canAdvance(step)) return;
    if (step < 3) setStep((step + 1) as Step);
  };

  const handleBack = () => {
    setError(null);
    if (step > 1) setStep((step - 1) as Step);
  };

  const handleCheckout = async () => {
    if (!tier || !paymentMethod) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/payment/create-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          tierId: tier.id,
          paymentMethodId: paymentMethod.id,
        }),
      });
      const data: CheckoutResponse & { error?: string } = await res.json().catch(() => ({ error: 'Invalid JSON' }));
      if (!res.ok) {
        if (res.status === 401) {
          // Session expired → redirect to Google OAuth login, then back to /billing
          const current = encodeURIComponent(window.location.href);
          window.location.href = `/api/auth/google?redirect=${current}`;
          return;
        }
        throw new Error(data.error || `Error ${res.status}`);
      }
      // Redirect to Midtrans Snap (VT-Web)
      window.location.href = data.redirectUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal membuat transaksi';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Stepper header */}
      <StepperHeader currentStep={step} />

      <AnimatePresence mode="wait" initial={false}>
        {/* STEP 1 — TIER SELECTION */}
        {step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
            className="grid gap-3 sm:grid-cols-2"
          >
            {BILLING_TIERS.map((t) => {
              const isSelected = tier?.id === t.id;
              const accent = ACCENT[t.accent];
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTier(t)}
                  className={`relative text-left rounded-xl border-2 p-4 transition-all ${
                    isSelected
                      ? `${accent.bg} ${accent.ring} ring-2 border-transparent`
                      : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.05]'
                  }`}
                >
                  {t.popular && (
                    <span
                      className={`absolute -top-2 right-3 inline-flex items-center gap-1 rounded-full ${accent.badge} px-2 py-0.5 text-[10px] font-semibold text-white`}
                    >
                      <Sparkles className="h-2.5 w-2.5" />
                      Populer
                    </span>
                  )}
                  <div className="mb-2 flex items-center justify-between">
                    <h3
                      className={`text-base font-bold ${isSelected ? accent.text : 'text-white'}`}
                    >
                      {t.name}
                    </h3>
                    {isSelected && <CheckCircle2 className={`h-5 w-5 ${accent.check}`} />}
                  </div>
                  <p className="mb-3 text-xs text-zinc-500">{t.tagline}</p>
                  <div className="mb-3 flex items-baseline gap-1">
                    <span className="text-xl font-bold text-white">{formatIDR(t.price)}</span>
                    <span className="text-xs text-zinc-500">/{t.durationDays} hari</span>
                  </div>
                  <ul className="space-y-1.5">
                    {t.features.map((f) => (
                      <li
                        key={f}
                        className="flex items-start gap-1.5 text-xs text-zinc-400"
                      >
                        <CheckCircle2 className={`mt-0.5 h-3 w-3 flex-shrink-0 ${accent.check}`} />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </motion.div>
        )}

        {/* STEP 2 — PAYMENT METHOD */}
        {step === 2 && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col gap-4"
          >
            {/* Selected tier summary */}
            <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Pesanan</p>
                <p className="font-bold text-white">{tier?.name}</p>
                <p className="text-xs text-zinc-500">{tier?.tagline}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                  {tier?.durationDays} hari
                </p>
                <p className="text-lg font-bold text-white">{formatIDR(tier?.price ?? 0)}</p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {BILLING_PAYMENT_METHODS.map((p) => {
                const isSelected = paymentMethod?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPaymentMethod(p)}
                    className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all ${
                      isSelected
                        ? 'border-[#8B5CF6] bg-[#8B5CF6]/[0.08]'
                        : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-white/[0.04] text-[10px] font-bold text-zinc-400">
                      {p.badge}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-zinc-200">{p.label}</p>
                      </div>
                      <p className="truncate text-xs text-zinc-500">{p.description}</p>
                    </div>
                    {isSelected && (
                      <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-[#8B5CF6]" />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* STEP 3 — CHECKOUT SUMMARY */}
        {step === 3 && (
          <motion.div
            key="step3"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col gap-4"
          >
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
              <h3 className="mb-4 text-base font-semibold text-white">Ringkasan Pembayaran</h3>
              <p className="mb-3 text-xs text-zinc-500">
                Periksa pesananmu sebelum melanjutkan ke pembayaran.
              </p>
              <div className="space-y-2.5 text-sm">
                <SummaryRow label="Model" value={tier?.name ?? '-'} />
                <SummaryRow
                  label="Periode"
                  value={`${tier?.durationDays ?? 0} hari`}
                />
                <SummaryRow
                  label="Metode Pembayaran"
                  value={paymentMethod?.label ?? '-'}
                />
                <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
                  <SummaryRow label="Harga langganan" value={formatIDR(subtotal)} />
                  <SummaryRow
                    label="Pajak (PPN 11%)"
                    value={formatIDR(tax)}
                  />
                  <div className="mt-2 flex items-baseline justify-between border-t border-white/[0.06] pt-2">
                    <span className="font-semibold text-zinc-200">Total Tagihan</span>
                    <span className="text-xl font-bold text-white">{formatIDR(total)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.03] px-3 py-2.5 text-xs text-zinc-400">
              <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
              <p>
                Pembayaran diamankan oleh Midtrans dengan enkripsi end-to-end.
                Detail kartu kredit tidak pernah disimpan di server ALYNNE.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.05] px-3 py-2.5 text-xs text-rose-300">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <button
              type="button"
              onClick={handleCheckout}
              disabled={submitting}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#7c3aed] text-sm font-semibold text-white shadow-lg transition-all hover:shadow-[0_0_20px_rgba(139,92,246,0.3)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Memproses…
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  Bayar {formatIDR(total)} Sekarang
                </>
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer nav */}
      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={handleBack}
          disabled={step === 1 || submitting}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
          Kembali
        </button>
        {step < 3 && (
          <button
            type="button"
            onClick={handleNext}
            disabled={!canAdvance(step)}
            className="inline-flex items-center gap-1 rounded-lg bg-[#8B5CF6] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#7c3aed] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Lanjut
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function StepperHeader({ currentStep }: { currentStep: Step }) {
  const steps: { n: Step; label: string }[] = [
    { n: 1, label: 'Pilih Model' },
    { n: 2, label: 'Metode Bayar' },
    { n: 3, label: 'Checkout' },
  ];
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s.n} className="flex flex-1 items-center gap-2">
          <div className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold transition ${
                currentStep === s.n
                  ? 'bg-[#8B5CF6] text-white'
                  : currentStep > s.n
                  ? 'bg-emerald-500 text-white'
                  : 'bg-white/[0.06] text-zinc-500'
              }`}
            >
              {currentStep > s.n ? <CheckCircle2 className="h-4 w-4" /> : s.n}
            </div>
            <span
              className={`whitespace-nowrap text-xs font-medium sm:text-sm ${
                currentStep === s.n
                  ? 'text-white'
                  : currentStep > s.n
                  ? 'text-emerald-400'
                  : 'text-zinc-500'
              }`}
            >
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={`h-0.5 flex-1 rounded ${
                currentStep > s.n ? 'bg-emerald-500' : 'bg-white/[0.06]'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium text-zinc-200">{value}</span>
    </div>
  );
}
