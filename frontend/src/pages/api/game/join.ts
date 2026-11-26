/**
 * api/game/join.ts  -  Gabung room via kode/link invite (PUBLIK, tanpa login)
 * POST { code, name, avatar } → { ok, code, pid, name }
 */
import type { APIRoute } from 'astro';
import { joinRoom, gcRooms, getRoom } from '@/lib/game/engine';

const AVATARS = ['🦁','🐼','🦊','🐸','🐨','🦄','🐙','🦉','🐺','🐯','🐵','🐲'];

function sanitizeName(s: string): string {
  const t = String(s || '').replace(/[<>"\\]/g, '').trim().slice(0, 16);
  return t.length >= 2 ? t : 'Pemain';
}

export const POST: APIRoute = async ({ request }) => {
  gcRooms();
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body tidak valid' }, { status: 400 });
  }

  const code = String(body.code || '').trim().toUpperCase();
  const room = getRoom(code);
  if (!room) {
    return Response.json({ error: 'Room tidak ditemukan — cek lagi kode/link-nya.' }, { status: 404 });
  }
  if (room.status !== 'lobby') {
    return Response.json(
      { error: 'Permainan sudah mulai — minta host buat room baru atau rematch.' },
      { status: 409 },
    );
  }

  const player = joinRoom(code, sanitizeName(String(body.name || '')), AVATARS.includes(String(body.avatar)) ? String(body.avatar) : '🐸');
  if (!player) {
    return Response.json({ error: 'Room penuh (maks 12 pemain).' }, { status: 409 });
  }
  return Response.json({ ok: true, code: room.code, pid: player.id, name: player.name });
};
