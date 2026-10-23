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

const MAX_TRANSCRIPT_CHARS = 50000;  // 1hr lecture ~ 50-80K chars, fits Cohere 256K ctx

const SYSTEM_PROMPT = `You are an educational content splitter for Indonesian lecture transcripts.

TASK: Given a raw STT (speech-to-text) transcript of a lecture, split it into 5-15 semantic chapters based on TOPIC changes.

INPUT CHARACTERISTICS:
- Raw spoken text, may have filler words ("eh", "ya", "kan", "gitu", "oke", "nah")
- May have STT typos / misheard words
- Sentences may be run-on or fragmented
- Speaker may jump between topics

RULES:
1. Each chapter = ONE coherent topic/section (e.g. "Pengertian MSCI", "Sejarah MSCI", "Cara Hitung")
2. Chapter title = concise (max 8 words), describes the topic — like a textbook table of contents
3. Content = the relevant transcript text for that topic
   - CLEAN filler words ("eh", "ya", "kan", "gitu", "nah", "anu", "jadi gini")
   - Fix obvious STT typos based on context
   - PRESERVE original meaning and key terms
   - Don't rewrite to formal — keep spoken tone but readable
4. Order chapters as they appear in the transcript (chronological)
5. Don't skip content — every meaningful part of transcript should be in some chapter
6. Don't duplicate content across chapters
7. Chapter titles in Indonesian (match the transcript language)
8. Aim for 5-15 chapters total — don't over-split (each chapter should have substantive content, min 50 words)

OUTPUT STRICT JSON ONLY (no markdown fences, no prose, no explanation):
{
  "chapters": [
    {"title": "Pengenalan MSCI", "content": "Halo warga CPL. Hari ini kita bahas MSCI..."},
    {"title": "Sejarah MSCI", "content": "Dulu MSCI itu..."},
    ...
  ]
}`;

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
      maxTokens: 12000,  // chapters can be long
      timeout: 180_000,
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
