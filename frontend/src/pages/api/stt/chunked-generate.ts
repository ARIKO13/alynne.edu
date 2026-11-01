import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { callLLM, extractJson, safeParseJson } from '@/lib/gateway-client';
import { d1 } from '@/lib/d1-client';

/**
 * POST /api/stt/chunked-generate  (route renamed from mega-generate, internal algo tetap 2-phase hybrid DeepSeek+GLM)
 *
 * MEGA-REQUEST: 1 LLM call → semua artefak belajar (modul + kuis + visualisasi +
 * mindmap + glosarium + coverage_checklist). Routes to Polyvor phala GLM-5.3-Flash.
 *
 * Per user spec (2026-10-25):
 *   - max_tokens: 131072 (Level 1 default)
 *   - Tiered fallback L1→L2→L3→L4 dengan prompt adjustment per level
 *   - Validasi: JSON valid + bab count >= minBab + coverage_checklist != []
 *   - D1 server-side cache → test ulang = 0 request
 *   - Tanpa chunking — kirim transcript utuh (up to 700K chars)
 *   - Flashcard dihapus, ganti "visualisasi" untuk STEM
 */

const MAX_TRANSCRIPT_CHARS = 700000;

const MEGA_SYSTEM_PROMPT = `You are a mega-generator for Indonesian educational content. Given a raw STT transcript, generate ALL learning artifacts in ONE JSON response.

LANGUAGE — CRITICAL:
- The transcript is in BAHASA INDONESIA (Indonesian)
- ALL output MUST be in Bahasa Indonesia
- DO NOT translate to English (except technical terms already English in source)

CRITICAL — DO NOT SUMMARIZE materi:
- modul bab content = FULL transcript text for that topic (greetings stripped)
- DO NOT condense or summarize materi
- kuis/visualisasi can paraphrase (they're derivatives, not materi text)

STRIP GREETINGS + INTERMEZZO (for modul content only):
- REMOVE: "Selamat pagi", "Halo", "warga CPL", "teman-teman", "guys"
- REMOVE: jokes, casual asides, "ok kita lanjut", "jadi gini", "gua mau bahas"
- KEEP: pure educational substance (materi)

CRITICAL — OUTPUT FORMAT:
- Output MUST be parseable JSON. First character MUST be '{'.
- NO prose, NO reasoning, NO thinking text before the JSON.
- NO markdown fences. Just JSON.
- Use \\n for newlines inside string values.
- If output truncated, ALL artifacts lost. Stay within max_tokens budget.
- Prioritize COMPLETE valid JSON over more content.

OUTPUT STRUCTURE (NO flashcard, NEW field "visualisasi"):
{
  "modul": {
    "judul": "Judul Modul (max 100 char)",
    "bab": [
      {
        "id": 1,
        "judul": "Judul Bab (max 8 kata)",
        "tujuan": "Tujuan belajar (1-2 kalimat)",
        "konsep_kunci": ["konsep 1", "konsep 2"],
        "penjelasan": "FULL transcript text untuk topik bab ini, greetings stripped",
        "contoh": "Contoh konkret (atau null)"
      }
    ]
  },
  "kuis": [
    {
      "id": 1,
      "bab_id": 1,
      "soal": "Pertanyaan kuis",
      "opsi": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "jawaban": "A",
      "pembahasan": "Ringkas (1-2 kalimat)"
    }
  ],
  "visualisasi": [
    {
      "id": "vis-001",
      "bab_id": 1,
      "subjek": "Matematika | Fisika | Kimia | Biologi | Umum",
      "judul": "Judul Visualisasi",
      "tipe": "grafik_fungsi | diagram_gaya | diagram_alur | diagram_konsep | grafik_gerak | rangkaian_listrik | struktur_molekul | diagram_sel | grafik_batang | grafik_garis | grafik_pie | tabel_data | rumus_latex",
      "deskripsi": "Deskripsi singkat (1-2 kalimat) untuk konteks",
      "data": { ... },
      "render_hint": "plotly | mermaid_flowchart | mermaid_mindmap | svg_diagram | chartjs | katex | html_table | smiles"
    }
  ],
  "mindmap": {
    "root": "Judul Materi",
    "cabang": [
      { "nama": "Bab 1", "sub": ["sub 1", "sub 2"] }
    ]
  },
  "glosarium": [
    { "istilah": "Istilah teknis", "definisi": "Definisi singkat" }
  ],
  "coverage_checklist": [
    { "bagian_transkrip": "rentang/topik", "masuk_ke_modul": "bab id" }
  ]
}

VISUALISASI RULES (CRITICAL):
- JANGAN menulis kode SVG, HTML, atau JavaScript langsung di field "data".
- Output HANYA data terstruktur (JSON) yang mendeskripsikan APA yang harus
  digambar, BUKAN BAGAIMANA menggambarnya.
- Pilih "tipe" dan "render_hint" dari daftar di atas.
- Untuk persamaan matematika, gunakan format LaTeX di field "persamaan".
- Batasi 1-3 visualisasi per bab, hanya untuk konsep yang BENAR-BENAR butuh
  representasi visual.
- Kalau materi gak butuh visualisasi (sejarah, bahasa, sosiologi) → array kosong

REMEMBER: Output JSON ONLY. First char = '{'. Last char = '}'. No prose.`;

// ── Tiered max_tokens strategy (per user spec 2026-10-25, revised) ──────────
// v-stabil: L3 (ringkas_lengkap, 65K) sekarang DEFAULT.
// Alasan user: L1 131K terlalu berat (~15 menit, rawan timeout), output 60-90K
// token sering truncated di provider free-tier. L3 (65K) → output ~35K token,
// waktu ~5-8 menit, risiko terpotong rendah. Semua bab tetap ada (80-120 kata/bab),
// kuis 15-20 soal, visualisasi esensial saja.
//
// Urutan baru: L3 → L4 → L2 → L1 (naik kapasitas hanya kalau L3 & L4 gagal).
// L4 (32K sangat_ringkas) jadi fallback utama (lebih cepat lagi, ~4 menit).
// L2 (100K) dan L1 (131K) sebagai last-resort untuk materi sangat panjang yang
// LLM tetap nggak bisa muat dalam 65K output.
const MEGA_LEVELS = [
  { maxTokens: 65536, mode: 'ringkas_lengkap' as const, label: 'L3-65K-ringkas-DEFAULT' },
  { maxTokens: 32768, mode: 'sangat_ringkas' as const, label: 'L4-32K-sangat-ringkas' },
  { maxTokens: 100000, mode: 'lengkap' as const, label: 'L2-100K-lengkap' },
  { maxTokens: 131072, mode: 'lengkap' as const, label: 'L1-131K-lengkap' },
];

