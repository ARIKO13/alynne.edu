import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { callLLM, extractJson } from '@/lib/gateway-client';

/**
 * POST /api/stt/structure-direct
 *
 * Server-side LLM endpoint for PDF module generation (Tier-3 path).
 * Replaces the client-side direct Polyvor fetch in lib/pdf-generator.ts
 * that had a hardcoded gateway key exposed in the browser bundle.
 *
 * Request body:
 *   { transcript: string, materialTexts: string[], dateStr: string, totalChars: number }
 *
 * Response 200:
 *   { title, identitas, pendahuluan, tujuanPembelajaran,
 *     kegiatanPembelajaran: [{title, stimulus, materi, tables, steps, reviewNotes}],
 *     rangkumanAkhir, entitasPenting, date, totalChars,
 *     materialCount, branding: 'ALYNNE.EDU',
 *     modelUsed, fallbacksTriggered }
 *   OR { error: 'all-failed' } (200 with error field — client falls back to local)
 *
 * Response 401: { error: 'Unauthorized' }
 *
 * Routes to pi-bansos via callLLM with task='code' if transcript contains
 * coding keywords (Poolside primary), else task='long' (Nemotron primary).
 * Fallback chain inside callLLM handles per-model errors.
 */

const CODE_KEYWORDS = /\b(?:function|class|import |export |const |let |var |return |async |await|useState|useEffect|def |print\(|printf|console\.log|git |npm |docker |api|endpoint|database|sql|query|html|css|javascript|typescript|python|java\b|react|vue|angular|node\.?js|express|flask|django|laravel)\b/i;

const GW_COMBINED_PROMPT = `Kamu mengubah materi kuliah menjadi modul catatan pembelajaran terstruktur dalam Bahasa Indonesia formal.

SUMBER INPUT bisa berisi dua jenis konten yang ditandai label:
- "--- TRANSCRIPT AUDIO ---" : hasil Speech-to-Text dari rekaman dosen. Mentah, banyak filler words, typo STT, dan kalimat bertele-tele.
- "--- MATERI SLIDE ---" : konten dari slide presentasi (PPTX/PDF). Sudah terstruktur rapi (heading, list, tabel).

━━━ ATURAN PENGGABUNGAN SUMBER (PALING PENTING) ━━━
1. Gunakan MATERI SLIDE sebagai KERANGKA STRUKTUR (urutan topik, judul heading, tabel) karena sudah rapi.
2. Gunakan TRANSCRIPT AUDIO sebagai PELENGKAP konteks/penjelasan tambahan pada section yang relevan - BUKAN sebagai section terpisah yang mengulang topik sama.
3. JANGAN membuat dua section/kegiatan berbeda untuk topik yang sama dari dua sumber - GABUNG jadi satu section.
4. Jika slide punya tabel (rubrik, bobot nilai, jadwal) dan transcript menjelaskan isi tabel tersebut, masukkan tabel lalu tambahkan penjelasan dari transcript sebagai paragraf setelah tabel.

━━━ ATURAN CLEANUP TRANSCRIPT ━━━
5. Buang filler words: "eh", "ya", "kan", "gitu", "oke", "jadi gini", "nah", "anu", dan pengulangan kata yang tidak bermakna.
6. Perbaiki typo/salah dengar STT berdasarkan konteks kalimat sekitarnya.
7. Rangkum kalimat bertele-tele jadi kalimat formal yang jelas dan padat. JANGAN salin transcript kata-per-kata.
8. Jika bagian transcript terlalu rusak/tidak jelas maknanya, ringkas jadi satu kalimat umum.

━━━ ATURAN TABEL ━━━
9. Data tabular (bobot nilai, rubrik penilaian, kriteria, jadwal, perbandingan) WAJIB dijadikan field "tables" dengan headers dan rows.
10. Jika slide punya tabel yang jelas, preservasi strukturnya ke field "tables".

━━━ ATURAN HEADING ━━━
11. Judul kegiatan/heading HARUS berupa frasa singkat dan LENGKAP. Maksimal 8 kata.
12. Rumuskan ulang judul berdasarkan TOPIK section, jangan salin mentah dari transcript.

━━━ ATURAN KONTEN ━━━
13. "stimulus" tiap kegiatan = 1 kalimat pemantik relevan.
14. TIDAK ADA rangkuman per kegiatan. Rangkuman HANYA di field "rangkumanAkhir" (5-8 poin mencakup inti SEMUA kegiatan).
15. TIDAK ADA section asesmen/soal.
16. "steps" HANYA jika ada prosedur eksplisit. "reviewNotes" HANYA jika ada koreksi teknis.
17. Jika tidak ada steps/review, set null (bukan array kosong).
18. Isi "entitasPenting" dengan: tools, namaOrang, angkaAturan, istilahTeknis, kodeRumus.
19. "identitas.mataPelajaran" dan "kelas": tebak dari konten.
20. JANGAN menambah informasi yang tidak ada di sumber. JAGA istilah teknis asli.

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
      "tables": [{"headers": ["Kolom1", "Kolom2"], "rows": [["val1", "val2"]]}],
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

function normalizeKegiatan(k: any) {
  return {
    title: String(k?.title || ''),
    stimulus: String(k?.stimulus || ''),
    materi: Array.isArray(k?.materi) ? k.materi.map(String) : [],
    tables: Array.isArray(k?.tables) ? k.tables : null,
    steps: Array.isArray(k?.steps) ? k.steps.map(String) : null,
    reviewNotes: Array.isArray(k?.reviewNotes) ? k.reviewNotes.map(String) : null,
  };
}

function normalizeEntitasPenting(ep: any) {
  return {
    tools: Array.isArray(ep?.tools) ? ep.tools.map(String) : [],
    namaOrang: Array.isArray(ep?.namaOrang) ? ep.namaOrang.map(String) : [],
    angkaAturan: Array.isArray(ep?.angkaAturan) ? ep.angkaAturan.map(String) : [],
    istilahTeknis: Array.isArray(ep?.istilahTeknis) ? ep.istilahTeknis.map(String) : [],
    kodeRumus: Array.isArray(ep?.kodeRumus) ? ep.kodeRumus.map(String) : [],
  };
}

export const POST: APIRoute = async ({ request }) => {
  try {
    // Auth: any logged-in user (PDF generation is user-facing, not admin-only)
    const session = await getSession(request);
    if (!session?.user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as {
      transcript: string;
      materialTexts?: string[];
      dateStr?: string;
      totalChars?: number;
    };

    const transcript = (body.transcript || '').trim();
    if (!transcript) {
      return Response.json({ error: 'Transcript kosong' }, { status: 400 });
    }

    const materialTexts = body.materialTexts || [];
    const dateStr = body.dateStr || new Date().toLocaleDateString('id-ID');
    const totalChars = body.totalChars || transcript.length;

    // Build user message — same format as old client-side tryGatewayFallback
    const matSec = materialTexts.length > 0
      ? '\n\nMATERI PENDUKUNG:\n' + materialTexts.map((t, i) => `--- MATERI SLIDE ${i + 1} ---\n${t.slice(0, 5000)}`).join('\n\n')
      : '';
    const userMsg = `Ubah transkrip ini jadi modul catatan pembelajaran.${matSec}\n\n--- TRANSCRIPT AUDIO ---\n${transcript}`;

    // Pick task type based on content
    const isCodeContent = CODE_KEYWORDS.test(transcript);
    const task = isCodeContent ? 'code' : 'long';
    console.log(`[structure-direct] transcript ${transcript.length} chars, task=${task} (code=${isCodeContent})`);

    const result = await callLLM(task, GW_COMBINED_PROMPT, userMsg, {
      maxTokens: 24000,
      timeout: 180_000,
      endpoint: 'structure-direct',
    });

    if (!result.content) {
      console.error('[structure-direct] callLLM returned null (all 3 pi-bansos models failed)');
      return Response.json({ error: 'all-failed' }, { status: 200 });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(extractJson(result.content));
    } catch (e) {
      console.error('[structure-direct] JSON parse failed:', e);
      return Response.json({ error: 'parse-failed' }, { status: 200 });
    }

    if (!parsed.title || !Array.isArray(parsed.kegiatanPembelajaran) || parsed.kegiatanPembelajaran.length === 0) {
      console.error('[structure-direct] Invalid structure');
      return Response.json({ error: 'invalid-structure' }, { status: 200 });
    }

    console.log(`[structure-direct] SUCCESS: ${parsed.kegiatanPembelajaran.length} kegiatan (model: ${result.modelUsed}, fallbacks: ${result.fallbacksTriggered.length})`);

    return Response.json({
      title: String(parsed.title),
      identitas: {
        mataPelajaran: String(parsed.identitas?.mataPelajaran || 'Umum'),
        kelas: String(parsed.identitas?.kelas || '-'),
      },
      pendahuluan: String(parsed.pendahuluan || ''),
      tujuanPembelajaran: Array.isArray(parsed.tujuanPembelajaran) ? parsed.tujuanPembelajaran.map(String) : [],
      kegiatanPembelajaran: parsed.kegiatanPembelajaran.map(normalizeKegiatan),
      rangkumanAkhir: Array.isArray(parsed.rangkumanAkhir) ? parsed.rangkumanAkhir.map(String) : [],
      entitasPenting: normalizeEntitasPenting(parsed.entitasPenting),
      date: dateStr,
      totalChars,
      materialCount: materialTexts.length,
      branding: 'ALYNNE.EDU',
      modelUsed: result.modelUsed,
      fallbacksTriggered: result.fallbacksTriggered.length,
    });
  } catch (e: any) {
    console.error('[structure-direct] fatal:', e);
    return Response.json({ error: 'Generation failed', message: e?.message }, { status: 500 });
  }
};
