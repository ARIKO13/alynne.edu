import type { APIRoute } from 'astro';

const WHISPER_INTERNAL = 'http://localhost:8000';

export const POST: APIRoute = async ({ request }) => {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    const body = await request.arrayBuffer();
    const contentLength = request.headers.get('content-length') || '0';

    // 5 min timeout per 25MB chunk (load whisper ~15s + transcribe ~60s + overhead)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    try {
      const res = await fetch(`${WHISPER_INTERNAL}/transcribe-chunk-stream`, {
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
          { error: `Stream transcribe error: ${res.status}`, detail: errText.slice(0, 300) },
          { status: res.status }
        );
      }

      const data = await res.json();
      return Response.json(data);
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    console.error('[transcribe-chunk-stream-proxy] Exception:', e);
    return Response.json({ error: 'Failed', detail: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
};
