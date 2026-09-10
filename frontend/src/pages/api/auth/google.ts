import type { APIRoute } from 'astro';
import { getGoogleAuthUrl, APP_URL } from '@/lib/auth';

export const GET: APIRoute = ({ request }) => {
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('host') || '';
  const baseUrl = host ? `${proto}://${host}` : APP_URL;
  return Response.redirect(getGoogleAuthUrl(baseUrl));
};
