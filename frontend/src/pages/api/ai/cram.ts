/**
 * api/ai/cram.ts  -  Mode SKS (Sistem Kebut Semalam) + Detektor Jebakan Soal
 *
 * Input: teks materi (paste / transkrip / materi unggahan) + tipe ujian.
 * Output JSON terkunci pada materi:
 * - inti 30% paling krusial (urut prioritas, dengan alasan)
 * - prediksi soal pengecoh (jawaban pengecoh + kenapa menggoda + penjelasan)
 * - fakta kilat untuk hafalan H-1
 * - checklist belajar H-1 jam ujian
 *
 * Strict grounding (anti-halusinasi): prompt WAJIB hanya memakai materi yang
 * dikirim; jika materi tidak memuat sesuatu, LLM dilarang mengarang. Materi
 * terpotong di 12.000 karakter agar token aman.
 */

import type { APIRoute } from 'astro';
import { callLLM } from '@/lib/gateway-client';

const TIPE_PROMPT: Record<string, string> = {
  'utbk': 'Gaya soal UTBK/SNBT: penalaran, pengecoh mirip jawaban benar, istilah yang tertukar.',
  'uas': 'Gaya soal UAS kampus: kombinasi konsep, rumus/istilah, dan studi kasus pendek.',
  'kuis': 'Gaya soal kuis kilat: definisi, fakta spesifik, angka.',
  'lisan': 'Pertanyaan ujian lisan: dibuat agar jawaban tersasar jika hafalan dangkal.',
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const sourceText: string = typeof body.sourceText === 'string' ? body.sourceText : '';
    const tipe: string = typeof body.tipe === 'string' && TIPE_PROMPT[body.tipe] ? body.tipe : 'uas';

    if (sourceText.trim().length < 50) {
      return Response.json(
        { error: 'Materi terlalu pendek. Tempel atau unggah materi minimal beberapa paragraf.' },
        { status: 400 }
      );
    }
    const materi = sourceText.slice(0, 12_000);

    const system = [
      'Kamu adalah penyusun materi belajar darurat ("Mode SKS") untuk pelajar/mahasiswa Indonesia: menyaring 30% inti materi paling krusial saat waktu belajar tinggal beberapa jam, dan memprediksi bagian yang sering dijadikan soal pengecoh.',
      `Gaya soal pengecoh: ${TIPE_PROMPT[tipe]}`,
      '',
      'ATURAN WAJIB (anti-halusinasi):',
      '1. HANYA gunakan informasi dari materi yang diberikan. DILARANG menambah fakta, angka, istilah, atau teori di luar materi.',
      '2. Jika materi tidak cukup untuk suatu bagian, isi array itu dengan sedikit item saja; jangan mengarang.',
      '3. Balas HANYA JSON valid tanpa teks lain, skema:',
      '{"ringkasan": "1 kalimat", "inti": [{"poin": "...", "mengapa_krusial": "...", "prioritas": "wajib|penting"}], "jebakan": [{"soal": "...", "opsi": ["...", "...", "...", "..."], "jawaban": "A|B|C|D", "jebakan": "kenapa jawaban pengecoh menggoda", "penjelasan": "..."}], "kilat": ["fakta satu baris"], "checklist": ["langkah belajar H-1"]}',
      '4. "inti" 6-10 item urut prioritas (wajib dulu). "jebakan" 4-6 soal pilihan ganda 4 opsi; jawaban pengecoh HARUS mirip jawaban benar tapi salah. "kilat" 8-12 baris. "checklist" 4-6 langkah praktis.',
    ].join('\n');

    const result = await callLLM('structured-json', system, `MATERI:\n${materi}`, {
      maxTokens: 3200,
      timeout: 90_000,
      temperature: 0.5,
      endpoint: 'ai/cram',
    });

    if (!result.content) {
      return Response.json(
        { error: 'Server AI sedang tidak tersedia. Materi inti masih bisa disaring offline.' },
        { status: 503 }
      );
    }

    return Response.json({
      id: `cram-${Date.now()}`,
      model: result.modelUsed,
      fallbacksTriggered: result.fallbacksTriggered.length,
      content: result.content,
    });
  } catch (e) {
    return Response.json(
      { error: 'Internal error', detail: e instanceof Error ? e.message : 'unknown' },
      { status: 500 }
    );
  }
};
