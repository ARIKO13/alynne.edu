/**
 * Cornell Notes PDF Generator
 *
 * Format: Modul Catatan bergaya Cornell Notes
 *   1. Sampul
 *   2. Daftar Isi
 *   3. Pendahuluan (catatan pembuka)
 *   4. Tujuan Pembelajaran
 *   5. Kegiatan Pembelajaran / Isi Materi (Cornell grid per topik)
 *   6. Rangkuman Akhir
 *
 * Uses LLM for structuring (via /api/stt/structure-module),
 * falls back to local heuristic if unavailable.
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── TYPES ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface PdfTable {
  headers: string[];
  rows: string[][];
}

export interface PdfKegiatan {
  title: string;
  stimulus: string;
  materi: string[];
  tables: PdfTable[];
  steps: string[] | null;
  reviewNotes: string[] | null;
  // Optional summary field used by keyword/question generators
  rangkuman?: string[];
}

export interface EntitasPenting {
  tools: string[];
  namaOrang: string[];
  angkaAturan: string[];
  istilahTeknis: string[];
  kodeRumus: string[];
}

export interface PdfModuleData {
  title: string;
  identitas: {
    mataPelajaran: string;
    kelas: string;
  };
  pendahuluan: string;
  tujuanPembelajaran: string[];
  kegiatanPembelajaran: PdfKegiatan[];
  rangkumanAkhir: string[];
  entitasPenting: EntitasPenting;
  date: string;
  totalChars: number;
  materialCount: number;
  branding: string;
  /** Origin label of the data (e.g. 'tier1', 'tier3', 'local', 'gateway'). */
  source?: string;
  /** Internal origin tag used by structureContent() before normalization. */
  _source?: string;
}

