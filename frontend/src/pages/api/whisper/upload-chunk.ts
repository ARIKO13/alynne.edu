import type { APIRoute } from 'astro';

const WHISPER_INTERNAL = 'http://localhost:8000';

export const POST: APIRoute = async ({ request }) => {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    // Forward raw body to backend
    const body = await request.arrayBuffer();
    const contentLength = request.headers.get('content-length') || '0';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min per 25MB chunk

    try {
      const res = await fetch(`${WHISPER_INTERNAL}/upload-chunk`, {
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
        return Response.json(
          { error: `Upload chunk error: ${res.status}`, detail: errText.slice(0, 300) },
          { status: res.status }
        );
      }

      const data = await res.json();
      return Response.json(data);
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    console.error('[upload-chunk-proxy] Exception:', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return Response.json({ error: 'Upload chunk failed', detail: msg }, { status: 500 });
  }
};
