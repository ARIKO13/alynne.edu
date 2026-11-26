/**
 * GET /api/youtube/status
 * Status koneksi YouTube user + URL OAuth untuk menghubungkan.
 * Scope: youtube.readonly (baca/search saja). Playback via official embed.
 */
import type { APIRoute } from 'astro';
import { getUidFromRequest, getRefreshToken, YT_SCOPE } from '@/lib/youtube-auth';
import { GOOGLE_CLIENT_ID } from '@/lib/auth';

export const GET: APIRoute = async ({ request }) => {
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('host') || '';
  const baseUrl = `${proto}://${host}`;
  const callbackUri = `${baseUrl}/api/auth/callback`;

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: callbackUri,
    response_type: 'code',
    scope: YT_SCOPE,
    access_type: 'offline',
    prompt: 'consent', // wajib agar refresh_token selalu diberikan
    state: 'youtube-connect',
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  let connected = false;
  try {
    const uid = await getUidFromRequest(request);
    if (uid) {
      connected = !!(await getRefreshToken(uid));
    }
  } catch {}

  return Response.json({ connected, authUrl });
};