// ── Color System (Catatan / Notes - 3 Warna) ──
const C = {
  // Warna 1: Teks utama (gelap)
  text: '#1B2A4A',
  textLight: '#4A5568',
  textMuted: '#8896AB',

  // Warna 2: Penanda / Highlighter (kuning pastel)
  highlight: '#FFD740',
  highlightText: '#5D4037',
  highlightBg: '#FFF8E1',

  // Warna 3: Aksen tunggal (cokelat tua) - dipakai konsisten untuk heading, garis, bullet, divider
  heading: '#4E342E',
  headingLight: '#6D4C41',

  // Structural
  white: '#FFFFFF',
  bg: '#FAFAFA',
  border: '#E0E0E0',
  borderDark: '#BDBDBD',
  stickyBg: '#FFF9C4',
  stickyBorder: '#FFD54F',
  stickyText: '#5D4037',
  green: '#2E7D32',
  greenLight: '#E8F5E9',
  line: '#E0E0E0',
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── NORMALIZE / SANITIZE HELPERS ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function normalizeKegiatan(k: any): PdfKegiatan {
  const tables = Array.isArray(k.tables) ? k.tables.map((t: any) => ({
    headers: Array.isArray(t.headers) ? t.headers.map(String) : [],
    rows: Array.isArray(t.rows) ? t.rows.map((r: any) => Array.isArray(r) ? r.map(String) : [String(r)]) : [],
  })) : [];
  return {
    title: String(k.title || 'Kegiatan Pembelajaran'),
    stimulus: String(k.stimulus || 'Perhatikan materi berikut.'),
    materi: Array.isArray(k.materi) ? k.materi.map(String) : [],
    tables,
    steps: Array.isArray(k.steps) ? k.steps.map(String) : null,
    reviewNotes: Array.isArray(k.reviewNotes) ? k.reviewNotes.map(String) : null,
  };
}

function normalizeEntitasPenting(e: any): EntitasPenting {
  const arr = (v: any) => Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  return {
    tools: arr(e?.tools),
    namaOrang: arr(e?.namaOrang),
    angkaAturan: arr(e?.angkaAturan),
    istilahTeknis: arr(e?.istilahTeknis),
    kodeRumus: arr(e?.kodeRumus),
  };
}

function sanitizeModuleData(d: any): PdfModuleData {
  return {
    title: String(d.title || 'Modul Pembelajaran').slice(0, 100),
    identitas: {
      mataPelajaran: String(d.identitas?.mataPelajaran || 'Umum'),
      kelas: String(d.identitas?.kelas || '-'),
    },
    pendahuluan: String(d.pendahuluan || ''),
    tujuanPembelajaran: Array.isArray(d.tujuanPembelajaran) ? d.tujuanPembelajaran.map(String) : [],
    kegiatanPembelajaran: Array.isArray(d.kegiatanPembelajaran) ? d.kegiatanPembelajaran.map(normalizeKegiatan) : [],
    rangkumanAkhir: Array.isArray(d.rangkumanAkhir) ? d.rangkumanAkhir.map(String) : [],
    entitasPenting: normalizeEntitasPenting(d.entitasPenting),
    date: String(d.date || ''),
    totalChars: Number(d.totalChars) || 0,
    materialCount: Number(d.materialCount) || 0,
    branding: String(d.branding || 'ALYNNE.EDU'),
    source: (d._source || 'unknown'),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── DIRECT GATEWAY FALLBACK (client → gateway, no server proxy needed) ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const GW_KEY = 'gw_sk_8754bb9017cfe3124c9a265d22634a0da2f7043b7edaf2317ece746058b96259';
const GW_URL = 'https://gateway.polyvorlabs.com/v1/chat/completions';

// Model routing: deteksi konten coding/teknis → Codex, else Claude Sonnet 5
const GW_MODEL_DEFAULT = 'cx/gpt-5.6-sol';
const GW_MODEL_CODE = 'cx/gpt-5.6-terra';
const CODE_KEYWORDS = /\b(?:function|class|import |export |const |let |var |return |async |await|useState|useEffect|def |print\(|printf|console\.log|git |npm |docker |api|endpoint|database|sql|query|html|css|javascript|typescript|python|java\b|react|vue|angular|node\.?js|express|flask|django|laravel)\b/i;

const GW_COMBINED_PROMPT = `Kamu mengubah materi kuliah menjadi modul catatan pembelajaran terstruktur dalam Bahasa Indonesia formal.

SUMBER INPUT bisa berisi dua jenis konten yang ditandai label:
- "--- TRANSCRIPT AUDIO ---" : hasil Speech-to-Text dari rekaman dosen. Mentah, banyak filler words, typo STT, dan kalimat bertele-tele.
- "--- MATERI SLIDE ---" : konten dari slide presentasi (PPTX/PDF). Sudah terstruktur rapi (heading, list, tabel).

━━━ ATURAN PENGGABUNGAN SUMBER (PALING PENTING) ━━━
1. Gunakan MATERI SLIDE sebagai KERANGKA STRUKTUR (urutan topik, judul heading, tabel) karena sudah rapi.
2. Gunakan TRANSCRIPT AUDIO sebagai PELENGKAP konteks/penjelasan tambahan pada section yang relevan - BUKAN sebagai section terpisah yang mengulang topik sama.
3. JANGAN membuat dua section/kegiatan berbeda untuk topik yang sama dari dua sumber - GABUNG jadi satu section. Contoh: kalau slide membahas "Definisi UI" dan transcript juga menjelaskan UI, jadikan SATU section "Definisi UI" yang menggabungkan keduanya.
4. Jika slide punya tabel (rubrik, bobot nilai, jadwal) dan transcript menjelaskan isi tabel tersebut, masukkan tabel lalu tambahkan penjelasan dari transcript sebagai paragraf setelah tabel.

━━━ ATURAN CLEANUP TRANSCRIPT ━━━
5. Buang filler words: "eh", "ya", "kan", "gitu", "oke", "jadi gini", "nah", "anu", dan pengulangan kata yang tidak bermakna.
6. Perbaiki typo/salah dengar STT berdasarkan konteks kalimat sekitarnya. Contoh: "juice" dalam konteks desain → "UI/UX", "PBL" yang terdengar aneh → sesuaikan.
7. Rangkum kalimat bertele-tele jadi kalimat formal yang jelas dan padat. JANGAN salin transcript kata-per-kata.
8. Jika bagian transcript terlalu rusak/tidak jelas maknanya, ringkas jadi satu kalimat umum daripada memaksakan detail yang salah.

━━━ ATURAN TABEL ━━━
9. Data tabular (bobot nilai, rubrik penilaian, kriteria, jadwal per minggu, perbandingan) WAJIB dijadikan field "tables" dengan headers dan rows - JANGAN ditulis sebagai paragraf panjang.
   Contoh input: "Aktivitas 25% Hasil Proyek 35% Tugas 20% UTS 20%"
   Contoh output: "tables": [{"headers": ["Komponen", "Bobot"], "rows": [["Aktivitas", "25%"], ["Hasil Proyek", "35%"], ["Tugas", "20%"], ["UTS", "20%"]]}]
10. Jika slide punya tabel yang jelas, preservasi strukturnya ke field "tables".

━━━ ATURAN HEADING ━━━
11. Judul kegiatan/heading HARUS berupa frasa singkat dan LENGKAP, bukan potongan kalimat transcript. Maksimal 8 kata.
12. Rumuskan ulang judul berdasarkan TOPIK section, jangan salin mentah dari transcript.

━━━ ATURAN KONTEN ━━━
13. "stimulus" tiap kegiatan = 1 kalimat pemantik relevan.
14. TIDAK ADA rangkuman per kegiatan. Rangkuman HANYA di field "rangkumanAkhir" (5-8 poin mencakup inti SEMUA kegiatan).
15. TIDAK ADA section asesmen/soal.
16. "steps" HANYA jika ada prosedur eksplisit. "reviewNotes" HANYA jika ada koreksi teknis.
17. Jika tidak ada steps/review, set null (bukan array kosong).
18. Isi "entitasPenting" dengan: tools, namaOrang, angkaAturan, istilahTeknis, kodeRumus - semua yang disebutkan dalam konten.
19. "identitas.mataPelajaran" dan "kelas": tebak dari konten.
20. JANGAN menambah informasi yang tidak ada di sumber. JAGA istilah teknis asli (bahasa Inggris/singkatan) apa adanya.

━━━ VALIDASI AKHIR ━━━
- Setiap entitas dari "entitasPenting" harus muncul di salah satu "materi" - jika ada yang hilang, tambahkan.
- Cek duplikasi: topik yang sama tidak boleh muncul di >1 kegiatan.
- Judul tidak boleh terpotong di tengah kata.
- Tidak ada kalimat yang masih terdengar seperti transkrip lisan mentah.

Kembalikan HANYA JSON valid sesuai skema, tanpa markdown code block:

{
  "title": "...",
  "identitas": { "mataPelajaran": "...", "kelas": "..." },
  "pendahuluan": "...",
  "tujuanPembelajaran": ["...", "..."],
  "kegiatanPembelajaran": [
    {
      "title": "...",
      "stimulus": "...",
      "materi": ["paragraf1", "paragraf2"],
      "tables": [
        { "headers": ["Kolom1", "Kolom2"], "rows": [["val1", "val2"]] }
      ],
      "steps": ["..."] atau null,
      "reviewNotes": ["..."] atau null
    }
  ],
  "rangkumanAkhir": ["...", "...", "...", "...", "..."],
  "entitasPenting": {
    "tools": ["..."],
    "namaOrang": ["..."],
    "angkaAturan": ["..."],
    "istilahTeknis": ["..."],
    "kodeRumus": ["..."]
  }
}`;


function extractJsonFromLLM(text: string): string {
  const cb = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cb) return cb[1].trim();
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : text;
}

function pickModel(transcript: string): string {
  return CODE_KEYWORDS.test(transcript) ? GW_MODEL_CODE : GW_MODEL_DEFAULT;
}

async function tryGatewayFallback(
  transcript: string, materialTexts: string[], dateStr: string, totalChars: number,
): Promise<PdfModuleData | null> {
  const cleaned = cleanTranscript(transcript);
  const matSec = materialTexts.length > 0
    ? '\n\nMATERI PENDUKUNG:\n' + materialTexts.map((t, i) => `--- MATERI SLIDE ${i + 1} ---\n${t.slice(0, 5000)}`).join('\n\n')
    : '';
  console.log(`[DEBUG] Panjang transkrip yang dikirim ke LLM: ${cleaned.length} karakter`);
  const userMsg = `Ubah transkrip ini jadi modul catatan pembelajaran.${matSec}\n\n--- TRANSCRIPT AUDIO ---\n${cleaned}`;

  let model = pickModel(cleaned);
  console.log(`[gateway] Trying model: ${model} (transcript: ${cleaned.length} chars)`);

  try {
    const r = await fetch(GW_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GW_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: GW_COMBINED_PROMPT },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.2,
        max_tokens: 24000,
      }),
      signal: AbortSignal.timeout(180_000),
    });

    // ── 503: model down → coba model lain sebelum fallback local ──
    if (r.status === 503) {
      const altModel = model === GW_MODEL_DEFAULT ? GW_MODEL_CODE : GW_MODEL_DEFAULT;
      console.error(`❌ [gateway] ${model} returned 503 (service unavailable). Retrying with ${altModel}...`);
      try {
        const r2 = await fetch(GW_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${GW_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: altModel,
            messages: [
              { role: 'system', content: GW_COMBINED_PROMPT },
              { role: 'user', content: userMsg },
            ],
            temperature: 0.2,
            max_tokens: 24000,
          }),
          signal: AbortSignal.timeout(180_000),
        });
        if (!r2.ok) {
          console.error(`❌ [gateway] ${altModel} also failed with HTTP ${r2.status} - returning null`);
          return null;
        }
        const d2 = await r2.json();
        const raw2 = d2.choices?.[0]?.message?.content || '';
        if (!raw2) {
          console.error('❌ [gateway] Empty response from fallback model', altModel);
          return null;
        }
        const s2 = JSON.parse(extractJsonFromLLM(raw2));
        if (!s2.title || !Array.isArray(s2.kegiatanPembelajaran) || s2.kegiatanPembelajaran.length === 0) {
          console.error('❌ [gateway] Invalid structure from fallback model', altModel);
          return null;
        }
        console.log(`✅ [gateway] OK with ${altModel} after 503 retry (${s2.kegiatanPembelajaran.length} kegiatan)`);
        return {
          title: String(s2.title),
          identitas: { mataPelajaran: String(s2.identitas?.mataPelajaran || 'Umum'), kelas: String(s2.identitas?.kelas || '-') },
          pendahuluan: String(s2.pendahuluan || ''),
          tujuanPembelajaran: Array.isArray(s2.tujuanPembelajaran) ? s2.tujuanPembelajaran.map(String) : [],
          kegiatanPembelajaran: s2.kegiatanPembelajaran.map(normalizeKegiatan),
          rangkumanAkhir: Array.isArray(s2.rangkumanAkhir) ? s2.rangkumanAkhir.map(String) : [],
          entitasPenting: normalizeEntitasPenting(s2.entitasPenting),
          date: dateStr, totalChars, materialCount: materialTexts.length, branding: 'ALYNNE.EDU',
        };
      } catch (retryErr) {
        console.error(`❌ [gateway] ${altModel} retry also failed:`, retryErr);
        return null;
      }
    }

    if (!r.ok) {
      console.error(`❌ [gateway] ${model} HTTP ${r.status} - returning null`);
      return null;
    }

    const d = await r.json();
    const raw = d.choices?.[0]?.message?.content || '';
    if (!raw) {
      console.error('❌ [gateway] Empty response from', model);
      return null;
    }

    let s;
    try {
      s = JSON.parse(extractJsonFromLLM(raw));
    } catch (parseErr) {
      console.error('❌ [gateway] JSON parse failed from', model, ':', parseErr);
      return null;
    }

    if (!s.title || !Array.isArray(s.kegiatanPembelajaran) || s.kegiatanPembelajaran.length === 0) {
      console.error('❌ [gateway] Invalid structure from', model, ':', JSON.stringify({
        hasTitle: !!s.title,
        kegCount: s.kegiatanPembelajaran?.length,
      }));
      return null;
    }

    console.log(`✅ [gateway] OK with ${model} (${s.kegiatanPembelajaran.length} kegiatan)`);
    return {
      title: String(s.title),
      identitas: { mataPelajaran: String(s.identitas?.mataPelajaran || 'Umum'), kelas: String(s.identitas?.kelas || '-') },
      pendahuluan: String(s.pendahuluan || ''),
      tujuanPembelajaran: Array.isArray(s.tujuanPembelajaran) ? s.tujuanPembelajaran.map(String) : [],
      kegiatanPembelajaran: s.kegiatanPembelajaran.map(normalizeKegiatan),
      rangkumanAkhir: Array.isArray(s.rangkumanAkhir) ? s.rangkumanAkhir.map(String) : [],
      entitasPenting: normalizeEntitasPenting(s.entitasPenting),
      date: dateStr, totalChars, materialCount: materialTexts.length, branding: 'ALYNNE.EDU',
    };
  } catch (err) {
    console.error(`❌ [gateway] ${model} unhandled exception:`, err);
    return null;
  }
}

