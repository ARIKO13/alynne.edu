import type { APIRoute } from 'astro';
import { localCorrect, setPersonalDictForRequest } from '@/lib/stt-dictionary';
import { contextAwareCorrect } from '@/lib/stt-context-corrector';
import { d1 } from '@/lib/d1-client';
import { getSession } from '@/lib/auth';

/**
 * POST /api/stt/fuzzy-correct
 * Body: {
 *   text: string,
 *   source?: 'webspeech' | 'ocr' | 'cv' | 'audio',
 *   personalDict?: string[],
 *   enableContextCorrect?: boolean  (default true)
 * }
 *
 * Pipeline correction (3 layers, run sequentially):
 *
 *   1. localCorrect (existing)
 *      - Phrase map (stock tickers, multi-word fixes)
 *      - Slang → formal (e.g. "lebay" → "berlebihan")
 *      - Direct fixes (e.g. "imformasi" → "informasi")
 *      - Context homophones (e.g. "kekerasan" → "kecerdasan" in AI context)
 *      - Phonetic matching (Double Metaphone for stock terms)
 *      - Fuzzy matching (Levenshtein for typos)
 *
 *   2. contextAwareCorrect (NEW - Layer 3)
 *      - For remaining unknown tokens, look at co-occurrence stats
 *      - Disambiguate pairs like "produksi" vs "solusi" based on context
 *      - Track 3 words before + 3 after as observations
 *      - Vote-based: corrections from user_corrections table override
 *      - Records observations back to word_cooccurrence (feedback loop)
 *
 *   3. Auto-log to STTFailure (existing)
 *      - Logs raw + corrected text to D1 for admin review
 *
 * AUTH: optional (userId tracked if logged in)
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      text?: string;
      source?: string;
      personalDict?: string[];
      enableContextCorrect?: boolean;
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

    // Get user ID if logged in (for context-aware corrector vote tracking)
    let userId: string | null = null;
    const session = await getSession(request);
    if (session?.user?.id) userId = session.user.id;

    // ─── LAYER 1: localCorrect (existing) ───
    // Apply personal dict for this request
    setPersonalDictForRequest(body.personalDict);
    const result = localCorrect(rawText);

    let textAfterLayer1 = result.text;
    const contextCorrections: Array<{
      original: string;
      corrected: string;
      score: number;
      confident: boolean;
    }> = [];

    // ─── LAYER 2: contextAwareCorrect (NEW) ───
    // Run after localCorrect to handle remaining ambiguities
    // e.g. "produksi" vs "solusi" - localCorrect's ctxHomophones rule only
    // catches specific known pairs. contextAwareCorrect uses co-occurrence
    // stats to pick the right one based on actual user behavior.
    const enableContext = body.enableContextCorrect !== false; // default true
    if (enableContext) {
      try {
        const ctxResult = contextAwareCorrect(textAfterLayer1, {
          userId: userId || undefined,
          recordObservations: true,
          personalDict: body.personalDict
            ? new Set(body.personalDict.map(w => w.toLowerCase()))
            : new Set<string>(),
        });

        if (ctxResult.text && ctxResult.text !== textAfterLayer1) {
          textAfterLayer1 = ctxResult.text;
        }

        contextCorrections.push(...ctxResult.corrections.map(c => ({
          original: c.original,
          corrected: c.corrected,
          score: c.score,
          confident: c.confident,
        })));

        if (ctxResult.corrections.length > 0) {
          console.log(`[fuzzy-correct] Context-aware: ${ctxResult.corrections.length} corrections applied, ${ctxResult.observed} observations recorded`);
        }
      } catch (ctxErr) {
        // Don't fail the request if context-aware correction fails
        console.warn('[fuzzy-correct] Context-aware correction failed:', ctxErr);
      }
    }

    // ─── Layer 3: Auto-log failures to D1 ───
    if (result.stats.unknownWords > 0 || result.needsLLM) {
      try {
        const words = rawText.toLowerCase()
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 2);
        const unknownWords = words.filter(w => !/^\d+$/.test(w) && w.length > 2);

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const unknownStr = unknownWords.slice(0, 20).join(',');
        const unknownCount = unknownWords.length;

        // DISABLED: STT failure logging to D1 (was filling up database quota).
        // Failures now logged to client localStorage only.
        console.log('[fuzzy-correct] Skipped D1 insert (disabled). unknownCount:', unknownCount);
      } catch (logErr) {
        console.warn('[fuzzy-correct] Log block skipped:', logErr);
      }
    }

    return Response.json({
      corrected: textAfterLayer1,
      needsLLM: result.needsLLM,
      llmReason: result.llmReason,
      stats: result.stats,
      contextCorrections: contextCorrections.length > 0 ? contextCorrections : undefined,
      source: body.source || 'unknown',
      originalLength: rawText.length,
      correctedLength: textAfterLayer1.length,
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
