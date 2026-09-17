import type { APIRoute } from 'astro';

/**
 * Sync transcribe proxy — Astro route to Python backend `/transcribe/sync`.
 *
 * This route is the missing piece that caused the "Entire Screen stuck" bug.
 * The frontend hook (`use-speech-recognition.ts`) calls this path for the
 * system-audio rolling recorder; without this file, the fetch returned 404,
 * the audio was captured but never transcribed, and the UI sat waiting
 * forever for a response that would never come.
 *
 * Pattern mirrors `pages/api/whisper/transcribe.ts` (the async variant).
 * Backend blocks until the transcription is done (or up to the timeout
 * passed in the form, default 1 hour), then returns the result directly.
 */
const WHISPER_SYNC_INTERNAL = 'http://localhost:8000/transcribe/sync';

export const POST: APIRoute = async ({ request }) => {
  try {
    const contentType = request.headers.get('content-type') || '';
    const contentLength = request.headers.get('content-length') || '0';

    if (!contentType.includes('multipart/form-data')) {
      return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    // Forward raw body without re-parsing FormData (Astro 5 has issues with
    // nested multipart). The backend will parse it itself.
    const body = await request.arrayBuffer();

    // Backend default timeout is 3600s; we give the client a bit more
    // headroom so we don't abort before the backend does.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 65 * 60 * 1000);

    try {
      const res = await fetch(WHISPER_SYNC_INTERNAL, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'Content-Length': contentLength,
        },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(
          `[whisper-sync-proxy] Error: ${res.status} — ${errText.slice(0, 200)}`
        );
        return Response.json(
          {
            error: `Whisper sync error: ${res.status}`,
            detail: errText.slice(0, 500),
          },
          { status: res.status }
        );
      }

      const data = await res.json();
      // Backend returns: { status: "completed", result: { text: "..." }, ... }
      console.log(
        `[whisper-sync-proxy] Job done: status=${data.status}, chars=${(data.result?.text || data.text || '').length}`
      );
      return Response.json(data);
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    console.error('[whisper-sync-proxy] Exception:', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg.includes('abort')) {
      return Response.json(
        { error: 'Transcribe timeout (backend never returned)' },
        { status: 504 }
      );
    }
    return Response.json(
      { error: 'Whisper sync proxy failed', detail: msg },
      { status: 500 }
    );
  }
};
