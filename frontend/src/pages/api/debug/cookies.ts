import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request }) => {
  const cookie = request.headers.get('cookie') || '(none)';
  return Response.json({
    cookies: cookie,
    has_lina_session: cookie.includes('lina-session='),
    all_cookie_names: cookie.split(';').map(s => s.trim().split('=')[0]).filter(Boolean),
  });
};
