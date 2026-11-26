/**
 * GET /api/music/audius — musik belajar via Audius (jaringan musik terbuka).
 *   ?q=<kata kunci>    → pencarian lagu via discovery API publik Audius
 *                        (tanpa OAuth, tanpa API key; atribusi app wajib:
 *                        query param app_name di setiap panggilan)
 *   ?stream=<trackId>  → 302 ke endpoint stream resmi Audius; elemen <audio>
 *                        di browser mengikuti redirect ke CDN creator node.
 * Semua request butuh sesi login (uid) supaya route ini tidak menjadi proxy
 * terbuka. Referensi API: https://docs.audius.org/api
 */
import type { APIRoute } from 'astro';
import { getUidFromRequest } from '@/lib/youtube-auth';

const APP_NAME = 'ALYNNE_EDU';
const HOSTS = ['https://api.audius.co', 'https://discoveryprovider.audius.co'];

async function fetchWithFallback(path: string): Promise<any> {
  let lastErr: unknown = null;
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}${path}`, {
        headers: { 'User-Agent': 'ALYNNE_EDU (music feature; https://alynne.my.id)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('Semua host Audius gagal');
}

export const GET: APIRoute = async ({ request, url }) => {
  const uid = await getUidFromRequest(request);
  if (!uid) {
    return Response.json({ error: 'Belum login' }, { status: 401 });
  }

  const streamId = (url.searchParams.get('stream') || '').trim();
  if (streamId) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(streamId)) {
      return Response.json({ error: 'Track ID tidak valid' }, { status: 400 });
    }
    // 302 ke endpoint resmi Audius — <audio> ikut redirect ke CDN
    return new Response(null, {
      status: 302,
      headers: {
        Location: `https://api.audius.co/v1/tracks/${encodeURIComponent(streamId)}/stream?app_name=${APP_NAME}`,
      },
    });
  }

  const q = (url.searchParams.get('q') || '').trim();
  if (!q) {
    return Response.json({ error: 'Kata kunci kosong' }, { status: 400 });
  }

  try {
    const path = `/v1/tracks/search?query=${encodeURIComponent(q)}&limit=12&app_name=${APP_NAME}`;
    const data = await fetchWithFallback(path);
    const items = ((data && data.data) || [])
      .filter((t: any) => t && t.id && !t.is_delete)
      .map((t: any) => ({
        id: t.id as string,
        title: (t.title || '') as string,
        artist: (t.user?.name || t.user?.handle || 'Artis Audius') as string,
        duration: (t.duration || 0) as number,
        artwork: (t.artwork?.['480x480'] || t.artwork?.['150x150'] || '') as string,
      }));
    return Response.json({ items });
  } catch (err) {
    console.error('[music/audius] error:', err);
    return Response.json({ error: 'Audius sedang tidak bisa dihubungi' }, { status: 502 });
  }
};
