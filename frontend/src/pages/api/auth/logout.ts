import type { APIRoute } from 'astro';
import { COOKIE_NAME, APP_URL } from '@/lib/auth';

export const GET: APIRoute = async () => {
  const isSecure = APP_URL.startsWith('https');
  const cookieDomain = APP_URL.includes('linalearning') ? '; Domain=linalearning.my.id' : '';

  // Clear lina-session cookie
  const clearCookie = `${COOKIE_NAME}=; Path=/; HttpOnly${isSecure ? '; Secure' : ''}; SameSite=Lax; Max-Age=0${cookieDomain}`;

  // Also clear any leftover NextAuth cookies
  const clearOldCookies = [
    'next-auth.session-token=; Path=/; Max-Age=0' + cookieDomain,
    '__Host-authjs.session-token=; Path=/; Max-Age=0' + cookieDomain,
    '__Host-authjs.csrf-token=; Path=/; Max-Age=0' + cookieDomain,
    'authjs.csrf-token=; Path=/; Max-Age=0' + cookieDomain,
    'authjs.session-token=; Path=/; Max-Age=0' + cookieDomain,
  ];

  return new Response(null, {
    status: 302,
    headers: {
      'Location': APP_URL,
      'Set-Cookie': [clearCookie, ...clearOldCookies].join(', '),
    },
  });
};
