import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { callLLM, extractJson } from '@/lib/gateway-client';

/**
 * POST /api/stt/split-chapters
 *
 * LLM-powered chapter splitting. Replaces the regex-based
 * splitTranscriptIntoChapters() which just took first 7 words as title.
 *
 * Request body:
 *   { transcript: string, maxChapters?: number }
 *
 * Response 200:
 *   { chapters: [{ id, title, content, wordCount }], modelUsed, fallbacksTriggered }
 *   OR { error: 'all-failed' } — caller falls back to regex split
 *
 * Response 401: { error: 'Unauthorized' }
 *
 * Routes to pi-bansos via callLLM('structured-json') → Cohere primary
 * → Nemotron → Poolside (internal fallback chain).
 * No legacy fallback — pi-bansos only (per user explicit requirement).
 */

const MAX_TRANSCRIPT_CHARS = 200000;  // bumped: Cohere 256K ctx, 200K chars safe

const SYSTEM_PROMPT = `You are an educational content splitter for Indonesian lecture transcripts.

TASK: Given a raw STT (speech-to-text) transcript, split it into 5-15 chapters based on TOPIC changes. DO NOT summarize. DO NOT abbreviate.

CRITICAL — DO NOT SUMMARIZE:
- Content of each chapter MUST be the FULL transcript text for that topic, word-for-word
- DO NOT condense, paraphrase, shorten, or summarize
- EVERY sentence in the transcript MUST appear in some chapter (in original form, just cleaned of filler)
- If a topic has 30 sentences in the original transcript, the chapter content MUST contain ~30 sentences
- A chapter with only 2-3 sentences is WRONG — you are splitting, not summarizing
- Expected content length: 200-2000 words per chapter (NOT 30-50 words)

WHAT YOU CAN DO (only these):
1. Remove filler words: "eh", "ya", "kan", "gitu", "oke", "nah", "anu", "jadi gini", "gua bilang", "kayak", repetitions
2. Fix obvious STT typos based on context (e.g. "juice" → "UI" if context is design)
3. Fix basic punctuation + capitalization
4. Group consecutive sentences about the same topic into one chapter

WHAT YOU CANNOT DO:
- DO NOT rewrite sentences to be "more formal" — keep spoken tone
- DO NOT merge multiple sentences into one shorter sentence
- DO NOT skip any sentence — every meaningful sentence must appear
- DO NOT add information not in the original
- DO NOT paraphrase

CHAPTER TITLE:
- Concise (max 8 words), describes the topic — like textbook table of contents
- In Indonesian (match transcript language)
- Example good titles: "Pengertian MSCI", "Sejarah MSCI", "Cara Hitung Free Float"

OUTPUT STRICT JSON ONLY (no markdown fences, no prose, no explanation):
{
  "chapters": [
    {"title": "Pengertian MSCI", "content": "[FULL transcript text for this topic, ALL sentences preserved, only filler removed]"},
    {"title": "Sejarah MSCI", "content": "[FULL transcript text for this topic, ALL sentences preserved, only filler removed]"}
  ]
}

REMEMBER: Content = FULL transcript text per topic (cleaned of filler), NOT a summary.`;

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as { transcript?: string; maxChapters?: number };
    const transcript = (body.transcript || '').trim();

    if (!transcript || transcript.length < 100) {
      return Response.json({ error: 'Transcript too short (min 100 chars)' }, { status: 400 });
    }

    // Truncate to fit context (keep head + tail to preserve start/end)
    const truncated = transcript.length > MAX_TRANSCRIPT_CHARS
      ? transcript.slice(0, MAX_TRANSCRIPT_CHARS * 0.7) + '\n\n[...bagian tengah dipotong...]\n\n' + transcript.slice(-MAX_TRANSCRIPT_CHARS * 0.3)
      : transcript;

    const maxChapters = Math.min(20, Math.max(5, body.maxChapters ?? 15));

    const userPrompt = `Split this lecture transcript into up to ${maxChapters} semantic chapters with proper titles.

TRANSCRIPT:
${truncated}

Output JSON only.`;

    const result = await callLLM('structured-json', SYSTEM_PROMPT, userPrompt, {
      maxTokens: 30000,  // bumped: full content per chapter can be long
      timeout: 300_000,  // 5 min — long content takes longer
      temperature: 0.2,
      endpoint: 'stt/split-chapters',
    });

    if (!result.content) {
      console.error('[split-chapters] callLLM returned null (all 3 pi-bansos models failed)');
      return Response.json({ error: 'all-failed' }, { status: 200 });
    }

    // Parse JSON — be defensive about LLM output quirks
    let parsed: { chapters?: { title?: string; content?: string }[] } = {};
    try {
      parsed = JSON.parse(extractJson(result.content));
    } catch (e) {
      // Try regex extract as last resort
      const match = result.content.match(/"chapters"\s*:\s*\[([\s\S]*?)\]\s*\}?$/);
      if (match) {
        try {
          parsed = JSON.parse('{"chapters":[' + match[1] + ']}');
        } catch { /* leave parsed = {} */ }
      }
    }

    const rawChapters = parsed.chapters || [];
    if (rawChapters.length === 0) {
      console.error('[split-chapters] LLM returned 0 chapters');
      return Response.json({ error: 'no-chapters' }, { status: 200 });
    }

    // Normalize + assign IDs
    const chapters = rawChapters
      .slice(0, maxChapters)
      .map((c, i) => {
        const title = String(c.title || '').trim().slice(0, 100) || `Bab ${i + 1}`;
        const content = String(c.content || '').trim();
        return {
          id: i + 1,
          title,
          content,
          wordCount: content.split(/\s+/).filter(Boolean).length,
        };
      })
      .filter(c => c.content.length > 20);  // skip empty/too-short chapters

    if (chapters.length === 0) {
      console.error('[split-chapters] All chapters had empty content');
      return Response.json({ error: 'no-valid-chapters' }, { status: 200 });
    }

    // Renumber IDs after filter
    chapters.forEach((c, i) => { c.id = i + 1; });

    console.log(`[split-chapters] SUCCESS: ${chapters.length} chapters (model: ${result.modelUsed}, fallbacks: ${result.fallbacksTriggered.length})`);

    return Response.json({
      chapters,
      modelUsed: result.modelUsed,
      fallbacksTriggered: result.fallbacksTriggered.length,
    });
  } catch (e: any) {
    console.error('[split-chapters] fatal:', e);
    return Response.json({ error: 'Generation failed', message: e?.message }, { status: 500 });
  }
};
