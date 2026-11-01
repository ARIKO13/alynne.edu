/**
 * ReferralPanel.tsx  -  Referral system UI
 *
 * User gets unique referral code, shares link with friends.
 * When friend signs up via link, both get 1 month free premium.
 *
 * Tracks: referral count, rewards earned.
 */

import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Gift, Copy, Check, Share2, Users, X, Sparkles } from 'lucide-react';
import { getReferralLink, getReferralCode, loadMemory } from '@/lib/ai-memory';
import { toast } from 'sonner';

interface ReferralPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ReferralPanel({ open, onClose }: ReferralPanelProps) {
  const [copied, setCopied] = useState(false);
  const memory = useMemo(() => loadMemory(), [open]);
  const referralLink = useMemo(() => getReferralLink(), []);
  const referralCode = useMemo(() => getReferralCode(), []);

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast.success('Link referral disalin!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Gagal copy. Copy manual: ' + referralLink);
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'ALYNNE.EDU - AI Education Platform',
          text: `Yuk belajar bareng di ALYNNE.EDU! Pakai kode referral aku ${referralCode} untuk dapat 1 bulan gratis premium. 🔥`,
          url: referralLink,
        });
      } catch {
        // User cancelled share
      }
    } else {
      handleCopy();
    }
  };

  const handleShareWA = () => {
    const text = encodeURIComponent(
      `Yuk belajar bareng di ALYNNE.EDU! 🎓\n\nPakai kode referral aku *${referralCode}* untuk dapat 1 bulan gratis premium.\n\nDaftar di: ${referralLink}\n\nFitur:\n- Speech to Text (Mode Offline + Online)\n- Mode Belajar + Focus Detector\n- Modul PDF + Mind Map\n- AI Assistant\n\n🔥 Ayo mulai belajar!`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <Gift className="h-5 w-5 text-[#7C3AED]" />
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Ajak Teman, Dapat Gratis!</h2>
            <p className="text-[11px] text-zinc-500">Setiap teman yang daftar pakai link kamu, kalian berdua dapat 1 bulan premium gratis.</p>
          </div>
        </div>
        <Button onClick={onClose} variant="ghost" size="sm" className="text-zinc-400 hover:text-white hover:bg-white/[0.04]">
          <X className="h-4 w-4" />
          <span className="ml-1 hidden sm:inline">Tutup</span>
        </Button>
      </div>

      <div className="p-5 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-center">
            <Users className="h-4 w-4 mx-auto mb-1 text-blue-400" />
            <p className="text-lg font-semibold text-white">{memory.referralCount}</p>
            <p className="text-[10px] text-zinc-500 uppercase">Teman</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-center">
            <Gift className="h-4 w-4 mx-auto mb-1 text-[#7C3AED]" />
            <p className="text-lg font-semibold text-white">{memory.referralRewards}</p>
            <p className="text-[10px] text-zinc-500 uppercase">Bulan Gratis</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-center">
            <Sparkles className="h-4 w-4 mx-auto mb-1 text-amber-400" />
            <p className="text-lg font-semibold text-white">{referralCode}</p>
            <p className="text-[10px] text-zinc-500 uppercase">Kode Kamu</p>
          </div>
        </div>

        {/* Referral link */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-500">Link Referral Kamu</label>
          <div className="flex gap-2">
            <input
              readOnly
              value={referralLink}
              className="flex-1 px-3 py-2 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs text-zinc-300 font-mono"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <Button onClick={handleCopy} size="sm" className="bg-[#7C3AED] hover:bg-[#7C3AED]">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Share buttons */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={handleShare}
            variant="outline"
            className="border-white/[0.08] text-zinc-300"
          >
            <Share2 className="h-4 w-4 mr-2" />
            Bagikan
          </Button>
          <Button
            onClick={handleShareWA}
            className="bg-green-600 hover:bg-green-700"
          >
            <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Bagikan ke WA
          </Button>
        </div>

        {/* How it works */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
          <p className="text-xs font-medium text-zinc-300">Cara Kerja:</p>
          <div className="space-y-1.5 text-[11px] text-zinc-500">
            <div className="flex gap-2">
              <span className="text-[#7C3AED] font-bold">1.</span>
              <span>Bagikan link atau kode referral ke teman</span>
            </div>
            <div className="flex gap-2">
              <span className="text-[#7C3AED] font-bold">2.</span>
              <span>Teman daftar pakai link kamu</span>
            </div>
            <div className="flex gap-2">
              <span className="text-[#7C3AED] font-bold">3.</span>
              <span>Kalian berdua dapat 1 bulan premium gratis</span>
            </div>
            <div className="flex gap-2">
              <span className="text-[#7C3AED] font-bold">4.</span>
              <span>Ajak lebih banyak teman, dapet lebih banyak bonus!</span>
            </div>
          </div>
        </div>

        {memory.referralCount > 0 && (
          <Badge variant="outline" className="border-green-500/30 text-green-400 bg-green-500/10 text-[10px]">
            <Check className="h-3 w-3 mr-1" />
            {memory.referralCount} teman sudah bergabung!
          </Badge>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose} className="text-zinc-400">
            <X className="h-4 w-4 mr-2" />
            Tutup
          </Button>
        </div>
      </div>
    </div>
  );
}