function validateEntityCoverage(data: PdfModuleData): string[] {
  const allMateriText = data.kegiatanPembelajaran
    .flatMap(k => k.materi)
    .join(' ')
    .toLowerCase();

  const ep = data.entitasPenting;
  const allEntities = [
    ...(ep.tools || []),
    ...(ep.namaOrang || []),
    ...(ep.angkaAturan || []),
    ...(ep.istilahTeknis || []),
    ...(ep.kodeRumus || []),
  ];

  if (allEntities.length === 0) return [];

  const missing: string[] = [];
  for (const entity of allEntities) {
    const term = entity.toLowerCase();
    if (!allMateriText.includes(term)) {
      missing.push(entity);
    }
  }

  if (missing.length > 0) {
    console.warn(`⚠️ [ENTITY CHECK] ${missing.length} entitas penting TIDAK ditemukan di materi: ${JSON.stringify(missing)}`);
  } else {
    console.log(`✅ [ENTITY CHECK] Semua ${allEntities.length} entitas penting ditemukan di materi.`);
  }

  return missing;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── STRUCTURE CONTENT ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function structureContent(
  transcript: string,
  materialTexts: string[] = [],
): Promise<PdfModuleData> {
  const totalChars = transcript.length + materialTexts.reduce((s, t) => s + t.length, 0);
  const dateStr = new Date().toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  if (transcript.trim().length > 100) {
    // ── Tier 1: Server-side API (uses GATEWAY_API_KEY env, combined Tahap A-E prompt) ──
    try {
      console.log('[structureContent] Tier 1: Calling /api/stt/structure-module...');
      const res = await fetch('/api/stt/structure-module', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: cleanTranscript(transcript), materialTexts }),
      });
      if (!res.ok) {
        console.error(`❌ [structureContent] Tier 1 HTTP ${res.status} - skipping to Tier 2`);
      } else {
        const data = await res.json();
        if (data.error === 'fallback') {
          console.error('❌ [structureContent] Tier 1 returned { error: "fallback" } - server-side LLM failed, skipping to Tier 2');
        } else if (data.title && Array.isArray(data.kegiatanPembelajaran) && data.kegiatanPembelajaran.length > 0) {
          console.log(`✅ [structureContent] Tier 1 success (${data.kegiatanPembelajaran.length} kegiatan)`);

          // Coverage validation: warn if materi terlalu sedikit vs transkrip asli
          const materiTotal = data.kegiatanPembelajaran.flatMap((k: any) => k.materi || []).join(' ').length;
          const coverageRatio = materiTotal / totalChars;
          console.log(`[DEBUG] Coverage: ${data.kegiatanPembelajaran.length} kegiatan, ${materiTotal} chars materi vs ${totalChars} chars input (ratio: ${coverageRatio.toFixed(2)})`);
          if (coverageRatio < 0.15) {
            console.warn(`⚠️ [structureContent] Kemungkinan ada topik yang terlewat. Coverage ratio: ${coverageRatio.toFixed(2)} - materi hasil rewrite terlalu pendek dibanding transkrip asli.`);
          }

          // Entity coverage validation
          const result = {
            title: String(data.title),
            identitas: { mataPelajaran: String(data.identitas?.mataPelajaran || 'Umum'), kelas: String(data.identitas?.kelas || '-') },
            pendahuluan: String(data.pendahuluan || ''),
            tujuanPembelajaran: Array.isArray(data.tujuanPembelajaran) ? data.tujuanPembelajaran.map(String) : [],
            kegiatanPembelajaran: data.kegiatanPembelajaran.map(normalizeKegiatan),
            rangkumanAkhir: Array.isArray(data.rangkumanAkhir) ? data.rangkumanAkhir.map(String) : [],
            entitasPenting: normalizeEntitasPenting(data.entitasPenting),
            date: dateStr, totalChars, materialCount: materialTexts.length, branding: 'ALYNNE.EDU',
            _source: 'tier1',
          };

          // Validate entity coverage
          validateEntityCoverage(result);
          console.log('[structureContent] Tier 1 result:', JSON.stringify(result.kegiatanPembelajaran.map((k: PdfKegiatan) => ({ title: k.title, materiLen: k.materi?.length, firstMateri: k.materi?.[0]?.slice(0, 80) })), null, 2));
          return result;
        } else {
          console.error('❌ [structureContent] Tier 1 response missing title/kegiatanPembelajaran - skipping to Tier 2');
        }
      }
    } catch (err) {
      console.error('❌ [structureContent] Tier 1 exception:', err, '- skipping to Tier 2');
    }

    // ── Tier 2: Server-side fallback API (same-origin, no CORS issue) ──
    try {
      console.log('[structureContent] Tier 2: Calling /api/stt/structure-fallback...');
      const fbRes = await fetch('/api/stt/structure-fallback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: cleanTranscript(transcript), materialTexts }),
      });
      if (fbRes.ok) {
        const fbData = await fbRes.json();
        if (fbData.title && Array.isArray(fbData.kegiatanPembelajaran) && fbData.kegiatanPembelajaran.length > 0) {
          console.log(`✅ [structureContent] Tier 2 success (${fbData.kegiatanPembelajaran.length} kegiatan)`);
          const result = {
            title: String(fbData.title),
            identitas: { mataPelajaran: String(fbData.identitas?.mataPelajaran || 'Umum'), kelas: String(fbData.identitas?.kelas || '-') },
            pendahuluan: String(fbData.pendahuluan || ''),
            tujuanPembelajaran: Array.isArray(fbData.tujuanPembelajaran) ? fbData.tujuanPembelajaran.map(String) : [],
            kegiatanPembelajaran: fbData.kegiatanPembelajaran.map(normalizeKegiatan),
            rangkumanAkhir: Array.isArray(fbData.rangkumanAkhir) ? fbData.rangkumanAkhir.map(String) : [],
            entitasPenting: normalizeEntitasPenting(fbData.entitasPenting),
            date: dateStr, totalChars, materialCount: materialTexts.length, branding: 'ALYNNE.EDU',
            _source: 'tier2',
          };
          console.log('[structureContent] Tier 2 result:', JSON.stringify(result.kegiatanPembelajaran.map((k: PdfKegiatan) => ({ title: k.title, materiLen: k.materi?.length, firstMateri: k.materi?.[0]?.slice(0, 80) })), null, 2));
          validateEntityCoverage(result);
          return result;
        }
      }
      console.error('❌ [structureContent] Tier 2 failed - both LLM tiers exhausted');
    } catch (err) {
      console.error('❌ [structureContent] Tier 2 exception:', err, '- both LLM tiers exhausted');
    }
  } else {
    console.warn('[structureContent] Transcript too short (<100 chars), cannot use LLM');
  }

  // Tier 3: Local heuristic fallback (last resort - quality lower)
  console.warn('[structureContent] Tier 3: Using localStructure() - output quality will be lower');
  const localResult = localStructure(transcript, materialTexts, dateStr, totalChars);
  localResult._source = 'tier3';
  return localResult;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── TRANSCRIPT PRE-PROCESSING ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function cleanTranscript(raw: string): string {
  return raw
    // Level 1: Hapus kalimat/bagian kalimat YouTube/CTA
    .replace(/(?:tekan|klik)?\s*(?:tombol )?(?:subscribe|subscrib|langganan)/gi, '')
    .replace(/(?:like|suka|follow|share|bagikan|comment|komentar|notifika(si)?)(?:\s+(?:dan|serta|\&)\s+(?:subscribe|like|follow|share))?(?:\s+(?:agar|supaya|biar)\s+.*?(?:\.|$))/gi, '')
    .replace(/(?:agar|supaya|biar)\s+kamu\s+tidak\s+ketinggalan[^.]*\./gi, '')
    .replace(/(?:jangan\s+lupa|jangan\s+lupain)[^.]*\./gi, '')
    .replace(/(?:simak|tonton|saksikan)\s+(?:penelusuran|video|konten|sampai)[^.]*\./gi, '')
    .replace(/(?:halo|hai|hey|assalamualaikum|apa\s+kabar|selamat\s+(?:datang|pagi|siang|sore|malam))[^,.]*[,.]?/gi, '')
    .replace(/(?:terima\s+kasih|makasih|thanks|thank\s+you)[^.]*\./gi, '')
    .replace(/(?:sampe\s+ketemu|sampai\s+umpa|see\s+you|goodbye|bye\s+bye)[^.]*\./gi, '')
    .replace(/(?:di\s+video\s+ini|dalam\s+video\s+ini|pada\s+video\s+ini)[^.]*\./gi, '')
    .replace(/(?:di\s+channel\s+ini|di\s+kanal\s+ini)[^.]*\./gi, '')
    .replace(/(?:subscribe\s+(?:dan|&|serta)\s+)*(?:nyalakan\s+lonceng|turn\s+on)[^.]*\./gi, '')

    // Level 2: Hapus filler lisan yang lebih lengkap
    .replace(/(jadi\s+nya|gitu\s+ya|kayak\s+gitu|gitu\s+loh|jadinya|kayaknya|begini\s+ya|gimana\s+sih|gimana\s+ya)/gi, ' ')
    .replace(/(nah|gitu|loh|kok|sih|dong|nih|deh|yah|yuk|toh|woi)/gi, ' ')
    .replace(/(anu|emang|emng|beneran|banget|bangeet)/gi, '')
    .replace(/(terus\s+terus|terus\s+yang|yang\s+yang)/gi, ' ')
    .replace(/(kayak\s+gitu|jadi\s+gitu|gitu\s+saja|gitu\s+sama)/gi, ' ')

    // Level 3: Hapus klausa yang 3+ filler beruntun (tanda kalimat noise)
    .replace(/\b(?:eh|apa|ya|nih|kan)\s+(?:eh|apa|ya|nih|kan)\s+(?:eh|apa|ya|nih|kan)\b[^.!?]*/gi, '')

    // Level 4: Normalisasi spasi dan tanda baca
    .replace(/\s+/g, ' ')
    .replace(/\s*\.+\s*/g, '. ')
    .replace(/\s+,\s*/g, ', ')
    .replace(/\.\s*\./g, '.')
    .trim();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── TOPIC & THEME EXTRACTION (improved) ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const FILLER_START = new Set(['ya','gitu','eh','apa','nah','loh','kok','sih','nih','dong','deh','anu','itu','oke','wah','hmm','oh','ow','hh','wkwk','xixi','hihi','haha']);
const FILLER_WORDS_SET = new Set([
  'yang','dengan','untuk','dari','dalam','pada','adalah','mereka','kita','tidak','akan','bisa','sudah','sebagai','oleh','juga','satu','setelah','sebelum','ketika','karena','seperti','telah','masih','hanya','lebih','atau','dan','ini','itu','di','ke','secara','tersebut','dapat','maka','agar','supaya','yaitu','ialah','baik','serta','maupun','sedangkan','selain','antara','melalui','tentang','suatu','setiap','saja','pun','buat','sampe','pas','abis','nanti','kemarin','tadi','hari','waktu','orang','bikin','nge','nya','si','dong','deh','kan','kok','loh','sih','nih','yah','gitu','nah','eh','apa','ya','lho','toh','anu','banget','bener','emang','udah','dah','tau','doang','dgn','dlm','utk','tp','jg','krn','sm','yg','jgn','dlu','kalo','klo','kayak','gmn','spt','jd','pdhl','klw','trus','gimana','gitu',
]);

/**
 * Scoring-based topic extraction.
 * Kalimat yang diawali/diakhiri filler → skor 0.
 * Kalimat punya kata benda spesifik → skor tinggi.
 * Default ke "Catatan Pertemuan - {tanggal}" jika semua kandidat kotor.
 */
function extractTopic(text: string, dateStr?: string): string {
  // 1. Coba pattern eksplisit: "membahas tentang X"
  const markers = /(?:tentang|mengenai|membahas|bahas|(?:topik|tema)\s+(?:kita|hari\s+ini(?:\s+adalah)?))\s+([^,.?]{5,60})/i;
  const m = text.match(markers);
  if (m) {
    const candidate = m[1].trim();
    if (!FILLER_START.has(candidate.split(/\s+/)[0].toLowerCase())) {
      return candidate.length > 50 ? candidate.slice(0, 47) + '...' : candidate;
    }
  }

  // 2. Scoring: ambil semua kalimat kandidat, beri skor, ambil yang tertinggi
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 25 && s.length <= 100);
  let bestScore = -1;
  let bestSentence = '';

  for (const s of sentences) {
    const clean = s.split(/[.!?]/)[0].trim();
    const words = clean.split(/\s+/);
    if (words.length < 4) continue;

    let score = 0;
    const first = words[0].toLowerCase();
    const last = words[words.length - 1].toLowerCase();

    // Penalty: diawali/diakhiri filler → diskualifikasi
    if (FILLER_START.has(first) || FILLER_START.has(last)) continue;

    // Bonus: mengandung kata benda teknis/akademis
    const techWords = ['konsep','teori','metode','proses','sistem','analisis','desain','strategi','prinsip','pendekatan','model','framework','algoritma','data','fungsi','struktur','evaluasi','implementasi','pengembangan','manajemen','organisasi','komunikasi','interaksi','penilaian','kurikulum','materi','pembelajaran','competency','rubrik','portfolio','assesmen','formative','sumatif','UX','UI','user','experience','interface','konten','media','platform','basis','rekayasa','perangkat','lunak','tabel','database','query','endpoint','frontend','backend','API','responsive','accessibility'];
    for (const w of words) {
    if (techWords.includes(w.toLowerCase())) score += 3;
  }

    // Bonus: mengandung angka atau singkatan (indikator spesifik)
    if (/[A-Z]{2,}|\d+/.test(clean)) score += 1;

    // Penalty: >30% filler words
    const fillerCount = words.filter(w => FILLER_WORDS_SET.has(w.toLowerCase())).length;
    if (fillerCount / words.length > 0.3) continue;

    // Penalty: kalimat terlalu pendek
    if (clean.length < 15) score -= 2;

    if (score > bestScore) {
      bestScore = score;
      bestSentence = clean;
    }
  }

  if (bestScore >= 2 && bestSentence) {
    return bestSentence.length > 50 ? bestSentence.slice(0, 47) + '...' : bestSentence;
  }

  // 3. Default: judul aman berdasarkan tanggal
  return dateStr ? `Catatan Pertemuan - ${dateStr}` : 'Modul Pembelajaran';
}

