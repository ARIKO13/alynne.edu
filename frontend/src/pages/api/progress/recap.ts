import type { APIRoute } from 'astro';
import { db } from '@/lib/db';

export const GET: APIRoute = async ({ url }) => {
  const userId = url.searchParams.get('userId');
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 });

  const recaps = await db.monthlyRecap.findMany({
    where: { userId },
    orderBy: { yearMonth: 'desc' },
    take: 12,
  });

  return Response.json({ recaps });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const { userId } = await request.json();
    if (!userId) return Response.json({ error: 'userId required' }, { status: 400 });

    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const yearMonth = prevMonth.toISOString().slice(0, 7);

    // Aggregate daily progress for previous month
    const dailyData = await db.dailyProgress.findMany({
      where: {
        userId,
        date: { startsWith: yearMonth },
      },
    });

    if (dailyData.length === 0) {
      return Response.json({ message: 'Tidak ada data bulan lalu' });
    }

    const totalXP = dailyData.reduce((sum, d) => sum + d.xpEarned, 0);
    const avgScore = Math.round(dailyData.reduce((sum, d) => sum + d.score, 0) / dailyData.length);
    const bestScore = Math.max(...dailyData.map((d) => d.score));
    const topics = [...new Set(dailyData.map((d) => d.topic))];

    const user = await db.user.findUnique({ where: { id: userId } });

    // Save monthly recap
    const recap = await db.monthlyRecap.upsert({
      where: { userId_yearMonth: { userId, yearMonth } },
      update: { totalXP, totalDays: dailyData.length, avgScore, bestScore, topicsCovered: JSON.stringify(topics), level: user?.level || 1 },
      create: { userId, yearMonth, totalXP, totalDays: dailyData.length, avgScore, bestScore, topicsCovered: JSON.stringify(topics), level: user?.level || 1 },
    });

    // Delete daily data for that month (CF D1 cost saving)
    await db.dailyProgress.deleteMany({
      where: { userId, date: { startsWith: yearMonth } },
    });

    // Update yearly record
    const year = yearMonth.slice(0, 4);
    const existingYear = await db.yearlyRecord.findFirst({ where: { userId, year } });

    if (existingYear) {
      await db.yearlyRecord.update({
        where: { id: existingYear.id },
        data: {
          totalXP: existingYear.totalXP + totalXP,
          totalDays: existingYear.totalDays + dailyData.length,
          avgScore: (existingYear.avgScore * existingYear.totalDays + avgScore * dailyData.length) / (existingYear.totalDays + dailyData.length),
          maxLevel: Math.max(existingYear.maxLevel, user?.level || 1),
          maxStreak: Math.max(existingYear.maxStreak, user?.streak || 0),
          completed: existingYear.totalDays + dailyData.length >= 30 ? 1 : 0,
        },
      });
    }

    return Response.json({ recap, deletedDaily: dailyData.length });
  } catch (error) {
    console.error('Recap error:', error);
    return Response.json({ error: 'Gagal membuat rekap' }, { status: 500 });
  }
};
