import type { APIRoute } from 'astro';
import { d1 } from '@/lib/d1-client';
import { getSession } from '@/lib/auth';

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    const session = await getSession(request);
    const userId = session?.user.id;
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const id = params.id;
    const body = await request.json();
    const { text, note, materialName, color } = body;

    const fields: string[] = [];
    const values: any[] = [];
    if (text !== undefined) { fields.push('text = ?'); values.push(text); }
    if (note !== undefined) { fields.push('note = ?'); values.push(note); }
    if (materialName !== undefined) { fields.push('materialName = ?'); values.push(materialName); }
    if (color !== undefined) { fields.push('color = ?'); values.push(color); }

    if (fields.length === 0) return new Response(JSON.stringify({ error: 'Nothing to update' }), { status: 400 });

    values.push(id, userId);
    await d1.execute(
      `UPDATE Highlight SET ${fields.join(', ')} WHERE id = ? AND userId = ?`,
      values
    );
    return new Response(JSON.stringify({ success: true }));
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ params, request }) => {
  try {
    const session = await getSession(request);
    const userId = session?.user.id;
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    await d1.execute('DELETE FROM Highlight WHERE id = ? AND userId = ?', [params.id, userId]);
    return new Response(JSON.stringify({ success: true }));
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
