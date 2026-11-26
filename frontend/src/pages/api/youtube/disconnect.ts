/**
 * POST /api/youtube/disconnect
 * Lepas koneksi akun YouTube user (hapus refresh token dari D1).
 */
import type { APIRoute } from 'astro';
import { getUidFromRequest, deleteToken } from '@/lib/youtube-auth';

export const POST: APIRoute = async ({ request }) => {
  const uid = await getUidFromRequest(request);
  if (!uid) {
    return Response.json({ error: 'Belum login' }, { status: 401 });
  }
  await deleteToken(uid);
  return Response.json({ success: true });
};
