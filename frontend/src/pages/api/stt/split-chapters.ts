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

// ── Non-streaming prompt: output single JSON object with chapters array ──
const SYSTEM_PROMPT = `You are an educational content splitter for Indonesian lecture transcripts.

TASK: Given a raw STT transcript, split it into 5-15 chapters based on TOPIC changes. DO NOT summarize. DO NOT abbreviate.

CRITICAL — DO NOT SUMMARIZE:
- Content of each chapter MUST be the FULL transcript text for that topic, word-for-word
- DO NOT condense, paraphrase, shorten, or summarize
- EVERY sentence in the transcript MUST appear in some chapter
- A chapter with only 2-3 sentences is WRONG
- Expected content length: 200-2000 words per chapter

WHAT YOU CAN DO (only these):
1. Remove filler words: "eh", "ya", "kan", "gitu", "oke", "nah", "anu"
2. Fix obvious STT typos
3. Fix basic punctuation
4. Group consecutive sentences about same topic into one chapter

CHAPTER TITLE:
- Concise (max 8 words), describes the topic — like textbook table of contents
- In Indonesian

OUTPUT STRICT JSON ONLY (no markdown fences, no prose, no explanation):
{
  "chapters": [
    {"title": "Pengertian MSCI", "content": "[FULL transcript text for this topic, ALL sentences preserved, only filler removed]"},
    {"title": "Sejarah MSCI", "content": "[FULL transcript text for this topic, ALL sentences preserved, only filler removed]"}
  ]
}

REMEMBER: Content = FULL transcript text per topic (cleaned of filler), NOT a summary.`;

