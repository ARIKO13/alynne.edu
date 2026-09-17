import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';

export const GET: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch user from D1 — this has the saved username
    let user = await db.user.findUnique({ where: { id: session.user.id } });

    // Auto-create if missing (first login after account system migration)
    if (!user) {
      const u = session.user;
      user = await db.user.create({
        data: {
          id: u.id || u.email || crypto.randomUUID(),
          googleId: u.id || '',
          email: u.email || '',
          name: u.name || 'Player',
          image: u.image || null,
        },
      });
    }

    return Response.json({
      name: user.name,
      email: user.email,
      image: user.image,
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    // Fallback to session data if D1 fails
    const session = await getSession(request);
    return Response.json({
      name: session?.user?.name || 'Player',
      email: session?.user?.email || '',
      image: session?.user?.image || null,
    });
  }
};
