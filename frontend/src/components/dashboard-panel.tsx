import { useAppStore } from '@/lib/store';
import { getTierForXP, getXPProgress, getXPToNextTier, TIERS } from '@/lib/tiers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Zap, Flame, Target, Calendar, Trophy, Award, TrendingUp, BookOpen, ArrowRight, Crown } from 'lucide-react';
import { useEffect, useState } from 'react';

interface MonthlyRecap {
  id: string; yearMonth: string; totalXP: number; totalDays: number; avgScore: number; bestScore: number; topicsCovered: string; level: number;
}

interface CertificateData {
  id: string; season: number; year: string; totalXP: number; totalDays: number; maxLevel: number; maxStreak: number; awardedAt: string; expiresAt: string; shareCode: string; daysUntilExpiry: number;
}

export function DashboardPanel() {
  const { user, userStats, setUserStats, setShowCertificate, setActiveTab } = useAppStore();
  const [recaps, setRecaps] = useState<MonthlyRecap[]>([]);
  const [certificate, setCertificate] = useState<CertificateData | null>(null);

  useEffect(() => {
    if (!user) return;
    fetch(`/api/progress/stats?userId=${user.id}`).then(r => r.json()).then(setUserStats);
    fetch(`/api/progress/recap?userId=${user.id}`).then(r => r.json()).then(d => setRecaps(d.recaps || []));
    fetch(`/api/progress/certificate?userId=${user.id}`).then(r => r.json()).then(d => { if (!d.error) setCertificate(d); });
  }, [user, setUserStats]);

  const stats = userStats;
  const tier = getTierForXP(stats?.xp || 0);
  const nextTier = TIERS.find(t => t.level === tier.level + 1);
  const xpProgress = getXPProgress(stats?.xp || 0, tier);
  const xpToNext = getXPToNextTier(stats?.xp || 0, tier);

  return (
    <div className="space-y-4">
      {certificate && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10"><Award className="h-5 w-5 text-amber-400" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-300">Sertifikat Season {certificate.season} Tersedia!</p>
            <p className="text-xs text-amber-400/70">{certificate.daysUntilExpiry} hari lagi sebelum dihapus. Flex di sosmed sekarang!</p>
          </div>
          <Button size="sm" className="gap-1 bg-[#8B5CF6] hover:bg-[#d14e1c] text-white rounded-lg text-xs" onClick={() => setShowCertificate(true)}><Trophy className="h-3.5 w-3.5" /> Lihat</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Zap} label="Total XP" value={(stats?.xp || 0).toLocaleString()} color="text-[#8B5CF6]" bg="bg-[#8B5CF6]/10 border-[#8B5CF6]/10" />
        <StatCard icon={Target} label="Tier" value={`${tier.emoji} ${tier.name}`} color="text-violet-400" bg="bg-violet-500/10 border-violet-500/10" />
        <StatCard icon={Flame} label="Streak" value={`${stats?.streak || 0} hari`} color="text-[#8B5CF6]" bg="bg-[#8B5CF6]/10 border-[#8B5CF6]/10" />
        <StatCard icon={Calendar} label="Bulan Ini" value={`${stats?.monthlyDays || 0} hari`} color="text-sky-400" bg="bg-sky-500/10 border-sky-500/10" />
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.06]"><h3 className="text-sm font-medium text-zinc-200">Tier Progress</h3></div>
        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5"><span className="text-xl">{tier.emoji}</span><div><p className="text-sm font-medium text-zinc-200">{tier.name}</p><p className="text-[10px] text-zinc-500">{tier.exclusivity}</p></div></div>
            {nextTier && <div className="text-right"><p className="text-sm font-medium text-zinc-200">{nextTier.emoji} {nextTier.name}</p><p className="text-[10px] text-[#8B5CF6]">{xpToNext.toLocaleString()} XP lagi</p></div>}
          </div>
          <Progress value={xpProgress} className="h-1.5" />
          <p className="text-[10px] text-zinc-600">{(stats?.xp || 0).toLocaleString()} / {(tier.xpRequired + tier.xpToNext).toLocaleString()} XP</p>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.06]"><h3 className="text-sm font-medium text-zinc-200">Season {stats?.currentSeason || 1} Progress</h3></div>
        <div className="p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat icon={BookOpen} label="Topik" value={`${recaps.reduce((s, r) => s + (JSON.parse(r.topicsCovered || '[]') as string[]).length, 0)}`} />
            <MiniStat icon={TrendingUp} label="Avg Score" value={`${recaps.length ? Math.round(recaps.reduce((s, r) => s + r.avgScore, 0) / recaps.length) : 0}%`} />
            <MiniStat icon={Trophy} label="Best Score" value={`${recaps.length ? Math.max(...recaps.map(r => r.bestScore)) : 0}%`} />
            <MiniStat icon={Crown} label="Season" value={`${recaps.length} bulan`} />
          </div>
          <p className="mt-3 text-[11px] text-zinc-600">Belajar 12 bulan penuh untuk raih sertifikat yang bisa di-flex di sosmed!</p>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.06]"><h3 className="text-sm font-medium text-zinc-200">Riwayat Bulanan</h3></div>
        <div className="p-5">
          {recaps.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <Calendar className="mb-2 h-8 w-8 text-zinc-800" />
              <p className="text-sm text-zinc-500">Belum ada rekap bulanan</p>
              <Button variant="ghost" size="sm" className="mt-3 gap-1 text-[#8B5CF6] hover:text-[#8B5CF6]" onClick={() => setActiveTab('stt')}>Mulai Belajar <ArrowRight className="h-3 w-3" /></Button>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {recaps.map((r) => {
                const topics = JSON.parse(r.topicsCovered || '[]') as string[];
                return (<div key={r.id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] p-3 hover:bg-white/[0.02] transition-colors">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#8B5CF6]/10"><Calendar className="h-5 w-5 text-[#8B5CF6]" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-300">{formatMonth(r.yearMonth)}</p>
                    <div className="flex flex-wrap gap-1 mt-1">{topics.slice(0, 3).map(t => <Badge key={t} variant="outline" className="text-[10px] px-1.5 border-white/[0.08] text-zinc-500">{t}</Badge>)}{topics.length > 3 && <Badge variant="outline" className="text-[10px] px-1.5 border-white/[0.08] text-zinc-500">+{topics.length - 3}</Badge>}</div>
                  </div>
                  <div className="text-right shrink-0"><p className="text-sm font-bold text-[#8B5CF6]">+{r.totalXP} XP</p><p className="text-[10px] text-zinc-500">{r.totalDays} hari</p></div>
                </div>);
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, bg }: { icon: React.ElementType; label: string; value: string; color: string; bg: string }) {
  return (<div className={`rounded-xl border p-3 ${bg}`}><Icon className={`h-4 w-4 ${color}`} /><p className="mt-1.5 text-lg font-bold leading-tight text-zinc-100">{value}</p><p className="text-[10px] text-zinc-500">{label}</p></div>);
}

function MiniStat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (<div className="rounded-lg border border-white/[0.06] p-2.5 text-center"><Icon className="mx-auto h-4 w-4 text-zinc-600" /><p className="mt-1 text-sm font-bold text-zinc-200">{value}</p><p className="text-[10px] text-zinc-500">{label}</p></div>);
}

function formatMonth(ym: string) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  const [y, m] = ym.split('-');
  return `${months[parseInt(m) - 1]} ${y}`;
}
