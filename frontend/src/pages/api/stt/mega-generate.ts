import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { callLLM, extractJson, safeParseJson } from '@/lib/gateway-client';
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
    console.log(`[mega-generate] START: transcript ${transcript.length} chars, ~${lembar} lembar`);

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

    let ringkasan: string;
    let phase1SuccessCount = 0;
    let phase1FailCount = 0;

    if (chunks.length === 0) {
      // Skip Phase 1: transcript ≤ 30K char, langsung pakai sebagai ringkasan untuk Phase 2
      ringkasan = transcript;
      console.log(`[mega-generate] Phase 1 SKIPPED: transcript ${transcript.length} chars ≤ ${SKIP_PHASE1_THRESHOLD}K threshold — use as-is, 0 LLM call`);
    } else {
      console.log(`[mega-generate] Phase 1: DeepSeek ${chunks.length} chunk(s) paralel (max 6K tok each, pLimit(3))`);
      const phase1Limiter = makeConcurrencyLimiter(3);
      const deepseekResults = await Promise.all(
        chunks.map((chunk, i) => phase1Limiter(() =>
          callLLM('long', DEEPSEEK_SUMMARY_PROMPT, chunk, {
            model: 'phala/deepseek/deepseek-v4-flash-0731',
            fallbackModels: ['phala/z-ai/glm-5.3-flash', 'jr/gemini-3.5-flash-lite'],
            maxTokens: 6000,
            timeout: 90_000,
            temperature: 0.2,
            jsonMode: false,
            endpoint: `mega-generate/p1-chunk-${i + 1}-of-${chunks.length}`,
          })
        ))
      );

      const summaries = deepseekResults.filter(r => r.content).map(r => r.content!);
      phase1SuccessCount = summaries.length;
      phase1FailCount = chunks.length - phase1SuccessCount;
      if (summaries.length === 0) {
        console.error(`[mega-generate] Phase 1 ALL FAILED — all ${chunks.length} chunks failed`);
        return Response.json({
          error: 'phase1_all_failed',
          message: `Semua ${chunks.length} chunk DeepSeek gagal. Coba lagi.`,
          chunkCount: chunks.length,
          failCount: phase1FailCount,
        });
      }
      ringkasan = summaries.join('\n\n---\n\n');
      console.log(`[mega-generate] Phase 1 done: ${phase1SuccessCount}/${chunks.length} chunks OK, ${phase1FailCount} failed, ringkasan ${ringkasan.length} chars`);
    }

    // ── PHASE 2: GLM strukturkan (CONSTANT 3 sections atau 1 compact) ──
    // Output target ~10K tok JSON (15 bab + kuis + mindmap + glosarium + coverage + visualisasi)
    // 3 sections × 5K tok = 15K budget (aman, < 120s gateway limit per section)
    let sections: Array<{ name: string; userPrompt: string }>;
    if (lembar <= 21) {
      // Compact: 1 section, target 5 bab
      sections = [{
        name: 'modul-compact',
        userPrompt: buildGLMCompactPrompt(ringkasan, title, 5),
      }];
    } else {
      // 3 sections: bab 1-5, 6-10, 11-15+extras
      sections = [
        { name: 'bab-1-5', userPrompt: buildGLMBabPrompt(ringkasan, title, 1, 5) },
        { name: 'bab-6-10', userPrompt: buildGLMBabPrompt(ringkasan, title, 6, 10) },
        { name: 'bab-11-15-extras', userPrompt: buildGLMBabAndExtrasPrompt(ringkasan, title, 11, 15) },
      ];
    }

    const totalReq = chunks.length + sections.length;
    console.log(`[mega-generate] Phase 2: GLM ${sections.length} section(s) paralel (max 5K tok each, pLimit(3)) — total req this call: ${totalReq} (${chunks.length} DeepSeek + ${sections.length} GLM)`);

    const phase2Limiter = makeConcurrencyLimiter(3);
    const glmResults = await Promise.all(
      sections.map(s => phase2Limiter(() =>
        callLLM('long', GLM_STRUCTURE_SYSTEM_PROMPT, s.userPrompt, {
          model: 'phala/z-ai/glm-5.3-flash',
          fallbackModels: ['phala/deepseek/deepseek-v4-flash-0731', 'jr/gemini-3.5-flash-lite'],
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

    // v-robust: validasi output — cek struktur minimum + coverage checklist non-empty.
    // Bukan fallback ke regex (yang user bilang "sumber hasil buruk"), tapi log warning
    // supaya monitoring kelihatan kalau LLM sering balik hasil nggak lengkap.
    // Expected bab: ≤20 lembar = 5 bab, 20-100 = 15 bab, 100-300 = 15 bab.
    const expectedBab = lembar <= 20 ? 5 : 15;
    const validation = validateMegaResult(merged, expectedBab);
    if (validation.warnings.length > 0) {
      console.warn(`[mega-generate] VALIDATION WARNINGS: ${validation.warnings.join('; ')}`);
    } else {
      console.log(`[mega-generate] VALIDATION OK: ${babCount} bab (expected ≥${Math.floor(expectedBab * 0.8)}), coverage ${coverageCount}, kuis ${kuisCount}`);
    }

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
 * v-robust (2026-10-25): Validasi output mega-generate.
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
