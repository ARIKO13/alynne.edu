import type { APIRoute } from 'astro';
import { d1 } from '@/lib/d1-client';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const session = JSON.parse(cookies.get('auth-session')?.value || '{}');
    const userId = session?.user?.id || session?.userId;
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const body = await request.json();
    const { title, nodesJson, sourceText } = body;
    if (!title || !nodesJson) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await d1.execute(
      `INSERT INTO MindMap (id, userId, title, nodesJson, sourceText, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, title, nodesJson, sourceText || '', now, now]
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
    if (!userId) return new Response(JSON.stringify({ maps: [] }), {
      headers: { 'Content-Type': 'application/json' }
    });

    const rows = await d1.query<{ id: string; title: string; createdAt: string }>(
      `SELECT id, title, createdAt FROM MindMap WHERE userId = ? ORDER BY updatedAt DESC`,
      [userId]
    );
    return new Response(JSON.stringify({ maps: rows }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};