/**
 * Enrichment Prompt Builder — v19
 *
 * Extends Phase 2 prompt with 8 enrichment fields per bab:
 *   analogy, whyItMatters, commonMistake, eli5, connectTo, examTip, mnemonic, realWorldExample
 *
 * Each field is OPTIONAL in output (LLM may skip if not applicable), but prompt strongly
 * encourages all 8. Validation post-generation marks missing fields as "no data" rather
 * than failing the whole generation.
 *
 * Token budget per bab (estimated):
 *   Base content (judul, tujuan, konsep_kunci, penjelasan, contoh): ~1500 tokens
 *   Enrichment × 8 fields × ~150 tokens each: +1200 tokens
 *   Total per bab: ~2700 tokens
 *
 * For 4 bab per section × 2700 = 10,800 tokens (under 16K maxTokens ✓)
 */

export interface EnrichmentFields {
  analogy: string;              // analogi dunia nyata
  whyItMatters: string;         // kenapa penting (frekuensi di ujian)
  commonMistake: string;        // kesalahan umum + koreksi
  eli5: string;                 // versi 5 tahun
  connectTo: string;            // koneksi ke bab lain
  examTip: string;              // tips ujian
  mnemonic: string;             // jembatan keledai
  realWorldExample: string;     // studi kasus konkret
}

export interface EnrichedBab {
  id: number;
  judul: string;
  tujuan: string;
  konsep_kunci: string[];
  penjelasan: string;
  contoh: string;
  // v19 enrichment
  analogy: string;
  whyItMatters: string;
  commonMistake: string;
  eli5: string;
  connectTo: string;
  examTip: string;
  mnemonic: string;
  realWorldExample: string;
}

/**
 * Build system prompt for Phase 2 with enrichment fields.
 * Replaces the old GLM_STRUCTURE_SYSTEM_PROMPT.
 */
export function buildEnrichedSystemPrompt(
  conceptList: string[],
  contentType: string,
  babRange: { start: number; end: number },
  quizBudgetPerBab: Map<number, number>,
): string {
  const conceptStr = conceptList.slice(0, 20).join(', ');
  const quizBudgetStr = Array.from(quizBudgetPerBab.entries())
    .map(([id, count]) => `bab ${id}: ${count} kuis`)
    .join('; ');

  return `Anda adalah generator materi belajar profesional. Buat JSON modul belajar untuk bab ${babRange.start}-${babRange.end}.

KONTEKS:
- Tipe konten: ${contentType}
- Konsep wajib dibahas: ${conceptStr}
- Budget kuis per bab: ${quizBudgetStr}

SETIAP BAB WAJIB punya struktur lengkap:
{
  "id": <number>,
  "judul": "<judul bab, max 8 kata>",
  "tujuan": "<tujuan belajar bab ini, 1 kalimat>",
  "konsep_kunci": ["<konsep1>", "<konsep2>", "..."],
  "penjelasan": "<penjelasan materi 150-300 kata, bahasa Indonesia akademik>",
  "contoh": "<contoh konkret, 50-100 kata>",
  "analogy": "<analogi dunia nyata yang relate dengan kehidupan sehari-hari, 50-100 kata>",
  "whyItMatters": "<kenapa bab ini penting dipelajari, sebut frekuensi muncul di ujian/UTBK/SNBT jika relevan, 30-80 kata>",
  "commonMistake": "<kesalahan umum yang sering dilakukan siswa + koreksinya, 50-100 kata>",
  "eli5": "<penjelasan versi 5 tahun (anak SD), bahasa sederhana, 30-80 kata>",
  "connectTo": "<koneksi ke bab lain dalam modul ini, format: 'Bab X: <judul>' - kenapa relate, 30-80 kata>",
  "examTip": "<tips ujian praktis untuk bab ini, 30-80 kata>",
  "mnemonic": "<jembatan keledai singkat untuk mengingat konsep inti bab>",
  "realWorldExample": "<studi kasus konkret di dunia nyata (industri, riset, berita), 50-100 kata>"
}

OUTPUT JSON VALID ONLY (no markdown, no preamble):
{
  "modul": {
    "judul": "<judul modul>",
    "bab": [<bab objects ${babRange.start} sampai ${babRange.end}>]
  },
  "kuis": [<kuis objects untuk bab di range ini>],
  "visualisasi": [<visualisasi objects per bab>],
  "glosarium": [<glosarium entries untuk konsep di range ini>]
}

SETIAP KUIS object:
{
  "id": <number>,
  "bab_id": <number>,
  "pertanyaan": "<pertanyaan jelas, 15-30 kata>",
  "opsi": ["A. ...", "B. ...", "C. ...", "D. ..."],
  "jawaban": "A" | "B" | "C" | "D",
  "pembahasan": "<pembahasan kenapa jawaban benar, 30-80 kata>"
}

SETIAP VISUALISASI object (auto-tipe via content):
{
  "id": "<vis-XXX>",
  "bab_id": <number>,
  "subjek": "Matematika|Fisika|Kimia|Biologi|Umum",
  "judul": "<judul visualisasi>",
  "tipe": "flowchart|tabel|bar_chart|line_chart|mindmap|latex|circular|network",
  "deskripsi": "<penjelasan visualisasi>",
  "data": {...},
  "render_hint": "mermaid_flowchart|html_table|chartjs|katex|plotly|svg_diagram"
}

SETIAP GLOSARIUM entry:
{
  "istilah": "<istilah>",
  "definisi": "<definisi singkat 20-50 kata>",
  "bab_id": <number>
}

PENTING:
- Output HARUS JSON valid, no markdown wrappers
- Bab ${babRange.start} sampai ${babRange.end} WAJIB ada (sequential)
- Semua 8 enrichment fields WAJIB diisi (kalau tidak relevan, tulis "Tidak ada analogi spesifik" jangan kosong)
- Pengetahuan umum boleh ditambah, label [TAMBAHAN] di akhir penjelasan
- Bahasa Indonesia akademik, bukan terjemahan mentah dari English`;
}