// ── Streaming prompt: output NDJSON (one chapter per line) ──
// Each line is a complete JSON object. Client can render chapters as they arrive.
const STREAM_SYSTEM_PROMPT = `You are an educational content splitter for Indonesian lecture transcripts.

TASK: Split the transcript into 5-15 chapters based on TOPIC changes. DO NOT summarize. DO NOT abbreviate.

CRITICAL — DO NOT SUMMARIZE:
- Content of each chapter MUST be the FULL transcript text for that topic, word-for-word
- DO NOT condense, paraphrase, shorten, or summarize
- EVERY sentence in the transcript MUST appear in some chapter
- Expected content length: 200-2000 words per chapter

WHAT YOU CAN DO (only these):
1. Remove filler words: "eh", "ya", "kan", "gitu", "oke", "nah", "anu"
2. Fix obvious STT typos
3. Fix basic punctuation
4. Group consecutive sentences about same topic into one chapter

OUTPUT FORMAT — STRICT NDJSON (one chapter per line, JSON per line):
Each line is a complete JSON object representing ONE chapter. NO array wrapper. NO markdown fences. NO explanation.

Output format:
{"title": "Pengertian MSCI", "content": "Full transcript text for this topic..."}
{"title": "Sejarah MSCI", "content": "Full transcript text for this topic..."}
{"title": "Cara Hitung Free Float", "content": "Full transcript text for this topic..."}

CRITICAL: Output ONE JSON object per line. Each line must be parseable independently. After the last chapter, output a single line "DONE" on its own line.

REMEMBER: Content = FULL transcript text per topic (cleaned of filler), NOT a summary.`;

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const isStream = url.searchParams.get('stream') === 'true';

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

    const userPrompt = isStream
      ? `Split this lecture transcript into up to ${maxChapters} chapters. Output ONE chapter per line as NDJSON, end with "DONE" on its own line.\n\nTRANSCRIPT:\n${truncated}\n\nOutput NDJSON only.`
      : `Split this lecture transcript into up to ${maxChapters} semantic chapters with proper titles.\n\nTRANSCRIPT:\n${truncated}\n\nOutput JSON only.`;

    // ── STREAMING PATH: use ReadableStream + SSE to client ──
    // Server-side: stream:true to pi-bansos, parse NDJSON line-by-line,
    // emit each chapter via SSE event `data: {...}\n\n`. Client renders
    // chapters one-by-one as they arrive (vs waiting ~30-60s for full).
    if (isStream) {
      const piBansosUrl = (process.env.PI_BANSOS_URL || 'http://127.0.0.1:18080/v1');
      const encoder = new TextEncoder();
      let streamLineBuffer = '';  // declared BEFORE ReadableStream (TS strict mode)

      const stream = new ReadableStream({
        async start(controller) {
          let upstream: ReadableStream<Uint8Array> | null = null;
          try {
            // Make streaming request to pi-bansos
            const upstreamRes = await fetch(`${piBansosUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer placeholder',
              },
              body: JSON.stringify({
                model: 'cohere/north-mini-code:free',  // Cohere primary for structured-json
                messages: [
                  { role: 'system', content: STREAM_SYSTEM_PROMPT },
                  { role: 'user', content: userPrompt },
                ],
                temperature: 0.2,
                max_tokens: 30000,
                stream: true,  // KEY: ask pi-bansos to stream
              }),
              signal: AbortSignal.timeout(300_000),
            });

            if (!upstreamRes.ok || !upstreamRes.body) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `upstream HTTP ${upstreamRes.status}` })}\n\n`));
              controller.close();
              return;
            }

            upstream = upstreamRes.body;
            const reader = upstream.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let chapterIdx = 0;

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              // pi-bansos streams OpenAI-format chunks: each chunk is
              // `data: {"choices":[{"delta":{"content":"..."}}]}\n\n`
              // Parse + accumulate content tokens, then look for newlines
              // in the accumulated LLM output.
              let eventEnd;
              while ((eventEnd = buffer.indexOf('\n\n')) >= 0) {
                const eventStr = buffer.slice(0, eventEnd);
                buffer = buffer.slice(eventEnd + 2);

                // Extract `data: ...` lines from this SSE event
                const dataLines = eventStr.split('\n').filter(l => l.startsWith('data:'));
                if (dataLines.length === 0) continue;
                const jsonStr = dataLines.map(l => l.slice(5).trim()).join('\n');
                if (jsonStr === '[DONE]') continue;

                try {
                  const chunk = JSON.parse(jsonStr);
                  const delta = chunk.choices?.[0]?.delta?.content || '';
                  if (!delta) continue;

                  // delta is a fragment of LLM output (NDJSON text).
                  // Accumulate + look for complete lines (separated by \n).
                  // We need to maintain our own line buffer separate from
                  // the SSE event buffer.
                  if (!streamLineBuffer) streamLineBuffer = '';
                  streamLineBuffer += delta;

                  // Process complete lines from streamLineBuffer
                  let lineEnd;
                  while ((lineEnd = streamLineBuffer.indexOf('\n')) >= 0) {
                    const line = streamLineBuffer.slice(0, lineEnd).trim();
                    streamLineBuffer = streamLineBuffer.slice(lineEnd + 1);

                    if (!line || line === 'DONE') continue;

                    // Try to parse line as chapter JSON
                    try {
                      const chapter = JSON.parse(line);
                      if (chapter && chapter.title && chapter.content) {
                        chapterIdx++;
                        // Emit as SSE event to client
                        const chapterOut = {
                          id: chapterIdx,
                          title: String(chapter.title).slice(0, 100),
                          content: String(chapter.content),
                          wordCount: String(chapter.content).split(/\s+/).filter(Boolean).length,
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chapterOut)}\n\n`));
                      }
                    } catch {
                      // Not valid JSON — might be partial or stray text. Skip.
                    }
                  }
                } catch {
                  // ignore malformed chunk
                }
              }
            }

            // Final flush: any remaining streamLineBuffer
            if (streamLineBuffer) {
              const lines = streamLineBuffer.split('\n');
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'DONE') continue;
                try {
                  const chapter = JSON.parse(trimmed);
                  if (chapter && chapter.title && chapter.content) {
                    chapterIdx++;
                    const chapterOut = {
                      id: chapterIdx,
                      title: String(chapter.title).slice(0, 100),
                      content: String(chapter.content),
                      wordCount: String(chapter.content).split(/\s+/).filter(Boolean).length,
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chapterOut)}\n\n`));
                  }
                } catch {}
              }
            }

            console.log(`[split-chapters stream] DONE: ${chapterIdx} chapters emitted`);
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (e: any) {
            console.error('[split-chapters stream] error:', e);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: e?.message || 'stream failed' })}\n\n`));
            controller.close();
          }
        },
        cancel() {
          // Client disconnected
          console.log('[split-chapters stream] client disconnected');
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // ── NON-STREAMING PATH: original JSON response ──
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
