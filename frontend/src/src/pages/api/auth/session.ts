import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session) {
    return Response.json({}, { status: 200 });
  }
  return Response.json(session);
};
