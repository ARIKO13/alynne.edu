import { useAppStore } from '@/lib/store';
import { isAdmin } from '@/lib/admin';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Users, Trophy, Flame, Award, Search, RefreshCw, Shield,
  Loader2, TrendingUp, Activity, FileText, Database, Cpu, Zap,
} from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { DatasetLibraryPanel } from '@/components/dataset-library-panel';
import { D1MonitoringView } from '@/components/d1-monitoring-view';

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
    image: string | null;
    createdAt: string;
  }[];
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  lastActiveAt: string | null;
  createdAt: string;
}

function StatCard({ icon: Icon, label, value, color, sub }: {
  icon: typeof Users;
  label: string;
  value: string | number;
  color: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-4 space-y-2">
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
  const [activeView, setActiveView] = useState<'overview' | 'users' | 'dataset' | 'd1' | 'llm'>('overview');
  // NOTE: STT Failures UI removed (privacy: storing raw user transcripts is
  // not appropriate). API endpoints remain at /api/admin/stt-failures for
  // debugging only.

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
        <Loader2 className="h-6 w-6 animate-spin text-[#7C3AED]" />
      </div>
    );
  }

  const totalPages = Math.ceil(totalUsers / 20);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-[#7C3AED]" />
          <h2 className="text-lg font-semibold text-white">Admin Panel</h2>
          <Badge className="bg-[#7C3AED]/20 text-[#7C3AED] border-[#7C3AED]/30 text-[10px]">
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
            'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            activeView === 'overview'
              ? 'bg-[#7C3AED]/15 text-[#7C3AED]'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <TrendingUp className="h-3.5 w-3.5" />
          Overview
        </button>
        <button
          onClick={() => setActiveView('users')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            activeView === 'users'
              ? 'bg-[#7C3AED]/15 text-[#7C3AED]'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <Users className="h-3.5 w-3.5" />
          Users
        </button>
        <button
          onClick={() => setActiveView('dataset')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            activeView === 'dataset'
              ? 'bg-[#7C3AED]/15 text-[#7C3AED]'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <Database className="h-3.5 w-3.5" />
          Dataset
        </button>
        <button
          onClick={() => setActiveView('d1')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            activeView === 'd1'
              ? 'bg-sky-500/15 text-sky-400'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <Database className="h-3.5 w-3.5" />
          D1 Monitor
        </button>
        <button
          onClick={() => setActiveView('llm')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            activeView === 'llm'
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <Cpu className="h-3.5 w-3.5" />
          LLM Health
        </button>
        {/* STT Failures tab removed - privacy concern: storing raw user speech
            transcripts in D1 is not appropriate. API endpoints remain for
            debugging but the admin UI no longer exposes them. */}
      </div>

      {activeView === 'overview' && stats && (
        <div className="space-y-4">
          {/* Stats grid */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <StatCard
              icon={Users}
              label="Total Users"
              value={stats.totalUsers}
              color="bg-[#7C3AED]/10 text-[#7C3AED]"
            />
            <StatCard
              icon={FileText}
              label="Total Modul"
              value={stats.totalModules || 0}
              color="bg-zinc-500/10 text-zinc-400"
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
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06]">
              <h3 className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-400" />
                Top 10 Leaderboard
              </h3>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {(stats.topUsers || []).map((u, idx) => {
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
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#7C3AED]/10 text-xs font-bold text-[#7C3AED] shrink-0">
                      {u.name?.[0] || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-zinc-200 truncate">{u.name}</span>
                        {isAdmin(u.email) && (
                          <Badge className="bg-[#7C3AED]/20 text-[#7C3AED] border-[#7C3AED]/30 text-[8px] px-1 py-0">Admin</Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-600 truncate">{u.email}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-white">"-"</p>
                      <p className="text-[10px] text-zinc-600">"-"</p>
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
              className="pl-9 h-9 border-white/[0.08] bg-[#111113] text-zinc-200 placeholder:text-zinc-600 text-sm"
            />
          </div>

          {/* User count */}
          <p className="text-[11px] text-zinc-600">{totalUsers} user ditemukan</p>

          {/* Users table */}
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] overflow-hidden">
            {/* Desktop header */}
            <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-white/[0.06] text-[12px] font-medium text-zinc-500">
              <div className="col-span-4">User</div>
              <div className="col-span-3 text-center">Status</div>
              <div className="col-span-3 text-center">Modul</div>
              <div className="col-span-2 text-center">Joined</div>
            </div>

            <div className="divide-y divide-white/[0.04]">
              {(users || []).map((u) => {
                return (
                  <div key={u.id} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
                    {/* Desktop row */}
                    <div className="hidden md:grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-4 flex items-center gap-2.5 min-w-0">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7C3AED]/10 text-xs font-bold text-[#7C3AED] shrink-0">
                          {u.name?.[0] || '?'}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm text-zinc-200 truncate">{u.name}</span>
                            {isAdmin(u.email) && (
                              <Badge className="bg-[#7C3AED]/20 text-[#7C3AED] border-[#7C3AED]/30 text-[8px] px-1 py-0">Admin</Badge>
                            )}
                          </div>
                          <p className="text-[10px] text-zinc-600 truncate">{u.email}</p>
                        </div>
                      </div>
                      <div className="col-span-2 text-center">
                        <p className="text-sm font-semibold text-white">"-"</p>
                        <p className="text-[10px] text-zinc-600">-</p>
                      </div>
                      <div className="col-span-2 text-center">
                        <span className="text-sm text-amber-400 font-medium">"-"</span>
                        <span className="text-[10px] text-zinc-600 ml-1">hari</span>
                      </div>
                      <div className="col-span-2 text-center">
                        <span className="text-sm text-zinc-300">0</span>
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
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#7C3AED]/10 text-sm font-bold text-[#7C3AED] shrink-0">
                        {u.name?.[0] || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-zinc-200 truncate">{u.name}</span>
                          {isAdmin(u.email) && (
                            <Badge className="bg-[#7C3AED]/20 text-[#7C3AED] border-[#7C3AED]/30 text-[8px] px-1 py-0">Admin</Badge>
                          )}
                        </div>
                        <p className="text-[10px] text-zinc-600 truncate">{u.email}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px]">
                          <span className="text-white font-medium">"-"</span>
                          <span className="text-amber-400">"-" streak</span>
                          <span className="text-zinc-500">0 modul</span>
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

      {activeView === 'dataset' && (
        <DatasetLibraryPanel />
      )}

      {activeView === 'd1' && (
        <D1MonitoringView />
      )}

      {activeView === 'llm' && (
        <LlmHealthView />
      )}

    </div>
  );
}

// ── LLM Health sub-component ──────────────────────────────────────
interface LlmHealthResponse {
  latest: {
    checkedAt: string;
    triggeredBy: string;
    proxyReachable: boolean;
    models: {
      modelId: string;
      alive: boolean;
      replySnippet?: string;
      errorType?: string;
      errorMessage?: string;
      responseMs: number;
    }[];
  } | null;
  fallbackEvents: {
    timestamp: string;
    fromModel: string;
    toModel: string;
    task: string;
    errorType: string;
    errorMessage: string;
    endpoint: string;
  }[];
  fallbackCount24h: number;
  piBansosUrl: string;
  usageInfo?: {
    requestsThisHour: number;
    hourlyLimit: number;
    remaining: number;
    lastRequestAt: string;
    resetsAt: string;
  };
}

function modelShortName(id: string): string {
  if (id.includes('cohere')) return 'Cohere';
  if (id.includes('nemotron')) return 'Nemotron';
  if (id.includes('poolside')) return 'Poolside';
  return id.split('/').pop()?.split(':')[0] || id;
}

function LlmHealthView() {
  const [data, setData] = useState<LlmHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/llm-health');
      if (res.status === 403) return;
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('LLM health fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  const handleTestNow = async () => {
    setTesting(true);
    try {
      await fetch('/api/admin/llm-health', { method: 'POST' });
      await fetchHealth();
    } catch (err) {
      console.error('LLM health test error:', err);
    } finally {
      setTesting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-xs text-zinc-500 text-center py-8">Gagal memuat data LLM health.</p>;
  }

  const { latest, fallbackEvents, fallbackCount24h, piBansosUrl, usageInfo } = data;
  const allAlive = latest?.models?.every(m => m.alive) ?? false;
  const anyAlive = latest?.models?.some(m => m.alive) ?? false;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Cpu className="h-4 w-4 text-emerald-400" />
            LLM Health Monitor
          </h3>
          <p className="text-[10px] text-zinc-500 mt-1">
            Proxy: <code className="text-zinc-400">{piBansosUrl}</code>
            {latest && (
              <> • Last check: {new Date(latest.checkedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })} ({latest.triggeredBy})</>
            )}
          </p>
        </div>
        <Button
          onClick={handleTestNow}
          disabled={testing}
          size="sm"
          variant="outline"
          className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 gap-1.5 h-8 text-xs"
        >
          {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
          Test Now
        </Button>
      </div>

      {/* Status banner */}
      <div className={cn(
        'rounded-lg border px-3 py-2.5 text-xs',
        !latest
          ? 'border-zinc-700 bg-zinc-900/40 text-zinc-400'
          : !latest.proxyReachable
            ? 'border-red-500/40 bg-red-500/10 text-red-300'
            : allAlive
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : anyAlive
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-red-500/40 bg-red-500/10 text-red-300'
      )}>
        {!latest && 'Belum ada data health check. Klik "Test Now" untuk memulai.'}
        {latest && !latest.proxyReachable && 'pi-bansos proxy tidak reachable. Cek PM2: pm2 status pi-bansos'}
        {latest && latest.proxyReachable && allAlive && `Semua 3 model sehat (${latest.models.length}/3)`}
        {latest && latest.proxyReachable && !allAlive && anyAlive && `${latest.models.filter(m => m.alive).length}/${latest.models.length} model sehat - beberapa fallback aktif`}
        {latest && latest.proxyReachable && !anyAlive && '✗ Semua model mati. Cek pi-bansos logs: pm2 logs pi-bansos'}
      </div>

      {/* KiloCode usage counter */}
      {usageInfo && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-emerald-400" />
              KiloCode Usage (200 req/jam)
            </h4>
            <Badge variant="outline" className={cn(
              'text-[10px]',
              usageInfo.remaining > 50
                ? 'border-emerald-500/30 text-emerald-400'
                : usageInfo.remaining > 10
                  ? 'border-amber-500/30 text-amber-400'
                  : 'border-red-500/30 text-red-400'
            )}>
              {usageInfo.remaining} tersisa
            </Badge>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <div className="flex-1 h-2 rounded-full bg-white/[0.04] overflow-hidden">
              <div
                className={cn(
                  'h-full transition-colors',
                  usageInfo.remaining > 50
                    ? 'bg-emerald-500'
                    : usageInfo.remaining > 10
                      ? 'bg-amber-500'
                      : 'bg-red-500'
                )}
                style={{ width: `${(usageInfo.requestsThisHour / usageInfo.hourlyLimit) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-zinc-500 shrink-0 tabular-nums">
              {usageInfo.requestsThisHour}/{usageInfo.hourlyLimit}
            </span>
          </div>
          <div className="flex items-center justify-between text-[9px] text-zinc-600">
            <span>
              Last: {usageInfo.lastRequestAt
                ? new Date(usageInfo.lastRequestAt).toLocaleString('id-ID', { timeStyle: 'medium' })
                : ' - '}
            </span>
            <span>
              Reset: {new Date(usageInfo.resetsAt).toLocaleString('id-ID', { timeStyle: 'short' })}
            </span>
          </div>
        </div>
      )}

      {/* Model status cards */}
      {latest && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {latest.models.map((m) => (
            <div key={m.modelId} className={cn(
              'rounded-lg border p-3 space-y-1.5',
              m.alive
                ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
                : 'border-red-500/30 bg-red-500/[0.04]'
            )}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white">{modelShortName(m.modelId)}</span>
                <span className={cn(
                  'w-2 h-2 rounded-full',
                  m.alive ? 'bg-emerald-400' : 'bg-red-400'
                )} />
              </div>
              <p className="text-[9px] text-zinc-500 truncate">{m.modelId}</p>
              <p className="text-[10px] text-zinc-400">
                {m.alive ? `${m.responseMs}ms` : m.errorType || 'dead'}
              </p>
              {m.alive && m.replySnippet && (
                <p className="text-[9px] text-zinc-500 italic truncate">"{m.replySnippet}"</p>
              )}
              {!m.alive && m.errorMessage && (
                <p className="text-[9px] text-red-400/70 truncate" title={m.errorMessage}>{m.errorMessage}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Fallback events summary */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-zinc-200">Recent Fallback Events</h4>
          <Badge variant="outline" className="text-[10px] border-white/10 text-zinc-400">
            {fallbackCount24h} in 24h
          </Badge>
        </div>
        {fallbackEvents.length === 0 ? (
          <p className="text-[10px] text-zinc-600 text-center py-4">
            Belum ada fallback. Semua request LLM pakai primary model.
          </p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {fallbackEvents.slice(0, 20).map((ev, i) => (
              <div key={i} className="text-[10px] flex items-start gap-2 p-1.5 rounded hover:bg-white/[0.02]">
                <span className="text-zinc-600 shrink-0">
                  {new Date(ev.timestamp).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' })}
                </span>
                <span className="text-zinc-400 truncate flex-1">
                  <code className="text-amber-400">{ev.endpoint}</code>{' → '}
                  <code>{modelShortName(ev.fromModel)}</code>{' '}
                  <span className="text-red-400">→</span>{' '}
                  <code className="text-emerald-400">{modelShortName(ev.toModel)}</code>
                  <span className="text-zinc-500 ml-2">({ev.errorType})</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] text-zinc-600">
        Cron daily 02:00 UTC+7 otomatis test semua 3 model. Bila ada model mati, akan tampil merah di sini.
      </p>
    </div>
  );
}
