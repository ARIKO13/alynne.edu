import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { createToken, COOKIE_NAME } from '@/lib/auth';
import { subscriptionDb } from '@/lib/subscription-db';

/**
 * POST /api/auth/demo-login
 * Body: { name, email, image? }
 *
 * Creates/looks up a demo user in D1, creates a trial subscription if new,
 * and sets the `lina-session` JWT cookie (same as Google OAuth callback).
 *
 * Previously this endpoint returned JSON without setting the cookie, which
 * meant the frontend's session check would fail immediately - the user
 * appeared logged-in but the next /api/auth/session call returned null.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const { name, email, image } = body;
    if (!name || !email) {
      return Response.json({ error: 'Nama dan email wajib diisi' }, { status: 400 });
    }

    let user = await db.user.findUnique({ where: { gmail: email } });
    if (!user) {
      user = await db.user.create({
        data: {
          uid: crypto.randomUUID(),
          googleId: 'demo-' + crypto.randomUUID(),
          gmail: email,
          username: name,
        },
      });
      // Create trial subscription for new demo users
      try {
        const existingSub = await subscriptionDb.findByUserId(user.uid);
        if (!existingSub) {
          await subscriptionDb.createTrial(user.uid);
        }
      } catch (subErr) {
        console.error('[demo-login] subscription creation error (non-blocking):', subErr);
      }
    }

    // Create JWT token (same as Google OAuth callback)
    // Map db.User (uid/gmail/username) → SessionUser (id/email/name/image)
    const token = await createToken({
      id: user.uid,
      email: user.gmail,
      name: user.username,
      image: image || null,
    });

    // Set session cookie (30 days, same as callback.ts)
    const cookieStr = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`;

    return new Response(
      JSON.stringify({
        id: user.uid,
        email: user.gmail,
        name: user.username,
        image: image || null,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': cookieStr,
        },
      }
    );
  } catch (error) {
    console.error('Demo login error:', error);
    return Response.json({ error: 'Gagal login' }, { status: 500 });
  }
};
