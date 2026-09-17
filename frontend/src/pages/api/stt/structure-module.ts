import type { APIRoute } from 'astro';
import { callPolyvor, extractJson, MODELS } from '@/lib/gateway-client';

// ─── Gateway Prompts (user spec) ───────────────────────────
const GATEWAY_STRUCT_PROMPT = `Kamu adalah asisten akademik. Kamu akan menerima transkrip suara (speech-to-text) dari perkuliahan, kemungkinan mentah (typo, tanpa tanda baca rapi, ada pengulangan kata).

Tugasmu:
1. Bersihkan transkrip tanpa mengubah makna aslinya.
2. Susun jadi hierarki modul: Bab -> Subbab -> Poin penting.
3. Sertakan juga: definisi penting, contoh kasus, dan kesimpulan jika ada.
4. Output HANYA JSON valid, tanpa teks lain, tanpa markdown fence:

{
  "judul_modul": "",
  "bab": [
    {
      "nama_bab": "",
      "subbab": [
        { "nama_subbab": "", "poin": [""] }
      ]
    }
  ]}`;

const GATEWAY_SUMMARY_PROMPT = `Kamu adalah asisten yang membuat ringkasan modul kuliah.

Tugasmu:
1. Baca struktur JSON modul (bab -> subbab -> poin).
2. Buat ringkasan singkat (2-3 kalimat) untuk setiap bab, merangkum inti dari subbab & poin di dalamnya.
3. Output HANYA JSON valid tanpa fence, format:

{
  "judul_modul": "",
  "ringkasan_bab": [
    { "nama_bab": "", "ringkasan": "" }
  ]}`;