function buildMegaPrompt(mode: 'lengkap' | 'ringkas_lengkap' | 'sangat_ringkas'): string {
  if (mode === 'lengkap') {
    return MEGA_SYSTEM_PROMPT + `

QUANTITY (lengkap, max_tokens tinggi):
- bab: 5-15 (proportionate to content)
- kuis: 2-3 per bab (10-30 total), pembahasan 1-2 kalimat
- visualisasi: 0-3 per bab, hanya kalau butuh
- glosarium: 10-20 istilah
- Setiap bab penjelasan 200-2000 kata, 1-2 contoh

Output JSON ONLY. First char = '{'. Last char = '}'.`;
  }

  if (mode === 'ringkas_lengkap') {
    return MEGA_SYSTEM_PROMPT + `

CRITICAL — RINGKAS TAPI LENGKAP (max_tokens terbatas, harus hemat):
- SEMUA bab dari materi WAJIB ada. Jangan hilangkan bab mana pun.
- Setiap bab: uraian 80-120 kata (bukan 300), 1 contoh (bukan 2),
  konsep_kunci MAKSIMAL 3, tanpa "kesalahan umum" kalau ruang sempit.
- Kuis: 15-20 soal total (bukan 30), pembahasan 1 kalimat.
- Visualisasi: MAKSIMAL 1 per bab, hanya yang PALING penting.
- Glosarium: 10-15 istilah inti saja.
- Mindmap: cabang utama saja, sub MAKSIMAL 3 per cabang.
- Coverage checklist WAJIB tetap ada dan lengkap.

PRIORITAS jika ruang menipis (wajib urut ini):
1. Semua judul bab + tujuan pembelajaran
2. Konsep kunci tiap bab
3. Kuis (1 per bab minimal)
4. Coverage checklist lengkap
5. Sisanya boleh dipangkas

Output JSON ONLY. First char = '{'. Last char = '}'.`;
  }

  // sangat_ringkas
  return MEGA_SYSTEM_PROMPT + `

CRITICAL — SANGAT RINGKAS (max_tokens sangat terbatas, hemat maksimal):
- SEMUA bab WAJIB ada. Jangan hilangkan bab mana pun.
- Setiap bab: uraian 40-80 kata, 1 contoh (atau null), konsep_kunci MAKSIMAL 2
- Kuis: 10-15 soal total, tanpa pembahasan (opsi + jawaban only)
- Visualisasi: MAKSIMAL 1 per 2 bab (skip yang kurang penting)
- Glosarium: 5-10 istilah inti
- Mindmap: hanya cabang utama, sub MAKSIMAL 2 per cabang
- Coverage checklist WAJIB lengkap

PRIORITAS mutlak:
1. Semua judul bab + tujuan (WAJIB semua bab ada)
2. Konsep kunci tiap bab (1-2 kata)
3. Coverage checklist
4. Kuis (1 per bab)
5. Sisanya boleh null atau skip

Output JSON ONLY. First char = '{'. Last char = '}'.`;
}

