/**
 * pre-summarize.ts — Pre-summarize transcript client-side SEBELUM kirim ke server.
 *
 * Strategi (berurutan):
 * 1. Chrome Summarizer API (window.ai.summarizer) — gratis, on-device, Chrome 127+
 *    Gemini Nano model, no rate limit, no API key, no signup.
 *    Chunk transcript ke 20K char per chunk (Chrome API max ~10K token).
 *    Untuk 219K char = ~11 chunks × 3s = ~33s (paralel tidak didukung, sequential).
 * 2. Fallback: kirim raw transcript ke server (Phase 1 DeepSeek handle ringkasan)
 *
 * Setelah pre-summarize:
 *   219K char → ~40-60K char ringkasan → kirim ke server
 *   Server lihat text ≤ 30K → skip Phase 1 (DeepSeek) → langsung Phase 2 (GLM/DeepSeek)
 *   Total: 0 LLM request untuk Phase 1 (Chrome API), 2 LLM request untuk Phase 2 (bagi tugas)
 *
 * Alternatif yang gak dipakai (terlalu rapuh):
 *   - Web scraping PDFSummarizer.net/Tomedes via headless browser — fragile, ToS issue
 *   - transformers.js summarization model — max input 1024 token, butuh 80+ chunks, lambat
 */

export interface PreSummarizeResult {
  summary: string;
  method: string;  // 'chrome-summarizer-api' | 'none'
  originalLength: number;
  summaryLength: number;
  chunkCount: number;
}

export async function preSummarize(transcript: string): Promise<PreSummarizeResult> {
  const originalLength = transcript.length;

  // Strategy 1: PDFSummarizer.net API (server-side, free, no signup, handle 50MB)
  // API: ai-services.formatech.io → upload to S3 → initialize → poll status → summary
  try {
    const res = await fetch('/api/stt/pre-summarize-web', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: transcript }),
      signal: AbortSignal.timeout(150_000),  // 2.5 min — API processing can take 60-120s
    });
    if (res.ok) {
      const data = await res.json() as { summary?: string; method?: string; error?: string };
      if (data.summary && data.summary.length > 50) {
        console.log(`[pre-summarize] PDFSummarizer.net API: ${originalLength} → ${data.summary.length} chars (method: ${data.method})`);
        return {
          summary: data.summary,
          method: 'pdfsummarizer-net-api',
          originalLength,
          summaryLength: data.summary.length,
          chunkCount: 1,
        };
      }
      console.log(`[pre-summarize] PDFSummarizer.net API returned: ${data.error || 'no summary'}`);
    } else {
      console.log(`[pre-summarize] PDFSummarizer.net API HTTP ${res.status}`);
    }
  } catch (err) {
    console.log(`[pre-summarize] PDFSummarizer.net API failed:`, err);
  }

  // Strategy 2: Chrome Summarizer API (on-device, free, Chrome 127+)
  const chromeResult = await chromeSummarizeChunked(transcript);
  if (chromeResult) {
    console.log(`[pre-summarize] Chrome Summarizer API: ${originalLength} → ${chromeResult.summary.length} chars (${chromeResult.chunkCount} chunks, method: on-device)`);
    return {
      summary: chromeResult.summary,
      method: 'chrome-summarizer-api',
      originalLength,
      summaryLength: chromeResult.summary.length,
      chunkCount: chromeResult.chunkCount,
    };
  }

  // Strategy 2: No pre-summarization — send raw transcript
  // Server Phase 1 (DeepSeek) will handle ringkasan
  console.log(`[pre-summarize] No Chrome Summarizer API → send raw transcript (${originalLength} chars), server Phase 1 will handle`);
  return {
    summary: transcript,
    method: 'none',
    originalLength,
    summaryLength: originalLength,
    chunkCount: 0,
  };
}

/**
 * Chrome Summarizer API — chunked summarization.
 * Split transcript ke 20K char chunks, summarize each, join results.
 */
async function chromeSummarizeChunked(text: string): Promise<{ summary: string; chunkCount: number } | null> {
  try {
    // @ts-ignore — Chrome Summarizer API is experimental (Chrome 127+)
    const ai = (window as any).ai;
    if (!ai?.summarizer) {
      console.log('[pre-summarize] Chrome Summarizer API not available (need Chrome 127+)');
      return null;
    }

    // Create summarizer instance
    // @ts-ignore
    const summarizer = await ai.summarizer.create({
      type: 'tl;dr',
      format: 'plain-text',
      length: 'medium',
      monitor: (m: any) => {
        // Download progress (first time only, cached after)
        if (m.type === 'download-progress') {
          console.log(`[pre-summarize] Chrome model download: ${Math.round(m.loaded * 100 / m.total)}%`);
        }
      },
    });

    // Chunk text by paragraph boundaries, max 20K char per chunk
    const MAX_CHUNK = 20000;
    const chunks = splitIntoChunks(text, MAX_CHUNK);
    console.log(`[pre-summarize] Chrome Summarizer: ${chunks.length} chunk(s) × ~${MAX_CHUNK} char`);

    const summaries: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        const result = await summarizer.summarize(chunks[i]);
        if (result && result.trim().length > 50) {
          summaries.push(result.trim());
          console.log(`[pre-summarize] Chrome chunk ${i + 1}/${chunks.length} OK (${result.length} chars)`);
        }
      } catch (e: any) {
        console.log(`[pre-summarize] Chrome chunk ${i + 1}/${chunks.length} failed: ${e?.message?.slice(0, 80)}`);
      }
    }

    // Cleanup
    summarizer.destroy();

    if (summaries.length === 0) return null;
    return { summary: summaries.join('\n\n'), chunkCount: chunks.length };
  } catch (e: any) {
    console.log(`[pre-summarize] Chrome Summarizer API error: ${e?.message?.slice(0, 100)}`);
    return null;
  }
}

function splitIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  // Split by paragraph first
  const paragraphs = text.split(/\n\s*\n/);
  let current = '';
  for (const p of paragraphs) {
    if (current.length + p.length > maxChars && current.length > 0) {
      chunks.push(current);
      current = p;
    } else {
      current += (current ? '\n\n' : '') + p;
    }
  }
  if (current) chunks.push(current);

  // Fallback: if any chunk is too big (one giant paragraph), split by sentence
  const finalChunks: string[] = [];
  for (const c of chunks) {
    if (c.length > maxChars * 1.5) {
      const sentences = c.match(/[^.!?]+[.!?]+/g) || [c];
      let cur = '';
      for (const s of sentences) {
        if (cur.length + s.length > maxChars && cur.length > 0) {
          finalChunks.push(cur);
          cur = s;
        } else {
          cur += s;
        }
      }
      if (cur) finalChunks.push(cur);
    } else {
      finalChunks.push(c);
    }
  }
  return finalChunks;
}
