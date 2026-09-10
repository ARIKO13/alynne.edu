import type { APIRoute } from 'astro';
import { db } from '@/lib/db';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { name, email, image } = await request.json();
    if (!name || !email) {
      return Response.json({ error: 'Nama dan email wajib diisi' }, { status: 400 });
    }

    let user = await db.user.findUnique({ where: { email } });
    if (!user) {
      user = await db.user.create({
        data: { id: crypto.randomUUID(), googleId: 'demo-' + crypto.randomUUID(), email, name, image: image || null },
      });
    }

    return Response.json({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    });
  } catch (error) {
    console.error('Demo login error:', error);
    return Response.json({ error: 'Gagal login' }, { status: 500 });
  }
};
