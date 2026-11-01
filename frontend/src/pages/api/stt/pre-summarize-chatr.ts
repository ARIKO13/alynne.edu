/**
 * POST /api/stt/pre-summarize-chatr
 *
 * Pre-summarize transcript menggunakan Chatr's Supabase Edge Function (GPT-4o-based).
 * Endpoint public: https://xdxjetmnngpscvnotoze.supabase.co/functions/v1/chat-gpt4o
 * No auth, no captcha, no signup required (Chatr.com "Chat with Text" tool backend).
 *
 * Flow (single HTTP request, no multi-step):
 *   1. POST to supabase function with {brandName, messages: [{role, content}]}
 *   2. Response: {"reply": "<summary text>"}
 *
 * Prompt strategy: "COMPREHENSIVE summary, preserve ALL key information,
 * aim for 30-50% of original length, plain paragraphs."
 * Time: ~2-5 seconds for 5K char input.
 *
 * Request body: { text: string }
 * Response: { summary: string, method: string, originalLength: number, summaryLength: number }
 */

import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';

const CHATR_API = 'https://xdxjetmnngpscvnotoze.supabase.co/functions/v1/chat-gpt4o';
const ORIGIN = 'https://chatrai.app';
const TIMEOUT_MS = 90_000; // 90s — usually 2-5s but allow buffer for big input

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as { text?: string };
    const text = (body.text || '').trim();
    if (!text || text.length < 100) {
      return Response.json({ error: 'Text too short (min 100 chars)' }, { status: 400 });
    }

    console.log(`[pre-summarize-chatr] Start: ${text.length} chars`);

    // Build chat message — system + user (with text content)
    // Prompt: comprehensive summary, preserve all key info, 30-50% retention, plain paragraphs
    const systemPrompt = 'You are a helpful summarization assistant for educational content. Provide COMPREHENSIVE summaries that preserve ALL key information, examples, names, numbers, definitions, and nuances. Use clear paragraphs (NOT bullet points). Output in plain text only (no markdown).';
    const userPrompt = `Give me a COMPREHENSIVE summary of the following text. Preserve ALL key points, examples, names, numbers, definitions, and important context. Aim for 30-50% of the original length while keeping every important detail. Use clear paragraphs separated by blank lines. Do NOT use bullet points or headings.\n\nText to summarize:\n${text}`;

    const payload = {
      brandName: 'Chatr ',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(CHATR_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': ORIGIN,
          'Referer': ORIGIN + '/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.log(`[pre-summarize-chatr] HTTP ${res.status}: ${errText.slice(0, 200)}`);
      return Response.json({
        summary: null,
        error: 'api_error',
        message: `Chatr HTTP ${res.status}: ${errText.slice(0, 100)}`,
      });
    }

    const data = await res.json() as { reply?: string; error?: string };
    const summary = (data.reply || '').trim();
    if (!summary || summary.length < 50) {
      return Response.json({
        summary: null,
        error: 'no_summary',
        message: `Chatr returned empty/short reply (${summary.length} chars)`,
      });
    }

    const pct = (summary.length * 100 / text.length).toFixed(0);
    console.log(`[pre-summarize-chatr] ✓ DONE: ${text.length} → ${summary.length} chars (${pct}% retention)`);

    return Response.json({
      summary,
      method: 'chatr-gpt4o',
      originalLength: text.length,
      summaryLength: summary.length,
    });
  } catch (e: any) {
    console.error('[pre-summarize-chatr] error:', e?.message?.slice(0, 300));
    return Response.json({
      summary: null,
      error: 'api_error',
      message: e?.message || 'Chatr pre-summarize failed',
    }, { status: 200 }); // 200 so client can fall back gracefully
  }
};
