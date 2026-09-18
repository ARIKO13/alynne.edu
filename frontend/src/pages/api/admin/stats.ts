import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { d1 } from '@/lib/d1-client';
import { isAdmin } from '@/lib/admin';

export const GET: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);
    // Debug logging untuk troubleshoot 403
    const cookie = request.headers.get('cookie') || '';
    const hasCookie = cookie.includes('lina-session=');
    const sessionEmail = session?.user?.email || 'NO_EMAIL';
    const sessionName = session?.user?.name || 'NO_NAME';
    console.log(`[admin/stats] DEBUG: hasCookie=${hasCookie}, sessionNull=${!session}, email=${sessionEmail}, name=${sessionName}, isAdmin=${isAdmin(sessionEmail)}`);

    if (!session?.user?.email || !isAdmin(session.user.email)) {
      return Response.json({
        error: 'Forbidden',
        debug: {
          hasCookie,
          sessionExists: !!session,
          email: sessionEmail,
          isAdmin: isAdmin(sessionEmail),
        }
      }, { status: 403 });
    }

    const today = new Date().toISOString().split('T')[0];

    const [userCounts, gameCounts, xpSums, activeCounts, certCounts, topUsers] =
      await Promise.all([
        d1.query<{ c: number }>('SELECT COUNT(*) as c FROM User'),
        d1.query<{ c: number }>('SELECT COUNT(*) as c FROM DailyProgress'),
        d1.query<{ s: number | null }>('SELECT SUM(xp) as s FROM User'),
        d1.query<{ c: number }>('SELECT COUNT(DISTINCT userId) as c FROM DailyProgress WHERE date = ?', [today]),
        d1.query<{ c: number }>('SELECT COUNT(*) as c FROM Certificate'),
        d1.query<{ id: string; name: string; email: string; xp: number; level: number; streak: number; image: string | null; currentSeason: number; createdAt: string }>(
          'SELECT id, name, email, xp, level, streak, image, currentSeason, createdAt FROM User ORDER BY xp DESC LIMIT 10'
        ),
      ]);

    return Response.json({
      totalUsers: userCounts[0]?.c ?? 0,
      totalGames: gameCounts[0]?.c ?? 0,
      totalXP: xpSums[0]?.s ?? 0,
      activeToday: activeCounts[0]?.c ?? 0,
      totalCertificates: certCounts[0]?.c ?? 0,
      topUsers: (topUsers || []).map(u => ({
        id: u.id,
        name: u.name || 'Player',
        email: u.email || '',
        xp: u.xp || 0,
        level: u.level || 1,
        streak: u.streak || 0,
        image: u.image || null,
        currentSeason: u.currentSeason || 1,
        createdAt: u.createdAt || '',
      })),
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return Response.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
};
