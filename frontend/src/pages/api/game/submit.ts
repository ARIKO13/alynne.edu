import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { getTierForXP } from '@/lib/tiers';

const XP_PER_DIFFICULTY = { easy: 10, medium: 20, hard: 30 };
const STREAK_BONUS = 5;
const PERFECT_BONUS = 50;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { userId, answers, questions, topic, timeSpentSeconds } = await request.json();
    if (!userId || !answers || !questions) {
      return Response.json({ error: 'Data tidak lengkap' }, { status: 400 });
    }

    const today = new Date().toISOString().split('T')[0];
    const correctCount = answers.filter((a: number, i: number) => a === questions[i]?.correctIndex).length;
    const score = Math.round((correctCount / questions.length) * 100);

    let totalXP = 0;
    answers.forEach((ans: number, i: number) => {
      if (ans === questions[i]?.correctIndex) {
        totalXP += XP_PER_DIFFICULTY[questions[i]?.difficulty as keyof typeof XP_PER_DIFFICULTY] || 10;
      }
    });

    if (score === 100) totalXP += PERFECT_BONUS;

    const existingUser = await db.user.findUnique({ where: { id: userId } });
    let streak = existingUser?.streak || 0;
    const lastActive = existingUser?.lastActiveAt;

    if (lastActive) {
      const lastDate = new Date(lastActive).toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      if (lastDate === yesterday) {
        streak += 1;
        totalXP += STREAK_BONUS * streak;
      } else if (lastDate !== today) {
        streak = 1;
      }
    } else {
      streak = 1;
    }

    const newXP = (existingUser?.xp || 0) + totalXP;
    const newTier = getTierForXP(newXP);
    const prevTier = getTierForXP(existingUser?.xp || 0);
    const tierUp = newTier.level > prevTier.level;

    await db.user.upsert({
      where: { id: userId },
      update: { xp: newXP, level: newTier.level, streak, lastActiveAt: new Date().toISOString() },
      create: {
        id: userId,
        googleId: userId,
        email: `${userId}@local`,
        name: 'Player',
        xp: totalXP,
        level: 1,
        streak: 1,
        lastActiveAt: new Date().toISOString(),
      },
    });

    await db.dailyProgress.upsert({
      where: { userId_date: { userId, date: today } },
      update: { topic, score, xpEarned: totalXP, questionsCount: questions.length, correctCount, timeSpentSeconds: timeSpentSeconds || 0 },
      create: { userId, date: today, topic, score, xpEarned: totalXP, questionsCount: questions.length, correctCount, timeSpentSeconds: timeSpentSeconds || 0 },
    });

    return Response.json({
      score,
      correctCount,
      total: questions.length,
      xpEarned: totalXP,
      streak,
      newTier,
      prevTier,
      tierUp,
      totalXP: newXP,
      perfectBonus: score === 100 ? PERFECT_BONUS : 0,
      streakBonus: streak > 1 ? STREAK_BONUS * streak : 0,
    });
  } catch (error) {
    console.error('Submit game error:', error);
    return Response.json({ error: 'Gagal menyimpan hasil' }, { status: 500 });
  }
};
