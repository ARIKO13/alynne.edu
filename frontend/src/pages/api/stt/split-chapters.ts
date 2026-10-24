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

TASK: Given a raw STT transcript, split it into 5-15 chapters based on TOPIC changes. DO NOT summarize. DO NOT abbreviate. STRIP greetings + intermezzo.

LANGUAGE — CRITICAL:
- The transcript is in BAHASA INDONESIA (Indonesian)
- ALL chapter content MUST be in Bahasa Indonesia
- DO NOT translate to English
- DO NOT output any content in English (except technical terms that are already English in the original, like "MSCI", "free float", "emerging market")
- Chapter titles MUST be in Bahasa Indonesia
- Keep the same Indonesian words/phrases from the original transcript — do not paraphrase into English

CRITICAL — DO NOT SUMMARIZE:
- Content of each chapter MUST be the FULL transcript text for that topic, word-for-word
- DO NOT condense, paraphrase, shorten, or summarize
- EVERY substantive sentence in the transcript MUST appear in some chapter
- A chapter with only 2-3 sentences is WRONG
- Expected content length: 200-2000 words per chapter

STRIP GREETINGS + INTERMEZZO (CRITICAL):
- REMOVE greetings: "Selamat pagi", "Selamat siang", "Selamat malam", "Halo", "Assalamualaikum"
- REMOVE audience address: "warga CPL", "teman-teman", "rekan-rekan", "bapak/ibu", "guys"
- REMOVE intermezzo/chit-chat: jokes, personal stories unrelated to topic, casual asides
- REMOVE meta-commentary: "ok kita lanjut", "jadi gini", "gua mau bahas", "yang penting", "intinya"
- REMOVE pure filler phrases: "eh", "ya", "kan", "gitu", "oke", "nah", "anu", "jadi gini", "gua bilang", "kayak"
- If a sentence is PURELY greeting/intermezzo (no educational content), SKIP IT entirely
- If a sentence has greeting + content mixed (e.g. "Selamat pagi, MSCI mengumumkan..."), KEEP ONLY THE CONTENT PART ("MSCI mengumumkan...")
- Example BAD: "Selamat pagi, warga CPL. Berita terkini, MSCI mengumumkan pertimbangan..."
- Example GOOD: "Berita terkini, MSCI mengumumkan pertimbangan untuk memindahkan klasifikasi pasar Indonesia..."
- Goal: chapter content = PURE MATERI (educational substance), no chatting/greeting fluff

WHAT YOU CAN DO (only these):
1. Remove filler words + greetings + intermezzo (per rules above)
2. Fix obvious STT typos
3. Fix basic punctuation
4. Group consecutive sentences about same topic into one chapter

WHAT YOU CANNOT DO:
- DO NOT rewrite sentences to be more formal — keep spoken tone (minus greetings)
- DO NOT merge multiple sentences into one shorter summary
- DO NOT skip substantive educational sentences
- DO NOT add information not in the original
- DO NOT paraphrase materi content

CHAPTER TITLE:
- Concise (max 8 words), describes the topic — like textbook table of contents
- In Indonesian

OUTPUT STRICT JSON ONLY (no markdown fences, no prose, no explanation):
{
  "chapters": [
    {"title": "Pengertian MSCI", "content": "[FULL transcript text for this topic, ALL substantive sentences preserved, greetings/intermezzo stripped]"},
    {"title": "Sejarah MSCI", "content": "[FULL transcript text for this topic, ALL substantive sentences preserved, greetings/intermezzo stripped]"}
  ]
}

REMEMBER: Content = FULL transcript text per topic (greetings/intermezzo STRIPPED), NOT a summary.`;

// ── Streaming prompt: output NDJSON (one chapter per line) ──
// Each line is a complete JSON object. Client can render chapters as they arrive.
const STREAM_SYSTEM_PROMPT = `You are an educational content splitter for Indonesian lecture transcripts.

TASK: Split the transcript into 5-15 chapters based on TOPIC changes. DO NOT summarize. DO NOT abbreviate. STRIP greetings + intermezzo.

