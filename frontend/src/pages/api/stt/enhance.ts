import type { APIRoute } from 'astro';
import { localCorrect } from '@/lib/stt-dictionary';
import { callLLM } from '@/lib/gateway-client';

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

    // ===== STEP 2: pi-bansos ONLY (no Groq/Qwen fallback) =====
    // callLLM('fast') → Cohere primary → Nemotron → Poolside.
    // If all 3 fail, return local-only with basic punctuation.
    const result = await callLLM('fast', ENHANCE_SYSTEM, local.text, {
      maxTokens: 2048,
      timeout: 30_000,
      temperature: 0.1,
      endpoint: 'stt/enhance',
    });

    if (result.content) {
      const enhanced = result.content.trim();
      return Response.json({
        text: enhanced || addBasicPunctuation(local.text),
        source: 'pi-bansos',
        model: result.modelUsed,
        stats: local.stats,
      });
    }

    // ===== Final fallback: just local (no legacy LLM fallbacks) =====
    console.warn('[Enhance] pi-bansos failed, returning local-only');
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
