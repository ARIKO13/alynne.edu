/**
 * google-drive.ts — Google Drive API client
 *
 * Uses existing Google OAuth credentials to access Drive.
 * Scope: drive.file (only files created by ALYNNE, not all Drive)
 *
 * Flow:
 *   1. User login → get refresh_token (stored in D1)
 *   2. refresh_token → access_token (server-side, 1hr expiry)
 *   3. access_token → Drive API calls
 *
 * Creates "ALYNNE.EDU" folder in user's Drive root.
 * All files stored inside that folder.
 */

import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { d1 } from '@/lib/d1-client';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

const DRIVE_FOLDER_NAME = 'ALYNNE.EDU';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

// ── Token Management ──

interface StoredToken {
  uid: string;
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
}

/**
 * Get refresh token from D1 for current user.
 */
async function getRefreshToken(uid: string): Promise<string | null> {
  try {
    const rows = await d1.query<{ refreshToken: string }>(
      'SELECT refreshToken FROM GDriveToken WHERE uid = ?',
      [uid]
    );
    return rows[0]?.refreshToken || null;
  } catch {
    // Table might not exist yet
    return null;
  }
}

/**
 * Store refresh token in D1.
 */
export async function storeRefreshToken(uid: string, refreshToken: string): Promise<void> {
  try {
    // Create table if not exists
    await d1.execute(`
      CREATE TABLE IF NOT EXISTS GDriveToken (
        uid TEXT PRIMARY KEY,
        refreshToken TEXT NOT NULL,
        accessToken TEXT,
        expiresAt INTEGER,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).catch(() => {});

    // Upsert
    await d1.execute(
      `INSERT INTO GDriveToken (uid, refreshToken, updatedAt) VALUES (?, ?, datetime('now'))
       ON CONFLICT(uid) DO UPDATE SET refreshToken = ?, updatedAt = datetime('now')`,
      [uid, refreshToken, refreshToken]
    );
  } catch (err) {
    console.error('[GDrive] Store token error:', err);
  }
}

/**
 * Get valid access token (refresh if needed).
 */
async function getAccessToken(uid: string): Promise<string | null> {
  const refreshToken = await getRefreshToken(uid);
  if (!refreshToken) return null;

  // Check if we have a cached valid token
  try {
    const rows = await d1.query<{ accessToken: string; expiresAt: number }>(
      'SELECT accessToken, expiresAt FROM GDriveToken WHERE uid = ?',
      [uid]
    );
    const cached = rows[0];
    if (cached?.accessToken && cached.expiresAt && Date.now() < cached.expiresAt - 60000) {
      return cached.accessToken;
    }
  } catch {}

  // Refresh token
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      console.error('[GDrive] Token refresh failed:', res.status);
      return null;
    }

    const data = await res.json();
    const accessToken = data.access_token;
    const expiresAt = Date.now() + (data.expires_in - 60) * 1000;

    // Cache in D1
    try {
      await d1.execute(
        'UPDATE GDriveToken SET accessToken = ?, expiresAt = ? WHERE uid = ?',
        [accessToken, expiresAt, uid]
      );
    } catch {}

    return accessToken;
  } catch (err) {
    console.error('[GDrive] Token refresh error:', err);
    return null;
  }
}

// ── Drive API ──

/**
 * Get or create ALYNNE.EDU folder in user's Drive.
 */
async function getOrCreateFolder(accessToken: string): Promise<string | null> {
  // Search for existing folder
  const searchRes = await fetch(
    `${DRIVE_API}/files?q=name='${DRIVE_FOLDER_NAME}'+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData.files?.length > 0) {
      return searchData.files[0].id;
    }
  }

  // Create folder
  const createRes = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (createRes.ok) {
    const createData = await createRes.json();
    return createData.id;
  }

  return null;
}

/**
 * List files in ALYNNE.EDU folder.
 */
export async function listDriveFiles(uid: string): Promise<Array<{
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size: string;
}>> {
  const accessToken = await getAccessToken(uid);
  if (!accessToken) return [];

  const folderId = await getOrCreateFolder(accessToken);
  if (!folderId) return [];

  const res = await fetch(
    `${DRIVE_API}/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,modifiedTime,size)&orderBy=modifiedTime desc`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) return [];
  const data = await res.json();
  return data.files || [];
}

/**
 * Upload file to ALYNNE.EDU folder.
 */
export async function uploadDriveFile(
  uid: string,
  filename: string,
  content: string,
  mimeType: string = 'text/plain'
): Promise<{ id: string; name: string } | null> {
  const accessToken = await getAccessToken(uid);
  if (!accessToken) return null;

  const folderId = await getOrCreateFolder(accessToken);
  if (!folderId) return null;

  // Use multipart upload
  const metadata = {
    name: filename,
    parents: [folderId],
  };

  const boundary = '-------314159265358979323846';
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    '',
    content,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary="${boundary}"`,
    },
    body,
  });

  if (!res.ok) {
    console.error('[GDrive] Upload failed:', res.status);
    return null;
  }

  const data = await res.json();
  return { id: data.id, name: data.name };
}

/**
 * Download file from Drive.
 */
export async function downloadDriveFile(uid: string, fileId: string): Promise<string | null> {
  const accessToken = await getAccessToken(uid);
  if (!accessToken) return null;

  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) return null;
  return await res.text();
}

/**
 * Delete file from Drive.
 */
export async function deleteDriveFile(uid: string, fileId: string): Promise<boolean> {
  const accessToken = await getAccessToken(uid);
  if (!accessToken) return false;

  const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return res.ok;
}

/**
 * Check if user has Drive connected.
 */
export async function isDriveConnected(uid: string): Promise<boolean> {
  const token = await getRefreshToken(uid);
  return !!token;
}

// ── Helper: get uid from request ──

export async function getUidFromRequest(request: Request): Promise<string | null> {
  const session = await getSession(request);
  return session?.user?.id || null;
}
