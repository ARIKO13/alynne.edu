import type { APIRoute } from 'astro';

const WHISPER_INTERNAL = 'http://localhost:8000';

export const POST: APIRoute = async ({ params, request }) => {
  const jobId = params.id;
  if (!jobId) {
    return Response.json({ error: 'Job ID required' }, { status: 400 });
  }

  try {
    // Parse language from body
    const body = await request.json().catch(() => ({}));
    const language = body.language || 'id';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(`${WHISPER_INTERNAL}/transcribe-chunked/${jobId}?language=${language}`, {
        method: 'POST',
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return Response.json(
          { error: `Transcribe chunked error: ${res.status}`, detail: errText.slice(0, 300) },
          { status: res.status }
        );
      }

      const data = await res.json();
      return Response.json(data);
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    console.error('[transcribe-chunked-proxy] Exception:', e);
    return Response.json({ error: 'Failed', detail: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
};
