import type { APIRoute } from 'astro';
import { d1 } from '@/lib/d1-client';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const session = JSON.parse(cookies.get('auth-session')?.value || '{}');
    const userId = session?.user?.id || session?.userId;
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const body = await request.json();
    const { text, note, materialName, color } = body;
    if (!text) return new Response(JSON.stringify({ error: 'Text required' }), { status: 400 });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await d1.execute(
      `INSERT INTO Highlight (id, userId, materialName, text, note, color, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, materialName || 'Umum', text, note || '', color || '#D9A87E', now]
    );
    return new Response(JSON.stringify({ success: true, id }), { status: 201 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const session = JSON.parse(cookies.get('auth-session')?.value || '{}');
    const userId = session?.user?.id || session?.userId;
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const rows = await d1.query(
      `SELECT * FROM Highlight WHERE userId = ? ORDER BY createdAt DESC`,
      [userId]
    );
    return new Response(JSON.stringify({ bookmarks: rows }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