/**
 * Improved theme extraction with stoplist + quality filter.
 */
function extractThemes(text: string): string[] {
  const BAD_STARTS = /^(?:apa|ya|itu|sendiri|ini|dia|mereka|kita|saya|aku|kamu|eh|nah|gitu|kok|loh|sih|dong|nih|deh|anu|kan|wah|oh)/i;

  const themePatterns = [
    /(?:definisi|pengertian|konsep|dasar|landasan)\s+(?:dari|tentang)?\s*([^,.]{5,30})/gi,
    /(?:sejarah|asal\s+usul|perkembangan|evolusi)\s+(?:dari|tentang)?\s*([^,.]{5,30})/gi,
    /(?:dampak|pengaruh|efek|akibat)\s+(?:dari|tentang)?\s*([^,.]{5,30})/gi,
    /(?:proses|langkah|cara|metode|teknik)\s+(?:dari|tentang)?\s*([^,.]{5,30})/gi,
    /(?:contoh|kasus|studi\s+kasus|peristiwa)\s+(?:dari|tentang)?\s*([^,.]{5,30})/gi,
    /(?:faktor|penyebab|alasan|dasar)\s+(?:dari|tentang)?\s*([^,.]{5,30})/gi,
    /(?:jenis|tipe|bentuk|macam|kategori)\s+(?:dari|tentang)?\s*([^,.]{5,30})/gi,
    /(?:teori|pendekatan|model|kerangka)\s+(?:dari|tentang)?\s*([^,.]{5,30})/gi,
  ];

  const themes: string[] = [];
  for (const pattern of themePatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      let theme = match[1].trim();
      if (theme.length < 5) continue;

      // Stoplist: buang yang diawali filler
      if (BAD_STARTS.test(theme)) continue;

      // Quality: >30% filler words → discard
      const words = theme.split(/\s+/);
      const fillerRatio = words.filter(w => FILLER_WORDS_SET.has(w.toLowerCase())).length / words.length;
      if (fillerRatio > 0.3) continue;

      // Dedup (case-insensitive)
      if (!themes.some(t => t.toLowerCase() === theme.toLowerCase()) && themes.length < 6) {
        themes.push(theme);
      }
    }
  }

  if (themes.length === 0) {
    // Fallback: frequency-based - kata benda yang paling sering muncul
    const words = text.split(/\s+/).filter(w => w.length > 4 && !FILLER_WORDS_SET.has(w.toLowerCase()));
    const freq = new Map<string, number>();
    for (const w of words) {
      const lw = w.toLowerCase();
      freq.set(lw, (freq.get(lw) || 0) + 1);
    }
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, 3).map(([w]) => w);
  }

  return themes;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── TOPIC SEGMENTATION (poin 5 - deteksi pergantian topik) ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Frasa transisi topik yang umum dipakai dosen/narasumber Indonesia
 * saat berpindah dari satu topik besar ke topik lain.
 * Urutan penting: pattern lebih spesifik taruh duluan.
 */
const TOPIC_TRANSITION_PATTERNS = [
  /\b(?:baik|oke|ok)?[,.]?\s*(?:jadi\s+)?lanjut(?:\s+ke)?\s+(?:materi|topik|bagian|bab)?\s*([a-z0-9\s]{3,40})/i,
  /\b(?:oke|baik)?\s*kita\s+(?:akan\s+)?masuk\s+ke\s+(?:materi|topik|bagian)?\s*([a-z0-9\s]{3,40})/i,
  /\bsekarang\s+(?:kita\s+)?(?:akan\s+)?(?:bahas|membahas|masuk)\s+([a-z0-9\s]{3,40})/i,
  /\bberikutnya\s+(?:kita\s+)?(?:akan\s+)?(?:bahas|membahas)\s+([a-z0-9\s]{3,40})/i,
  /\bnah\s+(?:sekarang|selanjutnya)\s+(?:kita\s+)?(?:masuk|bahas)\s+([a-z0-9\s]{3,40})/i,
];

