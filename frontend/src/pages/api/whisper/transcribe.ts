import type { APIRoute } from 'astro';

const WHISPER_INTERNAL = 'http://localhost:8000/transcribe';

export const POST: APIRoute = async ({ request }) => {
  try {
    // Get raw body as blob — DON'T parse FormData (Astro 5 has issue with multi-level encoding)
    const contentType = request.headers.get('content-type') || '';
    const contentLength = request.headers.get('content-length') || '0';

    if (!contentType.includes('multipart/form-data')) {
      return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    console.log(`[whisper-proxy] Forwarding raw body (${contentLength} bytes) to whisper backend...`);

    // Forward raw body (no FormData parsing = no encoding issues)
    const body = await request.arrayBuffer();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30 * 60 * 1000); // 30 min for large uploads

    try {
      const res = await fetch(WHISPER_INTERNAL, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'Content-Length': contentLength,
        },
        body: body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`[whisper-proxy] Error: ${res.status} — ${errText.slice(0, 200)}`);
        return Response.json(
          { error: `Whisper error: ${res.status}`, detail: errText.slice(0, 500) },
          { status: res.status }
        );
      }

      const data = await res.json();
      console.log(`[whisper-proxy] Job submitted: ${data.job_id || 'sync'}, status: ${data.status}`);
      return Response.json(data);
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    console.error('[whisper-proxy] Exception:', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg.includes('abort')) {
      return Response.json({ error: 'Upload timeout (30 min max)' }, { status: 504 });
    }
    return Response.json({ error: 'Whisper proxy failed', detail: msg }, { status: 500 });
  }
};
