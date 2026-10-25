import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { callLLM, extractJson } from '@/lib/gateway-client';
import { d1 } from '@/lib/d1-client';

/**
 * POST /api/stt/mega-generate
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

// Balanced bracket matching — handles spurious `{` prefix
function extractBalancedJson(raw: string): any {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '{') continue;
    let depth = 1;
    let inString = false;
    let escape = false;
    let jsonEnd = -1;
    for (let j = i + 1; j < raw.length; j++) {
      const c = raw[j];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { jsonEnd = j; break; }
      }
    }
    if (jsonEnd > 0) {
      try {
        const result = JSON.parse(raw.slice(i, jsonEnd + 1));
        if (result && result.modul && Array.isArray(result.modul.bab)) return result;
      } catch { continue; }
    }
  }
  return null;
}

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
    // v-hybrid: cache key include version prefix supaya cache lama (algo lama)
    // gak di-return. v3 = DeepSeek ringkasan → GLM strukturkan hybrid.
    const ALGORITHM_VERSION = 'v3-hybrid-2026-10-25';
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
            console.log(`[mega-generate] CACHE HIT hash=${materiHash.slice(0, 12)}... (age: ${ageHours.toFixed(1)}h) — 0 LLM call`);
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
        console.log(`[mega-generate] Cache MISS hash=${materiHash.slice(0, 12)}...`);
      }
    } catch (cacheErr) {
      console.warn('[mega-generate] Cache lookup failed (non-fatal):', (cacheErr as Error).message?.slice(0, 100));
    }

    // ── v-hybrid (2026-10-25): 2-phase DeepSeek (ringkas) → GLM (strukturkan) ──
    // Adaptive chunking based on transcript size.
    // 1 lembar A4 Bahasa Indonesia ≈ 1400 char (700 token @ ~2 char/token untuk BI)
    const lembar = Math.ceil(transcript.length / 1400);
    console.log(`[mega-generate] START: transcript ${transcript.length} chars, ~${lembar} lembar`);

    if (lembar > 300) {
      // >300 lembar: reject, minta user pecah jadi multiple upload
      return Response.json({
        error: 'transcript_too_long',
        message: `Transcript ~${lembar} lembar (>300 batas). Pecah jadi beberapa upload (max 200 lembar per upload).`,
        maxLembar: 300,
        currentLembar: lembar,
        transcriptChars: transcript.length,
      }, { status: 400 });
    }

    // ── PHASE 1: DeepSeek ringkasan (parallel chunks) ──
    // DeepSeek V4 Flash throughput ~150 tok/s. Max output 6K tok per chunk → ~40s (safe under 120s gateway limit).
    // Input context DeepSeek ~128K token. Chunk 50K char ≈ 12K input token, safe.
    const MAX_DEEPSEEK_CHUNK_CHARS = 50000;
    const chunks = splitTranscriptByParagraph(transcript, MAX_DEEPSEEK_CHUNK_CHARS);
    console.log(`[mega-generate] Phase 1: DeepSeek ${chunks.length} chunk(s) paralel (max 6K tok each, pLimit(3))`);

    const phase1Limiter = makeConcurrencyLimiter(3);
    const deepseekResults = await Promise.all(
      chunks.map((chunk, i) => phase1Limiter(() =>
        callLLM('long', DEEPSEEK_SUMMARY_PROMPT, chunk, {
          model: 'phala/deepseek/deepseek-v4-flash-0731',
          maxTokens: 6000,
          timeout: 90_000,
          temperature: 0.2,
          jsonMode: false,
          endpoint: `mega-generate/p1-chunk-${i + 1}-of-${chunks.length}`,
        })
      ))
    );

    const summaries = deepseekResults.filter(r => r.content).map(r => r.content!);
    const phase1SuccessCount = summaries.length;
    const phase1FailCount = chunks.length - phase1SuccessCount;
    if (summaries.length === 0) {
      console.error(`[mega-generate] Phase 1 ALL FAILED — all ${chunks.length} chunks failed`);
      return Response.json({
        error: 'phase1_all_failed',
        message: `Semua ${chunks.length} chunk DeepSeek gagal. Coba lagi.`,
        chunkCount: chunks.length,
        failCount: phase1FailCount,
      });
    }
    const ringkasan = summaries.join('\n\n---\n\n');
    console.log(`[mega-generate] Phase 1 done: ${phase1SuccessCount}/${chunks.length} chunks OK, ${phase1FailCount} failed, ringkasan ${ringkasan.length} chars`);

    // ── PHASE 2: GLM strukturkan (parallel sections) ──
    // GLM-5.3-Flash throughput ~71 tok/s. Max output 5K tok per section → ~70s (safe under 120s gateway limit).
    // GLM Intelligence Index 57, kepatuhan JSON 97.5-100% — cocok untuk output terstruktur.
    let sections: Array<{ name: string; userPrompt: string }> = [];
    if (lembar <= 20) {
      // ≤20 lembar: 1 section compact (target 5 bab)
      sections = [{
        name: 'modul-compact',
        userPrompt: buildGLMCompactPrompt(ringkasan, title, 5),
      }];
    } else if (lembar <= 100) {
      // 20-100 lembar: 2 sections (bab 1-8 + bab 9-15 + kuis + extras)
      sections = [
        { name: 'bab-1-8', userPrompt: buildGLMBabPrompt(ringkasan, title, 1, 8) },
        { name: 'bab-9-15-kuis-extras', userPrompt: buildGLMBabAndExtrasPrompt(ringkasan, title, 9, 15) },
      ];
    } else {
      // 100-300 lembar: 4 sections paralel
      sections = [
        { name: 'bab-1-5', userPrompt: buildGLMBabPrompt(ringkasan, title, 1, 5) },
        { name: 'bab-6-10', userPrompt: buildGLMBabPrompt(ringkasan, title, 6, 10) },
        { name: 'bab-11-15', userPrompt: buildGLMBabPrompt(ringkasan, title, 11, 15) },
        { name: 'kuis-extras', userPrompt: buildGLMKuisExtrasPrompt(ringkasan, title) },
      ];
    }

    console.log(`[mega-generate] Phase 2: GLM ${sections.length} section(s) paralel (max 5K tok each, pLimit(3))`);

    const phase2Limiter = makeConcurrencyLimiter(3);
    const glmResults = await Promise.all(
      sections.map(s => phase2Limiter(() =>
        callLLM('long', GLM_STRUCTURE_SYSTEM_PROMPT, s.userPrompt, {
          model: 'phala/z-ai/glm-5.3-flash',
          maxTokens: 5000,
          timeout: 90_000,
          temperature: 0.3,
          jsonMode: true,
          endpoint: `mega-generate/p2-${s.name}`,
        })
      ))
    );

    // Merge section results
    const merged = mergeGLMSections(glmResults, title);
    if (!merged || !merged.modul?.bab?.length) {
      console.error(`[mega-generate] Phase 2 ALL FAILED — no valid JSON from any GLM section`);
      return Response.json({
        error: 'phase2_all_failed',
        message: 'Semua section GLM gagal parse. Coba lagi atau kurangi ukuran materi.',
        phase1SuccessCount,
        phase2SectionCount: sections.length,
        phase2SuccessCount: glmResults.filter(r => r.content).length,
      });
    }

    const babCount = merged.modul.bab.length;
    const kuisCount = merged.kuis?.length ?? 0;
    const visualisasiCount = merged.visualisasi?.length ?? 0;
    const glosariumCount = merged.glosarium?.length ?? 0;
    const coverageCount = merged.coverage_checklist?.length ?? 0;

    console.log(`[mega-generate] FINAL: ${babCount} bab, ${kuisCount} kuis, ${visualisasiCount} visualisasi, ${glosariumCount} glosarium, ${coverageCount} coverage (DeepSeek ${phase1SuccessCount}/${chunks.length} + GLM ${glmResults.filter(r => r.content).length}/${sections.length})`);

    // ── SAVE TO D1 CACHE ──
    const megaResponse = {
      modul: merged.modul,
      kuis: merged.kuis || [],
      visualisasi: merged.visualisasi || [],
      mindmap: merged.mindmap || { root: title, cabang: [] },
      glosarium: merged.glosarium || [],
      coverage_checklist: merged.coverage_checklist || [],
      modelUsed: 'hybrid:deepseek-v4-flash→glm-5.3-flash',
      levelUsed: `hybrid-${chunks.length}d-${sections.length}g`,
      stats: {
        babCount, kuisCount, visualisasiCount, glosariumCount,
        coverageCount, transcriptChars: transcript.length,
        lembar, phase1SuccessCount, phase1FailCount,
        phase2SectionCount: sections.length,
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
      console.log(`[mega-generate] SAVED to cache hash=${materiHash.slice(0, 12)}... (${materiDataStr.length} chars, level=${megaResponse.levelUsed})`);
    } catch (saveErr) {
      console.warn('[mega-generate] Cache save failed (non-fatal):', (saveErr as Error).message?.slice(0, 100));
    }

    return Response.json({ ...megaResponse, cached: false });
  } catch (e: any) {
    console.error('[mega-generate] fatal:', e);
    return Response.json({ error: 'Generation failed', message: e?.message }, { status: 500 });
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

// ── DeepSeek summarization prompt (Phase 1) ──
const DEEPSEEK_SUMMARY_PROMPT = `Kamu adalah peringkas transkrip kuliah Bahasa Indonesia.

TUGAS: Ringkas transkrip berikut tanpa kehilangan:
- Semua poin penting, angka, nama, definisi
- Struktur bab/section (kalau ada di source)
- Konteks penting

ATURAN:
- Output 3.000-5.000 token
- Pertahankan SEMUA istilah teknis asli (bahasa Inggris/Indonesia)
- Jangan hilangkan bab (kalau ada di source)
- Buang filler words, greetings, intermezzo, pengulangan
- Tetap dalam Bahasa Indonesia

Output HANYA teks ringkasan, tanpa JSON, tanpa markdown fence, tanpa header tambahan.`;

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
  "mindmap": {"root":"...","cabang":[{"nama":"Bab 1","sub":["..."]}]},
  "glosarium": [{"istilah":"...","definisi":"..."}],
  "coverage_checklist": [{"bagian_transkrip":"...","masuk_ke_modul":"bab 1"}]
}`;

function buildGLMCompactPrompt(ringkasan: string, title: string, targetBab: number): string {
  return `Dari ringkasan berikut, susun SATU JSON modul belajar lengkap dengan ${targetBab} bab + kuis + mindmap + glosarium + coverage.

RINGKASAN:
${ringkasan.slice(0, 30000)}

Output JSON valid. Setiap bab: uraian 80-120 kata, 1 contoh. Kuis 1 per bab minimal. Glosarium 5-10 istilah. Coverage checklist wajib lengkap.`;
}

function buildGLMBabPrompt(ringkasan: string, title: string, startBab: number, endBab: number): string {
  return `Dari ringkasan berikut, susun JSON berisi BAB ${startBab} sampai ${endBab} saja (dari total 15 bab).

RINGKASAN:
${ringkasan.slice(0, 30000)}

Output JSON valid. Format: {"modul":{"judul":"${title}","bab":[{"id":${startBab},"judul":"...","tujuan":"...","konsep_kunci":["...","...","..."],"penjelasan":"80-120 kata","contoh":"contoh konkret"}]}}.
Setiap bab: uraian 80-120 kata, 1 contoh konkret. ID bab mulai dari ${startBab} sampai ${endBab}, total ${endBab - startBab + 1} bab.`;
}

function buildGLMBabAndExtrasPrompt(ringkasan: string, title: string, startBab: number, endBab: number): string {
  return `Dari ringkasan berikut, susun JSON berisi:
1. BAB ${startBab} sampai ${endBab} (uraian 80-120 kata per bab, 1 contoh per bab)
2. Kuis 15-20 soal total (bab_id menunjuk bab 1-${endBab}, pembahasan 1 kalimat)
3. Mindmap (cabang utama total 15 + sub maks 3 per cabang)
4. Glosarium 10-15 istilah inti
5. Coverage checklist lengkap (petakan setiap bagian ringkasan ke bab)

RINGKASAN:
${ringkasan.slice(0, 30000)}

Output JSON valid. Format lengkap: {"modul":{"judul":"${title}","bab":[{"id":${startBab},"judul":"...","tujuan":"...","konsep_kunci":[...],"penjelasan":"...","contoh":"..."}]},"kuis":[...],"mindmap":{...},"glosarium":[...],"coverage_checklist":[...]}.`;
}

function buildGLMKuisExtrasPrompt(ringkasan: string, title: string): string {
  return `Dari ringkasan berikut, susun JSON berisi HANYA kuis + mindmap + glosarium + coverage_checklist (bab sudah ada di section lain).

RINGKASAN:
${ringkasan.slice(0, 30000)}

Output JSON valid. Format: {"kuis":[{"id":1,"bab_id":1,"soal":"...","opsi":["A. ...","B. ...","C. ...","D. ..."],"jawaban":"A","pembahasan":"..."}],"mindmap":{"root":"${title}","cabang":[{"nama":"Bab 1","sub":["sub 1","sub 2","sub 3"]}]},"glosarium":[{"istilah":"...","definisi":"..."}],"coverage_checklist":[{"bagian_transkrip":"...","masuk_ke_modul":"bab 1"}]}.
Kuis 15-20 soal, mindmap 15 cabang utama, glosarium 10-15 istilah, coverage wajib lengkap.`;
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
    const parsed = extractBalancedJson(r.content) || tryJsonParse(r.content);
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

function tryJsonParse(raw: string): any | null {
  try { return JSON.parse(raw); } catch {}
  const cb = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cb) { try { return JSON.parse(cb[1].trim()); } catch {} }
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)); } catch {}
  }
  return null;
}