interface TopicSegment {
  title: string;
  startIndex: number;
  rawText: string;
}

/**
 * Validasi hasil capture topik - buang kalau kualitasnya jelek.
 * Regex boleh nangkep sembarangan, tapi HANYA yang lolos validasi ini
 * yang boleh dipakai jadi judul/topik.
 */
function isValidTopicCapture(topic: string): boolean {
  const words = topic.toLowerCase().split(/\s+/);
  if (words.length < 2 || topic.length < 6) return false;

  const fillerStarts = ['ya','apa','itu','gitu','eh','nih','kan','sih','dong'];
  if (fillerStarts.includes(words[0]) || fillerStarts.includes(words[words.length - 1])) return false;

  const fillerCount = words.filter(w => fillerStarts.includes(w)).length;
  if (fillerCount / words.length > 0.3) return false;

  const hasSubstantialWord = words.some(w => w.length >= 4 && !fillerStarts.includes(w));
  if (!hasSubstantialWord) return false;

  return true;
}

/**
 * Potong judul di batas kata, bukan di tengah kata.
 */
function truncateTitle(title: string, maxLen: number = 50): string {
  if (title.length <= maxLen) return title;
  const truncated = title.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

function capitalizeTopic(topic: string): string {
  return topic.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Cari titik-titik transisi topik dalam teks yang sudah dibersihkan.
 * Return array segment, masing-masing mewakili 1 topik besar.
 */
function segmentByTopicTransitions(cleanedText: string): TopicSegment[] {
  const sentences = cleanedText
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);

  // 1. Cari kalimat yang match pattern transisi
  const transitionPoints: { sentenceIdx: number; capturedTopic: string }[] = [];
  sentences.forEach((sentence, idx) => {
    for (const pattern of TOPIC_TRANSITION_PATTERNS) {
      const match = sentence.match(pattern);
      if (match && match[1]) {
        const topic = match[1].trim();
        if (isValidTopicCapture(topic)) {
          transitionPoints.push({ sentenceIdx: idx, capturedTopic: topic });
          break;
        }
      }
    }
  });

  // 2. Gak ada transisi → 1 segment
  if (transitionPoints.length === 0) {
    return [{ title: 'Materi Utama', startIndex: 0, rawText: sentences.join(' ') }];
  }

  // 3. Filter transisi yang terlalu berdekatan (< 15 kalimat)
  const MIN_SENTENCES_PER_SEGMENT = 15;
  const filteredPoints: typeof transitionPoints = [];
  for (const tp of transitionPoints) {
    const last = filteredPoints[filteredPoints.length - 1];
    if (!last || tp.sentenceIdx - last.sentenceIdx >= MIN_SENTENCES_PER_SEGMENT) {
      filteredPoints.push(tp);
    }
  }

  // 4. Potong jadi segment
  const segments: TopicSegment[] = [];
  let prevIdx = 0;

  // Segment pertama (pembuka/orientasi)
  if (filteredPoints.length > 0 && filteredPoints[0].sentenceIdx > 3) {
    segments.push({
      title: 'Pembukaan dan Orientasi',
      startIndex: 0,
      rawText: sentences.slice(0, filteredPoints[0].sentenceIdx).join(' '),
    });
    prevIdx = filteredPoints[0].sentenceIdx;
  }

  filteredPoints.forEach((tp, i) => {
    const nextIdx = filteredPoints[i + 1]?.sentenceIdx ?? sentences.length;
    segments.push({
      title: capitalizeTopic(tp.capturedTopic),
      startIndex: tp.sentenceIdx,
      rawText: sentences.slice(tp.sentenceIdx, nextIdx).join(' '),
    });
  });

  return segments;
}

/**
 * Ambil kalimat yang PALING UTUH secara struktural dari tiap paragraf,
 * bukan sekadar kalimat pertama.
 */
function extractCleanSummaryPoints(paragraphs: string[]): string[] {
  return paragraphs
    .map(p => {
      const candidates = p.split(/[.!?]/).map(s => s.trim()).filter(Boolean);
      return candidates
        .filter(s => s.length >= 20 && s.length <= 150)
        .sort((a, b) => b.length - a.length)[0];
    })
    .filter((s): s is string => !!s)
    .slice(0, 4);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── LOCAL FALLBACK STRUCTURE (improved heuristic) ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function localStructure(
  transcript: string,
  materialTexts: string[],
  dateStr: string,
  totalChars: number,
): PdfModuleData {
  // ── TAHAP 0: INGEST ──
  const cleaned = cleanTranscript(transcript);
  const allSentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20);

  if (allSentences.length === 0) {
    return {
      title: 'Modul Pembelajaran',
      identitas: { mataPelajaran: 'Umum', kelas: '-' },
      pendahuluan: 'Modul ini disusun berdasarkan materi yang disampaikan narasumber. Peserta diharapkan dapat memahami dan menerapkan konsep-konsep yang dibahas.',
      tujuanPembelajaran: ['Peserta mampu memahami materi yang disampaikan narasumber.'],
      kegiatanPembelajaran: [{
        title: 'Kegiatan Pembelajaran', stimulus: 'Perhatikan materi berikut.',
        materi: ['(Konten terlalu pendek untuk dianalisis.)'],
        tables: [], steps: null, reviewNotes: null,
      }],
      rangkumanAkhir: [],
      entitasPenting: { tools: [], namaOrang: [], angkaAturan: [], istilahTeknis: [], kodeRumus: [] },
      date: dateStr, totalChars, materialCount: materialTexts.length, branding: 'ALYNNE.EDU',
    };
  }

  // ── TAHAP 1: PEMETAAN TOPIK (improved scoring) ──
  const rawTopic = extractTopic(cleaned, dateStr);
  const themes = extractThemes(cleaned);
  const title = isValidTopicCapture(rawTopic)
    ? truncateTitle(capitalizeTopic(rawTopic))
    : `Catatan Pembelajaran - ${dateStr}`;

  // ── TAHAP 2: SEGMENTASI TOPIK VIA TRANSISI ──
  let topicSegments: TopicSegment[];
  try {
    topicSegments = segmentByTopicTransitions(cleaned);
    if (!topicSegments || topicSegments.length === 0) {
      throw new Error('Empty segments returned');
    }
  } catch (err) {
    console.error('[segmentByTopicTransitions] failed:', err);
    topicSegments = [{ title: 'Materi Utama', startIndex: 0, rawText: cleaned }];
  }

  // ── TAHAP 3: COMPOSE ──
  // Pendahuluan
  const firstSegSentences = topicSegments[0]?.rawText
    .split(/(?<=[.!?])\s+/).filter(s => s.length > 20) || [];
  const introText = firstSegSentences.slice(0, 3).join(' ');
  const pendahuluan = `Modul ini membahas tentang ${rawTopic.toLowerCase()}. ${introText} Modul ini disusun untuk membantu peserta memahami konsep-konsep kunci terkait ${themes[0] || 'materi ini'} secara sistematis.`;

  // Tujuan pembelajaran (dari tema per segment, bukan global)
  const verbs = ['memahami konsep', 'menjelaskan', 'menganalisis', 'mengidentifikasi', 'menerapkan'];
  const segThemes = topicSegments.flatMap(seg => extractThemes(seg.rawText));
  const uniqueThemes = [...new Set(segThemes.map(t => t.toLowerCase()))];
  const tujuanPembelajaran = uniqueThemes.slice(0, 4).map((theme, i) =>
    `Peserta mampu ${verbs[i] || 'memahami'} ${theme}`
  );
  if (tujuanPembelajaran.length === 0) {
    tujuanPembelajaran.push(`Peserta mampu memahami ${rawTopic.toLowerCase()}`);
  }

  // Material paras from uploaded docs
  const materialParas = materialTexts
    .flatMap(t => t.replace(/\s+/g, ' ').trim().split(/\n+/).map(l => l.trim()).filter(l => l.length > 20))
    .slice(0, 6);

  // Build kegiatan from topic segments
  const MAX_KEGIATAN = 4;

  const kegiatanPembelajaran: PdfKegiatan[] = topicSegments.slice(0, MAX_KEGIATAN).map((segment, ci) => {
    const segSentences = segment.rawText
      .split(/(?<=[.!?])\s+/)
      .filter(s => s.length > 20);

    const paragraphs: string[] = [];
    for (let i = 0; i < segSentences.length; i += 3) {
      paragraphs.push(segSentences.slice(i, i + 3).join(' '));
    }
    if (paragraphs.every(p => p.length <= 30)) {
      // Kalau paragraf terlalu pendek, gabung lebih banyak
      paragraphs.length = 0;
      for (let i = 0; i < segSentences.length; i += 5) {
        paragraphs.push(segSentences.slice(i, i + 5).join(' '));
      }
    }

    // Add materialParas to last kegiatan
    if (ci === Math.min(topicSegments.length - 1, MAX_KEGIATAN - 1) && materialParas.length > 0) {
      paragraphs.push(...materialParas);
    }

    const validParas = paragraphs.filter(p => p.length > 30);

    return {
      title: segment.title || `Kegiatan ${ci + 1}`,
      stimulus: `Perhatikan uraian berikut mengenai ${segment.title.toLowerCase()}.`,
      materi: validParas.length > 0 ? validParas : ['(Tidak cukup konten untuk bagian ini.)'],
      tables: [], steps: null, reviewNotes: null,
    };
  });

  return {
    title,
    identitas: { mataPelajaran: 'Umum', kelas: '-' },
    pendahuluan, tujuanPembelajaran, kegiatanPembelajaran,
    rangkumanAkhir: [],
    entitasPenting: { tools: [], namaOrang: [], angkaAturan: [], istilahTeknis: [], kodeRumus: [] },
    date: dateStr, totalChars, materialCount: materialTexts.length, branding: 'ALYNNE.EDU', source: 'local',
  };
}




// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── KEYWORD EXTRACTION (for Cornell left column) ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface CornellKeywords {
  terms: string[];     // kata kunci / istilah penting
  questions: string[]; // pertanyaan untuk review
}

