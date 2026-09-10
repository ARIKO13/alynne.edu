import { useAppStore } from '@/lib/store';
import { isAdmin } from '@/lib/admin';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Users, Trophy, Flame, Award, Search, RefreshCw, Shield,
  Loader2, TrendingUp, Activity,
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
  const [activeView, setActiveView] = useState<'overview' | 'users'>('overview');

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
    </div>
  );
}
