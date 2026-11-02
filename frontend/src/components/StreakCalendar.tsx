/**
 * StreakCalendar.tsx  -  GitHub-style heatmap of study activity
 *
 * Shows last 90 days of study sessions.
 * Color intensity = minutes studied that day.
 */

import { useMemo } from 'react';
import { Flame, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StreakCalendarProps {
  className?: string;
}

interface DayData {
  date: string;
  minutes: number;
  sessions: number;
}

function getStudyDays(): Map<string, DayData> {
  if (typeof localStorage === 'undefined') return new Map();
  try {
    const focusDays = JSON.parse(localStorage.getItem('lina-focus-days') || '[]');
    const map = new Map<string, DayData>();
    for (const d of focusDays) {
      map.set(d.date, { date: d.date, minutes: d.totalMinutes || 0, sessions: d.sessions || 0 });
    }
    return map;
  } catch {
    return new Map();
  }
}

function getIntensity(minutes: number): number {
  if (minutes === 0) return 0;
  if (minutes < 15) return 1;
  if (minutes < 30) return 2;
  if (minutes < 60) return 3;
  if (minutes < 120) return 4;
  return 5;
}

const INTENSITY_COLORS = [
  'bg-white/[0.03]',
  'bg-stone-400/20',
  'bg-stone-400/40',
  'bg-stone-400/60',
  'bg-stone-400/80',
  'bg-stone-400',
];

export function StreakCalendar({ className }: StreakCalendarProps) {
  const days = useMemo(() => {
    const studyDays = getStudyDays();
    const today = new Date();
    const result: DayData[] = [];

    // Generate last 91 days (13 weeks)
    for (let i = 90; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const data = studyDays.get(dateStr);
      result.push({
        date: dateStr,
        minutes: data?.minutes || 0,
        sessions: data?.sessions || 0,
      });
    }

    return result;
  }, []);

  // Group into weeks (columns)
  const weeks = useMemo(() => {
    const w: DayData[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      w.push(days.slice(i, i + 7));
    }
    return w;
  }, [days]);

  const totalMinutes = days.reduce((s, d) => s + d.minutes, 0);
  const activeDays = days.filter(d => d.minutes > 0).length;
  const maxMinutes = Math.max(...days.map(d => d.minutes), 1);

  const monthLabels = useMemo(() => {
    const labels: { week: number; label: string }[] = [];
    let lastMonth = -1;
    weeks.forEach((week, i) => {
      if (week.length > 0) {
        const month = new Date(week[0].date).getMonth();
        if (month !== lastMonth) {
          labels.push({ week: i, label: new Date(week[0].date).toLocaleDateString('id-ID', { month: 'short' }) });
          lastMonth = month;
        }
      }
    });
    return labels;
  }, [weeks]);

  return (
    <div className={cn('rounded-lg border border-white/[0.06] bg-white/[0.02] p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <Flame className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-medium text-stone-200">Aktivitas Belajar</h3>
        <span className="text-[10px] text-stone-500 ml-auto">
          {activeDays} hari aktif | {Math.floor(totalMinutes / 60)}j {totalMinutes % 60}m total
        </span>
      </div>

      {/* Heatmap */}
      <div className="overflow-x-auto">
        <div className="inline-flex gap-1">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((day, di) => {
                const intensity = getIntensity(day.minutes);
                return (
                  <div
                    key={di}
                    className={cn(
                      'w-3 h-3 rounded-sm transition-shadow hover:ring-1 hover:ring-white/20',
                      INTENSITY_COLORS[intensity]
                    )}
                    title={`${day.date}: ${day.minutes} menit, ${day.sessions} sesi`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Month labels */}
      <div className="flex gap-1 mt-1">
        {weeks.map((_, wi) => {
          const label = monthLabels.find(m => m.week === wi);
          return (
            <div key={wi} className="w-3 text-[8px] text-stone-600">
              {label?.label || ''}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1 mt-3 justify-end">
        <span className="text-[9px] text-stone-600 mr-1">Less</span>
        {INTENSITY_COLORS.map((color, i) => (
          <div key={i} className={cn('w-2.5 h-2.5 rounded-sm', color)} />
        ))}
        <span className="text-[9px] text-stone-600 ml-1">More</span>
      </div>
    </div>
  );
}
