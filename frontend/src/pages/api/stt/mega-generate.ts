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
    const materiHash = cyrb53(transcript);
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

    const truncated = transcript.length > MAX_TRANSCRIPT_CHARS
      ? transcript.slice(0, MAX_TRANSCRIPT_CHARS * 0.7) + '\n\n[...bagian tengah dipotong...]\n\n' + transcript.slice(-MAX_TRANSCRIPT_CHARS * 0.3)
      : transcript;

    const maxChapters = Math.min(15, Math.max(5, body.maxChapters ?? 10));

    const userPrompt = `Generate ALL learning artifacts from this lecture transcript. Target: ${maxChapters} chapters.

TITLE: ${title}

TRANSCRIPT:
${truncated}

Output STRICT JSON only. First character MUST be '{'. No prose, no reasoning, no markdown fences.`;

    console.log(`[mega-generate] START: transcript ${transcript.length} chars, target ${maxChapters} chapters → tiered max_tokens (65K ringkas DEFAULT → 32K → 100K → 131K last-resort)`);

    // ── TIERED MAX_TOKENS LOOP ──
    let successResult: { parsed: any; modelUsed: string | null; levelLabel: string } | null = null;
    let lastError: string = '';

    for (const level of MEGA_LEVELS) {
      console.log(`[mega-generate] Trying ${level.label} (maxTokens=${level.maxTokens}, mode=${level.mode})...`);

      const systemPrompt = buildMegaPrompt(level.mode);
      const result = await callLLM('long', systemPrompt, userPrompt, {
        maxTokens: level.maxTokens,
        // v-fast: 300s (5 menit) per level. Sebelumnya 600s (10 menit) — terlalu lama.
        // Kalau model belum selesai dalam 5 menit, fail dan coba level berikutnya.
        // Untuk L3 (65K) di claude-opus ~140 tok/s, 35K output butuh ~250s — cukup.
        // Untuk L1 (131K) butuh lebih, tapi L1 cuma last-resort (jarang dipakai).
        timeout: 300_000,
        temperature: 0.3,
        endpoint: `stt/mega-generate/${level.label}`,
      });

      if (!result.content) {
        lastError = 'all-gateways-failed';
        console.warn(`[mega-generate] ${level.label}: callLLM null → try next level`);
        continue;
      }

      const raw = result.content;
      let parsed: any = null;

      // 5 parse strategies
      try { parsed = JSON.parse(raw); } catch {}
      if (!parsed) {
        const cb = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (cb) { try { parsed = JSON.parse(cb[1].trim()); } catch {} }
      }
      if (!parsed) {
        const firstBrace = raw.indexOf('{');
        const lastBrace = raw.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
          try { parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1)); } catch {}
        }
      }
      if (!parsed) parsed = extractBalancedJson(raw);
      if (!parsed) { try { parsed = JSON.parse(extractJson(raw)); } catch {} }

      if (!parsed) {
        lastError = `parse-failed (raw ${raw.length} chars)`;
        console.warn(`[mega-generate] ${level.label}: parse failed → try next level`);
        continue;
      }

      if (!parsed.modul || !Array.isArray(parsed.modul.bab)) {
        lastError = `invalid-structure (keys: ${Object.keys(parsed).join(',')})`;
        console.warn(`[mega-generate] ${level.label}: invalid structure → try next level`);
        continue;
      }

      const babCount = parsed.modul.bab.length;
      const minBab = Math.max(3, Math.floor(maxChapters / 3));
      if (babCount < minBab) {
        lastError = `truncated-bab (got ${babCount}, min ${minBab})`;
        console.warn(`[mega-generate] ${level.label}: truncated bab → try next level`);
        continue;
      }

      // Validasi 2: coverage_checklist WAJIB ada dan tidak kosong
      const coverageChecklist = parsed.coverage_checklist;
      if (!Array.isArray(coverageChecklist) || coverageChecklist.length === 0) {
        lastError = 'missing-coverage-checklist';
        console.warn(`[mega-generate] ${level.label}: coverage_checklist missing → try next level`);
        continue;
      }

      // SUCCESS
      successResult = { parsed, modelUsed: result.modelUsed, levelLabel: level.label };
      console.log(`[mega-generate] SUCCESS at ${level.label}: ${babCount} bab, ${parsed.kuis?.length ?? 0} kuis, ${parsed.visualisasi?.length ?? 0} visualisasi, ${parsed.glosarium?.length ?? 0} glosarium, ${coverageChecklist.length} coverage`);
      break;
    }

    if (!successResult) {
      console.error(`[mega-generate] ALL LEVELS FAILED. Last error: ${lastError}`);
      return Response.json({ error: 'all-levels-failed', lastError }, { status: 200 });
    }

    const { parsed: successParsed, modelUsed: successModel, levelLabel: successLabel } = successResult;
    const babCount = successParsed.modul.bab.length;
    const kuisCount = successParsed.kuis?.length ?? 0;
    const visualisasiCount = successParsed.visualisasi?.length ?? 0;
    const glosariumCount = successParsed.glosarium?.length ?? 0;

    console.log(`[mega-generate] FINAL SUCCESS via ${successModel} at ${successLabel}: ${babCount} bab, ${kuisCount} kuis, ${visualisasiCount} visualisasi, ${glosariumCount} glosarium`);

    // ── SAVE TO D1 CACHE ──
    const megaResponse = {
      modul: successParsed.modul,
      kuis: successParsed.kuis || [],
      visualisasi: successParsed.visualisasi || [],
      mindmap: successParsed.mindmap || { root: title, cabang: [] },
      glosarium: successParsed.glosarium || [],
      coverage_checklist: successParsed.coverage_checklist || [],
      modelUsed: successModel,
      levelUsed: successLabel,
      stats: { babCount, kuisCount, visualisasiCount, glosariumCount, transcriptChars: transcript.length },
    };

    try {
      const materiDataStr = JSON.stringify(megaResponse);
      await d1.execute(
        `INSERT OR REPLACE INTO mega_cache
         (materi_hash, materi_data, transcript_chars, model_used, user_email, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [materiHash, materiDataStr, transcript.length, successModel, session.user.email]
      );
      console.log(`[mega-generate] SAVED to cache hash=${materiHash.slice(0, 12)}... (${materiDataStr.length} chars, level=${successLabel})`);
    } catch (saveErr) {
      console.warn('[mega-generate] Cache save failed (non-fatal):', (saveErr as Error).message?.slice(0, 100));
    }

    return Response.json({ ...megaResponse, cached: false });
  } catch (e: any) {
    console.error('[mega-generate] fatal:', e);
    return Response.json({ error: 'Generation failed', message: e?.message }, { status: 500 });
  }
};
