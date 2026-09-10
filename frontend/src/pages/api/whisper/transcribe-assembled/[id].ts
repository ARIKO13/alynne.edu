import type { APIRoute } from 'astro';

const WHISPER_INTERNAL = 'http://localhost:8000';

export const POST: APIRoute = async ({ params, request }) => {
  const uploadJobId = params.id;
  if (!uploadJobId) {
    return Response.json({ error: 'Upload job ID required' }, { status: 400 });
  }

  const language = new URL(request.url).searchParams.get('language') || 'id';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60 * 60 * 1000);

  try {
    const res = await fetch(`${WHISPER_INTERNAL}/transcribe-assembled/${uploadJobId}?language=${language}`, {
      method: 'POST',
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return Response.json(
        { error: `SSE transcribe error: ${res.status}`, detail: errText.slice(0, 300) },
        { status: res.status }
      );
    }

    return new Response(res.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
};
