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

    // Skema User asli: uid/username/gmail — alias ke id/name/email supaya
    // bentuk respons JSON untuk panel admin tidak berubah.
    // Guard: tabel DailyProgress / Certificate mungkin belum ada — cek
    // sqlite_master dulu supaya endpoint tidak 500 kalau tabelnya belum dibuat.
    let tableSet = new Set<string>();
    try {
      const tables = await d1.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('DailyProgress','Certificate')"
      );
      tableSet = new Set(tables.map(t => t.name));
    } catch {
      // kalau cek tabel gagal, fallback aman: counter ditampilkan sebagai 0
    }

    const dpSelect = tableSet.has('DailyProgress')
      ? '(SELECT COUNT(*) FROM DailyProgress dp WHERE dp.userId = u.uid) as dailyProgress'
      : '0 as dailyProgress';
    const certSelect = tableSet.has('Certificate')
      ? '(SELECT COUNT(*) FROM Certificate c WHERE c.userId = u.uid) as certificates'
      : '0 as certificates';

    let countSQL = 'SELECT COUNT(*) as c FROM User';
    let dataSQL = `SELECT u.uid as id, u.username as name, u.gmail as email, u.xp, u.level, u.streak, u.image, u.currentSeason, u.lastActiveAt, u.createdAt,
      ${dpSelect},
      ${certSelect}
      FROM User u`;
    const params: string[] = [];

    if (search) {
      countSQL += ' WHERE username LIKE ? OR gmail LIKE ?';
      dataSQL += ' WHERE username LIKE ? OR gmail LIKE ?';
      const pattern = `%${search}%`;
      params.push(pattern, pattern);
    }

    dataSQL += ' ORDER BY u.createdAt DESC LIMIT ? OFFSET ?';

    const [countResult, dataResult] = await Promise.all([
      d1.query<{ c: number }>(countSQL, params),
      // LIMIT/OFFSET dikirim sebagai angka (integer), bukan string
      d1.query<Record<string, unknown>>(dataSQL, [...params, limit, offset]),
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
