import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { d1 } from '@/lib/d1-client';
import { isAdmin } from '@/lib/admin';

export const GET: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);
    const sessionEmail = session?.user?.email || 'NO_EMAIL';

    if (!session?.user?.email || !isAdmin(session.user.email)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only query User table (only table that exists now)
    const [userCounts, activeSubs, trialSubs, topUsers] = await Promise.all([
      d1.query<{ c: number }>('SELECT COUNT(*) as c FROM User'),
      d1.query<{ c: number }>("SELECT COUNT(*) as c FROM User WHERE activeSubscription = 'active'"),
      d1.query<{ c: number }>("SELECT COUNT(*) as c FROM User WHERE activeSubscription = 'trial'"),
      d1.query<{ uid: string; username: string; gmail: string; activeSubscription: string; packetSubscription: string; createdAt: string }>(
        'SELECT uid, username, gmail, activeSubscription, packetSubscription, createdAt FROM User ORDER BY createdAt DESC LIMIT 10'
      ),
    ]);

    return Response.json({
      totalUsers: userCounts[0]?.c ?? 0,
      activeSubscriptions: activeSubs[0]?.c ?? 0,
      trialSubscriptions: trialSubs[0]?.c ?? 0,
      topUsers: (topUsers || []).map(u => ({
        id: u.uid,
        name: u.username || 'Player',
        email: u.gmail || '',
        activeSubscription: u.activeSubscription || 'trial',
        packetSubscription: u.packetSubscription || 'none',
        createdAt: u.createdAt || '',
      })),
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return Response.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
};
