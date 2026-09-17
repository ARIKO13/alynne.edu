import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';

export const PUT: APIRoute = async ({ request }) => {
  try {
    const cookieHeader = request.headers.get('cookie') || '';
    console.log('[username] cookie header:', cookieHeader.slice(0, 80));

    const session = await getSession(request);
    console.log('[username] session:', session ? `user=${session.user.id}` : 'null');

    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name } = await request.json();
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return Response.json({ error: 'Username minimal 2 karakter' }, { status: 400 });
    }
    if (name.trim().length > 30) {
      return Response.json({ error: 'Username maksimal 30 karakter' }, { status: 400 });
    }

    const trimmed = name.trim();
    await db.user.update({
      where: { id: session.user.id },
      data: { name: trimmed },
    });

    return Response.json({ success: true, name: trimmed });
  } catch (error) {
    console.error('Update username error:', error);
    return Response.json({ error: 'Gagal update username' }, { status: 500 });
  }
};
