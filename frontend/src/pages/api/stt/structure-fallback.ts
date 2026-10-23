import type { APIRoute } from 'astro';
import { callLLM as callLLMPiBansos, extractJson as extractJsonGlobal } from '@/lib/gateway-client';

const GATEWAY_URL = 'https://gateway.polyvorlabs.com/v1/chat/completions';
const FALLBACK_MODELS = ['cx/gpt-5.6-sol', 'openai/gpt-oss-120b'];

// Gateway may have higher TPM than Groq, but still be conservative
const MAX_TOTAL_TOKENS = 12000;
const MAX_OUTPUT_TOKENS = 6144;
const MAX_INPUT_CHARS = 8000;
const MAX_SLIDE_CHARS_PER_SLIDE = 400;
const MAX_TOTAL_SLIDE_CHARS = 1200;
const CHUNK_SIZE = 5000;
const TPM_DELAY_MS = 65_000; // wait for TPM reset between chunks

const SYSTEM_PROMPT = `Kamu mengubah materi kuliah menjadi modul catatan pembelajaran terstruktur dalam Bahasa Indonesia formal.

SUMBER INPUT:
- "--- TRANSCRIPT AUDIO ---" : hasil STT dari rekaman dosen. Mentah, banyak filler, typo.
- "--- MATERI SLIDE ---" : konten slide presentasi.

ATURAN:
1. Gunakan SLIDE sebagai kerangka, TRANSCRIPT sebagai pelengkap.
2. Gabung topik sama jadi SATU section.
3. Tabel dari slide WAJIB jadi field "tables".
4. Buang filler words, perbaiki typo STT, rangkum kalimat bertele-tele.
5. JANGAN salin transcript mentah.
6. Judul kegiatan = frasa singkat maks 8 kata.
7. stimulus = 1 kalimat pemantik.
8. steps/reviewNotes HANYA jika ada prosedur eksplisit, else null.
9. rangkumanAkhir 5-8 poin inti.
10. entitasPenting: tools, namaOrang, angkaAturan, istilahTeknis, kodeRumus.
11. identitas.mataPelajaran dan kelas: tebak dari konten.
12. Buat SEMUA kegiatan yang tercover. Jangan berhenti di 1.

Kembalikan HANYA JSON valid:
{"title":"...","identitas":{"mataPelajaran":"...","kelas":"..."},"pendahuluan":"...","tujuanPembelajaran":["..."],"kegiatanPembelajaran":[{"title":"...","stimulus":"...","materi":["paragraf1"],"tables":[{"headers":["Kolom1"],"rows":[["val1"]]}],"steps":null,"reviewNotes":null}],"rangkumanAkhir":["..."],"entitasPenting":{"tools":[],"namaOrang":[],"angkaAturan":[],"istilahTeknis":[],"kodeRumus":[]}}`;

const SYSTEM_PROMPT_CONT = `Lanjutkan strukturisasi transcript ini jadi kegiatan pembelajaran. Ini bagian LANJUTAN.

ATURAN:
1. Buat SEMUA kegiatanPembelajaran dari konten ini. Jangan ulang topik yang sudah dibahas.
2. Judul MELANJUTKAN topik sebelumnya.
3. Buang filler, perbaiki typo, rangkum.
4. JANGAN salin transcript mentah.
5. Tables WAJIB pakai field "tables". steps/reviewNotes HANYA jika prosedur, else null.
6. Isi sebanyak mungkin kegiatan, jangan berhenti di 1.

Kembalikan HANYA JSON (HANYA kegiatanPembelajaran dan rangkumanAkhir):
{"kegiatanPembelajaran":[{"title":"...","stimulus":"...","materi":["paragraf1"],"tables":null,"steps":null,"reviewNotes":null}],"rangkumanAkhir":["..."]}`;

const RETRYABLE = [502, 503, 504, 429];

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function extractJson(text: string): string {
  const cb = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cb) return cb[1].trim();
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : text;
}

function buildSlideSection(materialTexts: string[]): string {
  if (!materialTexts || materialTexts.length === 0) return '';
  let totalChars = 0;
  const parts: string[] = [];
  for (let i = 0; i < materialTexts.length; i++) {
    if (totalChars >= MAX_TOTAL_SLIDE_CHARS) break;
    const remaining = MAX_TOTAL_SLIDE_CHARS - totalChars;
    const allowed = Math.min(MAX_SLIDE_CHARS_PER_SLIDE, remaining, materialTexts[i].length);
    if (allowed > 50) {
      parts.push('--- Slide ' + (i + 1) + ' ---\n' + materialTexts[i].slice(0, allowed));
      totalChars += allowed;
    }
  }
  return parts.length > 0 ? '--- MATERI SLIDE ---\n' + parts.join('\n\n') : '';
}

