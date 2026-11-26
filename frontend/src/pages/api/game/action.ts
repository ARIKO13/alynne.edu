/**
 * api/game/action.ts  -  Aksi pemain/host (PUBLIK)
 * POST { code, pid, action } + payload:
 *   start    (host)   mulai → countdown
 *   answer   {qi, c}  jawab soal (feedback langsung: benar/pts)
 *   advance  (host)   paksa lanjut dari reveal
 *   restart  (host)   rematch pakai soal yang sama
 *   leave             keluar room
 */
import type { APIRoute } from 'astro';
import {
  getRoom, gcRooms, tickRoom, touchPlayer,
  startGame, restartGame, forceAdvance, leaveRoom, submitAnswer,
} from '@/lib/game/engine';

export const POST: APIRoute = async ({ request }) => {
  gcRooms();
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body tidak valid' }, { status: 400 });
  }

  const room = getRoom(String(body.code || ''));
  if (!room) return Response.json({ error: 'ROOM_HILANG' }, { status: 404 });
  const pid = String(body.pid || '');
  const action = String(body.action || '');

  tickRoom(room);
  touchPlayer(room, pid);

  switch (action) {
    case 'start':
      if (!startGame(room, pid)) {
        return Response.json({ error: 'Hanya host yang bisa mulai (dan saat masih di lobby).' }, { status: 403 });
      }
      return Response.json({ ok: true });
    case 'answer': {
      const qi = Number(body.qi);
      const c = Number(body.c);
      const res = submitAnswer(room, pid, qi, c);
      if (!res.ok) {
        return Response.json({ ok: false, error: `Jawaban ditolak (${res.reason}).` }, { status: 409 });
      }
      return Response.json({ ok: true, correct: res.correct, pts: res.pts, streak: res.streak });
    }
    case 'advance':
      if (!forceAdvance(room, pid)) {
        return Response.json({ error: 'Tidak bisa lanjut sekarang.' }, { status: 409 });
      }
      return Response.json({ ok: true });
    case 'restart':
      if (!restartGame(room, pid)) {
        return Response.json({ error: 'Rematch hanya untuk host, saat game selesai.' }, { status: 403 });
      }
      return Response.json({ ok: true });
    case 'leave':
      leaveRoom(room, pid);
      return Response.json({ ok: true });
    default:
      return Response.json({ error: 'Aksi tidak dikenal' }, { status: 400 });
  }
};
