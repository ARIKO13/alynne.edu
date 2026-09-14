import type { APIRoute } from 'astro';
import { localCorrect } from '@/lib/stt-dictionary';

/**
 * POST /api/stt/fuzzy-correct
 * Body: { text: string, source?: 'webspeech' | 'ocr' | 'cv' | 'audio' }
 *
 * Applies the full localCorrect pipeline (slang → direct fixes → homophones
 * → multi-word phrases → fuzzy Levenshtein for typos) to text from ANY of
 * the combined STT methods:
 *
 *   - Web Speech API output (live mic transcription)
 *   - OCR output (tesseract.js text from screen frames)
 *   - CV tags (no correction needed — deterministic)
 *   - Web Audio API (no text output — produces audio levels only)
 *
 * Returns:
 *   {
 *     corrected: string,           — final corrected text
 *     corrections: [{from, to, method}],  — list of changes (optional)
 *     stats: { fuzzyFixed, slangFixed, ... },
 *     needsLLM: boolean,           — true if too many unknown words remain
 *   }
 *
 * This endpoint is called from:
 *   - use-screen-cv.ts OCR onOcrText callback (every 5s during screen capture)
 *   - use-speech-recognition.ts Web Speech onresult (every interim text)
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      text?: string;
      source?: string;
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

    const result = localCorrect(rawText);

    return Response.json({
      corrected: result.text,
      needsLLM: result.needsLLM,
      llmReason: result.llmReason,
      stats: result.stats,
      source: body.source || 'unknown',
      // Length of original vs corrected (for UI debug)
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
