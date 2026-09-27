/**
 * gdrive-list.ts — List files in ALYNNE.EDU Drive folder
 */
import type { APIRoute } from 'astro';
import { listDriveFiles, getUidFromRequest } from '@/lib/google-drive';

export const GET: APIRoute = async ({ request }) => {
  const uid = await getUidFromRequest(request);
  if (!uid) return Response.json({ error: 'Not logged in' }, { status: 401 });

  try {
    const files = await listDriveFiles(uid);
    return Response.json({ files });
  } catch (err) {
    return Response.json({ error: 'Failed to list files' }, { status: 500 });
  }
};
