import type { APIRoute } from 'astro';
import { exchangeGoogleCode, createToken, COOKIE_NAME, APP_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '@/lib/auth';
import { storeRefreshToken } from '@/lib/youtube-auth';
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

  // ── state=youtube-connect: hubungkan akun YouTube user (bukan login app) ──
  // Menukar code → refresh_token (offline), menyimpan per-user di D1, balik ke /edu.
  const state = url.searchParams.get('state');
  if (state === 'youtube-connect') {
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: callbackUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) {
        console.error('[callback][youtube] token exchange failed:', await tokenRes.text());
        return Response.redirect(`${baseUrl}/edu?yt=error`);
      }
      const tok = await tokenRes.json();
      const refreshToken = tok.refresh_token as string | undefined;
      const ytAccess = tok.access_token as string;

      if (!refreshToken) {
        // Tanpa refresh_token kuota per-user tidak bisa diperpanjang
        return Response.redirect(`${baseUrl}/edu?yt=no_refresh`);
      }

      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${ytAccess}` },
      });
      if (!userRes.ok) {
        return Response.redirect(`${baseUrl}/edu?yt=error`);
      }
      const gUser = await userRes.json();
      await storeRefreshToken(gUser.id, refreshToken);
      console.log('[callback][youtube] connected uid=' + gUser.id);
      return Response.redirect(`${baseUrl}/edu?yt=1`);
    } catch (err) {
      console.error('[callback][youtube] error:', err);
      return Response.redirect(`${baseUrl}/edu?yt=error`);
    }
  }

  const user = await exchangeGoogleCode(code, callbackUri);
  console.log('[callback] exchangeGoogleCode result:', user ? `id=${user.id} email=${user.email}` : 'null');
  
  if (!user) {
    return Response.redirect(`${baseUrl}/?auth=failed`);
  }

  // Save user to D1
  try {
    const existing = await db.user.findUnique({ where: { uid: user.id } });
    if (!existing) {
      const byEmail = await db.user.findUnique({ where: { gmail: user.email || '' } });
      if (byEmail) {
        await db.user.update({
          where: { id: byEmail.uid },
          data: { username: user.name || byEmail.username },
        });
      } else {
        await db.user.create({
          data: {
            uid: user.id,
            gmail: user.email || '',
            username: user.name || 'Player',
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
