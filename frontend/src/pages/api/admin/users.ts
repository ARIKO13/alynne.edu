import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { d1 } from '@/lib/d1-client';
import { isAdmin } from '@/lib/admin';

export const GET: APIRoute = async ({ url, request }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email || !isAdmin(session.user.email)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const search = url.searchParams.get('search') || '';
    const offset = (page - 1) * limit;

    let countSQL = 'SELECT COUNT(*) as c FROM User';
    let dataSQL = `SELECT u.id, u.name, u.email, u.xp, u.level, u.streak, u.image, u.currentSeason, u.lastActiveAt, u.createdAt,
      (SELECT COUNT(*) FROM DailyProgress dp WHERE dp.userId = u.id) as dailyProgress,
      (SELECT COUNT(*) FROM Certificate c WHERE c.userId = u.id) as certificates
      FROM User u`;
    const params: string[] = [];

    if (search) {
      countSQL += ' WHERE name LIKE ? OR email LIKE ?';
      dataSQL += ' WHERE name LIKE ? OR email LIKE ?';
      const pattern = `%${search}%`;
      params.push(pattern, pattern);
    }

    dataSQL += ' ORDER BY u.createdAt DESC LIMIT ? OFFSET ?';

    const [countResult, dataResult] = await Promise.all([
      d1.query<{ c: number }>(countSQL, params),
      d1.query<Record<string, unknown>>(dataSQL, [...params, String(limit), String(offset)]),
    ]);

    const users = dataResult.map(u => ({
      id: u.id,
      name: u.name || 'Player',
      email: u.email || '',
      xp: u.xp || 0,
      level: u.level || 1,
      streak: u.streak || 0,
      image: u.image || null,
      currentSeason: u.currentSeason || 1,
      lastActiveAt: u.lastActiveAt || null,
      createdAt: u.createdAt || '',
      _count: {
        dailyProgress: u.dailyProgress || 0,
        certificates: u.certificates || 0,
      },
    }));

    return Response.json({
      users,
      total: countResult[0]?.c ?? 0,
      page,
      limit,
    });
  } catch (error) {
    console.error('Admin users error:', error);
    return Response.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
};
