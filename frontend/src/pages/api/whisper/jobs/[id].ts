import type { APIRoute } from 'astro';

const WHISPER_INTERNAL = 'http://localhost:8000/jobs';

// GET /api/whisper/jobs/{id} — poll job status
export const GET: APIRoute = async ({ params }) => {
  const jobId = params.id;
  if (!jobId) {
    return Response.json({ error: 'Job ID required' }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(`${WHISPER_INTERNAL}/${jobId}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return Response.json(
        { error: `Job fetch error: ${res.status}`, detail: errText.slice(0, 300) },
        { status: res.status }
      );
    }

    const data = await res.json();
    return Response.json(data);
  } catch (e) {
    console.error('[whisper-jobs-proxy] Exception:', e);
    return Response.json(
      { error: 'Failed to fetch job status', detail: e instanceof Error ? e.message : 'unknown' },
      { status: 500 }
    );
  }
};

// DELETE /api/whisper/jobs/{id} — cancel job
export const DELETE: APIRoute = async ({ params }) => {
  const jobId = params.id;
  if (!jobId) {
    return Response.json({ error: 'Job ID required' }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(`${WHISPER_INTERNAL}/${jobId}`, {
      method: 'DELETE',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return Response.json(
        { error: `Cancel error: ${res.status}`, detail: errText.slice(0, 300) },
        { status: res.status }
      );
    }

    const data = await res.json();
    return Response.json(data);
  } catch (e) {
    console.error('[whisper-jobs-proxy] Cancel exception:', e);
    return Response.json(
      { error: 'Failed to cancel job', detail: e instanceof Error ? e.message : 'unknown' },
      { status: 500 }
    );
  }
};
