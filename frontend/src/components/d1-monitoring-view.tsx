'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Database, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface D1Info {
  d1: {
    tables: Array<{ name: string; count: number; error?: string }>;
    recentUsers: Array<{ id: string; name: string; email: string; createdAt: string }>;
    recentFailures: Array<{ id: string; source: string; createdAt: string; unknownCount: number }>;
    accountId: string;
    databaseId: string;
    region: string;
  };
  timestamp: string;
}

export function D1MonitoringView() {
  const [info, setInfo] = useState<D1Info | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/dataset-library?section=d1-monitoring');
      if (res.status === 403) {
        toast.error('Akses ditolak. Admin only.');
        return;
      }
      const data = await res.json();
      setInfo(data);
    } catch (e) {
      console.error('D1 monitoring fetch error:', e);
      toast.error('Gagal load D1 data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 10s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchData();
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  if (!info) {
    return (
      <div className="text-center py-8 text-sm text-zinc-500">
        Loading D1 monitoring data...
      </div>
    );
  }

  const { d1, timestamp } = info;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <Database className="h-4 w-4 text-sky-400" />
            Cloudflare D1 — User Account Database
          </h3>
          {timestamp && (
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Updated: {new Date(timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setAutoRefresh(!autoRefresh)}
            variant="outline"
            size="sm"
            className={cn(
              'h-8 text-xs gap-1.5',
              autoRefresh
                ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                : 'border-white/[0.08] text-zinc-400 hover:bg-white/[0.06]'
            )}
          >
            {autoRefresh ? '⏸ Auto 10s' : '▶ Paused'}
          </Button>
          <Button
            onClick={fetchData}
            disabled={loading}
            variant="outline"
            size="sm"
            className="border-white/[0.08] text-zinc-400 hover:bg-white/[0.06] h-8 text-xs gap-1.5"
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* D1 Info */}
      <div className="rounded-lg border border-white/[0.06] bg-[#0c0c0e] p-3">
        <p className="text-[11px] text-zinc-400 mb-2 flex items-center gap-1.5">
          <Database className="h-3 w-3" /> D1 Connection Info
        </p>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <p className="text-zinc-500">Account ID</p>
            <p className="text-zinc-300 font-mono text-[10px] break-all">{d1?.accountId}</p>
          </div>
          <div>
            <p className="text-zinc-500">Database ID</p>
            <p className="text-zinc-300 font-mono text-[10px] break-all">{d1?.databaseId}</p>
          </div>
          <div>
            <p className="text-zinc-500">Region</p>
            <p className="text-zinc-300 font-mono">{d1?.region}</p>
          </div>
          <div>
            <p className="text-zinc-500">Type</p>
            <p className="text-zinc-300 font-mono">Cloudflare D1 (HTTP API)</p>
          </div>
        </div>
      </div>

      {/* Table counts */}
      <div className="rounded-lg border border-white/[0.06] bg-[#0c0c0e] p-3">
        <p className="text-[11px] text-zinc-400 mb-2 flex items-center gap-1.5">
          <Database className="h-3 w-3" /> Tables ({d1?.tables?.length || 0})
        </p>
        {d1?.tables?.length === 0 ? (
          <p className="text-xs text-zinc-500 italic py-4 text-center">
            No tables found. Mungkin D1 API error — cek server logs.
          </p>
        ) : (
          <div className="space-y-1.5">
            {d1?.tables?.map((t, i) => {
              const maxCount = Math.max(...(d1?.tables || []).map(x => x.count || 0));
              const pct = maxCount > 0 ? (t.count / maxCount) * 100 : 0;
              return (
                <div key={i} className="rounded-md border border-white/[0.04] bg-[#18181b] p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-sky-400">{t.name}</span>
                    <span className="text-[10px] text-zinc-400 font-mono">{t.count.toLocaleString()}</span>
                  </div>
                  {t.error && (
                    <p className="text-[9px] text-red-400">Error: {t.error}</p>
                  )}
                  <div className="h-1.5 bg-[#0c0c0e] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-sky-500/60 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent users */}
      {d1?.recentUsers?.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[#0c0c0e] p-3">
          <p className="text-[11px] text-zinc-400 mb-2">Recent Users (last 5)</p>
          <div className="space-y-1">
            {d1.recentUsers.map((u, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
                <span className="font-mono text-zinc-300">{u.name || '—'}</span>
                <span className="text-zinc-600">{u.email}</span>
                <span className="text-zinc-600 ml-auto text-[10px]">
                  {new Date(u.createdAt).toLocaleDateString('id-ID', { dateStyle: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent STT failures */}
      {d1?.recentFailures?.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[#0c0c0e] p-3">
          <p className="text-[11px] text-zinc-400 mb-2">Recent STT Failures (last 5)</p>
          <div className="space-y-1">
            {d1.recentFailures.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/30 text-amber-400 bg-amber-500/10">
                  {f.source}
                </Badge>
                <span className="text-zinc-600">{f.unknownCount} unknown</span>
                <span className="text-zinc-600 ml-auto text-[10px]">
                  {new Date(f.createdAt).toLocaleDateString('id-ID', { dateStyle: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* D1 architecture note */}
      <div className="rounded-lg border border-sky-500/15 bg-sky-500/[0.03] p-3">
        <p className="text-[11px] text-sky-300 mb-1">ℹ️ D1 vs SQLite</p>
        <p className="text-[10px] text-zinc-400 leading-relaxed">
          D1 (Cloudflare) menyimpan data user account: Users, Certificates, Subscriptions, DailyProgress,
          MindMaps, Bookmarks, STTFailure. Diakses via HTTP API (50-200ms per query).
          SQLite di VPS SSD menyimpan STT dictionary (learned_words, cooccurrence, corrections) —
          synchronous, {'<'}1ms per query.
        </p>
      </div>
    </div>
  );
}
