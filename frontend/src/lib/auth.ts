/**
 * Simple JWT-based Google OAuth (replaces NextAuth)
 * Much lighter weight - no NextAuth dependency needed.
 */
import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || '0pGDBWqT4l_Q41ueiLPKIr48mMRMjADpjF7L7J2Y0QM'
);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const APP_URL = process.env.NEXTAUTH_URL || 'https://linalearning.my.id';

export interface SessionUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

export interface Session {
  user: SessionUser;
  expires: string;
}

const COOKIE_NAME = 'lina-session';

/** Create JWT token for a user */
export async function createToken(user: SessionUser): Promise<string> {
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(JWT_SECRET);
}

/** Verify JWT token */
export async function verifyToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      id: payload.id as string,
      name: (payload.name as string) || null,
      email: (payload.email as string) || null,
      image: (payload.image as string) || null,
    };
  } catch {
    return null;
  }
}

/** Get session from request cookies */
export async function getSession(request: Request): Promise<Session | null> {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;

  const user = await verifyToken(match[1]);
  if (!user) return null;

  return { user, expires: '' };
}

/** Exchange Google auth code for user info */
export async function exchangeGoogleCode(code: string, redirectUri?: string): Promise<SessionUser | null> {
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const uri = redirectUri || `${APP_URL}/api/auth/callback`;

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: uri,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    console.error('Google token exchange failed:', await res.text());
    return null;
  }

  const { access_token } = await res.json();

  // Fetch user info from Google
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!userRes.ok) {
    console.error('Google user info failed:', await userRes.text());
    return null;
  }

  const googleUser = await userRes.json();
  return {
    id: googleUser.id,
    name: googleUser.name,
    email: googleUser.email,
    image: googleUser.picture,
  };
}

/** Get Google OAuth authorization URL */
export function getGoogleAuthUrl(baseUrl?: string): string {
  const base = baseUrl || APP_URL;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${base}/api/auth/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account', // show account picker but don't force consent every time
    access_type: 'offline',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export { COOKIE_NAME, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL };