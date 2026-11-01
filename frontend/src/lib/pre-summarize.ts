/**
 * pre-summarize.ts — Pre-summarize transcript client-side SEBELUM kirim ke server.
 *
 * Strategi (berurutan, kalau satu gagal → fallback berikutnya):
 * 1. Resoomer (https://resoomer.com/) — gratis, no signup, no captcha.
 *    Pakai mode "filtreSummary" (Résumé optimisé) — paling detail di antara 5 mode Resoomer.
 *    Server-side endpoint /api/stt/pre-summarize-resoomer handle full multi-step flow:
 *      GET homepage → POST step 1-6 (multi-step pipeline) → POST changeViewResult=filtre
 *      → GET homepage lagi → extract #returnFiltre (clean summary text).
 *    Untuk input panjang (>5K char) → filtre mode IS actually summarize (keep only key sentences).
 *    Untuk input pendek (<2K char) → filtre mode keeps most sentences (since they're all important).
 *    Retention: 30-70% of input length, depending on text complexity.
 *    Time: ~30-45s (server-side, no captcha, no rate-limit known).
 * 2. Chatr (https://chatrai.app/tools/ai-chat-text) — gratis, no signup, no captcha.
 *    Backend: Supabase Edge Function (GPT-4o) — endpoint public tanpa auth.
 *    Server-side endpoint /api/stt/pre-summarize-chatr forward text + "comprehensive summary" prompt.
 *    Retention: 15-65% (smart compression, preserves all key info).
 *    Time: ~2-5 seconds (jauh lebih cepat dari Resoomer).
 * 3. PDFSummarizer.net API (server-side, free, no signup, handle 50MB)
 *    API: ai-services.formatech.io → upload to S3 → initialize → poll status → summary
 *    Reject threshold: kalau summary <10% of input → too aggressive (350 char dari 219K = useless)
 * 4. Chrome Summarizer API (window.ai.summarizer) — gratis, on-device, Chrome 127+
 *    Gemini Nano model, no rate limit, no API key, no signup.
 *    Chunk transcript ke 20K char per chunk (Chrome API max ~10K token).
 * 5. Fallback: kirim raw transcript ke server (Phase 1 DeepSeek handle ringkasan)
 *
 * Setelah pre-summarize:
 *   219K char → ~30-50K char ringkasan → kirim ke server
 *   Server lihat text ≤ 30K → skip Phase 1 (DeepSeek) → langsung Phase 2 (GLM/DeepSeek)
 */

export interface PreSummarizeResult {
  summary: string;
  method: string;  // 'resoomer-filtre' | 'chatr-gpt4o' | 'pdfsummarizer-net-api' | 'chrome-summarizer-api' | 'none'
  originalLength: number;
  summaryLength: number;
  chunkCount: number;
}

export async function preSummarize(transcript: string): Promise<PreSummarizeResult> {
  const originalLength = transcript.length;

  // Strategy 1: Chatr (Supabase GPT-4o function — FASTEST, no captcha, ~2-5s, reliable)
  // Dipindah jadi #1 (sebelumnya #2) karena:
  //   - 5-10x lebih cepat dari Resoomer (2-5s vs 30-45s)
  //   - API-nya single-call (no multi-step pipeline)
  //   - Compression ratio 15-65% (smart, preserves key info)
  //   - Dari VPS test: 4K input → 800 char output (20% retention), 2 detik
  try {
    const res = await fetch('/api/stt/pre-summarize-chatr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: transcript }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) {
      const data = await res.json() as { summary?: string; method?: string; error?: string };
      if (data.summary && data.summary.length > 50) {
        // Chatr compression: 15-65% retention depending on input.
        // For 219K input → 2% (too aggressive — REJECT, fall to Resoomer)
        // For 5K-50K input → 20-50% (good — ACCEPT)
        // Threshold: min 8% of input OR 2000 char for big input
        // v14-3output: Chatr threshold diturunkan 8% → 0.5% (sesuai arsitektur baru).
        // Chatr memang dirancang untuk "padat" (1-2% retention), bukan ringkasan sedang.
        // Threshold 0.5% = batas minimum wajar — di bawah itu, summary gak berguna.
        // Contoh: 219K input → min 1095 chars. Chatr return 2738 → diterima (2738 > 1095).
        const minSummaryLength = originalLength > 10000 ? Math.max(300, originalLength * 0.005) : 150;
        if (data.summary.length < minSummaryLength) {
          console.log(`[pre-summarize] Chatr summary too short: ${data.summary.length} chars from ${originalLength} input (min ${minSummaryLength}) — rejecting, falling back to Resoomer`);
        } else {
          console.log(`[pre-summarize] Chatr GPT-4o: ${originalLength} → ${data.summary.length} chars (${(data.summary.length * 100 / originalLength).toFixed(0)}% retention, method: ${data.method})`);
          return {
            summary: data.summary,
            method: 'chatr-gpt4o',
            originalLength,
            summaryLength: data.summary.length,
            chunkCount: 1,
          };
        }
      }
      console.log(`[pre-summarize] Chatr returned: ${data.error || 'no summary'}`);
    } else {
      console.log(`[pre-summarize] Chatr HTTP ${res.status}`);
    }
  } catch (err: any) {
    console.log(`[pre-summarize] Chatr failed:`, err?.message?.slice(0, 100) || err);
  }

  // Strategy 2: Resoomer (filtreSummary mode — paling detail di antara 5 mode Resoomer)
  // Dipindah jadi #2 — dipakai kalau Chatr return too-short summary (untuk input >50K yang
  // Chatr kompres terlalu agresif). Resoomer filtre biasanya give 7-15% retention.
  // Time budget: 120s (server flow takes ~30-45s, give buffer)
  try {
    const res = await fetch('/api/stt/pre-summarize-resoomer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: transcript }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) {
      const data = await res.json() as { summary?: string; method?: string; error?: string };
      if (data.summary && data.summary.length > 50) {
        // Resoomer filtre mode for long input keeps ~7% of content (key sentences only)
        // For 219K input → 15K summary (7% retention). Itu ACTUALLY GOOD summary!
        // Old threshold was 10% (too strict — 15K dari 219K = rejected).
        // New threshold: 5% (supaya 15K dari 219K diterima).
        const minSummaryLength = originalLength > 10000 ? Math.max(1500, originalLength * 0.05) : 150;
        if (data.summary.length < minSummaryLength) {
          console.log(`[pre-summarize] Resoomer summary too short: ${data.summary.length} chars from ${originalLength} input (min ${minSummaryLength}) — rejecting, falling back`);
        } else {
          console.log(`[pre-summarize] Resoomer filtre: ${originalLength} → ${data.summary.length} chars (${(data.summary.length * 100 / originalLength).toFixed(0)}% retention, method: ${data.method})`);
          return {
            summary: data.summary,
            method: 'resoomer-filtre',
            originalLength,
            summaryLength: data.summary.length,
            chunkCount: 1,
          };
        }
      }
      console.log(`[pre-summarize] Resoomer returned: ${data.error || 'no summary'}`);
    } else {
      console.log(`[pre-summarize] Resoomer HTTP ${res.status}`);
    }
  } catch (err: any) {
    console.log(`[pre-summarize] Resoomer failed:`, err?.message?.slice(0, 100) || err);
  }

  // Strategy 3: PDFSummarizer.net API (server-side, free, no signup, handle 50MB)
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
        // v-fix: reject too-short summaries. PDFSummarizer.net kadang return hanya 350 char
        // dari 219K input (99.8% hilang!). User complaint: "hasilnya ringkas banget,
        // materinya ada yg ilang". Kalau input > 50K tapi summary < 5K, terlalu agresif.
        // Threshold: summary harus >= 10% dari input (atau min 5000 char untuk input > 50K).
        const minSummaryLength = originalLength > 50000 ? 5000 : Math.max(200, originalLength * 0.1);
        if (data.summary.length < minSummaryLength) {
          console.log(`[pre-summarize] PDFSummarizer.net summary too short: ${data.summary.length} chars from ${originalLength} input (min ${minSummaryLength}) — rejecting, too aggressive, falling back`);
        } else {
          console.log(`[pre-summarize] PDFSummarizer.net API: ${originalLength} → ${data.summary.length} chars (method: ${data.method})`);
          return {
            summary: data.summary,
            method: 'pdfsummarizer-net-api',
            originalLength,
            summaryLength: data.summary.length,
            chunkCount: 1,
          };
        }
      }
      console.log(`[pre-summarize] PDFSummarizer.net API returned: ${data.error || 'no summary'}`);
    } else {
      console.log(`[pre-summarize] PDFSummarizer.net API HTTP ${res.status}`);
    }
  } catch (err) {
    console.log(`[pre-summarize] PDFSummarizer.net API failed:`, err);
  }

  // Strategy 4: Chrome Summarizer API (on-device, free, Chrome 127+)
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

  // Strategy 5: No pre-summarization — send raw transcript
  // Server Phase 1 (DeepSeek) will handle ringkasan
  console.log(`[pre-summarize] No pre-summarizer worked → send raw transcript (${originalLength} chars), server Phase 1 will handle`);
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
