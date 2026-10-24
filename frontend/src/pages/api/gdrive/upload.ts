/**
 * gdrive-upload.ts — Upload file to ALYNNE.EDU Drive folder
 */
import type { APIRoute } from 'astro';
import { uploadDriveFile, getUidFromRequest } from '@/lib/google-drive';

export const POST: APIRoute = async ({ request }) => {
  const uid = await getUidFromRequest(request);
  if (!uid) return Response.json({ error: 'Not logged in' }, { status: 401 });

  try {
    const body = await request.json();
    const { filename, content, mimeType } = body;

    if (!filename || !content) {
      return Response.json({ error: 'filename and content required' }, { status: 400 });
    }

    const result = await uploadDriveFile(uid, filename, content, mimeType || 'text/plain');
    if (!result) {
      return Response.json({ error: 'Upload failed' }, { status: 500 });
    }

    return Response.json({ success: true, ...result });
  } catch (err) {
    return Response.json({ error: 'Upload failed' }, { status: 500 });
  }
};
