import type { APIRoute } from 'astro';
import { d1 } from '@/lib/d1-client';
import { getSession } from '@/lib/auth';

export const GET: APIRoute = async ({ params, request }) => {
  try {
    const session = await getSession(request);
    const userId = session?.user.id;
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const rows = await d1.query(
      `SELECT * FROM MindMap WHERE id = ? AND userId = ?`,
      [params.id, userId]
    );
    if (rows.length === 0) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    return new Response(JSON.stringify({ map: rows[0] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ params, request }) => {
  try {
    const session = await getSession(request);
    const userId = session?.user.id;
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    await d1.execute('DELETE FROM MindMap WHERE id = ? AND userId = ?', [params.id, userId]);
    return new Response(JSON.stringify({ success: true }));
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
