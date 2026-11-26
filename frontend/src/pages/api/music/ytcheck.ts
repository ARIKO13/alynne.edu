/**
 * GET /api/music/ytcheck — pre-check apakah konten YouTube bisa di-embed,
 * lewat endpoint oEmbed publik YouTube (tanpa API key, tanpa kuota).
 *   ?v=<videoId>   → cek video (deleted/privat/embed dilarang → ok:false)
 *   ?list=<listId> → cek playlist biasa (PL…)
 * Mix (RD…) selalu 404 di oEmbed walau embed-nya jalan, jadi dilewati
 * (ok:true tanpa dicek). Gagal jaringan → fail-open (ok:true).
 */
import type { APIRoute } from 'astro';
import { getUidFromRequest } from '@/lib/youtube-auth';

export const GET: APIRoute = async ({ request, url }) => {
  const uid = await getUidFromRequest(request);
  if (!uid) {
    return Response.json({ error: 'Belum login' }, { status: 401 });
  }

  const v = (url.searchParams.get('v') || '').trim();
  const list = (url.searchParams.get('list') || '').trim();

  let target = '';
  if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) {
    target = `https://www.youtube.com/watch?v=${v}`;
  } else if (list && /^PL[A-Za-z0-9_-]{10,60}$/.test(list)) {
    target = `https://www.youtube.com/playlist?list=${list}`;
  } else if (list && /^RD/.test(list)) {
    return Response.json({ ok: true, unchecked: true });
  } else {
    return Response.json({ error: 'Parameter tidak valid' }, { status: 400 });
  }

  try {
    const oe = `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`;
    const res = await fetch(oe, {
      headers: { 'User-Agent': 'ALYNNE_EDU (music feature; https://alynne.my.id)' },
    });
    return Response.json({ ok: res.ok });
  } catch {
    return Response.json({ ok: true, unchecked: true });
  }
};
