import type { APIRoute } from 'astro';
import { db } from '@/lib/db';

// Called on login or periodically to:
// 1. Monthly: aggregate daily → monthly recap, delete daily
// 2. Yearly: check if 12 months completed → generate certificate
// 3. Certificate expiry: delete certificates older than 7 days
export const POST: APIRoute = async () => {
  try {
    const now = new Date();
    const today = todayStr(now);
    const currentMonth = today.slice(0, 7);
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);

    // 1. MONTHLY CLEANUP: Aggregate previous month's daily data into recap
    const userIds = await db.dailyProgress.findDistinctUserIds(prevMonth);

    for (const userId of userIds) {
      const daily = await db.dailyProgress.findMany({
        where: { userId, date: { startsWith: prevMonth } },
      });
      if (daily.length === 0) continue;

      const totalXP = daily.reduce((s, d) => s + d.xpEarned, 0);
      const avgScore = Math.round(daily.reduce((s, d) => s + d.score, 0) / daily.length);
      const bestScore = Math.max(...daily.map(d => d.score));
      const topics = [...new Set(daily.map(d => d.topic))];
      const user = await db.user.findUnique({ where: { id: userId } });

      await db.monthlyRecap.upsert({
        where: { userId_yearMonth: { userId, yearMonth: prevMonth } },
        update: { totalXP, totalDays: daily.length, avgScore, bestScore, topicsCovered: JSON.stringify(topics), level: user?.level || 1 },
        create: { userId, yearMonth: prevMonth, totalXP, totalDays: daily.length, avgScore, bestScore, topicsCovered: JSON.stringify(topics), level: user?.level || 1 },
      });

      // Delete daily data (CF D1 cost saving)
      await db.dailyProgress.deleteMany({ where: { userId, date: { startsWith: prevMonth } } });

      // Update yearly record
      const year = prevMonth.slice(0, 4);
      const ey = await db.yearlyRecord.findFirst({ where: { userId, year } });
      if (ey) {
        await db.yearlyRecord.update({
          where: { id: ey.id },
          data: {
            totalXP: ey.totalXP + totalXP,
            totalDays: ey.totalDays + daily.length,
            maxLevel: Math.max(ey.maxLevel, user?.level || 1),
            maxStreak: Math.max(ey.maxStreak, user?.streak || 0),
            completed: ey.totalDays + daily.length >= 30 ? 1 : 0,
          },
        });
      }
    }

    // 2. YEARLY CHECK: Generate certificate for completed seasons
    const completedYears = await db.yearlyRecord.findMany({
      where: { completed: true },
    });

    for (const yr of completedYears) {
      const existingCert = await db.certificate.findFirst2({
        where: { userId: yr.userId, season: yr.season, year: yr.year },
      });
      if (!existingCert) {
        const expiresAt = new Date(now);
        expiresAt.setDate(expiresAt.getDate() + 7);
        await db.certificate.create({
          data: {
            userId: yr.userId,
            season: yr.season,
            year: yr.year,
            totalXP: yr.totalXP,
            totalDays: yr.totalDays,
            maxLevel: yr.maxLevel,
            maxStreak: yr.maxStreak,
            awardedAt: new Date(),
            expiresAt,
            shareCode: `${yr.year}-s${yr.season}-${yr.userId.slice(0, 8)}`,
          },
        });
      }
    }

    // 3. CERTIFICATE EXPIRY: Delete expired certificates (>7 days old)
    const expiredCerts = await db.certificate.findMany({
      where: { expiresAt: { lt: now } },
    });
    for (const cert of expiredCerts) {
      await db.certificate.delete({ where: { id: cert.id } });
    }

    // 4. SEASON RESET: If a season's certificate expired, reset user for new season
    const usersWithExpired = expiredCerts.map(c => c.userId);
    for (const uid of usersWithExpired) {
      const user = await db.user.findUnique({ where: { id: uid } });
      if (user) {
        await db.user.update({
          where: { id: uid },
          data: {
            xp: 0,
            level: 1,
            streak: 0,
            currentSeason: (user.currentSeason || 1) + 1,
          },
        });
      }
    }

    return Response.json({
      monthlyCleaned: userIds.length,
      certificatesGenerated: completedYears.length - expiredCerts.length,
      certificatesExpired: expiredCerts.length,
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return Response.json({ error: 'Cleanup gagal' }, { status: 500 });
  }
};

function todayStr(d: Date) {
  return d.toISOString().split('T')[0];
}
