/**
 * GET /api/youtube/search?q=...
 * Pencarian video musik via YouTube Data API v3 (search.list).
 * Dipanggil server-side dengan access token milik USER yang terhubung —
 * kuota API dibayar dari kuota harian user (bukan kuota developer server).
 * Playback dilakukan klien via official IFrame embed (patuh ToS).
 */
import type { APIRoute } from 'astro';
import { getUidFromRequest, getAccessToken } from '@/lib/youtube-auth';

export const GET: APIRoute = async ({ request, url }) => {
  const uid = await getUidFromRequest(request);
  if (!uid) {
    return Response.json({ error: 'Belum login' }, { status: 401 });
  }

  const q = (url.searchParams.get('q') || '').trim();
  if (!q) {
    return Response.json({ error: 'Kata kunci kosong' }, { status: 400 });
  }

  const accessToken = await getAccessToken(uid);
  if (!accessToken) {
    return Response.json({ error: 'YouTube belum terhubung' }, { status: 403 });
  }

  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoEmbeddable: 'true',
    maxResults: '8',
    q,
  });

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (res.status === 401 || res.status === 403) {
      const detail = await res.json().catch(() => null);
      const msg = detail?.error?.message || 'Akses YouTube ditolak';
      return Response.json({ error: msg, reauth: res.status === 401 }, { status: res.status });
    }
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      const msg = detail?.error?.message || `Search gagal (${res.status})`;
      return Response.json({ error: msg }, { status: res.status });
    }

    const data = await res.json();
    const items = (data.items || [])
      .filter((i: any) => i.id?.videoId)
      .map((i: any) => ({
        id: i.id.videoId as string,
        title: i.snippet?.title as string,
        channel: i.snippet?.channelTitle as string,
        thumb: i.snippet?.thumbnails?.medium?.url as string,
      }));

    return Response.json({ items });
  } catch (err) {
    console.error('[youtube/search] error:', err);
    return Response.json({ error: 'Search gagal' }, { status: 500 });
  }
};