LANGUAGE — CRITICAL:
- The transcript is in BAHASA INDONESIA (Indonesian)
- ALL chapter content MUST be in Bahasa Indonesia
- DO NOT translate to English
- DO NOT output any content in English (except technical terms that are already English in the original, like "MSCI", "free float", "emerging market")
- Chapter titles MUST be in Bahasa Indonesia
- Keep the same Indonesian words/phrases from the original transcript — do not paraphrase into English

CRITICAL — DO NOT SUMMARIZE:
- Content of each chapter MUST be the FULL transcript text for that topic, word-for-word
- DO NOT condense, paraphrase, shorten, or summarize
- EVERY substantive sentence in the transcript MUST appear in some chapter
- Expected content length: 200-2000 words per chapter

STRIP GREETINGS + INTERMEZZO (CRITICAL):
- REMOVE greetings: "Selamat pagi", "Selamat siang", "Selamat malam", "Halo", "Assalamualaikum"
- REMOVE audience address: "warga CPL", "teman-teman", "rekan-rekan", "bapak/ibu", "guys"
- REMOVE intermezzo/chit-chat: jokes, personal stories unrelated to topic, casual asides
- REMOVE meta-commentary: "ok kita lanjut", "jadi gini", "gua mau bahas", "yang penting", "intinya"
- REMOVE pure filler phrases: "eh", "ya", "kan", "gitu", "oke", "nah", "anu", "jadi gini", "gua bilang", "kayak"
- If a sentence is PURELY greeting/intermezzo (no educational content), SKIP IT entirely
- If a sentence has greeting + content mixed (e.g. "Selamat pagi, MSCI mengumumkan..."), KEEP ONLY THE CONTENT PART ("MSCI mengumumkan...")
- Example BAD: "Selamat pagi, warga CPL. Berita terkini, MSCI mengumumkan pertimbangan..."
- Example GOOD: "Berita terkini, MSCI mengumumkan pertimbangan untuk memindahkan klasifikasi pasar Indonesia..."
- Goal: chapter content = PURE MATERI (educational substance), no chatting/greeting fluff

WHAT YOU CAN DO (only these):
1. Remove filler words + greetings + intermezzo (per rules above)
2. Fix obvious STT typos
3. Fix basic punctuation
4. Group consecutive sentences about same topic into one chapter

OUTPUT FORMAT — STRICT NDJSON (one chapter per line, JSON per line):
Each line is a complete JSON object representing ONE chapter. NO array wrapper. NO markdown fences. NO explanation.

Output format:
{"title": "Pengertian MSCI", "content": "Full transcript text for this topic, greetings stripped..."}
{"title": "Sejarah MSCI", "content": "Full transcript text for this topic, greetings stripped..."}
{"title": "Cara Hitung Free Float", "content": "Full transcript text for this topic, greetings stripped..."}

CRITICAL: Output ONE JSON object per line. Each line must be parseable independently. After the last chapter, output a single line "DONE" on its own line.

