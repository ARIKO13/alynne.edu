import type { APIRoute } from 'astro';
import { readFileSync, unlinkSync } from 'node:fs';

export const GET: APIRoute = async () => {
  try {
    const content = readFileSync('/tmp/react-error.log', 'utf-8');
    try { unlinkSync('/tmp/react-error.log'); } catch {}
    return new Response(content, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch {
    return Response.json({ empty: true });
  }
};