// cyrb53 — hash for cache key
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// NOTE: extractBalancedJson + tryJsonParse dihapus di v-robust (2026-10-25).
// Sekarang pakai safeParseJson unified parser dari gateway-client.ts yang:
//   1. Direct JSON.parse
//   2. Strip markdown fence ```json ... ```
//   3. Balanced-brace extraction dengan escape handling
// Lebih robust dari implementasi lama + dipakai konsisten di seluruh codebase.

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as { transcript?: string; title?: string; maxChapters?: number };
    const transcript = (body.transcript || '').trim();
    const title = (body.title || '').trim() || 'Materi Belajar';

    if (!transcript || transcript.length < 100) {
      return Response.json({ error: 'Transcript too short (min 100 chars)' }, { status: 400 });
    }

    // ── SERVER-SIDE CACHE LOOKUP (D1) ──
    // v-chunked: cache key include version prefix supaya cache lama (algo lama)
    // gak di-return. v5 = DeepSeek ringkas → GLM strukturkan hybrid.
    // v6-4sec-2026-10-25 = bump dari v5: tambah Phase 2 jadi 4 sections (was 3).
    // v7-stable-2026-10-25 = per-chunk retry + minimal fallback + pLimit 2.
    // v8-no-error-2026-10-25 = hard deadline per phase.
    // v9-fast-2026-10-25 = pLimit 2→5, Phase 2 model GLM→DeepSeek, hapus retry,
    // hapus regex fallback, friendly error UI. Total target 66-100s (was 350s).
    // v11-fix-ringsak-2026-10-25: client-side pre-summarize (Chrome Summarizer API)
    // SEBELUM kirim ke server. Kalau Chrome API available: 219K → 40-60K char ringkasan
    // → server skip Phase 1 (DeepSeek, 0 LLM req) → langsung Phase 2 (GLM/DeepSeek bagi tugas, 2 LLM req).
    // Kalau Chrome API gak available: raw transcript → Phase 1 DeepSeek (5 LLM req) → Phase 2 (2-4 LLM req).
    const ALGORITHM_VERSION = 'v18-nvidia-2026-10-28';
    const materiHash = cyrb53(`${ALGORITHM_VERSION}:${transcript}`);
    try {
      await d1.execute(`
        CREATE TABLE IF NOT EXISTS mega_cache (
          materi_hash TEXT PRIMARY KEY,
          materi_data TEXT NOT NULL,
          transcript_chars INTEGER,
          model_used TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          user_email TEXT
        )
      `);
      const cached = await d1.query<{ materi_data: string; created_at: string; model_used: string; transcript_chars: number }>(
        `SELECT materi_data, created_at, model_used, transcript_chars
         FROM mega_cache WHERE materi_hash = ? LIMIT 1`,
        [materiHash]
      );
      if (cached.length > 0) {
        const row = cached[0];
        const ageHours = (Date.now() - new Date(row.created_at + 'Z').getTime()) / (1000 * 60 * 60);
        if (ageHours < 7 * 24) {
          try {
            const megaData = JSON.parse(row.materi_data);
            console.log(`[chunked-generate] CACHE HIT hash=${materiHash.slice(0, 12)}... (age: ${ageHours.toFixed(1)}h) — 0 LLM call`);
            return Response.json({
              cached: true,
              ...megaData,
              cacheMeta: { age: `${ageHours.toFixed(1)}h`, modelUsed: row.model_used, transcriptChars: row.transcript_chars, createdAt: row.created_at },
            });
          } catch {
            await d1.execute('DELETE FROM mega_cache WHERE materi_hash = ?', [materiHash]);
          }
        }
      } else {
        console.log(`[chunked-generate] Cache MISS hash=${materiHash.slice(0, 12)}...`);
      }
    } catch (cacheErr) {
      console.warn('[chunked-generate] Cache lookup failed (non-fatal):', (cacheErr as Error).message?.slice(0, 100));
    }

    // ── v-chunked (2026-10-25): adaptive chunking berbasis token budget per model ──
    // Token math (BI ~2.5 char/token):
    //   DeepSeek V4 input context = 128K → safe 12K tok/chunk = 50K char/chunk
    //   DeepSeek V4 throughput = 150 tok/s → output 6K tok = ~40s (under 120s gateway limit)
    //   GLM-5.3-Flash throughput = 71 tok/s → output 5K tok = ~70s (under 120s gateway limit)
    //   Output target 15 bab ringkas = ~10K tok → muat di 3 sections × 5K tok
    //
    // Total req (chunk = req):
    //   ≤21 lembar (≤30K char):  1 req   (Phase 1 skip, Phase 2 = 1 compact)
    //   21-35 lembar:             4 req   (Phase 1 = 1, Phase 2 = 3)
    //   35-70 lembar:             5 req   (Phase 1 = 2, Phase 2 = 3)
    //   70-140 lembar:            6 req   (Phase 1 = 3, Phase 2 = 3)
    //   140-210 lembar:           7 req   (Phase 1 = 4, Phase 2 = 3)
    //   210-300 lembar:           8 req   (Phase 1 = 5, Phase 2 = 3)
    //   300-430 lembar:           9 req   (Phase 1 = 6, Phase 2 = 3)
    //   >430 lembar:              reject  (minta user pecah upload)
    //
    // Phase 2 CONSTANT 3 sections karena output target (15 bab ringkas JSON ~10K tok)
    // gak berubah dengan input size. Cuma Phase 1 yang adaptive.
    const lembar = Math.ceil(transcript.length / 1400);
    console.log(`[chunked-generate] START: transcript ${transcript.length} chars, ~${lembar} lembar`);

    const MAX_TRANSCRIPT_CHARS_V2 = 600000;  // >430 lembar = reject
    if (transcript.length > MAX_TRANSCRIPT_CHARS_V2) {
      return Response.json({
        error: 'transcript_too_long',
        message: `Transcript ${transcript.length} chars (~${lembar} lembar) > batas 600K char (~430 lembar). Pecah jadi beberapa upload.`,
        maxChars: MAX_TRANSCRIPT_CHARS_V2,
        currentChars: transcript.length,
        currentLembar: lembar,
      }, { status: 400 });
    }

    // ── PHASE 1: DeepSeek ringkasan (adaptive chunks paralel) ──
    // Skip Phase 1 kalau transcript ≤ 30K char (sudah pendek, langsung ke Phase 2)
    const SKIP_PHASE1_THRESHOLD = 30000;
    const MAX_DEEPSEEK_CHUNK_CHARS = 50000;  // 50K char ≈ 12K input tok (safe under 128K context)
    const chunks = transcript.length > SKIP_PHASE1_THRESHOLD
      ? splitTranscriptByParagraph(transcript, MAX_DEEPSEEK_CHUNK_CHARS)
      : [];  // empty = skip Phase 1

    let materi_lengkap: string;  // v15: renamed from ringkasan — Phase 1 sekarang FILTER, BUKAN ringkas
    let phase1SuccessCount = 0;
    let phase1FailCount = 0;

    if (chunks.length === 0) {
      // Skip Phase 1: transcript ≤ 30K char, langsung pakai sebagai materi_lengkap
      materi_lengkap = transcript;
      console.log(`[chunked-generate] Phase 1 SKIPPED: transcript ${transcript.length} chars ≤ ${SKIP_PHASE1_THRESHOLD}K threshold — use as-is, 0 LLM call`);
    } else {
      // v15-arch: Phase 1 sekarang FILTER (preserve 70-85%), BUKAN ringkas.
      // maxTokens naik dari 6K → 10K supaya output materi_lengkap muat semua konten yang difilter.
      // timeout naik dari 60s → 90s untuk output lebih panjang (10K tok × 150 tok/s = 67s).
      // Prompt: DEEPSEEK_FILTER_PROMPT (clean + ## Topik markers, preserve all content).
      console.log(`[chunked-generate] Phase 1: DeepSeek FILTER ${chunks.length} chunk(s) paralel (max 10K tok each, pLimit(5), preserve 70-85%)`);
      const phase1Limiter = makeConcurrencyLimiter(5);  // v9-fast: pLimit 5 (was 2)
      const deepseekResults = await Promise.all(
        chunks.map((chunk, i) => phase1Limiter(() =>
          callLLM('long', DEEPSEEK_FILTER_PROMPT, chunk, {
            model: 'z-ai/glm-5.3-flash',
            fallbackModels: [],  // v16: no fallback, DeepSeek-only
            maxTokens: 10000,
            timeout: 300_000,
            temperature: 0.2,
            jsonMode: false,
            endpoint: `chunked-generate/p1-filter-chunk-${i + 1}-of-${chunks.length}`,
          })
        ))
      );

      const summaries = deepseekResults.filter(r => r.content).map(r => r.content!);
      phase1SuccessCount = summaries.length;
      phase1FailCount = chunks.length - phase1SuccessCount;
      if (summaries.length === 0) {
        // v-stable: jangan crash kalau Phase 1 all failed. Lanjut ke Phase 2 dengan transcript utuh
        // (kalau ≤ 600K char, muat di DeepSeek context 128K token). Quality turun tapi gak crash.
        console.log(`[chunked-generate] Phase 1 ALL FAILED — using raw transcript as materi_lengkap (degraded)`);
        materi_lengkap = transcript.slice(0, 100_000);  // cap at 100K to fit Phase 2 input
      } else {
        materi_lengkap = summaries.join('\n\n');
        console.log(`[chunked-generate] Phase 1 FILTER done: ${phase1SuccessCount}/${chunks.length} chunks OK, ${phase1FailCount} failed, materi_lengkap ${materi_lengkap.length} chars (${(materi_lengkap.length * 100 / transcript.length).toFixed(0)}% retention)`);
      }
    }

    // ── PHASE 1.5: SUMMARY via Chatr (gratis) + fallback Resoomer (v15-arch) ──
    // Chatr = single HTTP POST ke Supabase, ~2-5s, no LLM di gateway kita.
    // Threshold: max(300, materi_lengkap.length * 0.005) — kalau Chatr return < 0.5% dari
    // materi_lengkap, terlalu pendek → fallback ke Resoomer (lebih panjang, 7% retention).
    // Untuk input > 5K char, juga panggil Resoomer sebagai "Ringkasan Sedang" toggle di UI.
    const chatrThreshold = Math.max(300, Math.floor(materi_lengkap.length * 0.005));
    let ringkasan_padat = '';       // dari Chatr (default "Padat" di UI)
    let ringkasan_sedang = '';      // dari Resoomer (opsional toggle "Sedang" di UI)

    console.log(`[chunked-generate] Phase 1.5: Chatr summary (threshold ${chatrThreshold} chars, materi_lengkap ${materi_lengkap.length} chars)`);
    const chatrResult = await callChatrSummary(materi_lengkap);
    if (chatrResult && chatrResult.length >= chatrThreshold) {
      ringkasan_padat = chatrResult;
      console.log(`[chunked-generate] Chatr OK: ${materi_lengkap.length} → ${ringkasan_padat.length} chars (${(ringkasan_padat.length * 100 / materi_lengkap.length).toFixed(1)}% retention)`);
    } else {
      console.log(`[chunked-generate] Chatr too short: ${chatrResult?.length || 0} chars < ${chatrThreshold} threshold — will fallback to Resoomer`);
    }

    // Untuk input > 5K char, panggil Resoomer untuk "Ringkasan Sedang" toggle di UI
    if (materi_lengkap.length > 5000) {
      console.log(`[chunked-generate] Phase 1.5: Resoomer summary (for "Sedang" toggle)`);
      const resoomerResult = await callResoomerSummary(materi_lengkap, request.headers.get('cookie') || '');
      if (resoomerResult && resoomerResult.length > 100) {
        ringkasan_sedang = resoomerResult;
        console.log(`[chunked-generate] Resoomer OK: ${materi_lengkap.length} → ${ringkasan_sedang.length} chars (${(ringkasan_sedang.length * 100 / materi_lengkap.length).toFixed(1)}% retention)`);
      }
    }

    // Final fallback: kalau Chatr gak ada, pakai Resoomer sebagai padat
    if (!ringkasan_padat && ringkasan_sedang) {
      ringkasan_padat = ringkasan_sedang;
      ringkasan_sedang = '';  // jangan duplikat
      console.log(`[chunked-generate] Using Resoomer as padat fallback (Chatr was empty)`);
    }

    // ── PHASE 2: Strukturkan ringkasan → JSON modul lengkap ──
    // v10-bagi-tugas (per user spec 2026-10-25):
    //   - Auto-detect GLM health (ping 10s). Kalau hidup → bagi tugas (GLM modul+vis, DeepSeek kuis+extras)
    //   - Kalau GLM mati → DeepSeek everything (4 sections, v9-fast fallback)
    //   - Kalau ≤21 lembar → 1 compact section (hemat request untuk materi pendek)
    //
    // Bagi tugas = 2 request paralel:
    //   GLM: modul (15 bab + visualisasi), max_tokens=8000, timeout=110s (fit 120s gateway limit @ 71 tok/s)
    //   DeepSeek: kuis + mindmap + glosarium + coverage, max_tokens=10000, timeout=70s (fit @ 150 tok/s)
    //   Wall time: max(113s, 67s) = ~113s ≈ 2 menit
    //
    // DeepSeek fallback = 4 request paralel (pLimit 5):
    //   4 × max_tokens=5000, timeout=60s. Wall time: ~33s (1 gelombang)
    
    // v10: GLM health check
    // v16-all-deepseek: Phase 2 selalu DeepSeek-only, no GLM health check, no bagi-tugas.
    // User request: "semuanya libatin deepseek". GLM + Gemini Flash dihapus dari fallback chain
    // karena bermasalah terus (GLM timeout, Gemini Flash quota habis permanent -$0.01).
    // Sekarang: 4 sections × DeepSeek V4 Flash, parallel pLimit 2 (was 5 — kurangi strain gateway).

    interface Phase2Section {
      name: string;
      userPrompt: string;
      model: string;
      fallbackModels: string[];
      maxTokens: number;
      timeout: number;
    }

    const DS = 'z-ai/glm-5.3-flash';
    const DS_FALLBACK: readonly string[] = [];  // v16: no fallback, just retry DeepSeek

    let sections: Phase2Section[];
    if (lembar <= 21) {
      // Compact: 1 section, target 5 bab (hemat untuk materi pendek)
      sections = [{
        name: 'modul-compact',
        userPrompt: buildGLMCompactPrompt(materi_lengkap, title, 5),
        model: DS,
        fallbackModels: [...DS_FALLBACK],
        maxTokens: 10000,
        timeout: 300_000,
      }];
    } else {
      // v16-all-deepseek: 4 sections × DeepSeek V4 Flash, paralel pLimit 2
      sections = [
        { name: 'bab-1-4', userPrompt: buildGLMBabPrompt(materi_lengkap, title, 1, 4), model: DS, fallbackModels: [...DS_FALLBACK], maxTokens: 8000, timeout: 300_000 },
        { name: 'bab-5-8', userPrompt: buildGLMBabPrompt(materi_lengkap, title, 5, 8), model: DS, fallbackModels: [...DS_FALLBACK], maxTokens: 8000, timeout: 300_000 },
        { name: 'bab-9-12', userPrompt: buildGLMBabPrompt(materi_lengkap, title, 9, 12), model: DS, fallbackModels: [...DS_FALLBACK], maxTokens: 8000, timeout: 300_000 },
        { name: 'bab-13-15-extras', userPrompt: buildGLMBabAndExtrasPrompt(materi_lengkap, title, 13, 15), model: DS, fallbackModels: [...DS_FALLBACK], maxTokens: 8000, timeout: 300_000 },
      ];
    }

    const totalReq = chunks.length + sections.length;
    const modeLabel = 'DEEPSEEK-ONLY (v16)';
    console.log(`[chunked-generate] Phase 2: ${modeLabel} ${sections.length} section(s) paralel — total req this call: ${totalReq} (${chunks.length} DeepSeek p1 + ${sections.length} p2)`);

    const phase2Limiter = makeConcurrencyLimiter(2);  // v16: pLimit 2 (was 5) — kurangi strain gateway
    const glmResults = await Promise.all(
      sections.map(s => phase2Limiter(() => callLLM('long', GLM_STRUCTURE_SYSTEM_PROMPT, s.userPrompt, {
        model: s.model,
        fallbackModels: s.fallbackModels,
        maxTokens: s.maxTokens,
        timeout: s.timeout,
        temperature: 0.3,
        jsonMode: true,
        endpoint: `chunked-generate/p2-${s.name}`,
      })))
    );

    // Merge section results
    let merged = mergeGLMSections(glmResults, title);
    if (!merged || !merged.modul?.bab?.length) {
      // v12-fix-chatr: kalau Phase 2 ALL FAILED, jangan crash. Build fallback yang LEBIH BERMANFAAT
      // dari raw materi_lengkap — pecah jadi multiple bab berdasarkan paragraph (~600 char per bab).
      // User tetap dapat something, UI gak blank, gak 500 error, dan materi lumayan detail.
      console.error(`[chunked-generate] Phase 2 ALL FAILED after retry — building paragraph-split fallback response (multiple bab dari materi_lengkap, gak crash)`);
      // Pecah materi_lengkap jadi multiple paragraph — setiap paragraf jadi 1 bab
      const paragraphs = materi_lengkap.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 50);
      // Atau split per ~600 char kalau cuma 1 paragraf panjang
      let chunks: string[] = [];
      if (paragraphs.length >= 3) {
        chunks = paragraphs;
      } else {
        // Manual chunk: ambil per 600 char (atau kelipatan sentence)
        const sentences = materi_lengkap.match(/[^.!?]+[.!?]+/g) || [materi_lengkap];
        let cur = '';
        for (const s of sentences) {
          if (cur.length + s.length > 800 && cur.length > 0) {
            chunks.push(cur);
            cur = s;
          } else {
            cur += s;
          }
        }
        if (cur) chunks.push(cur);
      }
      // Cap max 15 bab
      const babChunks = chunks.slice(0, 15);
      console.log(`[chunked-generate] Fallback: ${babChunks.length} bab dari ${materi_lengkap.length} char materi_lengkap (${paragraphs.length} paragraphs source)`);
      merged = {
        modul: {
          judul: title,
          bab: babChunks.map((chunk, i) => ({
            id: i + 1,
            judul: i === 0 ? title.slice(0, 50) || 'Materi Belajar' : `Bagian ${i + 1}`,
            tujuan: `Materi belajar (mode fallback — server LLM sedang tidak stabil, coba lagi nanti untuk generate kuis + visualisasi)`,
            konsep_kunci: [],
            penjelasan: chunk,
            contoh: '',
          })),
        },
        kuis: [],
        visualisasi: [],
        mindmap: { root: title, cabang: [] },
        glosarium: [],
        coverage_checklist: babChunks.map((_, i) => ({ bagian_transkrip: `paragraf ${i + 1}`, masuk_ke_modul: `bab ${i + 1}` })),
      };
    }

    const babCount = merged.modul.bab.length;
    const kuisCount = merged.kuis?.length ?? 0;
    const visualisasiCount = merged.visualisasi?.length ?? 0;
    const glosariumCount = merged.glosarium?.length ?? 0;
    const coverageCount = merged.coverage_checklist?.length ?? 0;

    // v9-fast: estimasi waktu untuk client UI (progress bar). pLimit 5 = mostly 1 wave:
    //   Phase 1: 1 gelombang × ~40s (5 chunks parallel, DeepSeek 150 tok/s × 6K = 40s)
    //   Phase 2: 1 gelombang × ~33s (4 sections parallel, DeepSeek 150 tok/s × 5K = 33s)
    //   + 10s buffer untuk network + parse
    // Total target: 66-100s (jauh di bawah client timeout 320s)
    const estimatedPhase1Ms = chunks.length > 0 ? Math.ceil(chunks.length / 5) * 40_000 : 0;
    const estimatedPhase2Ms = Math.ceil(sections.length / 5) * 33_000;
    const estimatedTimeMs = estimatedPhase1Ms + estimatedPhase2Ms + 10_000;

    // v-robust: validasi output — cek struktur minimum + coverage checklist non-empty.
    // Bukan fallback ke regex (yang user bilang "sumber hasil buruk"), tapi log warning
    // supaya monitoring kelihatan kalau LLM sering balik hasil nggak lengkap.
    // Expected bab: ≤20 lembar = 5 bab, 20-100 = 15 bab, 100-300 = 15 bab.
    const expectedBab = lembar <= 20 ? 5 : 15;
    const validation = validateMegaResult(merged, expectedBab);
    if (validation.warnings.length > 0) {
      console.warn(`[chunked-generate] VALIDATION WARNINGS: ${validation.warnings.join('; ')}`);
    } else {
      console.log(`[chunked-generate] VALIDATION OK: ${babCount} bab (expected ≥${Math.floor(expectedBab * 0.8)}), coverage ${coverageCount}, kuis ${kuisCount}`);
    }

    console.log(`[chunked-generate] FINAL: ${babCount} bab, ${kuisCount} kuis, ${visualisasiCount} visualisasi, ${glosariumCount} glosarium, ${coverageCount} coverage (DeepSeek ${phase1SuccessCount}/${chunks.length} + GLM ${glmResults.filter(r => r.content).length}/${sections.length})`);

    // ── SAVE TO D1 CACHE ──
    // v15-arch: response sekarang include materi_lengkap + ringkasan_padat + ringkasan_sedang
    // (3 keluaran dari 1 upload). materi_lengkap = hasil filter Phase 1 (untuk tab Materi,
    // accordion per ## Topik). ringkasan_padat = Chatr summary (untuk tab Ringkasan default).
    // ringkasan_sedang = Resoomer summary (untuk toggle "Sedang" di tab Ringkasan, opsional).
    const megaResponse = {
      materi_lengkap,           // v15: ~160K char filtered (untuk tab Materi accordion)
      ringkasan_padat,          // v15: ~2-5K char dari Chatr (untuk tab Ringkasan default "Padat")
      ringkasan_sedang,         // v15: ~15K char dari Resoomer (untuk toggle "Sedang", bisa kosong)
      modul: merged.modul,
      kuis: merged.kuis || [],
      visualisasi: merged.visualisasi || [],
      mindmap: merged.mindmap || { root: title, cabang: [] },
      glosarium: merged.glosarium || [],
      coverage_checklist: merged.coverage_checklist || [],
      modelUsed: 'v15-arch:deepseek-filter→chatr+resoomer-summary→glm-struktur',
      levelUsed: `v15-${chunks.length}d-filter-${sections.length}g-struktur`,
      stats: {
        babCount, kuisCount, visualisasiCount, glosariumCount,
        coverageCount, transcriptChars: transcript.length,
        materiLengkapChars: materi_lengkap.length,
        ringkasanPadatChars: ringkasan_padat.length,
        ringkasanSedangChars: ringkasan_sedang.length,
        lembar, phase1SuccessCount, phase1FailCount,
        phase2SectionCount: sections.length,
        estimatedTimeMs,
        estimatedTimeLabel: estimatedTimeMs >= 60_000
          ? `~${Math.ceil(estimatedTimeMs / 60_000)} menit`
          : `~${Math.ceil(estimatedTimeMs / 1000)} detik`,
      },
    };

    try {
      const materiDataStr = JSON.stringify(megaResponse);
      await d1.execute(
        `INSERT OR REPLACE INTO mega_cache
         (materi_hash, materi_data, transcript_chars, model_used, user_email, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [materiHash, materiDataStr, transcript.length, megaResponse.modelUsed, session.user.email]
      );
      console.log(`[chunked-generate] SAVED to cache hash=${materiHash.slice(0, 12)}... (${materiDataStr.length} chars, level=${megaResponse.levelUsed})`);
    } catch (saveErr) {
      console.warn('[chunked-generate] Cache save failed (non-fatal):', (saveErr as Error).message?.slice(0, 100));
    }

    return Response.json({ ...megaResponse, cached: false });
  } catch (e: any) {
    // v9-fast (per user spec): NEVER return 500. Selalu 200 dengan friendly error.
    // User lihat "Coba lagi dalam 1 menit" di UI, bukan "TimeoutError: signal timed out".
    // Server log untuk debugging, user gak pernah lihat stack trace.
    console.log('[chunked-generate] caught error (returning friendly 200, not 500):', e?.message?.slice(0, 200));
    return Response.json({
      error: 'server_busy',
      message: 'Server sedang sibuk. Coba lagi dalam 1 menit.',
      retryAfterMs: 60_000,
      // NOTE: NO bab/kuis/visualisasi fields — client will see error and show friendly UI
    }, { status: 200 });  // 200 = soft error, client treats as data not network failure
  }
};

// ═══════════════════════════════════════════════════════════════════════
// v-hybrid helper functions (2026-10-25)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Split transcript by paragraph boundaries first, fallback to sentence split
 * if a single paragraph exceeds maxChars × 1.5.
 */
function splitTranscriptByParagraph(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
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

/**
 * Simple concurrency limiter (pLimit-style).
 * Limits number of in-flight async operations to `concurrency`.
 */
function makeConcurrencyLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const task = queue.shift()!;
    task();
  };
  return function<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        try {
          const r = await fn();
          resolve(r);
        } catch (e) {
          reject(e);
        } finally {
          active--;
          next();
        }
      };
      queue.push(run);
      next();
    });
  };
}

// v9-fast (2026-10-25): callDeepSeekChunkWithRetry + callGLMSectionWithRetry DIHAPUS.
// Sesuai spec user: no retry, single attempt, fail fast. pLimit 5 parallel bukan
// pLimit 2 sequential. 9 request selesai dalam 2 gelombang (~66-100s) bukan 5
// gelombang (~350s). Tanpa retry, gateway rate-limit gak ter-trigger lagi.

// v10-bagi-tugas: GLM health check — ping GLM dengan request kecil (max_tokens=10, timeout=10s).
// Kalau GLM balik content/reasoning → alive. Kalau null/timeout → dead.
// Digunakan untuk auto-switch antara "bagi tugas" (GLM+DeepSeek) vs "DeepSeek-only".
async function isGLMAlive(): Promise<boolean> {
  try {
    const result = await callLLM('fast', 'Balas dengan satu kata: OK', 'Health check', {
      model: 'z-ai/glm-5.3-flash',
      maxTokens: 10,
      timeout: 10_000,
      endpoint: 'chunked-generate/glm-health-check',
    });
    return result.content !== null && result.content.trim().length > 0;
  } catch {
    return false;
  }
}

// v10-bagi-tugas: prompt untuk GLM yang minta SEMUA 15 bab + visualisasi dalam 1 request.
// max_tokens=8000 (fit 120s gateway limit @ 71 tok/s = 113s).
// Output: {"modul":{"judul":"...","bab":[15 bab]},"visualisasi":[1 per bab maks]}
function buildGLMModulPrompt(ringkasan: string, title: string): string {
  return `Dari ringkasan berikut, susun JSON berisi modul lengkap (15 bab) + visualisasi per bab.

RINGKASAN:
${ringkasan.slice(0, 50000)}

Output JSON valid. Format: {"modul":{"judul":"${title}","bab":[{"id":1,"judul":"...","tujuan":"...","konsep_kunci":["...","...","..."],"penjelasan":"80-120 kata","contoh":"contoh konkret"}]},"visualisasi":[{"id":"vis-001","bab_id":1,"subjek":"Matematika|Fisika|Kimia|Biologi|Umum","judul":"...","tipe":"grafik_fungsi|diagram_alur|rumus_latex|tabel_data|grafik_batang|struktur_molekul|diagram_gaya|diagram_sel|rangkaian_listrik","deskripsi":"...","data":{...},"render_hint":"plotly|mermaid_flowchart|katex|html_table|chartjs|smiles|svg_diagram"}]}.
15 bab total (id 1-15), uraian 80-120 kata per bab, 1 contoh per bab.
Visualisasi maks 1 per bab, hanya untuk konsep STEM yang butuh gambar. Materi non-STEM = array kosong.`;
}

// ── DeepSeek FILTER prompt (Phase 1 v15: filter, BUKAN ringkas) ──
// v15-arch: Phase 1 sekarang FILTER (preserve 70-85% content), BUKAN ringkas.
// Output materi_lengkap = transkrip yang dibersihkan + diberi penanda ## Topik: <judul>
// untuk accordion di UI. Ringkasan dilakukan terpisah oleh Chatr (Phase 1.5, gratis).
const DEEPSEEK_FILTER_PROMPT = `Kamu asisten pembersih transkrip kuliah Bahasa Indonesia.

TUGAS: BERSIHKAN transkrip berikut, jangan ringkas. Pertahankan SEMUA konten substantif.

LANGKAH PEMBERSIHAN:
1. Hapus pengisi verbal: "um", "ah", "eh", "hmm", "kan", "gitu", "ya ya ya", "Oke", "eee", "Halo warga"
2. Normalisasi whitespace: gabungkan baris pendek, hapus spasi ganda
3. Hapus duplikat: kalimat yang diulang 2+ kali → tulis sekali
4. Hapus greeting/closing/sapaan: "selamat datang", "terima kasih", "okay guys", "breaking news nih"
5. Hapus intermezo off-topic: guyonan yang tidak nyambung dengan materi
6. Rapikan kalimat: gabungkan fragment kalimat, perbaiki grammar ringan
7. SISIPKAN "## Topik: <judul_topik>" di awal setiap bagian ketika TEMA BERUBAH SIGNIFIKAN
   (contoh: pindah dari teori → praktik, atau dari konsep A → konsep B)
   Judul topik = 2-5 kata yang menggambarkan isi bagian tersebut.

ATURAN RETENSI:
- Target output 70-85% dari panjang input
- PERTAHANKAN SEMUA: poin penting, angka, nama, definisi, contoh, langkah-langkah
- PERTAHANKAN SEMUA istilah teknis asli (Bahasa Inggris/Indonesia)
- Jangan gabungkan paragraf yang berbeda topik
- Tetap dalam Bahasa Indonesia

Output HANYA teks materi yang sudah dibersihkan + diberi penanda ## Topik:.
JANGAN tambahkan JSON, markdown fence, atau header lain di luar "## Topik:".`;

// Legacy alias (untuk backward-compat dengan kode lama yang manggil DEEPSEEK_SUMMARY_PROMPT)
const DEEPSEEK_SUMMARY_PROMPT = DEEPSEEK_FILTER_PROMPT;

// ── GLM structure system prompt (Phase 2) ──
const GLM_STRUCTURE_SYSTEM_PROMPT = `Kamu generator modul belajar Bahasa Indonesia. Output HANYA JSON valid.

ATURAN OUTPUT:
- First character WAJIB '{', last character WAJIB '}'
- NO markdown fences, NO prose, NO reasoning text before/after JSON
- Use \\n for newlines inside string values
- Jika output truncated, ALL artifacts lost — stay within budget

LANGUAGE: SEMUA output Bahasa Indonesia (kecuali istilah teknis Inggris di source).

STRUKTUR JSON (template):
{
  "modul": { "judul": "...", "bab": [{"id":1,"judul":"...","tujuan":"...","konsep_kunci":["..."],"penjelasan":"...","contoh":"..."}] },
  "kuis": [{"id":1,"bab_id":1,"soal":"...","opsi":["A. ...","B. ...","C. ...","D. ..."],"jawaban":"A","pembahasan":"..."}],
  "visualisasi": [
    {
      "id": "vis-001",
      "bab_id": 1,
      "subjek": "Matematika|Fisika|Kimia|Biologi|Umum",
      "judul": "Judul Visualisasi (max 8 kata)",
      "tipe": "grafik_fungsi|diagram_gaya|diagram_alur|diagram_konsep|grafik_gerak|grafik_batang|grafik_garis|grafik_pie|tabel_data|rumus_latex",
      "deskripsi": "Deskripsi singkat 1-2 kalimat untuk konteks",
      "data": { ... },
      "render_hint": "plotly|mermaid_flowchart|mermaid_mindmap|svg_diagram|chartjs|katex|html_table|smiles"
    }
  ],
  "mindmap": {"root":"...","cabang":[{"nama":"Bab 1","sub":["..."]}]},
  "glosarium": [{"istilah":"...","definisi":"..."}],
  "coverage_checklist": [{"bagian_transkrip":"...","masuk_ke_modul":"bab 1"}]
}

VISUALISASI RULES (CRITICAL):
- JANGAN tulis SVG, HTML, atau JavaScript langsung di field "data".
- Output HANYA JSON terstruktur (data terstruktur) yang mendeskripsikan APA yang
  harus digambar, BUKAN BAGAIMANA menggambarnya.
- Pilih "tipe" dan "render_hint" dari daftar di atas.
- Untuk persamaan matematika, gunakan format LaTeX di field "data.persamaan"
  (contoh: "y = x^2 - 4x + 3", "E = mc^2", "\\\\frac{1}{2}mv^2").
- Batasi MAKSIMAL 1 visualisasi per bab, hanya untuk konsep yang BENAR-BENAR
  butuh representasi visual (grafik fungsi, diagram alur, persamaan, tabel data).
- Kalau materi gak butuh visualisasi (sejarah, bahasa, sosiologi, ekonomi naratif)
  → array kosong "visualisasi": []
- Contoh data untuk grafik_fungsi: {"persamaan":"y = x^2 - 4x + 3","domain":[-2,6],"titik_kritis":[2,-1]}
- Contoh data untuk rumus_latex: {"persamaan":"E = mc^2","deskripsi":"Energi = massa × kecepatan cahaya kuadrat"}
- Contoh data untuk diagram_alur: {"node":["Mulai","Input","Proses","Output"],"edge":[["Mulai","Input"],["Input","Proses"]]}
- Contoh data untuk tabel_data: {"headers":["Kolom1","Kolom2"],"rows":[["val1","val2"]]}
- Contoh data untuk grafik_batang: {"categories":["A","B","C"],"values":[10,20,15]}
- Contoh data untuk struktur_molekul: {"smiles":"CCO","nama":"Etanol","deskripsi":"Struktur molekul etanol (C2H6O)"}
- Contoh data untuk diagram_gaya: {"vektor":[{"label":"F1","magnitude":5,"angle":30,"color":"#ef4444"},{"label":"F2","magnitude":3,"angle":-45,"color":"#3b82f6"}],"resultan":{"magnitude":6.6,"angle":15}}
- Contoh data untuk diagram_sel: {"organel":[{"nama":"Membran Sel","tipe":"rect","warna":"#10b981","posisi":[10,10,90,90]},{"nama":"Inti Sel","tipe":"lingkaran","warna":"#3b82f6","posisi":[50,50,15]},{"nama":"Mitokondria","tipe":"oval","warna":"#ef4444","posisi":[30,70,10,6]},{"nama":"Ribosom","tipe":"titik","warna":"#f59e0b","posisi":[20,30,2]}]}
- Contoh data untuk rangkaian_listrik: {"komponen":[{"tipe":"resistor","label":"R1","value":"10Ω","pos":[10,30]},{"tipe":"kapasitor","label":"C1","value":"100µF","pos":[40,30]},{"tipe":"induktor","label":"L1","value":"10mH","pos":[70,30]},{"tipe":"battery","label":"V1","value":"9V","pos":[40,70]}],"koneksi":[[0,1],[1,2],[2,3],[3,0]]}`;

function buildGLMCompactPrompt(ringkasan: string, title: string, targetBab: number): string {
  return `Dari ringkasan berikut, susun SATU JSON modul belajar lengkap dengan ${targetBab} bab + kuis + visualisasi + mindmap + glosarium + coverage.

RINGKASAN:
${ringkasan.slice(0, 30000)}

Output JSON valid. Setiap bab: uraian 80-120 kata, 1 contoh. Kuis 1 per bab minimal. Visualisasi maks 1 per bab (hanya STEM, materi non-STEM = array kosong). Glosarium 5-10 istilah. Coverage checklist wajib lengkap.`;
}

function buildGLMBabPrompt(ringkasan: string, title: string, startBab: number, endBab: number): string {
  return `Dari ringkasan berikut, susun JSON berisi BAB ${startBab} sampai ${endBab} saja (dari total 15 bab) + visualisasi untuk tiap bab.

RINGKASAN:
${ringkasan.slice(0, 30000)}

Output JSON valid. Format: {"modul":{"judul":"${title}","bab":[{"id":${startBab},"judul":"...","tujuan":"...","konsep_kunci":["...","...","..."],"penjelasan":"80-120 kata","contoh":"contoh konkret"}]},"visualisasi":[{"id":"vis-${startBab}","bab_id":${startBab},"subjek":"Matematika|Fisika|Kimia|Biologi|Umum","judul":"...","tipe":"grafik_fungsi|diagram_alur|rumus_latex|tabel_data|grafik_batang|struktur_molekul|diagram_gaya|diagram_sel|rangkaian_listrik","deskripsi":"...","data":{...},"render_hint":"plotly|mermaid_flowchart|katex|html_table|chartjs|smiles|svg_diagram"}]}.
Setiap bab: uraian 80-120 kata, 1 contoh konkret. ID bab mulai dari ${startBab} sampai ${endBab}, total ${endBab - startBab + 1} bab.
Visualisasi: MAKSIMAL 1 per bab, hanya untuk konsep STEM yang benar-benar butuh gambar. Materi non-STEM = array kosong.`;
}

function buildGLMBabAndExtrasPrompt(ringkasan: string, title: string, startBab: number, endBab: number): string {
  return `Dari ringkasan berikut, susun JSON berisi:
1. BAB ${startBab} sampai ${endBab} (uraian 80-120 kata per bab, 1 contoh per bab)
2. Kuis 15-20 soal total (bab_id menunjuk bab 1-${endBab}, pembahasan 1 kalimat)
3. Visualisasi maks 1 per bab (untuk bab ${startBab}-${endBab}, hanya STEM — sejarah/bahasa = array kosong)
4. Mindmap (cabang utama total 15 + sub maks 3 per cabang)
5. Glosarium 10-15 istilah inti
6. Coverage checklist lengkap (petakan setiap bagian ringkasan ke bab)

RINGKASAN:
${ringkasan.slice(0, 30000)}

Output JSON valid. Format lengkap: {"modul":{"judul":"${title}","bab":[{"id":${startBab},"judul":"...","tujuan":"...","konsep_kunci":[...],"penjelasan":"...","contoh":"..."}]},"kuis":[...],"visualisasi":[{"id":"vis-001","bab_id":${startBab},"subjek":"...","judul":"...","tipe":"grafik_fungsi|diagram_alur|rumus_latex|...","deskripsi":"...","data":{...},"render_hint":"plotly|mermaid_flowchart|katex|..."}],"mindmap":{...},"glosarium":[...],"coverage_checklist":[...]}.`;
}

function buildGLMKuisExtrasPrompt(ringkasan: string, title: string): string {
  return `Dari ringkasan berikut, susun JSON berisi HANYA kuis + visualisasi + mindmap + glosarium + coverage_checklist (bab sudah ada di section lain).

RINGKASAN:
${ringkasan.slice(0, 30000)}

Output JSON valid. Format: {"kuis":[{"id":1,"bab_id":1,"soal":"...","opsi":["A. ...","B. ...","C. ...","D. ..."],"jawaban":"A","pembahasan":"..."}],"visualisasi":[{"id":"vis-001","bab_id":1,"subjek":"...","judul":"...","tipe":"grafik_fungsi|diagram_alur|rumus_latex|...","deskripsi":"...","data":{...},"render_hint":"plotly|mermaid_flowchart|katex|..."}],"mindmap":{"root":"${title}","cabang":[{"nama":"Bab 1","sub":["sub 1","sub 2","sub 3"]}]},"glosarium":[{"istilah":"...","definisi":"..."}],"coverage_checklist":[{"bagian_transkrip":"...","masuk_ke_modul":"bab 1"}]}.
Kuis 15-20 soal, visualisasi maks 1 per bab (hanya STEM), mindmap 15 cabang utama, glosarium 10-15 istilah, coverage wajib lengkap.`;
}

function mergeGLMSections(
  results: Array<{ content: string | null; modelUsed: string | null }>,
  title: string
): any | null {
  const allBab: any[] = [];
  let allKuis: any[] = [];
  let mindmap: any = null;
  let allGlosarium: any[] = [];
  let allCoverage: any[] = [];
  let allVisualisasi: any[] = [];

  for (const r of results) {
    if (!r.content) continue;
    // v-robust: pakai safeParseJson (unified parser) — tahan terhadap output kotor
    // (markdown fence, text sebelum/sesudah JSON, escape character, dll).
    // Ganti extractBalancedJson + tryJsonParse yang lama.
    const parsed = safeParseJson(r.content);
    if (!parsed) continue;
    if (Array.isArray(parsed.modul?.bab)) allBab.push(...parsed.modul.bab);
    if (Array.isArray(parsed.kuis)) allKuis.push(...parsed.kuis);
    if (parsed.mindmap) mindmap = parsed.mindmap;
    if (Array.isArray(parsed.glosarium)) allGlosarium.push(...parsed.glosarium);
    if (Array.isArray(parsed.coverage_checklist)) allCoverage.push(...parsed.coverage_checklist);
    if (Array.isArray(parsed.visualisasi)) allVisualisasi.push(...parsed.visualisasi);
  }

  if (allBab.length === 0) return null;

  // Dedup bab by id (keep first occurrence), sort by id ascending
  const seenIds = new Set<number>();
  const dedupedBab = allBab.filter((b: any) => {
    const id = Number(b.id);
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  }).sort((a: any, b: any) => Number(a.id) - Number(b.id));

  // Dedup kuis by id
  const seenKuisIds = new Set<number>();
  const dedupedKuis = allKuis.filter((k: any) => {
    const id = Number(k.id);
    if (seenKuisIds.has(id)) return false;
    seenKuisIds.add(id);
    return true;
  });

  return {
    modul: { judul: title, bab: dedupedBab },
    kuis: dedupedKuis,
    mindmap: mindmap || { root: title, cabang: [] },
    glosarium: allGlosarium,
    coverage_checklist: allCoverage,
    visualisasi: allVisualisasi,
  };
}

// tryJsonParse dihapus di v-robust (2026-10-25) — fungsinya sudah di-subsume
// oleh safeParseJson di gateway-client.ts (strategi 1+2+3: direct parse,
// markdown strip, balanced-brace extraction).

/**
 * v-robust (2026-10-25): Validasi output chunked-generate.
 *
 * Cek struktur minimum yang menentukan kualitas hasil:
 * - modul.bab array non-empty
 * - jumlah bab >= 80% expected (toleransi 20% loss)
 * - coverage_checklist non-empty (bukti coverage materi)
 * - minimal 1 kuis per bab (kalau expected bab >= 5)
 *
 * Return: { valid, warnings, missingBab }.
 * - valid = true kalau semua cek lolos
 * - warnings = array pesan warning untuk log
 * - missingBab = array bab id yang hilang (1..expectedBab yang gak ada di result)
 *
 * Bukan fallback ke regex (sumber hasil buruk), tapi log warning supaya
 * monitoring kelihatan pola kegagalan LLM. Caller tetap return result partial
 * — keputusan retry/user-notice di client.
 */
function validateMegaResult(merged: any, expectedBab: number): {
  valid: boolean;
  warnings: string[];
  missingBab: number[];
} {
  const warnings: string[] = [];
  const missingBab: number[] = [];

  if (!merged?.modul?.bab || !Array.isArray(merged.modul.bab) || merged.modul.bab.length === 0) {
    warnings.push('no bab in modul (severe)');
    return { valid: false, warnings, missingBab: [] };
  }

  const actualBab = merged.modul.bab.length;
  const minBab = Math.floor(expectedBab * 0.8);  // 80% threshold
  if (actualBab < minBab) {
    warnings.push(`bab count ${actualBab} < expected ${minBab} (80% of ${expectedBab})`);
  }

  // Cek bab id 1..expectedBab yang hilang
  const presentIds = new Set(merged.modul.bab.map((b: any) => Number(b.id)).filter((n: number) => !isNaN(n)));
  for (let i = 1; i <= expectedBab; i++) {
    if (!presentIds.has(i)) missingBab.push(i);
  }
  if (missingBab.length > 0) {
    warnings.push(`missing bab id: ${missingBab.slice(0, 10).join(', ')}${missingBab.length > 10 ? ` (+${missingBab.length - 10} more)` : ''}`);
  }

  if (!Array.isArray(merged.coverage_checklist) || merged.coverage_checklist.length === 0) {
    warnings.push('coverage_checklist missing/empty — no proof of material coverage');
  }

  if (!Array.isArray(merged.kuis) || merged.kuis.length === 0) {
    warnings.push('kuis array empty — no quiz questions generated');
  } else if (expectedBab >= 5 && merged.kuis.length < expectedBab) {
    warnings.push(`kuis count ${merged.kuis.length} < 1 per bab (${expectedBab})`);
  }

  if (!merged.mindmap || !merged.mindmap.cabang || merged.mindmap.cabang.length === 0) {
    warnings.push('mindmap.cabang empty — no mindmap structure');
  }

  if (!Array.isArray(merged.glosarium) || merged.glosarium.length === 0) {
    warnings.push('glosarium empty — no glossary terms');
  }

  return { valid: warnings.length === 0, warnings, missingBab };
}

// ═══════════════════════════════════════════════════════════════════════
// v15-arch: Phase 1.5 summary helpers (Chatr + Resoomer)
// ═══════════════════════════════════════════════════════════════════════

/**
 * callChatrSummary — panggil Chatr's Supabase Edge Function (GPT-4o) untuk summary padat.
 * Free, no auth, no captcha, ~2-5 detik. Returns summary text atau null.
 */
async function callChatrSummary(text: string): Promise<string | null> {
  try {
    const inputText = text.length > 100_000 ? text.slice(0, 100_000) : text;
    const payload = {
      brandName: 'Chatr ',
      messages: [
        {
          role: 'system',
          content: 'You are a summarization assistant for educational content. Provide concise summaries that capture only the most essential points. Plain text only, no markdown, no bullet points. Use clear paragraphs.'
        },
        {
          role: 'user',
          content: `Give me a very concise summary of the following text. Aim for 1-2% of original length (very compact). Preserve only key concepts, main arguments, and critical numbers. Skip details and examples. Plain text only.\n\nText to summarize:\n${inputText}`
        }
      ]
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    try {
      const r = await fetch('https://xdxjetmnngpscvnotoze.supabase.co/functions/v1/chat-gpt4o', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://chatrai.app',
          'Referer': 'https://chatrai.app/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!r.ok) {
        console.log(`[callChatrSummary] HTTP ${r.status}`);
        return null;
      }
      const data = await r.json() as { reply?: string; error?: string };
      return (data.reply || '').trim() || null;
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    console.log(`[callChatrSummary] error: ${e?.message?.slice(0, 100)}`);
    return null;
  }
}

/**
 * callResoomerSummary — panggil internal endpoint /api/stt/pre-summarize-resoomer
 * (yang punya 7-step curl pipeline ke resoomer.com, mode filtreSummary).
 */
async function callResoomerSummary(text: string, cookieHeader: string): Promise<string | null> {
  try {
    const inputText = text.length > 50_000 ? text.slice(0, 50_000) : text;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    try {
      const r = await fetch('http://localhost:3000/api/stt/pre-summarize-resoomer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieHeader,
        },
        body: JSON.stringify({ text: inputText }),
        signal: ctrl.signal,
      });
      if (!r.ok) {
        console.log(`[callResoomerSummary] HTTP ${r.status}`);
        return null;
      }
      const data = await r.json() as { summary?: string; error?: string };
      return (data.summary || '').trim() || null;
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    console.log(`[callResoomerSummary] error: ${e?.message?.slice(0, 100)}`);
    return null;
  }
}