/**
 * Validate that all enrichment fields are non-empty.
 * Returns list of missing fields per bab (for logging/debugging).
 */
export function validateEnrichment(babList: any[]): { babId: number; missing: string[] }[] {
  const requiredFields: (keyof EnrichmentFields)[] = [
    'analogy', 'whyItMatters', 'commonMistake', 'eli5',
    'connectTo', 'examTip', 'mnemonic', 'realWorldExample',
  ];

  const issues: { babId: number; missing: string[] }[] = [];

  for (const bab of babList) {
    const missing: string[] = [];
    for (const field of requiredFields) {
      const value = bab[field];
      if (!value || typeof value !== 'string' || value.trim().length < 10) {
        missing.push(field);
      }
    }
    if (missing.length > 0) {
      issues.push({ babId: bab.id, missing });
    }
  }

  return issues;
}

/**
 * Fill missing enrichment fields with "no data" placeholder.
 * Non-destructive — only fills empty/missing fields.
 */
export function fillMissingEnrichment(babList: any[]): any[] {
  const placeholders: Record<keyof EnrichmentFields, string> = {
    analogy: 'Tidak ada analogi spesifik untuk bab ini.',
    whyItMatters: 'Bab ini memberikan fondasi konsep yang penting untuk pemahaman lanjutan.',
    commonMistake: 'Tidak ada pola kesalahan umum yang teridentifikasi.',
    eli5: 'Konsep ini menjelaskan ide dasar dengan cara sederhana.',
    connectTo: 'Bab ini terhubung dengan bab-bab selanjutnya dalam modul.',
    examTip: 'Pahami konsep inti sebelum mengerjakan soal latihan.',
    mnemonic: 'Tidak ada jembatan keledai spesifik.',
    realWorldExample: 'Tidak ada studi kasus konkret yang relevan.',
  };

  return babList.map(bab => {
    const filled = { ...bab };
    for (const [field, placeholder] of Object.entries(placeholders)) {
      if (!filled[field] || typeof filled[field] !== 'string' || filled[field].trim().length < 10) {
        filled[field] = placeholder;
      }
    }
    return filled;
  });
}
