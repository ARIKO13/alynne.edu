import type { APIRoute } from 'astro';
import { appendFileSync } from 'node:fs';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const logLine = `\n[${new Date().toISOString()}] ${body.message}\nStack: ${body.stack}\nComponent: ${body.componentStack}\n---`;
    appendFileSync('/tmp/react-error.log', logLine);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false });
  }
};