function buildUserMessage(transcript: string, materialTexts: string[]): string {
  const truncated = transcript.length > MAX_INPUT_CHARS
    ? transcript.slice(0, MAX_INPUT_CHARS) + '\n[...dipotong...]'
    : transcript;
  const slideSection = buildSlideSection(materialTexts);
  return '--- TRANSCRIPT AUDIO ---\n' + truncated + '\n\n' + slideSection;
}

function splitTranscriptIntoChunks(transcript: string, maxChars: number): string[] {
  if (transcript.length <= maxChars) return [transcript];
  const chunks: string[] = [];
  const sentences = transcript.split(/(?<=[.!?])\s+/);
  let current = '';
  for (const s of sentences) {
    if (current.length + s.length > maxChars && current.length > maxChars * 0.3) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += (current ? ' ' : '') + s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function callLLM(model: string, systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        const delay = [30000, 60000][attempt - 1];
        console.log('[structure-fallback] ' + model + ' retry ' + (attempt + 1) + '/3, waiting ' + (delay / 1000) + 's...');
        await sleep(delay);
      }
      const res = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + (process.env.GATEWAY_API_KEY || ''), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], temperature: 0.2, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.ok) { const data = await res.json(); return data.choices?.[0]?.message?.content || null; }
      console.error('[structure-fallback] ' + model + ' HTTP ' + res.status + ' (attempt ' + (attempt + 1) + '/3)');
      if (!RETRYABLE.includes(res.status)) break;
    } catch (e: any) { console.error('[structure-fallback] ' + model + ' exception:', e?.message || e); }
  }
  return null;
}

async function tryModels(systemPrompt: string, userPrompt: string): Promise<any | null> {
  const totalInputChars = systemPrompt.length + userPrompt.length;
  const estInputTokens = Math.ceil(totalInputChars * 0.65);
  const maxTokens = Math.max(1024, Math.min(MAX_OUTPUT_TOKENS, MAX_TOTAL_TOKENS - estInputTokens));
  console.log('[structure-fallback] estInput:' + estInputTokens + ', maxOut:' + maxTokens + ', total:' + (estInputTokens + maxTokens));
  for (const model of FALLBACK_MODELS) {
    console.log('[structure-fallback] Trying ' + model + '...');
    const raw = await callLLM(model, systemPrompt, userPrompt, maxTokens);
    if (!raw) continue;
    try { return JSON.parse(extractJson(raw)); } catch { console.error('[structure-fallback] ' + model + ': JSON parse failed'); }
  }
  return null;
}

