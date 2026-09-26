import { useAppStore } from '@/lib/store';
import { isAdmin } from '@/lib/admin';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Users, Trophy, Flame, Award, Search, RefreshCw, Shield,
  Loader2, TrendingUp, Activity, AlertTriangle, FileText,
} from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { TIERS } from '@/lib/tiers';
import { cn } from '@/lib/utils';

interface AdminStats {
  totalUsers: number;
  totalModules: number;
  totalXP: number;
  activeToday: number;
  totalCertificates: number;
  topUsers: {
    id: string;
    name: string;
    email: string;
    xp: number;
    level: number;
    streak: number;
    image: string | null;
    currentSeason: number;
    createdAt: string;
  }[];
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  xp: number;
  level: number;
  streak: number;
  image: string | null;
  currentSeason: number;
  lastActiveAt: string | null;
  createdAt: string;
  _count: { dailyProgress: number; certificates: number };
}

function getTierName(xp: number): { name: string; emoji: string } {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (xp >= TIERS[i].xpRequired) return { name: TIERS[i].name, emoji: TIERS[i].emoji };
  }
  return { name: TIERS[0].name, emoji: TIERS[0].emoji };
}

function StatCard({ icon: Icon, label, value, color, sub }: {
  icon: typeof Users;
  label: string;
  value: string | number;
  color: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', color)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{typeof value === 'number' ? value.toLocaleString() : value}</p>
        <p className="text-[11px] text-zinc-500">{label}</p>
      </div>
      {sub && <p className="text-[10px] text-zinc-600">{sub}</p>}
    </div>
  );
}

