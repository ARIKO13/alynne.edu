/**
 * youtube-auth.ts — Manajemen token YouTube OAuth per-user (disimpan di D1)
 *
 * Scope: youtube.readonly — HANYA baca (search via YouTube Data API v3).
 * Playback video selalu lewat official IFrame embed player (patuh ToS).
 *
 * Flow:
 *   1. User klik "Hubungkan YouTube" → OAuth redirect (state=youtube-connect,
 *      prompt=consent + access_type=offline) → callback /api/auth/callback
 *      menukar code → menyimpan refresh_token di tabel YouTubeToken (D1)
 *   2. refresh_token → access_token server-side (kadaluarsa 1 jam, dicache)
 *   3. access_token → search.list — kuota API dibayar dari kuota harian
 *      milik user sendiri (default 10.000 unit/user/hari), bukan kuota server
 */

import { getSession } from '@/lib/auth';
import { d1 } from '@/lib/d1-client';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const YT_SCOPE = 'openid email profile https://www.googleapis.com/auth/youtube.readonly';

export async function getUidFromRequest(request: Request): Promise<string | null> {
  const session = await getSession(request);
  return session?.user?.id || null;
}

/** Idempotent: pastikan tabel token ada */
async function ensureTable(): Promise<void> {
  try {
    await d1.execute(
      `CREATE TABLE IF NOT EXISTS YouTubeToken (
        uid TEXT PRIMARY KEY,
        refreshToken TEXT NOT NULL,
        accessToken TEXT,
        expiresAt INTEGER,
        updatedAt TEXT NOT NULL
      )`
    );
  } catch (err) {
    console.error('[YouTube] ensureTable failed:', err);
  }
}

export async function storeRefreshToken(uid: string, refreshToken: string): Promise<void> {
  await ensureTable();
  await d1.execute(
    `INSERT INTO YouTubeToken (uid, refreshToken, updatedAt) VALUES (?, ?, datetime('now'))
     ON CONFLICT(uid) DO UPDATE SET refreshToken = ?, updatedAt = datetime('now')`,
    [uid, refreshToken, refreshToken]
  );
}

export async function getRefreshToken(uid: string): Promise<string | null> {
  await ensureTable();
  const rows = await d1.query<{ refreshToken: string }>(
    'SELECT refreshToken FROM YouTubeToken WHERE uid = ?',
    [uid]
  );
  return rows[0]?.refreshToken || null;
}

export async function deleteToken(uid: string): Promise<void> {
  await ensureTable();
  await d1.execute('DELETE FROM YouTubeToken WHERE uid = ?', [uid]);
}

/** Access token valid (refresh kalau perlu, cache di D1) */
export async function getAccessToken(uid: string): Promise<string | null> {
  await ensureTable();
  const rows = await d1.query<{ accessToken: string; expiresAt: number; refreshToken: string }>(
    'SELECT accessToken, expiresAt, refreshToken FROM YouTubeToken WHERE uid = ?',
    [uid]
  );
  const row = rows[0];
  if (!row?.refreshToken) return null;

  // cache masih hidup
  if (row.accessToken && row.expiresAt && Date.now() < row.expiresAt) {
    return row.accessToken;
  }

  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: row.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      console.error('[YouTube] Token refresh failed:', res.status);
      return null;
    }
    const data = await res.json();
    const accessToken = data.access_token;
    const expiresAt = Date.now() + (data.expires_in - 60) * 1000;

    try {
      await d1.execute(
        'UPDATE YouTubeToken SET accessToken = ?, expiresAt = ? WHERE uid = ?',
        [accessToken, expiresAt, uid]
      );
    } catch {}

    return accessToken;
  } catch (err) {
    console.error('[YouTube] Token refresh error:', err);
    return null;
  }
}
