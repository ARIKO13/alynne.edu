import type { APIRoute } from "astro";
import { isDriveConnected, getUidFromRequest } from "@/lib/google-drive";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;

export const GET: APIRoute = async ({ request }) => {
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host") || "";
  const baseUrl = `${proto}://${host}`;
  const callbackUri = `${baseUrl}/api/auth/callback`;

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: callbackUri,
    response_type: "code",
    scope: "openid email profile https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
    state: "gdrive",
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  // Try to check if Drive is connected (non-blocking)
  let connected = false;
  try {
    const uid = await getUidFromRequest(request);
    if (uid) {
      connected = await isDriveConnected(uid);
    }
  } catch {}

  // Always return 200 with authUrl so the button works
  return Response.json({ connected, authUrl });
};