// ─── Groq Fallback (existing chunk system) ────────────────
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = ['groq/compound', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b'];
const MAX_TOTAL_TOKENS = 7500;
const MAX_OUTPUT_TOKENS = 4096;
const MAX_CHARS_PER_CHUNK = 2500;
const MAX_SLIDE_CHARS_PER_SLIDE = 350;
const MAX_TOTAL_SLIDE_CHARS = 1000;
const TPM_DELAY_MS = 65_000;

const GROQ_SYSTEM_PROMPT = `Kamu mengubah materi kuliah menjadi modul catatan pembelajaran terstruktur dalam Bahasa Indonesia formal.

SUMBER INPUT:
- "--- TRANSCRIPT AUDIO ---" : hasil STT dari rekaman dosen.
- "--- MATERI SLIDE ---" : konten slide presentasi.

ATURAN:
1. Gunakan SLIDE sebagai kerangka, TRANSCRIPT sebagai pelengkap.
2. Gabung topik sama jadi SATU section.
3. Tabel dari slide WAJIB jadi field "tables" dengan headers dan rows.
4. Buang filler words, perbaiki typo STT, rangkum kalimat bertele-tele.
5. JANGAN salin transcript mentah.
6. Judul kegiatan = frasa singkat maks 8 kata.
7. stimulus = 1 kalimat pemantik.
8. steps/reviewNotes HANYA jika ada prosedur eksplisit, else null.
9. rangkumanAkhir 5-8 poin inti SEMUA kegiatan.
10. entitasPenting: tools, namaOrang, angkaAturan, istilahTeknis, kodeRumus.
11. identitas.mataPelajaran dan kelas: tebak dari konten.
12. Buat SEMUA kegiatan yang tercover di transcript.

Kembalikan HANYA JSON valid:
{"title":"...","identitas":{"mataPelajaran":"...","kelas":"..."},"pendahuluan":"...","tujuanPembelajaran":["..."],"kegiatanPembelajaran":[{"title":"...","stimulus":"...","materi":["paragraf1"],"tables":[{"headers":["Kolom1"],"rows":[["val1"]]}],"steps":null,"reviewNotes":null}],"rangkumanAkhir":["..."],"entitasPenting":{"tools":[],"namaOrang":[],"angkaAturan":[],"istilahTeknis":[],"kodeRumus":[]}}`;

const GROQ_SYSTEM_PROMPT_CONT = `Lanjutkan strukturisasi transcript ini jadi kegiatan pembelajaran.

ATURAN:
1. Buat SEMUA kegiatanPembelajaran. Jangan ulang topik.
2. Judul MELANJUTKAN topik sebelumnya.
3. Buang filler, perbaiki typo, rangkum.
4. JANGAN salin transcript mentah.
5. Tables WAJIB pakai field "tables". steps/reviewNotes HANYA jika prosedur, else null.

Kembalikan HANYA JSON:
{"kegiatanPembelajaran":[{"title":"...","stimulus":"...","materi":["paragraf1"],"tables":null,"steps":null,"reviewNotes":null}],"rangkumanAkhir":["..."]}`;

const RETRYABLE = [502, 503, 504, 429, 400, 413];
const NON_RETRYABLE = ['invalid_api_key', 'authentication', 'insufficient_quota'];

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function extractJsonGroq(text: string): string {
  const cb = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cb) return cb[1].trim();
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : text;
}
function splitTranscript(transcript: string, max: number): string[] {
  if (transcript.length <= max) return [transcript];
  const chunks: string[] = [];
  const sents = transcript.split(/(?<=[.!?])\s+/);
  let cur = '';
  for (const s of sents) {
    if (cur.length + s.length > max && cur.length > max * 0.3) { chunks.push(cur.trim()); cur = s; }
    else cur += (cur ? ' ' : '') + s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}
function buildSlideSection(mt: string[]): string {
  if (!mt?.length) return '';
  let total = 0; const parts: string[] = [];
  for (let i = 0; i < mt.length; i++) {
    if (total >= MAX_TOTAL_SLIDE_CHARS) break;
    const allowed = Math.min(MAX_SLIDE_CHARS_PER_SLIDE, MAX_TOTAL_SLIDE_CHARS - total, mt[i].length);
    if (allowed > 50) { parts.push('--- Slide ' + (i+1) + ' ---\n' + mt[i].slice(0, allowed)); total += allowed; }
  }
  return parts.length ? '--- MATERI SLIDE ---\n' + parts.join('\n\n') : '';
}

async function groqCall(model: string, sys: string, user: string, maxTok: number): Promise<string | null> {
  for (let a = 0; a < 3; a++) {
    try {
      if (a > 0) { const d = [30000,60000][a-1]; console.log('[struct-groq] ' + model + ' retry ' + (a+1) + ', wait ' + d/1000 + 's'); await sleep(d); }
      const res = await fetch(GROQ_URL, {
        method: 'POST', headers: { Authorization: 'Bearer ' + (process.env.GROQ_API_KEY || ''), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: 0.2, max_tokens: maxTok }),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) { const d = await res.json(); return d.choices?.[0]?.message?.content || null; }
      const err = await res.text().catch(() => '');
      console.error('[struct-groq] ' + model + ' HTTP ' + res.status);
      if (NON_RETRYABLE.some(m => err.toLowerCase().includes(m))) break;
      if (!RETRYABLE.includes(res.status)) break;
    } catch (e: any) { console.error('[struct-groq] ' + model + ' err:', e?.message); }
  }
  return null;
}
async function groqTryModels(sys: string, user: string): Promise<any | null> {
  const est = Math.ceil((sys.length + user.length) * 0.65);
  const maxTok = Math.max(1024, Math.min(MAX_OUTPUT_TOKENS, MAX_TOTAL_TOKENS - est));
  for (const m of GROQ_MODELS) {
    console.log('[struct-groq] Trying ' + m + '...');
    const raw = await groqCall(m, sys, user, maxTok);
    if (!raw) continue;
    try { return JSON.parse(extractJsonGroq(raw)); } catch { console.error('[struct-groq] ' + m + ': parse fail'); }
  }
  return null;
}
function mergeResults(first: any, conts: any[]): any {
  const allK = [...(first.kegiatanPembelajaran || [])];
  const allR = [...(first.rangkumanAkhir || [])];
  const allE = first.entitasPenting || { tools:[], namaOrang:[], angkaAturan:[], istilahTeknis:[], kodeRumus:[] };
  for (const c of conts) {
    if (c.kegiatanPembelajaran) allK.push(...c.kegiatanPembelajaran);
    if (c.rangkumanAkhir) allR.push(...c.rangkumanAkhir);
  }
  return { title: first.title||'Modul', identitas: first.identitas||{mataPelajaran:'Umum',kelas:'-'}, pendahuluan: first.pendahuluan||'', tujuanPembelajaran: first.tujuanPembelajaran||[], kegiatanPembelajaran: allK, rangkumanAkhir: [...new Set(allR)].slice(-8), entitasPenting: allE };
}

// ─── Groq Chunk Pipeline (fallback) ─────────────────────
async function groqPipeline(transcript: string, materialTexts: string[]): Promise<any | null> {
  if (!process.env.GROQ_API_KEY) { console.error('[struct-groq] No GROQ_API_KEY'); return null; }
  const chunks = splitTranscript(transcript, MAX_CHARS_PER_CHUNK);
  console.log('[struct-groq] ' + transcript.length + ' chars -> ' + chunks.length + ' chunk(s)');
  if (chunks.length === 1) {
    const slideSection = buildSlideSection(materialTexts || []);
    const userPrompt = '--- TRANSCRIPT AUDIO ---\n' + chunks[0] + '\n\n' + slideSection;
    const result = await groqTryModels(GROQ_SYSTEM_PROMPT, userPrompt);
    if (result?.title && result.kegiatanPembelajaran?.length > 0) { console.log('[struct-groq] Single chunk OK'); return result; }
    return null;
  }
  const slideSection = buildSlideSection(materialTexts || []);
  const first = await groqTryModels(GROQ_SYSTEM_PROMPT, '--- TRANSCRIPT AUDIO ---\n' + chunks[0] + '\n\n' + slideSection);
  if (!first?.title || !first.kegiatanPembelajaran) return null;
  const conts: any[] = [];
  for (let i = 1; i < chunks.length; i++) {
    console.log('[struct-groq] TPM wait ' + TPM_DELAY_MS/1000 + 's before chunk ' + (i+1));
    await sleep(TPM_DELAY_MS);
    const c = await groqTryModels(GROQ_SYSTEM_PROMPT_CONT, '--- TRANSCRIPT AUDIO (lanjutan) ---\n' + chunks[i]);
    if (c?.kegiatanPembelajaran?.length > 0) conts.push(c);
  }
  return mergeResults(first, conts);
}

// ─── Gateway Pipeline ─────────────────────────────────────
async function gatewayPipeline(transcript: string, materialTexts: string[]): Promise<any | null> {
  // Step 1: transcript → JSON module structure
  console.log('[struct-gw] Step 1: transcript → JSON structure (' + MODELS.structure + ')...');
  const maxInput = 12000;
  const truncated = transcript.length > maxInput ? transcript.slice(0, maxInput) + '\n[...dipotong...]' : transcript;
  const slideSection = buildSlideSection(materialTexts || []);
  const userContent = '--- TRANSCRIPT AUDIO ---\n' + truncated + '\n\n' + slideSection;

  const structRaw = await callPolyvor(MODELS.structure, GATEWAY_STRUCT_PROMPT, userContent, { maxTokens: 6144, timeout: 120000 });
  if (!structRaw) return null;

  let moduleJson: any;
  try { moduleJson = JSON.parse(extractJson(structRaw)); } catch { console.error('[struct-gw] Structure parse failed'); return null; }

  if (!moduleJson.judul_modul && !moduleJson.bab) { console.error('[struct-gw] Invalid structure'); return null; }
  console.log('[struct-gw] Structure OK: ' + (moduleJson.bab?.length || 0) + ' bab');

  // Step 2: JSON → summary per bab
  console.log('[struct-gw] Step 2: JSON → summary (' + MODELS.summary + ')...');
  const summaryRaw = await callPolyvor(MODELS.summary, GATEWAY_SUMMARY_PROMPT, JSON.stringify(moduleJson), { maxTokens: 4096, timeout: 90000 });
  let summaryData: any = null;
  if (summaryRaw) {
    try { summaryData = JSON.parse(extractJson(summaryRaw)); } catch { console.error('[struct-gw] Summary parse failed'); }
  }

  // Convert gateway format → existing app format
  const kegiatanPembelajaran = (moduleJson.bab || []).map((bab: any) => ({
    title: bab.nama_bab,
    stimulus: '',
    materi: (bab.subbab || []).map((sb: any) => {
      const parts = [sb.nama_subbab];
      if (sb.poin?.length) parts.push(sb.poin.join('; '));
      return parts.join(' — ');
    }),
    tables: null, steps: null, reviewNotes: null,
  }));

  const ringkumanAkhir = summaryData?.ringkasan_bab?.map((r: any) => r.ringkasan) || [];
  const entitasPenting = { tools: [], namaOrang: [], angkaAturan: [], istilahTeknis: [], kodeRumus: [] };

  return {
    title: moduleJson.judul_modul || 'Modul Pembelajaran',
    identitas: { mataPelajaran: '', kelas: '-' },
    pendahuluan: '',
    tujuanPembelajaran: [],
    kegiatanPembelajaran,
    rangkumanAkhir,
    entitasPenting,
    _gatewaySummary: summaryData,
    _gatewayModule: moduleJson,
  };
}

// ─── Main Route ───────────────────────────────────────────
export const POST: APIRoute = async ({ request }) => {
  try {
    const { transcript, materialTexts } = await request.json();
    if (!transcript?.trim()) return Response.json({ error: 'Transcript kosong' }, { status: 400 });

    // ═══════════════════════════════════════════════════════
    // PATH 1: Gateway Pipeline (Polyvor)
    // ═══════════════════════════════════════════════════════
    if (process.env.GATEWAY_API_KEY) {
      console.log('[structure-module] Trying Gateway pipeline...');
      try {
        const result = await gatewayPipeline(transcript, materialTexts || []);
        if (result?.kegiatanPembelajaran?.length > 0) {
          console.log('[structure-module] Gateway SUCCESS (' + result.kegiatanPembelajaran.length + ' kegiatan)');
          return Response.json({ ...result, source: 'gateway' });
        }
      } catch (e) { console.error('[structure-module] Gateway error:', e); }
      console.log('[structure-module] Gateway failed, falling back to Groq chunks...');
    }

    // ═══════════════════════════════════════════════════════
    // PATH 2: Groq Chunk Fallback
    // ═══════════════════════════════════════════════════════
    console.log('[structure-module] Using Groq chunk fallback...');
    const result = await groqPipeline(transcript, materialTexts || []);
    if (result) {
      console.log('[structure-module] Groq SUCCESS (' + result.kegiatanPembelajaran.length + ' kegiatan)');
      return Response.json({ ...result, source: 'groq' });
    }
    return Response.json({ error: 'fallback' });
  } catch (e) {
    console.error('[structure-module] Unhandled:', e);
    return Response.json({ error: 'fallback' });
  }
};
