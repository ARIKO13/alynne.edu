'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Activity, RefreshCw, Cpu, MemoryStick, HardDrive, Zap, Clock,
  Database, Server, Pause, Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface MonitoringViewProps {
  info: any;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onRefresh: () => void;
  loading: boolean;
}

export function MonitoringView({ info, autoRefresh, onToggleAutoRefresh, onRefresh, loading }: MonitoringViewProps) {
  if (!info) {
    return (
      <div className="text-center py-8 text-sm text-zinc-500">
        Loading monitoring data...
      </div>
    );
  }

  const { vps, pm2, sqlite, dbFile, timestamp } = info;

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const formatUptime = (seconds: number): string => {
    if (!seconds) return '-';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const cpuPct = parseFloat(vps?.cpuUsage || '0');
  const memPct = parseFloat(vps?.memory?.usedPct || '0');

  return (
    <div className="space-y-3">
      {/* Header with auto-refresh toggle */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
          <Activity className="h-3 w-3" />
          Real-time Monitoring
          {timestamp && (
            <span className="text-zinc-600 ml-2">
              Updated: {new Date(timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </p>
        <div className="flex items-center gap-1">
          <Button
            onClick={onToggleAutoRefresh}
            variant="outline"
            size="sm"
            className={cn(
              'h-7 text-[10px] gap-1',
              autoRefresh
                ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                : 'border-white/[0.08] text-zinc-400 hover:bg-white/[0.06]'
            )}
          >
            {autoRefresh ? <Pause className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5" />}
            {autoRefresh ? 'Auto 10s' : 'Paused'}
          </Button>
          <Button
            onClick={onRefresh}
            disabled={loading}
            variant="outline"
            size="sm"
            className="h-7 text-[10px] border-white/[0.08] text-zinc-400 hover:bg-white/[0.06]"
          >
            <RefreshCw className={cn('h-2.5 w-2.5', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* VPS Stats */}
      <div className="rounded-lg border border-white/[0.06] bg-[#111113] p-3">
        <p className="text-[11px] text-zinc-400 mb-2 flex items-center gap-1.5">
          <Server className="h-3 w-3" /> VPS (176.100.37.238)
        </p>
        <div className="space-y-2">
          {/* CPU usage */}
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-zinc-400 flex items-center gap-1">
                <Cpu className="h-3 w-3" /> CPU
              </span>
              <span className={cn(
                'font-mono font-semibold',
                cpuPct > 80 ? 'text-red-400' : cpuPct > 60 ? 'text-amber-400' : 'text-emerald-400'
              )}>
                {cpuPct.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 bg-[#161618] rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  cpuPct > 80 ? 'bg-red-500' : cpuPct > 60 ? 'bg-amber-500' : 'bg-emerald-500'
                )}
                style={{ width: `${Math.min(cpuPct, 100)}%` }}
              />
            </div>
          </div>

          {/* Memory usage */}
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-zinc-400 flex items-center gap-1">
                <MemoryStick className="h-3 w-3" /> Memory
              </span>
              <span className={cn(
                'font-mono font-semibold',
                memPct > 80 ? 'text-red-400' : memPct > 60 ? 'text-amber-400' : 'text-emerald-400'
              )}>
                {memPct.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 bg-[#161618] rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  memPct > 80 ? 'bg-red-500' : memPct > 60 ? 'bg-amber-500' : 'bg-emerald-500'
                )}
                style={{ width: `${Math.min(memPct, 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-zinc-600 mt-0.5">
              {formatBytes(vps?.memory?.used || 0)} / {formatBytes(vps?.memory?.total || 0)} · Available: {formatBytes(vps?.memory?.available || 0)}
            </p>
          </div>

          {/* Load average + uptime */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <p className="text-[10px] text-zinc-500">Load Avg (1/5/15m)</p>
              <p className="text-[11px] text-zinc-300 font-mono">
                {vps?.loadAvg?.[0]?.toFixed(2)} / {vps?.loadAvg?.[1]?.toFixed(2)} / {vps?.loadAvg?.[2]?.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-zinc-500">Uptime</p>
              <p className="text-[11px] text-zinc-300 font-mono">{formatUptime(vps?.uptime || 0)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* PM2 Process Stats */}
      {pm2 && (
        <div className="rounded-lg border border-white/[0.06] bg-[#111113] p-3">
          <p className="text-[11px] text-zinc-400 mb-2 flex items-center gap-1.5">
            <Activity className="h-3 w-3" /> PM2 Process: {pm2.name}
          </p>
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <p className="text-zinc-500">Status</p>
              <Badge
                variant="outline"
                className={cn(
                  'text-[9px] px-1.5 py-0 mt-0.5',
                  pm2.status === 'online'
                    ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                    : 'border-red-500/30 text-red-400 bg-red-500/10'
                )}
              >
                {pm2.status}
              </Badge>
            </div>
            <div>
              <p className="text-zinc-500">PID</p>
              <p className="text-zinc-300 font-mono">{pm2.pid || '-'}</p>
            </div>
            <div>
              <p className="text-zinc-500">Uptime</p>
              <p className="text-zinc-300 font-mono">{formatUptime((Date.now() - (pm2.uptime || 0)) / 1000)}</p>
            </div>
            <div>
              <p className="text-zinc-500">Restarts</p>
              <p className="text-zinc-300 font-mono">{pm2.restarts}</p>
            </div>
            <div>
              <p className="text-zinc-500">Memory</p>
              <p className="text-zinc-300 font-mono">{formatBytes(pm2.memory || 0)}</p>
            </div>
            <div>
              <p className="text-zinc-500">CPU (PM2)</p>
              <p className="text-zinc-300 font-mono">{pm2.cpu?.toFixed(1) || 0}%</p>
            </div>
          </div>
          {pm2.unstableRestarts > 0 && (
            <p className="text-[10px] text-amber-400 mt-2">
              ⚠️ {pm2.unstableRestarts} unstable restarts detected
            </p>
          )}
        </div>
      )}

      {/* SQLite Performance */}
      {sqlite && (
        <div className="rounded-lg border border-white/[0.06] bg-[#111113] p-3">
          <p className="text-[11px] text-zinc-400 mb-2 flex items-center gap-1.5">
            <Database className="h-3 w-3" /> SQLite Performance
          </p>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <p className="text-zinc-500">Journal Mode</p>
              <p className="text-zinc-300 font-mono">{sqlite.journalMode}</p>
            </div>
            <div>
              <p className="text-zinc-500">Query Time (LIKE)</p>
              <p className={cn(
                'font-mono',
                sqlite.queryMs > 100 ? 'text-amber-400' : 'text-emerald-400'
              )}>
                {sqlite.queryMs}ms
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Cache Size</p>
              <p className="text-zinc-300 font-mono">{sqlite.cacheSize}</p>
            </div>
            <div>
              <p className="text-zinc-500">WAL Frames</p>
              <p className="text-zinc-300 font-mono">{sqlite.walCheckpoint?.frames || 0}</p>
            </div>
            <div>
              <p className="text-zinc-500">Learned Words</p>
              <p className="text-zinc-300 font-mono">{(sqlite.learnedCount || 0).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-zinc-500">Co-occurrences</p>
              <p className="text-zinc-300 font-mono">{(sqlite.cooccurrenceCount || 0).toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      {/* DB File */}
      {dbFile && (
        <div className="rounded-lg border border-white/[0.06] bg-[#111113] p-3">
          <p className="text-[11px] text-zinc-400 mb-2 flex items-center gap-1.5">
            <HardDrive className="h-3 w-3" /> DB File
          </p>
          <p className="text-[10px] text-zinc-500 font-mono break-all">{dbFile.path}</p>
          <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
            <div>
              <p className="text-zinc-500">Main DB</p>
              <p className="text-zinc-300 font-mono">{formatBytes(dbFile.sizeBytes || 0)}</p>
            </div>
            <div>
              <p className="text-zinc-500">WAL File</p>
              <p className="text-zinc-300 font-mono">{formatBytes(dbFile.walSizeBytes || 0)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
