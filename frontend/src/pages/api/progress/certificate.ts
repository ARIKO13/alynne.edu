import type { APIRoute } from 'astro';
import { db } from '@/lib/db';

export const GET: APIRoute = async ({ url }) => {
  const shareCode = url.searchParams.get('code');
  const userId = url.searchParams.get('userId');

  try {
    let cert;
    if (shareCode) {
      cert = await db.certificate.findUnique({ where: { shareCode } });
    } else if (userId) {
      const now = new Date();
      cert = await db.certificate.findFirst({
        where: { userId, expiresAt: { gt: now } },
        orderBy: { awardedAt: 'desc' },
      });
    }

    if (!cert) {
      return Response.json({ error: 'Sertifikat tidak ditemukan atau sudah expired' }, { status: 404 });
    }

    // Fetch user's custom display name
    let userName: string | undefined;
    try {
      const u = await db.user.findUnique({ where: { id: cert.userId } });
      userName = u?.name || undefined;
    } catch {}

    return Response.json({
      id: cert.id,
      season: cert.season,
      year: cert.year,
      totalXP: cert.totalXP,
      totalDays: cert.totalDays,
      maxLevel: cert.maxLevel,
      maxStreak: cert.maxStreak,
      awardedAt: cert.awardedAt,
      expiresAt: cert.expiresAt,
      shareCode: cert.shareCode,
      daysUntilExpiry: Math.max(0, Math.ceil((new Date(cert.expiresAt).getTime() - Date.now()) / 86400000)),
      userName,
    });
  } catch (error) {
    return Response.json({ error: 'Gagal mengambil sertifikat' }, { status: 500 });
  }
};