function extractCornellKeywords(kg: PdfKegiatan): CornellKeywords {
  const terms: string[] = [];
  const questions: string[] = [];
  const allText = [...kg.materi].join(' ');

  // 1. Definisi patterns: "X adalah/yaitu/merupakan..."
  const defPatterns = [
    /([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(?:adalah|yaitu|merupakan|ialah)\s+/g,
    /pengertian\s+(?:dari\s+)?([A-Za-z]+(?:\s[A-Za-z]+){0,2})/gi,
    /definisi\s+(?:dari\s+)?([A-Za-z]+(?:\s[A-Za-z]+){0,2})/gi,
  ];
  for (const pat of defPatterns) {
    let m;
    while ((m = pat.exec(allText)) !== null) {
      const t = m[1].trim();
      if (t.length > 2 && t.length < 40 && !terms.includes(t)) terms.push(t);
    }
  }

  // 2. Concept/method patterns
  const conceptPatterns = [
    /(?:konsep|prinsip|teori|metode|proses|teknik|strategi|model|pendekatan)\s+(?:dari\s+)?([A-Za-z]+(?:\s[A-Za-z]+){0,3})/gi,
  ];
  for (const pat of conceptPatterns) {
    let m;
    while ((m = pat.exec(allText)) !== null) {
      const t = m[1].trim();
      if (t.length > 3 && t.length < 40 && !terms.includes(t)) terms.push(t);
    }
  }

  // 3. Capitalized multi-word terms (2-3 words, likely technical terms)
  const capPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;
  let capMatch;
  while ((capMatch = capPattern.exec(allText)) !== null) {
    const t = capMatch[1].trim();
    const skipWords = new Set(['Pernahkah','Perhatikan','Berikut','Sebelum','Sesudah','Selain','Dengan','Tanpa','Melalui','Menggunakan']);
    if (t.length > 5 && !terms.includes(t) && !skipWords.has(t)) terms.push(t);
  }

  // 4. Generate questions from rangkuman
  for (const r of (kg.rangkuman || [])) {
    const clean = r.replace(/[.!?]+$/, '').trim();
    if (clean.length > 15) {
      // Convert statement to question
      if (/^(?:peserta|mahasiswa|siswa)\s/i.test(clean)) {
        questions.push('Apa yang dimaksud dengan: ' + clean.split(/\s+(?:peserta|mahasiswa)/i)[0].trim().toLowerCase() + '?');
      } else {
        questions.push(clean.charAt(0).toLowerCase() + clean.slice(1) + '?');
      }
    }
  }

  // 5. Generate question from stimulus if no questions yet
  if (questions.length < 2 && kg.stimulus.length > 20) {
    const stimClean = kg.stimulus.replace(/[?!.]+$/, '').trim();
    if (stimClean.length > 10) {
      questions.push(stimClean + '?');
    }
  }

  // 6. If steps exist, add process question
  if (kg.steps && kg.steps.length > 0) {
    questions.push('Bagaimana langkah-langkah ' + kg.title.toLowerCase() + '?');
  }

  // 7. If reviewNotes exist, add review question
  if (kg.reviewNotes && kg.reviewNotes.length > 0) {
    questions.push('Apa saja koreksi teknis yang perlu diperhatikan?');
  }

  return {
    terms: [...new Set(terms)].slice(0, 10),
    questions: [...new Set(questions)].slice(0, 5),
  };
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── PDF BUILDER (Cornell Notes Style) ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function generatePdf(rawData: PdfModuleData): Promise<void> {
  const data = sanitizeModuleData(rawData);

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();  // 210
  const pageH = doc.internal.pageSize.getHeight(); // 297
  const margin = 18;
  const contentW = pageW - margin * 2;

  let y = 0;
  let pageNum = 0;

  const checkPage = (needed: number = 30) => {
    if (y + needed > pageH - 25) {
      addFooter(doc, pageW, pageH, ++pageNum, margin);
      doc.addPage();
      drawPageBg(doc, pageW, pageH);
      y = margin;
    }
  };

  // ════════════════════════════════════════════════════════════
  // 1. SAMPUL (Cover Page)
  // ════════════════════════════════════════════════════════════
  drawPageBg(doc, pageW, pageH);
  y = margin;

  // Top decorative double line
  doc.setDrawColor(78, 52, 62);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageW - margin, y);
  doc.setLineWidth(0.3);
  doc.line(margin, y + 1.5, pageW - margin, y + 1.5);
  y += 12;

  // Branding
  doc.setFontSize(9);
  doc.setTextColor(78, 52, 62);
  doc.setFont('helvetica', 'bold');
  doc.text('ALYNNE.EDU', margin, y);

  // Badge: MODUL CATATAN
  doc.setFontSize(7);
  const badgeText = 'MODUL CATATAN';
  const badgeW = doc.getTextWidth(badgeText) + 14;
  doc.setFillColor(255, 215, 64);
  doc.roundedRect(pageW - margin - badgeW, y - 3.5, badgeW, 7, 2, 2, 'F');
  doc.setTextColor(93, 64, 55);
  doc.setFont('helvetica', 'bold');
  doc.text(badgeText, pageW - margin - badgeW / 2, y + 0.5, { align: 'center' });
  y += 20;

  // Title
  doc.setFontSize(28);
  doc.setTextColor(27, 42, 74);
  doc.setFont('helvetica', 'bold');
  const titleLines = doc.splitTextToSize(data.title.toUpperCase(), contentW);
  for (const line of titleLines) {
    doc.text(line, margin, y);
    y += 11;
  }
  y += 6;

  // Decorative dashed line under title
  drawDashedLine(doc, margin, y, pageW - margin, y, [189, 189, 189]);
  y += 14;

  // Identitas card - simple, clean
  let identitasY = y;
  const identitasRows = [
    ['Mata Pelajaran', data.identitas.mataPelajaran],
    ['Kelas / Fase', data.identitas.kelas],
    ['Tanggal', data.date],
  ];
  for (const [label, value] of identitasRows) {
    doc.setFontSize(9);
    doc.setTextColor(136, 150, 171);
    doc.setFont('helvetica', 'normal');
    doc.text(label, margin, identitasY);
    doc.setTextColor(27, 42, 74);
    doc.setFont('helvetica', 'bold');
    doc.text(':  ' + value, margin + 38, identitasY);
    identitasY += 9;
  }
  y = identitasY + 10;

  // Stats line (subtle)
  doc.setFontSize(8);
  doc.setTextColor(136, 150, 171);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `${data.totalChars} karakter  |  ${data.kegiatanPembelajaran.length} kegiatan  |  ${data.materialCount} materi pendukung`,
    margin, y,
  );
  y += 14;

  // Bottom decorative double line
  drawDashedLine(doc, margin, pageH - 30, pageW - margin, pageH - 30, [189, 189, 189]);
  doc.setFontSize(7);
  doc.setTextColor(136, 150, 171);
  doc.setFont('helvetica', 'normal');
  doc.text('Dibuat otomatis oleh ALYNNE.EDU  |  Speech to Text & Modul Catatan', pageW / 2, pageH - 22, { align: 'center' });

  // Bottom double line
  doc.setDrawColor(78, 52, 62);
  doc.setLineWidth(0.3);
  doc.line(margin, pageH - 18, pageW - margin, pageH - 18);
  doc.setLineWidth(0.8);
  doc.line(margin, pageH - 16.5, pageW - margin, pageH - 16.5);

  // ════════════════════════════════════════════════════════════
  // 2. DAFTAR ISI (Table of Contents)
  // ════════════════════════════════════════════════════════════
  doc.addPage();
  pageNum = 1;
  drawPageBg(doc, pageW, pageH);
  y = margin;

  // Section header
  doc.setFontSize(10);
  doc.setTextColor(78, 52, 62);
  doc.setFont('helvetica', 'bold');
  doc.text('DAFTAR ISI', margin, y);
  y += 2;
  doc.setDrawColor(78, 52, 62);
  doc.setLineWidth(0.8);
  doc.line(margin, y, margin + 35, y);
  y += 16;

  const tocItems: { label: string; indent: number; isMain: boolean }[] = [
    { label: 'Pendahuluan', indent: 0, isMain: true },
    { label: 'Tujuan Pembelajaran', indent: 0, isMain: true },
    { label: 'Kegiatan Pembelajaran', indent: 0, isMain: true },
    ...data.kegiatanPembelajaran.flatMap((k, i) => [
      { label: `Kegiatan ${i + 1}: ${k.title}`, indent: 12, isMain: false },
    ]),
    { label: 'Rangkuman', indent: 0, isMain: true },
  ];

  for (const item of tocItems) {
    checkPage(8);
    const fs = item.isMain ? 10.5 : 9;
    doc.setFontSize(fs);
    doc.setFont('helvetica', item.isMain ? 'bold' : 'normal');
    doc.setTextColor(item.isMain ? 27 : 74, item.isMain ? 42 : 85, item.isMain ? 74 : 104);
    doc.text(item.label, margin + item.indent, y);

    if (item.isMain) {
      const tw = doc.getTextWidth(item.label);
      let dotX = margin + item.indent + tw + 3;
      doc.setTextColor(189, 189, 189);
      doc.setFontSize(7);
      while (dotX < pageW - margin - 10) {
        doc.text('.', dotX, y);
        dotX += 2.2;
      }
    }

    y += item.isMain ? 9 : 6;
  }

  addFooter(doc, pageW, pageH, ++pageNum, margin);

  // ════════════════════════════════════════════════════════════
  // 3. PENDAHULUAN (Catatan Pembuka)
  // ════════════════════════════════════════════════════════════
  doc.addPage();
  drawPageBg(doc, pageW, pageH);
  y = margin;

  // Bab header
  y = drawBabHeader(doc, margin, y, 'BAB 1', 'PENDAHULUAN', contentW);
  y += 6;

  // Pendahuluan text - clean paragraph style (Principle 3: whitespace cukup)
  if (data.pendahuluan) {
    const pendLines = doc.splitTextToSize(data.pendahuluan, contentW - 8);
    doc.setFontSize(10.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(27, 42, 74);
    for (const line of pendLines) {
      checkPage(7);
      doc.text(line, margin + 4, y);
      y += 7;
    }
    y += 12;
  }

  // Scope info box - dipakai JARANG, fungsional saja (Principle 2)
  checkPage(35);
  y += 4;
  const scopeLines = [
    `Modul ini terdiri dari ${data.kegiatanPembelajaran.length} kegiatan pembelajaran.`,
    data.materialCount > 0 ? `Tersedia ${data.materialCount} materi pendukung sebagai referensi.` : 'Modul ini disusun berdasarkan materi narasumber.',
    `Di akhir modul, tersedia rangkuman yang mencakup inti dari seluruh kegiatan pembelajaran.`,
  ];
  const scopeBoxH = scopeLines.length * 7 + 16;
  drawInfoBox(doc, margin + 4, y, contentW - 8, scopeBoxH);
  y += 8;
  doc.setFontSize(9.5);
  doc.setTextColor(74, 85, 104);
  for (const line of scopeLines) {
    const lines = doc.splitTextToSize(line, contentW - 24);
    for (const l of lines) {
      checkPage(7);
      doc.text(l, margin + 12, y);
      y += 6;
    }
    y += 1;
  }
  y += 6;

  addFooter(doc, pageW, pageH, ++pageNum, margin);

  // ════════════════════════════════════════════════════════════
  // 4. TUJUAN PEMBELAJARAN
  // ════════════════════════════════════════════════════════════
  doc.addPage();
  drawPageBg(doc, pageW, pageH);
  y = margin;

  y = drawBabHeader(doc, margin, y, 'BAB 2', 'TUJUAN PEMBELAJARAN', contentW);
  y += 6;

  // Intro text
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(136, 150, 171);
  const tujuanIntro = 'Setelah menyelesaikan modul ini, peserta diharapkan mampu:';
  const tujuanIntroLines = doc.splitTextToSize(tujuanIntro, contentW - 8);
  for (const line of tujuanIntroLines) {
    doc.text(line, margin + 4, y);
    y += 7;
  }
  y += 10;

  // Objectives - with creative bullets (small squares)
  if (data.tujuanPembelajaran.length > 0) {
    for (let oi = 0; oi < data.tujuanPembelajaran.length; oi++) {
      checkPage(14);

      // Draw small square bullet
      drawSquareBullet(doc, margin + 4, y - 1, [78, 52, 62]);

      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(27, 42, 74);
      const objLines = doc.splitTextToSize(data.tujuanPembelajaran[oi], contentW - 22);
      for (const line of objLines) {
        checkPage(7);
        doc.text(line, margin + 12, y);
        y += 6.5;
      }
      y += 8;  // whitespace antar item (Principle 3)
    }
  }

  y += 12;
  addFooter(doc, pageW, pageH, ++pageNum, margin);

  // ════════════════════════════════════════════════════════════
  // 5. KEGIATAN PEMBELAJARAN (Full-width content pages)
  for (let ki = 0; ki < data.kegiatanPembelajaran.length; ki++) {
    const kg = data.kegiatanPembelajaran[ki];

    doc.addPage();
    drawPageBg(doc, pageW, pageH);
    y = margin;

    const babNum = ki + 3;
    y = drawBabHeader(doc, margin, y, `BAB ${babNum}`, kg.title.toUpperCase(), contentW);
    y += 4;

    // Stimulus
    if (kg.stimulus) {
      checkPage(20);
      const stimLines = doc.splitTextToSize(kg.stimulus, contentW - 16);
      const stimBoxH = stimLines.length * 5.5 + 14;
      drawInfoBox(doc, margin, y, contentW, stimBoxH);
      y += 8;
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(74, 85, 104);
      for (const line of stimLines) {
        checkPage(7);
        doc.text(line, margin + 8, y);
        y += 5.5;
      }
      doc.setFont('helvetica', 'normal');
      y += stimBoxH - stimLines.length * 5.5 - 6 + 6;
    }

    // Materi (full width)
    if (kg.materi.length > 0) {
      for (let mi = 0; mi < kg.materi.length; mi++) {
        const para = kg.materi[mi];
        const lines = doc.splitTextToSize(para, contentW - 4);
        for (const line of lines) {
          checkPage(8);
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(27, 42, 74);
          doc.text(line, margin + 2, y);
          y += 6.5;
        }
        y += 7;
      }
    }

    // Tabel
    if (kg.tables && kg.tables.length > 0) {
      for (const tbl of kg.tables) {
        if (!tbl.headers.length || !tbl.rows.length) continue;
        checkPage(25);
        y += 4;
        const colCount = tbl.headers.length;
        const colW = contentW / colCount;
        const rowH = 7;
        const headerH = 8;

        // Table border
        const tableH = headerH + tbl.rows.length * rowH + 2;
        doc.setDrawColor(189, 189, 189);
        doc.setLineWidth(0.3);
        doc.setFillColor(250, 250, 250);
        doc.roundedRect(margin, y, contentW, tableH, 1, 1, 'FD');

        // Header row
        doc.setFillColor(78, 52, 62);
        doc.rect(margin, y, contentW, headerH, 'F');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        for (let ci = 0; ci < colCount; ci++) {
          const cellX = margin + ci * colW;
          const txt = tbl.headers[ci].slice(0, Math.floor(colW / 2.2));
          doc.text(txt, cellX + 2, y + 5.5);
        }
        y += headerH;

        // Data rows
        doc.setTextColor(27, 42, 74);
        for (let ri = 0; ri < tbl.rows.length; ri++) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          if (ri % 2 === 0) {
            doc.setFillColor(245, 245, 245);
            doc.rect(margin, y, contentW, rowH, 'F');
          }
          for (let ci = 0; ci < colCount; ci++) {
            const cellX = margin + ci * colW;
            const val = tbl.rows[ri]?.[ci] || '';
            const txt = val.slice(0, Math.floor(colW / 2));
            doc.text(txt, cellX + 2, y + 5);
          }
          y += rowH;
        }
        y += 2;
      }
      y += 6;
    }

    // Langkah Kerja
    if (kg.steps && kg.steps.length > 0) {
      checkPage(25);
      y += 4;
      drawDashedLine(doc, margin, y, margin + contentW, y, [189, 189, 189]);
      y += 8;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(78, 52, 62);
      doc.text('Langkah Kerja', margin, y);
      y += 2;
      doc.setDrawColor(78, 52, 62);
      doc.setLineWidth(0.3);
      doc.line(margin, y, margin + 30, y);
      y += 8;
      for (let si = 0; si < kg.steps.length; si++) {
        checkPage(12);
        const stepLines = doc.splitTextToSize(kg.steps[si], contentW - 18);
        drawNumberedSquare(doc, margin + 2, y - 1, si + 1, [78, 52, 62]);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(27, 42, 74);
        for (const line of stepLines) {
          checkPage(7);
          doc.text(line, margin + 10, y);
          y += 5;
        }
        y += 3;
      }
    }

    // Review Notes (koreksi teknis dari LLM)
    const reviewNotes = kg.reviewNotes;
    if (reviewNotes && reviewNotes.length > 0) {
      checkPage(20);
      y += 4;
      drawDashedLine(doc, margin, y, margin + contentW, y, [189, 189, 189]);
      y += 8;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(78, 52, 62);
      doc.text('Catatan Koreksi Teknis', margin, y);
      y += 2;
      doc.setDrawColor(78, 52, 62);
      doc.setLineWidth(0.3);
      doc.line(margin, y, margin + 35, y);
      y += 8;
      for (const note of reviewNotes) {
        checkPage(12);
        const noteLines = doc.splitTextToSize(note, contentW - 16);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(74, 85, 104);
        for (const line of noteLines) {
          checkPage(7);
          drawArrowBullet(doc, margin + 2, y - 1, [78, 52, 62]);
          doc.text(line, margin + 8, y);
          y += 5;
        }
        y += 3;
      }
    }

    addFooter(doc, pageW, pageH, ++pageNum, margin);
  }

  // ════════════════════════════════════════════════════════════
  // 6. RANGKUMAN AKHIR
  // ════════════════════════════════════════════════════════════
  if (data.rangkumanAkhir.length > 0) {
    doc.addPage();
    drawPageBg(doc, pageW, pageH);
    y = margin;

    const rangkumanBabNum = data.kegiatanPembelajaran.length + 3;
    y = drawBabHeader(doc, margin, y, `BAB ${rangkumanBabNum}`, 'RANGKUMAN', contentW);

    doc.setFontSize(9.5);
    doc.setTextColor(74, 85, 104);
    doc.setFont('helvetica', 'normal');
    doc.text('Berikut rangkuman inti yang mencakup seluruh kegiatan pembelajaran dalam modul ini.', margin, y);
    y += 12;

    for (const point of data.rangkumanAkhir) {
      checkPage(12);
      // Numbered bullet
      drawCircleBullet(doc, margin + 4, y - 1, [255, 213, 79]);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(27, 42, 74);
      const lines = doc.splitTextToSize(point, contentW - 18);
      for (const line of lines) {
        checkPage(7);
        doc.text(line, margin + 10, y);
        y += 6;
      }
      y += 4;
    }

    addFooter(doc, pageW, pageH, ++pageNum, margin);
  }

  // ── Save ──
  const filename = data.title
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
    .slice(0, 50);
  doc.save(`${filename}_catatan.pdf`);
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── PDF HELPER FUNCTIONS (Cornell Notes Style) ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** White/off-white page background */
function drawPageBg(doc: any, pageW: number, pageH: number) {
  doc.setFillColor(250, 250, 250);
  doc.rect(0, 0, pageW, pageH, 'F');
}

/** Clean footer with page number */
function addFooter(doc: any, pageW: number, pageH: number, num: number, mg: number) {
  doc.setDrawColor(224, 224, 224);
  doc.setLineWidth(0.2);
  doc.line(mg, pageH - 14, pageW - mg, pageH - 14);
  doc.setFontSize(7);
  doc.setTextColor(136, 150, 171);
  doc.setFont('helvetica', 'normal');
  doc.text('ALYNNE.EDU', mg, pageH - 9);
  doc.text(`Halaman ${num}`, pageW - mg, pageH - 9, { align: 'right' });
}

/** Dashed line - used for dividers between sections and Cornell vertical line */
function drawDashedLine(doc: any, x1: number, y1: number, x2: number, y2: number, color: number[], dashLen: number = 3, gapLen: number = 2) {
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(0.3);

  const isVertical = Math.abs(x1 - x2) < 0.5;
  if (isVertical) {
    let cy = y1;
    while (cy < y2) {
      const endY = Math.min(cy + dashLen, y2);
      doc.line(x1, cy, x2, endY);
      cy = endY + gapLen;
    }
  } else {
    let cx = x1;
    while (cx < x2) {
      const endX = Math.min(cx + dashLen, x2);
      doc.line(cx, y1, endX, y2);
      cx = endX + gapLen;
    }
  }
}

/** Info box - thin border for definitions, warnings, instructions */
function drawInfoBox(doc: any, x: number, y: number, w: number, h: number) {
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, w, h, 2, 2, 'F');
  doc.setDrawColor(189, 189, 189);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, h, 2, 2, 'S');
  // Left accent line
  doc.setDrawColor(78, 52, 62);
  doc.setLineWidth(0.8);
  doc.line(x, y + 2, x, y + h - 2);
}