export function AdminPanel() {
  const { user } = useAppStore();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<'overview' | 'users' | 'stt-failures'>('overview');
  const [failures, setFailures] = useState<any[]>([]);
  const [failuresTotal, setFailuresTotal] = useState(0);
  const [failuresPage, setFailuresPage] = useState(1);
  const [fixInputs, setFixInputs] = useState<Record<string, string>>({});
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [fixedIds, setFixedIds] = useState<Set<string>>(new Set());

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/stats');
      if (res.status === 403) return;
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error('Stats fetch error:', err);
    }
  }, []);

  const fetchUsers = useCallback(async (p: number, s: string) => {
    try {
      const params = new URLSearchParams({ page: String(p), limit: '20' });
      if (s) params.set('search', s);
      const res = await fetch(`/api/admin/users?${params}`);
      if (res.status === 403) return;
      const data = await res.json();
      setUsers(data.users);
      setTotalUsers(data.total);
    } catch (err) {
      console.error('Users fetch error:', err);
    }
  }, []);

  const fetchFailures = useCallback(async (p: number = 1) => {
    try {
      const res = await fetch(`/api/admin/stt-failures?page=${p}&limit=20`);
      if (res.status === 403) return;
      const data = await res.json();
      setFailures(data.failures || []);
      setFailuresTotal(data.total || 0);
      setFailuresPage(p);
    } catch (err) {
      console.error('STT failures fetch error:', err);
    }
  }, []);

  const handleFixMapping = async (failureId: string, unknownWord: string) => {
    const correctWord = fixInputs[`${failureId}-${unknownWord}`];
    if (!correctWord?.trim()) return;
    setFixingId(`${failureId}-${unknownWord}`);
    try {
      const res = await fetch('/api/admin/stt-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wrongWord: unknownWord,
          correctWord: correctWord.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        console.log('Mapping added:', data);
        setFixedIds(prev => new Set([...prev, `${failureId}-${unknownWord}`]));
      } else {
        console.error('Fix failed:', res.status);
      }
    } catch (err) {
      console.error('Fix error:', err);
    } finally {
      setFixingId(null);
    }
  };

  useEffect(() => {
    if (!isAdmin(user?.email)) return;
    setLoading(true);
    Promise.all([fetchStats(), fetchUsers(1, '')]).finally(() => setLoading(false));
  }, [user, fetchStats, fetchUsers]);

  const handleRefresh = async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchUsers(page, search)]);
    setLoading(false);
  };

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
    fetchUsers(1, val);
  };

  if (!isAdmin(user?.email)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Shield className="h-12 w-12 text-zinc-800 mb-4" />
        <p className="text-sm text-zinc-500">Akses ditolak. Halaman ini hanya untuk admin.</p>
      </div>
    );
  }

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-[#8B5CF6]" />
      </div>
    );
  }

  const totalPages = Math.ceil(totalUsers / 20);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-[#8B5CF6]" />
          <h2 className="text-lg font-semibold text-white">Admin Panel</h2>
          <Badge className="bg-[#8B5CF6]/20 text-[#8B5CF6] border-[#8B5CF6]/30 text-[10px]">
            Admin
          </Badge>
        </div>
        <Button
          onClick={handleRefresh}
          size="sm"
          variant="outline"
          className="border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] gap-1.5 h-8 text-xs"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
        <button
          onClick={() => setActiveView('overview')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
            activeView === 'overview'
              ? 'bg-[#8B5CF6]/15 text-[#8B5CF6]'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <TrendingUp className="h-3.5 w-3.5" />
          Overview
        </button>
        <button
          onClick={() => setActiveView('users')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
            activeView === 'users'
              ? 'bg-[#8B5CF6]/15 text-[#8B5CF6]'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <Users className="h-3.5 w-3.5" />
          Users
        </button>
        <button
          onClick={() => { setActiveView('stt-failures'); fetchFailures(1); }}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
            activeView === 'stt-failures'
              ? 'bg-[#8B5CF6]/15 text-[#8B5CF6]'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          STT Failures
        </button>
      </div>

      {activeView === 'overview' && stats && (
        <div className="space-y-4">
          {/* Stats grid */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <StatCard
              icon={Users}
              label="Total Users"
              value={stats.totalUsers}
              color="bg-[#8B5CF6]/10 text-[#8B5CF6]"
            />
            <StatCard
              icon={FileText}
              label="Total Modul"
              value={stats.totalModules || 0}
              color="bg-violet-500/10 text-violet-400"
            />
            <StatCard
              icon={Trophy}
              label="Total XP"
              value={stats.totalXP}
              color="bg-amber-500/10 text-amber-400"
            />
            <StatCard
              icon={Activity}
              label="Active Today"
              value={stats.activeToday}
              color="bg-emerald-500/10 text-emerald-400"
              sub={`${stats.totalUsers > 0 ? Math.round((stats.activeToday / stats.totalUsers) * 100) : 0}% dari total`}
            />
            <StatCard
              icon={Award}
              label="Certificates"
              value={stats.totalCertificates}
              color="bg-sky-500/10 text-sky-400"
            />
            <StatCard
              icon={Flame}
              label="Avg XP/User"
              value={stats.totalUsers > 0 ? Math.round(stats.totalXP / stats.totalUsers) : 0}
              color="bg-pink-500/10 text-pink-400"
            />
          </div>

          {/* Top Users Leaderboard */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06]">
              <h3 className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-400" />
                Top 10 Leaderboard
              </h3>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {(stats.topUsers || []).map((u, idx) => {
                const tier = getTierName(u.xp);
                return (
                  <div key={u.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                    <span className={cn(
                      'w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold',
                      idx === 0 ? 'bg-amber-400/20 text-amber-400' :
                      idx === 1 ? 'bg-zinc-400/20 text-zinc-300' :
                      idx === 2 ? 'bg-orange-400/20 text-orange-400' :
                      'bg-white/[0.04] text-zinc-600'
                    )}>
                      {idx + 1}
                    </span>
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#8B5CF6]/10 text-xs font-bold text-[#8B5CF6] shrink-0">
                      {u.name?.[0] || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-zinc-200 truncate">{u.name}</span>
                        <span className="text-xs">{tier.emoji}</span>
                        {isAdmin(u.email) && (
                          <Badge className="bg-[#8B5CF6]/20 text-[#8B5CF6] border-[#8B5CF6]/30 text-[8px] px-1 py-0">Admin</Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-600 truncate">{u.email}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-white">{u.xp.toLocaleString()} XP</p>
                      <p className="text-[10px] text-zinc-600">{tier.name} &middot; Streak {u.streak}</p>
                    </div>
                  </div>
                );
              })}
              {(stats.topUsers || []).length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-zinc-600">
                  Belum ada data user
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeView === 'users' && (
        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" />
            <Input
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Cari nama atau email..."
              className="pl-9 h-9 border-white/[0.08] bg-[#0c0c0e] text-zinc-200 placeholder:text-zinc-600 text-sm"
            />
          </div>

          {/* User count */}
          <p className="text-[11px] text-zinc-600">{totalUsers} user ditemukan</p>

          {/* Users table */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
            {/* Desktop header */}
            <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-white/[0.06] text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
              <div className="col-span-4">User</div>
              <div className="col-span-2 text-center">XP / Level</div>
              <div className="col-span-2 text-center">Streak</div>
              <div className="col-span-2 text-center">Modul</div>
              <div className="col-span-2 text-center">Joined</div>
            </div>

            <div className="divide-y divide-white/[0.04]">
              {(users || []).map((u) => {
                const tier = getTierName(u.xp);
                return (
                  <div key={u.id} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
                    {/* Desktop row */}
                    <div className="hidden md:grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-4 flex items-center gap-2.5 min-w-0">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#8B5CF6]/10 text-xs font-bold text-[#8B5CF6] shrink-0">
                          {u.name?.[0] || '?'}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm text-zinc-200 truncate">{u.name}</span>
                            <span className="text-xs">{tier.emoji}</span>
                            {isAdmin(u.email) && (
                              <Badge className="bg-[#8B5CF6]/20 text-[#8B5CF6] border-[#8B5CF6]/30 text-[8px] px-1 py-0">Admin</Badge>
                            )}
                          </div>
                          <p className="text-[10px] text-zinc-600 truncate">{u.email}</p>
                        </div>
                      </div>
                      <div className="col-span-2 text-center">
                        <p className="text-sm font-semibold text-white">{u.xp.toLocaleString()}</p>
                        <p className="text-[10px] text-zinc-600">{tier.name}</p>
                      </div>
                      <div className="col-span-2 text-center">
                        <span className="text-sm text-amber-400 font-medium">{u.streak}</span>
                        <span className="text-[10px] text-zinc-600 ml-1">hari</span>
                      </div>
                      <div className="col-span-2 text-center">
                        <span className="text-sm text-zinc-300">{u._count.dailyProgress}</span>
                        <span className="text-[10px] text-zinc-600 ml-1">modul</span>
                      </div>
                      <div className="col-span-2 text-center">
                        <p className="text-[10px] text-zinc-500">
                          {new Date(u.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                    </div>

                    {/* Mobile row */}
                    <div className="md:hidden flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#8B5CF6]/10 text-sm font-bold text-[#8B5CF6] shrink-0">
                        {u.name?.[0] || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-zinc-200 truncate">{u.name}</span>
                          <span className="text-xs">{tier.emoji}</span>
                          {isAdmin(u.email) && (
                            <Badge className="bg-[#8B5CF6]/20 text-[#8B5CF6] border-[#8B5CF6]/30 text-[8px] px-1 py-0">Admin</Badge>
                          )}
                        </div>
                        <p className="text-[10px] text-zinc-600 truncate">{u.email}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px]">
                          <span className="text-white font-medium">{u.xp.toLocaleString()} XP</span>
                          <span className="text-amber-400">{u.streak} streak</span>
                          <span className="text-zinc-500">{u._count.dailyProgress || 0} modul</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {(users || []).length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-zinc-600">
                  {search ? 'Tidak ada user yang cocok' : 'Belum ada user'}
                </div>
              )}
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                onClick={() => { setPage(page - 1); fetchUsers(page - 1, search); }}
                disabled={page <= 1}
                size="sm"
                variant="outline"
                className="border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] h-8 text-xs"
              >
                Prev
              </Button>
              <span className="text-xs text-zinc-500">
                {page} / {totalPages}
              </span>
              <Button
                onClick={() => { setPage(page + 1); fetchUsers(page + 1, search); }}
                disabled={page >= totalPages}
                size="sm"
                variant="outline"
                className="border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] h-8 text-xs"
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {activeView === 'stt-failures' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-zinc-200">STT Recognition Failures</h3>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                {failuresTotal > 0 ? `${failuresTotal} total failures logged` : 'No failures logged yet'}
              </p>
            </div>
            <Button
              onClick={() => fetchFailures(failuresPage)}
              variant="outline"
              size="sm"
              className="border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] h-8 text-xs"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Refresh
            </Button>
          </div>

          {failures.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-white/[0.06] bg-white/[0.02]">
              <AlertTriangle className="h-8 w-8 text-zinc-700 mx-auto mb-2" />
              <p className="text-sm text-zinc-500">No STT failures logged</p>
              <p className="text-[10px] text-zinc-600 mt-1">
                Failures appear here when the fuzzy-correct endpoint encounters unknown words
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {failures.map((f: any) => (
                  <div key={f.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[9px] px-1.5 py-0',
                            f.source === 'webspeech' ? 'border-green-500/30 text-green-400 bg-green-500/10'
                              : f.source === 'ocr' ? 'border-violet-500/30 text-violet-400 bg-violet-500/10'
                              : 'border-zinc-500/30 text-zinc-400 bg-zinc-500/10'
                          )}
                        >
                          {f.source || 'unknown'}
                        </Badge>
                        <span className="text-[10px] text-zinc-600">
                          {new Date(f.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                        {f.unknownCount > 0 && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/30 text-amber-400 bg-amber-500/10">
                            {f.unknownCount} unknown
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div>
                        <p className="text-[10px] text-zinc-600 mb-0.5">Raw text (from Web Speech/OCR):</p>
                        <p className="text-xs text-rose-300 font-mono bg-rose-500/5 rounded px-2 py-1">{f.rawText}</p>
                      </div>
                      {f.correctedText && f.correctedText !== f.rawText && (
                        <div>
                          <p className="text-[10px] text-zinc-600 mb-0.5">Corrected (after fuzzy):</p>
                          <p className="text-xs text-emerald-300 font-mono bg-emerald-500/5 rounded px-2 py-1">{f.correctedText}</p>
                        </div>
                      )}
                      {f.unknownWords && f.unknownWords.length > 0 && (
                        <div>
                          <p className="text-[10px] text-zinc-600 mb-0.5">Unknown words — type correction + click Fix:</p>
                          <div className="space-y-1.5">
                            {f.unknownWords.map((w: string, i: number) => {
                              const fixKey = `${f.id}-${w}`;
                              const isFixed = fixedIds.has(fixKey);
                              const isFixing = fixingId === fixKey;
                              return (
                                <div key={i} className="flex items-center gap-2">
                                  <span className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 font-mono shrink-0">
                                    {w}
                                  </span>
                                  <span className="text-zinc-600 text-[10px] shrink-0">→</span>
                                  {isFixed ? (
                                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5 font-mono">
                                      {fixInputs[fixKey] || '✓'} ✓ Fixed (live)
                                    </span>
                                  ) : (
                                    <>
                                      <input
                                        type="text"
                                        placeholder="e.g. GOTO, BBCA, sistem..."
                                        value={fixInputs[fixKey] || ''}
                                        onChange={(e) => setFixInputs(prev => ({ ...prev, [fixKey]: e.target.value }))}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') handleFixMapping(f.id, w);
                                        }}
                                        className="flex-1 h-6 text-[11px] bg-[#0c0c0e] border border-white/[0.08] rounded px-2 text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-[#8B5CF6]/40"
                                      />
                                      <button
                                        onClick={() => handleFixMapping(f.id, w)}
                                        disabled={isFixing || !fixInputs[fixKey]?.trim()}
                                        className="text-[10px] px-2 py-0.5 rounded bg-[#8B5CF6] hover:bg-[#7c3aed] text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                                      >
                                        {isFixing ? '...' : 'Fix'}
                                      </button>
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {failuresTotal > 20 && (
                <div className="flex items-center justify-center gap-2">
                  <Button
                    onClick={() => fetchFailures(failuresPage - 1)}
                    disabled={failuresPage <= 1}
                    size="sm"
                    variant="outline"
                    className="border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] h-8 text-xs"
                  >
                    Prev
                  </Button>
                  <span className="text-xs text-zinc-500">
                    {failuresPage} / {Math.ceil(failuresTotal / 20)}
                  </span>
                  <Button
                    onClick={() => fetchFailures(failuresPage + 1)}
                    disabled={failuresPage >= Math.ceil(failuresTotal / 20)}
                    size="sm"
                    variant="outline"
                    className="border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] h-8 text-xs"
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