function mergeResults(first: any, continuations: any[]): any {
  const allKegiatan = [...(first.kegiatanPembelajaran || [])];
  const allRangkuman = [...(first.rangkumanAkhir || [])];
  const allEntitas = first.entitasPenting || { tools: [], namaOrang: [], angkaAturan: [], istilahTeknis: [], kodeRumus: [] };
  for (const cont of continuations) {
    if (cont.kegiatanPembelajaran) allKegiatan.push(...cont.kegiatanPembelajaran);
    if (cont.rangkumanAkhir) allRangkuman.push(...cont.rangkumanAkhir);
  }
  return { title: first.title || 'Modul Pembelajaran', identitas: first.identitas || { mataPelajaran: 'Umum', kelas: '-' }, pendahuluan: first.pendahuluan || '', tujuanPembelajaran: first.tujuanPembelajaran || [], kegiatanPembelajaran: allKegiatan, rangkumanAkhir: [...new Set(allRangkuman)].slice(-8), entitasPenting: allEntitas };
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const { transcript, materialTexts } = await request.json();
    if (!transcript?.trim()) return Response.json({ error: 'Transcript kosong' }, { status: 400 });
    if (!process.env.GATEWAY_API_KEY) { console.error('[structure-fallback] GATEWAY_API_KEY not found'); return Response.json({ error: 'no-key' }); }

    // ═══════════════════════════════════════════════════════
    // PATH 0 (NEW v-pi-bansos): Single full-transcript call via pi-bansos
    // Nemotron 1M context can absorb the WHOLE lecture in one call. Skips
    // the multi-chunk pipeline entirely (no TPM_DELAY_MS waits = ~65s saved
    // per chunk). Falls through to chunked Polyvor pipeline if pi-bansos
    // returns invalid JSON or all 3 models fail.
    // ═══════════════════════════════════════════════════════
    console.log('[structure-fallback] PATH 0: trying pi-bansos with full transcript (' + transcript.length + ' chars)...');
    const slideSection = buildSlideSection(materialTexts || []);
    const piUserPrompt = '--- TRANSCRIPT AUDIO ---\n' + transcript + '\n\n' + slideSection;
    const piResult = await callLLMPiBansos('long', SYSTEM_PROMPT, piUserPrompt, {
      maxTokens: MAX_OUTPUT_TOKENS,
      timeout: 180_000,
      endpoint: 'structure-fallback/pi-bansos-full',
    });
    if (piResult.content) {
      try {
        const parsed = JSON.parse(extractJsonGlobal(piResult.content));
        if (parsed?.title && Array.isArray(parsed.kegiatanPembelajaran) && parsed.kegiatanPembelajaran.length > 0) {
          console.log('[structure-fallback] PATH 0 SUCCESS: ' + parsed.kegiatanPembelajaran.length + ' kegiatan (model: ' + piResult.modelUsed + ')');
          return Response.json({ ...parsed, source: 'pi-bansos' });
        }
        console.error('[structure-fallback] PATH 0: invalid structure, falling through to chunked pipeline');
      } catch (e) {
        console.error('[structure-fallback] PATH 0: JSON parse failed, falling through:', e);
      }
    } else {
      console.warn('[structure-fallback] PATH 0: pi-bansos returned null, falling through to chunked pipeline');
    }

    // ═══════════════════════════════════════════════════════
    // PATH 1 (LEGACY): Multi-chunk Polyvor Gateway pipeline
    // Kept as fallback when pi-bansos fails. Has ~65s TPM wait per chunk.
    // ═══════════════════════════════════════════════════════
    const chunks = splitTranscriptIntoChunks(transcript, CHUNK_SIZE);
    const totalChunks = chunks.length;
    console.log('[structure-fallback] transcript:' + transcript.length + ' chars -> ' + totalChunks + ' chunk(s)');

    if (totalChunks === 1) {
      const userPrompt = buildUserMessage(chunks[0], materialTexts || []);
      const result = await tryModels(SYSTEM_PROMPT, userPrompt);
      if (result?.title && Array.isArray(result.kegiatanPembelajaran) && result.kegiatanPembelajaran.length > 0) {
        console.log('[structure-fallback] SUCCESS (' + result.kegiatanPembelajaran.length + ' kegiatan)');
        return Response.json(result);
      }
      console.error('[structure-fallback] All models exhausted');
      return Response.json({ error: 'fallback' });
    }

    console.log('[structure-fallback] Multi-chunk: ' + totalChunks + ' chunks, est time: ~' + Math.ceil(totalChunks * 65 / 60) + ' min');
    const firstPrompt = buildUserMessage(chunks[0], materialTexts || []);
    const firstResult = await tryModels(SYSTEM_PROMPT, firstPrompt);
    if (!firstResult?.title || !Array.isArray(firstResult.kegiatanPembelajaran)) { console.error('[structure-fallback] First chunk failed'); return Response.json({ error: 'fallback' }); }
    console.log('[structure-fallback] Chunk 1 OK: ' + firstResult.kegiatanPembelajaran.length + ' kegiatan');

    const continuations: any[] = [];
    for (let i = 1; i < totalChunks; i++) {
      console.log('[structure-fallback] Waiting ' + (TPM_DELAY_MS / 1000) + 's for TPM reset before chunk ' + (i + 1) + '...');
      await sleep(TPM_DELAY_MS);
      console.log('[structure-fallback] Chunk ' + (i + 1) + '/' + totalChunks + ' (' + chunks[i].length + ' chars)...');
      const contPrompt = '--- TRANSCRIPT AUDIO (lanjutan) ---\n' + chunks[i];
      const contResult = await tryModels(SYSTEM_PROMPT_CONT, contPrompt);
      if (contResult?.kegiatanPembelajaran?.length > 0) { continuations.push(contResult); console.log('[structure-fallback] Chunk ' + (i + 1) + ' OK: ' + contResult.kegiatanPembelajaran.length + ' kegiatan'); }
      else { console.error('[structure-fallback] Chunk ' + (i + 1) + ' FAILED'); }
    }

    const merged = mergeResults(firstResult, continuations);
    console.log('[structure-fallback] MERGED: ' + merged.kegiatanPembelajaran.length + ' kegiatan');
    return Response.json(merged);
  } catch (e) { console.error('[structure-fallback] Error:', e); return Response.json({ error: 'fallback' }); }
};
