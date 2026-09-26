import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { learnWord } from '@/lib/learned-word';

/**
 * POST /api/stt/learn-word
 * Body: { word: string, confidence: number, source?: string }
 *
 * Server-side auto-learning system:
 *   - Saat client (use-speech-recognition.ts) detect kata baru dengan confidence
 *     tinggi (2+ kali), panggil API ini.
 *   - Server simpan kata ke D1 table LearnedWord.
 *   - Server expand fonetik (misal "goceh" → ["go ceh", "goceh", "goseh", "gokeh", ...])
 *   - Server merge variations ke phonetic-map.json (file fisik di VPS)
 *   - Server reset dict cache supaya isKnown() pick up kata baru di request berikutnya
 *
 * Authentication:
 *   - User harus login (kalau ga ada session, tetap belajar tapi userId=null)
 *   - Tidak ada role check — semua user boleh contribute ke global dict
 *
 * Response: { learned: boolean, variations: number, word: string, count: number }
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      word?: string;
      confidence?: number;
      source?: string;
    };

    const word = (body.word || '').trim();
    const confidence = Math.max(0, Math.min(1, Number(body.confidence) || 0));
    const source = (body.source || 'webspeech').trim();

    if (!word || word.length < 3) {
      return Response.json({
        error: 'word required (min 3 chars)',
        learned: false,
      }, { status: 400 });
    }

    if (confidence < 0.5) {
      return Response.json({
        error: 'confidence too low (min 0.5)',
        learned: false,
        word,
      }, { status: 400 });
    }

    // Get user ID if logged in (optional)
    let userId: string | null = null;
    const session = await getSession(request);
    if (session?.user?.id) {
      userId = session.user.id;
    }

    const result = await learnWord(word, confidence, userId, source);

    return Response.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[learn-word] error:', error);
    return Response.json({
      error: 'Failed to learn word',
      learned: false,
    }, { status: 500 });
  }
};
