import { useAppStore } from '@/lib/store';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Award, Share2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface CertData {
  season: number;
  year: string;
  totalXP: number;
  totalDays: number;
  maxLevel: number;
  maxStreak: number;
  awardedAt: string;
  expiresAt: string;
  shareCode: string;
  daysUntilExpiry: number;
  userName?: string;
}

export function CertificateView() {
  const { showCertificate, setShowCertificate, user } = useAppStore();
  const [cert, setCert] = useState<CertData | null>(null);

  useEffect(() => {
    if (showCertificate && user) {
      fetch(`/api/progress/certificate?userId=${user.id}`)
        .then(r => r.json())
        .then(d => { if (!d.error) setCert(d); });
    }
  }, [showCertificate, user]);

  const handleShare = async () => {
    if (!cert) return;
    const text = `Saya baru saja menyelesaikan Season ${cert.season} di LINA.LEARNING!\n\nLevel ${cert.maxLevel} | ${cert.totalXP} XP | ${cert.totalDays} hari belajar\nMax Streak: ${cert.maxStreak} hari\n\n#BelajarSambilMain #LINALEARING`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Sertifikat LINA.LEARNING', text }); } catch {}
    } else {
      await navigator.clipboard.writeText(text);
      alert('Teks sertifikat disalin ke clipboard!');
    }
  };

  return (
    <Dialog open={showCertificate} onOpenChange={setShowCertificate}>
      <DialogContent className="max-w-lg p-0 overflow-hidden border-white/[0.06] bg-[#18181b]">
        {cert && user && (
          <div className="relative">
            {/* Certificate Design - Dark theme */}
            <div className="relative bg-gradient-to-br from-[#0c0c0e] via-[#18181b] to-[#0c0c0e] p-8 text-center">
              <div className="absolute inset-2 rounded-xl border border-[#8B5CF6]/20" />

              <div className="relative space-y-4">
                <div className="flex justify-center">
                  <Award className="h-12 w-12 text-[#8B5CF6]" />
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest text-[#8B5CF6]/70">Sertifikat Kompetensi</p>
                  <h2 className="mt-1 text-xl font-bold text-zinc-100">LINA.LEARNING</h2>
                  <p className="text-xs text-zinc-500">Season {cert.season} - {cert.year}</p>
                </div>

                <div className="py-2">
                  <p className="text-xs text-zinc-500">Diberikan kepada</p>
                  <p className="text-2xl font-bold mt-1 bg-gradient-to-r from-[#8B5CF6] to-amber-400 bg-clip-text text-transparent">
                    {cert.userName || String(user.name || 'Player')}
                  </p>
                </div>

                <p className="text-sm text-zinc-400">
                  Telah menyelesaikan {cert.totalDays} hari pembelajaran aktif<br />
                  dengan pencapaian {cert.totalXP} Total XP, mencapai Level {cert.maxLevel}<br />
                  dan streak terpanjang {cert.maxStreak} hari berturut-turut.
                </p>

                <div className="flex justify-center gap-6 pt-2">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-[#8B5CF6]">{cert.totalXP}</p>
                    <p className="text-[10px] text-zinc-500">Total XP</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-violet-400">Lv.{cert.maxLevel}</p>
                    <p className="text-[10px] text-zinc-500">Max Level</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-amber-400">{cert.maxStreak}</p>
                    <p className="text-[10px] text-zinc-500">Max Streak</p>
                  </div>
                </div>

                <div className="pt-2 border-t border-white/[0.06]">
                  <p className="text-[10px] text-zinc-500">
                    Sertifikat ini berlaku hingga {new Date(cert.expiresAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                  <p className="text-[10px] text-amber-400/70 font-medium">
                    {cert.daysUntilExpiry} hari tersisa sebelum dihapus
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 p-4 border-t border-white/[0.06]">
              <Button onClick={handleShare} className="flex-1 gap-2 bg-[#8B5CF6] hover:bg-[#d14e1c] rounded-lg">
                <Share2 className="h-4 w-4" /> Share ke Sosmed
              </Button>
              <Button variant="outline" onClick={() => setShowCertificate(false)} className="border-white/[0.08] text-zinc-400 hover:bg-white/[0.06]">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
