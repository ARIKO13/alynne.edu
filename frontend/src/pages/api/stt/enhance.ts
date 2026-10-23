import type { APIRoute } from 'astro';
import { localCorrect } from '@/lib/stt-dictionary';
import { callLLM } from '@/lib/gateway-client';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const QWEN_LOCAL = 'http://localhost:8000/llm/enhance';
const QWEN_TIMEOUT_MS = 60_000;

const ENHANCE_SYSTEM = `Perbaiki teks STT bahasa Indonesia. Teks sudah sebagian dikoreksi secara lokal.
Tugasmu: perbaiki sisa kata yang tidak dikenali, tambahkan tanda baca, huruf kapital awal kalimat.
Aturan KETAT:
1. JANGAN ubah kata asing/teknis (English, istilah IT)
2. JANGAN tambah atau hapus kata
3. JAGA makna asli
4. Kembalikan TEKS SAJA`;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { text } = await request.json();
    if (!text?.trim()) return Response.json({ text: '', source: 'empty' });

    // ===== STEP 1: Local dictionary (instant, 0 API cost) =====
    const local = localCorrect(text);
    console.log(`[Enhance] Local: ${local.stats.unknownWords}/${local.stats.totalWords} unknown → ${local.needsLLM ? 'LLM' : 'LOCAL'}`);

    if (!local.needsLLM) {
      return Response.json({
        text: addBasicPunctuation(local.text),
        source: 'local',
        stats: local.stats,
      });
    }

    // ===== STEP 2: pi-bansos primary (Cohere → Nemotron → Poolside via callLLM, task='fast') =====
    const piResult = await callLLM('fast', ENHANCE_SYSTEM, local.text, {
      maxTokens: 2048,
      timeout: 30_000,
      temperature: 0.1,
      endpoint: 'stt/enhance',
    });
    if (piResult.content) {
      const enhanced = piResult.content.trim();
      return Response.json({
        text: enhanced || addBasicPunctuation(local.text),
        source: 'pi-bansos',
        model: piResult.modelUsed,
        stats: local.stats,
      });
    }
    console.log('[Enhance] pi-bansos failed, falling back to Groq...');

    // ===== STEP 3: Fall back to Groq =====
    const apiKey = process.env.GROQ_API_KEY;
    if (apiKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        const res = await fetch(GROQ_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'qwen/qwen3.8-27b',
            messages: [
              { role: 'system', content: ENHANCE_SYSTEM },
              { role: 'user', content: local.text },
            ],
            temperature: 0.1,
            max_tokens: 2048,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          const enhanced = (data.choices?.[0]?.message?.content || '').trim();
          return Response.json({
            text: enhanced || addBasicPunctuation(local.text),
            source: 'groq',
            stats: local.stats,
          });
        }
        console.log(`[Enhance] Groq ${res.status}, falling back to Qwen...`);
      } catch (e) {
        console.log(`[Enhance] Groq failed: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }

    // ===== STEP 4: Fallback to Qwen local =====
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), QWEN_TIMEOUT_MS);
      const res = await fetch(QWEN_LOCAL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: local.text }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        return Response.json({
          text: data.text || addBasicPunctuation(local.text),
          source: 'qwen-local',
          stats: local.stats,
        });
      }
    } catch (e) {
      console.log(`[Enhance] Qwen failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // ===== Final fallback: just local =====
    return Response.json({
      text: addBasicPunctuation(local.text),
      source: 'local-only',
      stats: local.stats,
    });
  } catch {
    return Response.json({ text: '', source: 'error' });
  }
};

function addBasicPunctuation(text: string): string {
  if (!text.trim()) return text;
  let r = text.charAt(0).toUpperCase() + text.slice(1);
  if (!/[.!?]$/.test(r.trim())) r = r.trim() + '.';
  r = r.replace(/([.!?])\s+([a-z])/g, (_, p, l) => `${p} ${l.toUpperCase()}`);
  return r;
}