REMEMBER: Content = FULL transcript text per topic (greetings/intermezzo STRIPPED), NOT a summary.`;

// ── Server-side greeting/intermezzo strip — safety net for when LLM
// doesn't follow prompt instructions. Removes patterns that should
// never appear in clean materi content.
function stripGreetings(text: string): string {
  let r = text;
  // Remove bracketed stage directions: [tertawa], [terkesiap], [tawa], [musik], etc.
  r = r.replace(/\[(?:tertawa|terkesiap|tawa|klik|musik|iringan|suara|background|aksi|tepuk tangan)\]/gi, '');
  // Remove greetings at start of content
  r = r.replace(/^(?:Selamat\s+(?:pagi|siang|sore|malam)|Halo+|Assalamualaikum|Pagi|Sore|Malam)[,!]?\.?\s*/i, '');
  // Remove audience address (anywhere in text)
  r = r.replace(/(?:warga\s+CPL(?:\s+sekalian)?|teman-teman|rekan-rekan|bapak(?:-?ibu)?|guys|everybody|semua)[,!]?\.?\s*/gi, '');
  // Remove "Breaking news" / "Berita terkini" intermezzo at start
  r = r.replace(/^(?:Breaking\s+news|Berita\s+terkini|Kabar\s+terbaru)[,!]?\.?\s*/i, '');
  // Remove "Oke, jadi" / "Jadi gini" / "Nah, jadi" meta-commentary at start
  r = r.replace(/^(?:Oke,?\s*(?:jadi|guar|lanjut)?|Jadi\s+gini|Nah,?\s*jadi?|Ya\s+jadi|Eh,?|Iya,?|Ya,?|Oke\s+jadi|Gini,?)[,!]?\.?\s*/i, '');
  // Remove "gua mau bahas" / "gua bilang" / "kayak gua bilang"
  r = r.replace(/(?:gua\s+mau\s+bahas|gua\s+bilang|kayak\s+gua\s+bilang|gua\s+jelasin)[,!]?\.?\s*/gi, '');
  // Remove pure filler phrases
  r = r.replace(/\b(?:gitu|ya\s+gitu|kan\s+gitu|nah\s+gitu)\b[,.!?]?\s*/gi, '');
  // Clean up double spaces + leading/trailing whitespace
  r = r.replace(/\s{2,}/g, ' ').trim();
  // Capitalize first letter
  if (r.length > 0) r = r.charAt(0).toUpperCase() + r.slice(1);
  return r;
}

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
      const emittedTitles = new Set<string>();  // dedup: skip chapters with same title

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
              // Normalize line endings: pi-bansos may use \r\n\r\n for SSE
              // event boundaries (standard HTTP). Convert to \n so our
              // indexOf('\n\n') search works correctly.
              buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

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
                  // Capture ONLY delta.content (not delta.reasoning).
                  // Reasoning is Cohere's internal chain-of-thought — it
                  // ALSO contains the NDJSON (model "writes" output in
                  // reasoning, then outputs it in content). If we capture
                  // both, we'd get DUPLICATE chapters. Content-only is
                  // correct + deduplicates automatically.
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
                        const title = String(chapter.title).trim().slice(0, 100);
                        // Dedup: skip if we already emitted a chapter with this title
                        if (emittedTitles.has(title.toLowerCase())) {
                          console.log(`[split-chapters stream] SKIP duplicate: "${title}"`);
                          continue;
                        }
                        emittedTitles.add(title.toLowerCase());
                        // Strip greetings/intermezzo that LLM may have missed
                        const cleanContent = stripGreetings(String(chapter.content));
                        if (cleanContent.length < 20) continue;  // skip if too short after stripping
                        chapterIdx++;
                        const chapterOut = {
                          id: chapterIdx,
                          title,
                          content: cleanContent,
                          wordCount: cleanContent.split(/\s+/).filter(Boolean).length,
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
                    const title = String(chapter.title).trim().slice(0, 100);
                    if (emittedTitles.has(title.toLowerCase())) continue;
                    emittedTitles.add(title.toLowerCase());
                    const cleanContent = stripGreetings(String(chapter.content));
                    if (cleanContent.length < 20) continue;
                    chapterIdx++;
                    const chapterOut = {
                      id: chapterIdx,
                      title,
                      content: cleanContent,
                      wordCount: cleanContent.split(/\s+/).filter(Boolean).length,
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

    // ── NON-STREAMING PATH ──
    // v-chunked: for long transcripts, split into chunks and process
    // in PARALLEL. Each chunk is small enough for LLM to handle reliably
    // (no timeout/truncation). Chunks processed 3-at-a-time for speed.
    
    const CHUNK_SIZE = 8000; // ~2K tokens per chunk — reliable for LLM
    const CHUNK_CONCURRENCY = 3; // 3 chunks in parallel
    
    function splitIntoChunks(text: string, maxChars: number): string[] {
      if (text.length <= maxChars) return [text];
      const chunks: string[] = [];
      // Split by sentence boundary
      const sentences = text.split(/(?<=[.!?])\s+/);
      let current = '';
      for (const s of sentences) {
        if (current.length + s.length > maxChars && current.length > 200) {
          chunks.push(current.trim());
          current = s;
        } else {
          current += (current ? ' ' : '') + s;
        }
      }
      if (current.trim()) chunks.push(current.trim());
      return chunks;
    }
    
    async function processChunk(chunk: string, chunkIdx: number): Promise<{ title?: string; content?: string }[]> {
      const chunkPrompt = `Split this lecture transcript SEGMENT into 2-5 chapters. This is segment ${chunkIdx + 1} of a longer transcript.\n\nTRANSCRIPT SEGMENT:\n${chunk}\n\nOutput JSON only.`;
      
      const result = await callLLM('structured-json', SYSTEM_PROMPT, chunkPrompt, {
        maxTokens: 8000,  // smaller per chunk — faster + no truncation
        timeout: 120_000, // 2 min per chunk (enough for small input)
        temperature: 0.2,
        endpoint: `stt/split-chapters/chunk-${chunkIdx}`,
      });
      
      if (!result.content) return [];
      
      try {
        const parsed = JSON.parse(extractJson(result.content));
        return parsed.chapters || [];
      } catch {
        const match = result.content.match(/"chapters"\s*:\s*\[([\s\S]*?)\]/);
        if (match) {
          try { return JSON.parse('{"chapters":[' + match[1] + ']}').chapters || []; } catch { return []; }
        }
        return [];
      }
    }
    
    // Check if transcript needs chunking
    const needsChunking = transcript.length > CHUNK_SIZE * 2; // > 16K chars
    let rawChapters: { title?: string; content?: string }[] = [];
    
    if (needsChunking) {
      // CHUNKED PARALLEL PATH — for long transcripts
      const chunks = splitIntoChunks(transcript, CHUNK_SIZE);
      console.log(`[split-chapters] Long transcript (${transcript.length} chars) → ${chunks.length} chunks, processing ${CHUNK_CONCURRENCY} at a time`);
      
      // Process chunks in batches of CHUNK_CONCURRENCY
      for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
        const batch = chunks.slice(i, i + CHUNK_CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map((chunk, j) => processChunk(chunk, i + j))
        );
        for (const chapters of batchResults) {
          rawChapters.push(...chapters);
        }
        console.log(`[split-chapters] Batch ${Math.floor(i / CHUNK_CONCURRENCY) + 1}/${Math.ceil(chunks.length / CHUNK_CONCURRENCY)} done — ${rawChapters.length} chapters total so far`);
      }
      
      console.log(`[split-chapters] All chunks done: ${rawChapters.length} raw chapters`);
    } else {
      // SINGLE CALL PATH — for short transcripts (original approach)
      const result = await callLLM('structured-json', SYSTEM_PROMPT, userPrompt, {
        maxTokens: 30000,
        timeout: 300_000,
        temperature: 0.2,
        endpoint: 'stt/split-chapters',
      });
      
      if (!result.content) {
        console.error('[split-chapters] callLLM returned null');
        return Response.json({ error: 'all-failed' }, { status: 200 });
      }
      
      try {
        const parsed = JSON.parse(extractJson(result.content));
        rawChapters = parsed.chapters || [];
      } catch {
        const match = result.content.match(/"chapters"\s*:\s*\[([\s\S]*?)\]/);
        if (match) {
          try { rawChapters = JSON.parse('{"chapters":[' + match[1] + ']}').chapters || []; } catch {}
        }
      }
    }
    
    if (rawChapters.length === 0) {
      console.error('[split-chapters] 0 chapters from LLM');
      return Response.json({ error: 'no-chapters' }, { status: 200 });
    }

    // Normalize + assign IDs + strip greetings + dedup
    const seenTitles = new Set<string>();
    const chapters = rawChapters
      .slice(0, maxChapters * 3) // allow more before dedup filtering
      .map((c, i) => {
        const title = String(c.title || '').trim().slice(0, 100) || `Bab ${i + 1}`;
        const content = stripGreetings(String(c.content || ''));
        return { title, content, wordCount: content.split(/\s+/).filter(Boolean).length };
      })
      .filter(c => {
        if (c.content.length < 20) return false;
        const key = c.title.toLowerCase();
        if (seenTitles.has(key)) return false;
        seenTitles.add(key);
        return true;
      })
      .slice(0, maxChapters)
      .map((c, i) => ({ id: i + 1, ...c }));

    if (chapters.length === 0) {
      console.error('[split-chapters] All chapters had empty content');
      return Response.json({ error: 'no-valid-chapters' }, { status: 200 });
    }

    console.log(`[split-chapters] SUCCESS: ${chapters.length} chapters from ${rawChapters.length} raw`);

    return Response.json({
      chapters,
      chunked: needsChunking,
    });
  } catch (e: any) {
    console.error('[split-chapters] fatal:', e);
    return Response.json({ error: 'Generation failed', message: e?.message }, { status: 500 });
  }
};
