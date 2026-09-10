import type { APIRoute } from 'astro';
import { db } from '@/lib/db';

export const GET: APIRoute = async ({ url }) => {
  const userId = url.searchParams.get('userId');
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 });

  const today = new Date().toISOString().split('T')[0];
  const yearMonth = today.slice(0, 7);

  const [user, todayProgress, monthlyDaysResult] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.dailyProgress.findUnique({ where: { userId_date: { userId, date: today } } }),
    db.dailyProgress.count({ where: { userId, date: { startsWith: yearMonth } } }),
  ]);

  const monthlyDays = monthlyDaysResult;

  if (!user) {
    return Response.json({
      id: userId,
      xp: 0, level: 1, streak: 0, currentSeason: 1,
      playedToday: false, monthlyDays: 0,
    });
  }

  return Response.json({
    ...user,
    playedToday: !!todayProgress,
    monthlyDays,
  });
};