/** Keyword highlight - yellow pastel background behind term */
function drawKeywordHighlight(doc: any, x: number, y: number, text: string, maxW: number) {
  doc.setFontSize(8);
  const tw = Math.min(doc.getTextWidth(text), maxW);
  // Yellow background
  doc.setFillColor(255, 248, 225);
  doc.roundedRect(x, y - 0.5, tw + 4, 5.5, 1, 1, 'F');
  // Text
  doc.setTextColor(93, 64, 55);
  doc.setFont('helvetica', 'bold');
  const lines = doc.splitTextToSize(text, maxW);
  doc.text(lines[0], x + 2, y + 3);
}

/** Small square bullet - replaces standard dash */
function drawSquareBullet(doc: any, x: number, y: number, color: number[], size: number = 1.5) {
  doc.setFillColor(color[0], color[1], color[2]);
  doc.rect(x - size, y - size, size * 2, size * 2, 'F');
}

/** Small circle bullet */
function drawCircleBullet(doc: any, x: number, y: number, color: number[], radius: number = 1.2) {
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(0.4);
  doc.circle(x, y, radius, 'S');
}

/** Arrow bullet - small arrow pointing right */
function drawArrowBullet(doc: any, x: number, y: number, color: number[]) {
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(0.4);
  // Arrow line
  doc.line(x, y, x + 3, y);
  // Arrow head
  doc.line(x + 2, y - 1, x + 3.5, y);
  doc.line(x + 2, y + 1, x + 3.5, y);
}

