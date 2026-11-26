/**
 * api/game/state.ts  -  Polling status room (PUBLIK)
 * GET /api/game/state?code=ABCD&pid=xxx → snapshot publik (tanpa kunci soal
 * kecuali fase reveal/finished). Transisi fase ditangani tickRoom di sini,
 * jadi client cukup jajal tiap ~900 ms.
 */
import type { APIRoute } from 'astro';
import { getRoom, gcRooms, tickRoom, touchPlayer, pubRoom } from '@/lib/game/engine';

export const GET: APIRoute = async ({ url }) => {
  const code = (url.searchParams.get('code') || '').trim().toUpperCase();
  const pid = (url.searchParams.get('pid') || '').trim();
  const room = getRoom(code);
  if (!room) {
    return Response.json({ error: 'ROOM_HILANG' }, { status: 404 });
  }
  gcRooms();
  tickRoom(room);
  if (pid) touchPlayer(room, pid);
  return Response.json(pubRoom(room, pid), {
    headers: { 'Cache-Control': 'no-store' },
  });
};
