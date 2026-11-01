/**
 * WeeklyAnalytics.tsx  -  Focus study analytics dashboard
 *
 * Shows last 7 days of study sessions:
 * - Total minutes studied
 * - Total sessions
 * - Best day
 * - Bar chart of daily minutes
 * - Streak info
 * - Quiz accuracy
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
import {
  Clock,
  Flame,
  TrendingUp,
  Target,
  Award,
  Calendar,
  X,
} from 'lucide-react';
import { getWeeklyAnalytics, loadMemory } from '@/lib/ai-memory';

interface WeeklyAnalyticsProps {
  open: boolean;
  onClose: () => void;
}

export function WeeklyAnalytics({ open, onClose }: WeeklyAnalyticsProps) {
  const stats = useMemo(() => getWeeklyAnalytics(), [open]);
  const memory = useMemo(() => loadMemory(), [open]);

  if (!open) return null;

  const maxMinutes = Math.max(...stats.dailyBreakdown.map((d) => d.minutes), 60);
  const quizAccuracy =
    memory.totalQuestionsAttempted > 0
      ? Math.round((memory.totalCorrectAnswers / memory.totalQuestionsAttempted) * 100)
      : 0;

  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <TrendingUp className="h-5 w-5 text-[var(--accent-soft)]" />
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Analitik Belajar Minggu Ini</h2>
            <p className="text-[11px] text-zinc-500">Statistik fokus dan progress belajar 7 hari terakhir.</p>
          </div>
        </div>
        <Button onClick={onClose} variant="ghost" size="sm" className="text-zinc-400 hover:text-white hover:bg-white/[0.04]">
          <X className="h-4 w-4" />
          <span className="ml-1 hidden sm:inline">Tutup</span>
        </Button>
      </div>

      <div className="p-5 space-y-5">
        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            icon={Clock}
            label="Total Belajar"
            value={`${Math.floor(stats.totalMinutes / 60)}j ${stats.totalMinutes % 60}m`}
            color="text-blue-400"
          />
          <StatCard
            icon={Target}
            label="Sesi"
            value={stats.totalSessions}
            color="text-green-400"
          />
          <StatCard
            icon={Flame}
            label="Streak"
            value={`${memory.currentStreak} hari`}
            sub={`Tertinggi: ${memory.longestStreak}`}
            color="text-amber-400"
          />
          <StatCard
            icon={Award}
            label="Akurasi Kuis"
            value={`${quizAccuracy}%`}
            sub={`${memory.totalCorrectAnswers}/${memory.totalQuestionsAttempted}`}
            color="text-[var(--accent-soft)]"
          />
        </div>

        {/* Daily bar chart */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-zinc-500" />
            Aktivitas Harian (7 hari)
          </h3>
          <div className="flex items-end justify-between gap-2 h-32">
            {stats.dailyBreakdown.map((day, i) => {
              const heightPct = (day.minutes / maxMinutes) * 100;
              const date = new Date(day.date);
              const dayName = dayNames[date.getDay()];
              const isToday = day.date === new Date().toISOString().split('T')[0];
              const isBest = stats.bestDay?.date === day.date && day.minutes > 0;

              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-zinc-500">
                    {day.minutes > 0 ? `${day.minutes}m` : ''}
                  </span>
                  <div
                    className={`w-full rounded-t transition-colors ${
                      isBest
                        ? 'bg-amber-500'
                        : isToday
                        ? 'bg-[var(--accent)]'
                        : 'bg-zinc-700'
                    }`}
                    style={{ height: `${Math.max(heightPct, 2)}%` }}
                    title={`${day.date}: ${day.minutes} menit, ${day.sessions} sesi`}
                  />
                  <span
                    className={`text-[10px] ${
                      isToday ? 'text-[var(--accent-soft)] font-bold' : 'text-zinc-500'
                    }`}
                  >
                    {dayName}
                  </span>
                </div>
              );
            })}
          </div>
          {stats.bestDay && (
            <p className="text-[11px] text-zinc-500 mt-3 text-center">
              Hari terbaik: {new Date(stats.bestDay.date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' })} ({stats.bestDay.minutes} menit)
            </p>
          )}
        </div>

        {/* Achievements */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">Pencapaian</h3>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="outline"
              className={`text-[10px] ${
                memory.currentStreak >= 1
                  ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                  : 'border-zinc-700 text-zinc-600'
              }`}
            >
              <Flame className="h-3 w-3 mr-1" />
              First Step (1 hari streak)
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] ${
                memory.currentStreak >= 7
                  ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                  : 'border-zinc-700 text-zinc-600'
              }`}
            >
              <Flame className="h-3 w-3 mr-1" />
              Consistent (7 hari)
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] ${
                memory.currentStreak >= 30
                  ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                  : 'border-zinc-700 text-zinc-600'
              }`}
            >
              <Flame className="h-3 w-3 mr-1" />
              Monthly Master (30 hari)
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] ${
                memory.totalStudyMinutes >= 600
                  ? 'border-blue-500/30 text-blue-400 bg-blue-500/10'
                  : 'border-zinc-700 text-zinc-600'
              }`}
            >
              <Clock className="h-3 w-3 mr-1" />
              10 Jam Belajar
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] ${
                quizAccuracy >= 80 && memory.totalQuizzesTaken >= 5
                  ? 'border-[var(--accent)]/30 text-[var(--accent-soft)] bg-[var(--accent)]/10'
                  : 'border-zinc-700 text-zinc-600'
              }`}
            >
              <Award className="h-3 w-3 mr-1" />
              Quiz Master (80%+ akurasi)
            </Badge>
          </div>
        </div>

        {/* Total stats */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
          <h3 className="text-sm font-medium text-zinc-300 mb-2">Statistik Total</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-500">Total waktu belajar:</span>
              <span className="text-zinc-300">{Math.floor(memory.totalStudyMinutes / 60)}j {memory.totalStudyMinutes % 60}m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Total sesi:</span>
              <span className="text-zinc-300">{memory.totalSessions}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Total kuis:</span>
              <span className="text-zinc-300">{memory.totalQuizzesTaken}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Pertanyaan dijawab:</span>
              <span className="text-zinc-300">{memory.totalQuestionsAttempted}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Jawaban benar:</span>
              <span className="text-zinc-300">{memory.totalCorrectAnswers}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Referral:</span>
              <span className="text-zinc-300">{memory.referralCount} teman</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={onClose} className="text-zinc-400">
            <X className="h-4 w-4 mr-2" />
            Tutup
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: typeof Clock;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <Icon className={`h-4 w-4 mb-1 ${color}`} />
      <p className="text-lg font-semibold text-white">{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase">{label}</p>
      {sub && <p className="text-[9px] text-zinc-600 mt-0.5">{sub}</p>}
    </div>
  );
}