/** Numbered square - small square with number inside */
function drawNumberedSquare(doc: any, x: number, y: number, num: number, color: number[]) {
  doc.setFillColor(color[0], color[1], color[2]);
  doc.rect(x - 2, y - 2, 4, 4, 'F');
  doc.setFontSize(6);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.text(`${num}`, x, y + 1, { align: 'center' });
}

/** Bab/Chapter header - big bold title with brown underline */
function drawBabHeader(doc: any, x: number, y: number, babLabel: string, title: string, maxW: number): number {
  // Bab label (small)
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(136, 150, 171);
  doc.text(babLabel, x, y);
  y += 7;

  // Title (big, bold, dark blue)
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(27, 42, 74);
  const titleLines = doc.splitTextToSize(title, maxW);
  for (const line of titleLines) {
    doc.text(line, x, y);
    y += 8;
  }

  // Brown underline
  y += 1;
  doc.setDrawColor(78, 52, 62);
  doc.setLineWidth(0.8);
  doc.line(x, y, x + 40, y);
  y += 8;
  return y;
}

/** Sub-heading - Level 3 (review notes, steps sections, etc). Hierarki konsisten: selalu 11.5pt bold cokelat + garis cokelat */
function drawSubHeading(doc: any, x: number, y: number, text: string): number {
  y += 10;
  doc.setFontSize(11.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(78, 52, 62);
  doc.text(text, x, y);
  y += 2;
  // Brown underline (konsisten dengan aksen tunggal)
  doc.setDrawColor(78, 52, 62);
  doc.setLineWidth(0.4);
  doc.line(x, y, x + 35, y);
  y += 10;
  return y;
}
