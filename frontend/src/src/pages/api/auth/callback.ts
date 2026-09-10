import type { APIRoute } from 'astro';
import { exchangeGoogleCode, createToken, COOKIE_NAME, APP_URL } from '@/lib/auth';
import { db } from '@/lib/db';
import { subscriptionDb } from '@/lib/subscription-db';

export const GET: APIRoute = async ({ url, request }) => {
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('host') || '';
  const baseUrl = host ? `${proto}://${host}` : APP_URL;
  const callbackUri = `${baseUrl}/api/auth/callback`;

  console.log('[callback] hit, code=' + (code ? 'yes' : 'no') + ', error=' + (error || 'none') + ', host=' + host);

  if (error) {
    console.error('[callback] Google OAuth error:', error);
    return Response.redirect(`${baseUrl}/?auth=error`);
  }

  if (!code) {
    console.log('[callback] no code, redirecting');
    return Response.redirect(`${baseUrl}/?auth=no_code`);
  }

  const user = await exchangeGoogleCode(code, callbackUri);
  console.log('[callback] exchangeGoogleCode result:', user ? `id=${user.id} email=${user.email}` : 'null');
  
  if (!user) {
    return Response.redirect(`${baseUrl}/?auth=failed`);
  }

  // Save user to D1
  try {
    const existing = await db.user.findUnique({ where: { googleId: user.id } });
    if (!existing) {
      const byEmail = await db.user.findUnique({ where: { email: user.email || '' } });
      if (byEmail) {
        await db.user.update({
          where: { id: byEmail.id },
          data: { googleId: user.id, image: user.image },
        });
      } else {
        await db.user.create({
          data: {
            id: user.id,
            googleId: user.id,
            email: user.email || '',
            name: user.name || 'Player',
            image: user.image,
          },
        });
      }

      // Create trial subscription for NEW users
      try {
        const existingSub = await subscriptionDb.findByUserId(user.id);
        if (!existingSub) {
          const sub = await subscriptionDb.createTrial(user.id);
          console.log('[callback] trial subscription created for', user.email, 'trial ends:', sub.trialEndsAt);
        }
      } catch (subErr) {
        console.error('[callback] subscription creation error (non-blocking):', subErr);
      }
    }
  } catch (dbError) {
    console.error('[callback] DB error (non-blocking):', dbError);
  }

  // Create JWT and build Set-Cookie header
  const token = await createToken(user);
  console.log('[callback] token created, length=' + token.length);

  const cookieStr = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`;

  return new Response(null, {
    status: 302,
    headers: {
      'Location': baseUrl,
      'Set-Cookie': cookieStr,
    },
  });
};
