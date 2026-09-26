import type { APIRoute } from 'astro';
import { d1 } from '@/lib/d1-client';

export const GET: APIRoute = async ({ params, cookies }) => {
  try {
    const session = JSON.parse(cookies.get('auth-session')?.value || '{}');
    const userId = session?.user?.id || session?.userId;
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

export const DELETE: APIRoute = async ({ params, cookies }) => {
  try {
    const session = JSON.parse(cookies.get('auth-session')?.value || '{}');
    const userId = session?.user?.id || session?.userId;
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    await d1.execute('DELETE FROM MindMap WHERE id = ? AND userId = ?', [params.id, userId]);
    return new Response(JSON.stringify({ success: true }));
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
