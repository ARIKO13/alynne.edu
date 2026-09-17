import type { APIRoute } from 'astro';
import { localCorrect, setPersonalDictForRequest } from '@/lib/stt-dictionary';
import { d1 } from '@/lib/d1-client';
import { getSession } from '@/lib/auth';

/**
 * POST /api/stt/fuzzy-correct
 * Body: { text: string, source?: 'webspeech' | 'ocr' | 'cv' | 'audio', personalDict?: string[] }
 *
 * Applies the full localCorrect pipeline + fuzzy matching + phonetic map
 * to text from ANY of the combined STT methods.
 *
 * PERSONAL DICT (auto-learning system):
 *   Client can send personalDict array (list of words the user has
 *   auto-confirmed via repetition). These words are added to the known-words
 *   set for THIS request only, so they skip fuzzy matching.
 *
 * AUTO-LOGGING: When unknownWords > 0 (the system couldn't recognize some
 * words), the raw text is logged to the `STTFailure` D1 table for later
 * analysis. The user can view these failures in the admin panel and later
 * connect a spreadsheet sync.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      text?: string;
      source?: string;
      personalDict?: string[];
    };

    const rawText = (body.text || '').trim();
    if (!rawText) {
      return Response.json({
        corrected: '',
        corrections: [],
        stats: null,
        needsLLM: false,
      });
    }

    // Apply personal dict for this request (auto-learning system)
    // Words in personalDict will be treated as "known" by isKnown()
    setPersonalDictForRequest(body.personalDict);

    const result = localCorrect(rawText);

    // ── Auto-log failures ──
    // When there are unknown words, log the raw text to D1 for later analysis.
    // This helps the user build a dataset of what the STT system can't recognize,
    // so they can add corrections to the dictionary.
    if (result.stats.unknownWords > 0 || result.needsLLM) {
      try {
        // Extract the actual unknown words from the text
        const words = rawText.toLowerCase()
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 2);
        // Filter to only unknown words (skip numbers + very short)
        const unknownWords = words.filter(w => !/^\d+$/.test(w) && w.length > 2);

        let userId: string | null = null;
        const session = await getSession(request);
        if (session?.user?.id) userId = session.user.id;

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const unknownStr = unknownWords.slice(0, 20).join(','); // cap at 20 words
        const unknownCount = unknownWords.length;

        // Create table if not exists
        await d1.execute(`
          CREATE TABLE IF NOT EXISTS STTFailure (
            id TEXT PRIMARY KEY,
            rawText TEXT NOT NULL,
            correctedText TEXT,
            source TEXT,
            unknownWords TEXT,
            unknownCount INTEGER DEFAULT 0,
            userId TEXT,
            createdAt TEXT NOT NULL
          )
        `).catch(() => {});

        await d1.execute(
          `INSERT INTO STTFailure (id, rawText, correctedText, source, unknownWords, unknownCount, userId, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, rawText, result.text, body.source || 'unknown',
           unknownStr, unknownCount, userId, now]
        );
      } catch (logErr) {
        // Don't fail the request if logging fails
        console.warn('[fuzzy-correct] Failed to log failure:', logErr);
      }
    }

    return Response.json({
      corrected: result.text,
      needsLLM: result.needsLLM,
      llmReason: result.llmReason,
      stats: result.stats,
      source: body.source || 'unknown',
      originalLength: rawText.length,
      correctedLength: result.text.length,
    });
  } catch (error) {
    console.error('[fuzzy-correct] error:', error);
    return Response.json(
      {
        corrected: '',
        error: error instanceof Error ? error.message : 'Fuzzy correction failed',
      },
      { status: 500 }
    );
  }
};

