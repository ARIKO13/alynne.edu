/**
 * api/game/create.ts  -  Buat room game kuis multiplayer (PUBLIK, tanpa login)
 *
 * POST { topic, count, mode, name, avatar }
 * Soal digenerate LLM via gateway internal (callLLM 'structured-json') —
 * tanpa API key tambahan. Room + host player dibuat di engine in-memory.
 * Rate limit per-IP 6x/15 menit biar nggak dipakai generator gratisan.
 */
import type { APIRoute } from 'astro';
import { callLLM } from '@/lib/gateway-client';
import {
  createRoom, gcRooms, type GameMode, type GQuestion,
} from '@/lib/game/engine';

const RATE: Map<string, number[]> = new Map();
const RATE_MAX = 6;
const RATE_WINDOW = 15 * 60 * 1000;

const AVATARS = ['🦁','🐼','🦊','🐸','🐨','🦄','🐙','🦉','🐺','🐯','🐵','🐲'];

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (RATE.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  if (arr.length >= RATE_MAX) {
    RATE.set(ip, arr);
    return true;
  }
  arr.push(now);
  RATE.set(ip, arr);
  return false;
}

function sanitizeName(s: string): string {
  const t = String(s || '').replace(/[<>"\\]/g, '').trim().slice(0, 16);
  return t.length >= 2 ? t : 'Pemain';
}

function shuffleQuiz(q: GQuestion): GQuestion {
  const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
  return {
    q: q.q,
    choices: order.map((i) => q.choices[i]),
    answer: order.indexOf(q.answer),
    explain: q.explain,
  };
}

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

/** Normalisasi jawaban: index 0-3 / angka 1-4 / huruf A-D / teks opsi. */
function normAnswer(raw: unknown, choices: string[]): number {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (raw >= 0 && raw <= 3) return raw;
    if (raw >= 1 && raw <= 4) return raw - 1;
    return -1;
  }
  const s = String(raw ?? '').trim();
  if (/^[1-4]$/.test(s)) return Number(s) - 1;
  const m = s.match(/^[A-Da-d]([.)\s:]|$)/);
  if (m) return 'ABCD'.indexOf(s[0].toUpperCase());
  const lower = s.toLowerCase();
  const idx = choices.findIndex((c) => c.toLowerCase() === lower);
  return idx;
}

function extractQuestions(raw: string, want: number): GQuestion[] | null {
  const txt = raw.replace(/```(?:json)?/gi, '').trim();
  // kandidat array: bare [..] atau objek {soal:[..]} / {questions:[..]} dsb
  let candidates: unknown[] = [];
  const a1 = txt.indexOf('[');
  const b1 = txt.lastIndexOf(']');
  if (a1 !== -1 && b1 > a1) {
    try {
      const j = JSON.parse(txt.slice(a1, b1 + 1));
      if (Array.isArray(j)) candidates = j;
    } catch { /* coba jalur objek */ }
  }
  if (!candidates.length) {
    const a2 = txt.indexOf('{');
    const b2 = txt.lastIndexOf('}');
    if (a2 !== -1 && b2 > a2) {
      try {
        const j = JSON.parse(txt.slice(a2, b2 + 1)) as Record<string, unknown>;
        if (j && typeof j === 'object') {
          for (const v of Object.values(j)) {
            if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
              candidates = v as unknown[];
              break;
            }
          }
          if (!candidates.length) candidates = [j]; // soal tunggal
        }
      } catch { /* balanced-brace fallback di bawah */ }
    }
  }
  if (!candidates.length) {
    // balanced-bracket scan utk array yang nempel di teks lain
    for (let i = 0; i < txt.length; i++) {
      if (txt[i] !== '[') continue;
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let j2 = i; j2 < txt.length; j2++) {
        const ch = txt[j2];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '[') depth++;
        else if (ch === ']') {
          depth--;
          if (depth === 0) {
            try {
              const j = JSON.parse(txt.slice(i, j2 + 1));
              if (Array.isArray(j)) candidates = j;
            } catch { /* coba '[' berikutnya */ }
            break;
          }
        }
      }
      if (candidates.length) break;
    }
  }
  if (!candidates.length) return null;

  const out: GQuestion[] = [];
  for (const it of candidates) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const qStr = String(pick(o, ['q', 'pertanyaan', 'soal', 'question', 'teks']) ?? '').trim();
    const rawChoices = pick(o, ['choices', 'opsi', 'pilihan', 'options', 'pilihan_jawaban']);
    const choices = (Array.isArray(rawChoices) ? rawChoices : [])
      .map((c) =>
        typeof c === 'object' && c !== null
          ? String(pick(c as Record<string, unknown>, ['text', 'teks', 'isi', 'jawaban']) ?? '')
          : String(c ?? ''),
      )
      .map((c) => c.replace(/^\s*[A-Da-d][.)]\s*/, '').trim()) // buang "A. " prefix
      .filter((c) => c.length > 0 && c.length <= 120)
      .slice(0, 4);
    const explain = String(pick(o, ['explain', 'penjelasan', 'alasan', 'explanation']) ?? '').trim().slice(0, 200);
    if (qStr.length < 5 || qStr.length > 300 || choices.length !== 4) continue;
    const answer = normAnswer(pick(o, ['answer', 'jawaban', 'kunci', 'kunci_jawaban', 'correct', 'jawaban_benar']), choices);
    if (answer < 0 || answer > 3) continue;
    out.push(shuffleQuiz({ q: qStr, choices, answer, explain }));
    if (out.length >= want) break;
  }
  return out.length >= Math.min(3, want) ? out : null;
}

export const POST: APIRoute = async ({ request }) => {
  gcRooms();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'lokal';
  if (rateLimited(ip)) {
    return Response.json({ error: 'Terlalu sering buat room — tunggu beberapa menit.' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body tidak valid' }, { status: 400 });
  }

  const topic = String(body.topic || '').trim().replace(/[<>"\\]/g, '').slice(0, 60);
  const count = [5, 10, 15].includes(Number(body.count)) ? Number(body.count) : 10;
  const mode: GameMode = body.mode === 'coop' ? 'coop' : 'battle';
  const name = sanitizeName(String(body.name || ''));
  const avatar = AVATARS.includes(String(body.avatar)) ? String(body.avatar) : '🦁';

  if (topic.length < 3) {
    return Response.json({ error: 'Topik minimal 3 huruf — misal "Fotosintesis".' }, { status: 400 });
  }

  const system =
    'Kamu pembuat soal kuis edukatif berbahasa Indonesia untuk siswa SMP/SMA. ' +
    'Kembalikan HANYA satu objek JSON valid sesuai format yang diminta — tanpa markdown, tanpa penjelasan, tanpa teks lain.';
  const mkUser = (n: number) =>
    [
      `Buat ${n} soal kuis pilihan ganda untuk topik: "${topic}".`,
      'Format jawaban WAJIB persis seperti ini (satu objek JSON berisi array "daftar_soal"):',
      '{"daftar_soal": [{"q": "teks soal", "choices": ["opsi A", "opsi B", "opsi C", "opsi D"], "answer": 0, "explain": "penjelasan singkat kenapa jawaban itu benar (maks 150 karakter)"}]}',
      `- Array "daftar_soal" harus berisi TEPAT ${n} objek soal.`,
      '- "answer" = index opsi yang benar (angka 0-3).',
      '- Campuran mudah/sedang/sulit, tidak mengulang konsep yang sama.',
      '- 4 opsi mirip panjangnya, hanya SATU benar, pengecoh masuk akal (bukan absurd).',
      '- Fakta harus benar dan umum diterima; bahasa Indonesia natural.',
      '- Jawab dengan objek JSON itu saja.',
    ].join('\n');

  let questions: GQuestion[] | null = null;
  const budgetEnd = Date.now() + 55_000; // di bawah timeout nginx 60 dtk
  for (let attempt = 1; attempt <= 2 && !questions; attempt++) {
    const left = budgetEnd - Date.now();
    if (attempt > 1 && left < 12_000) break; // nggak cukup waktu buat attempt kedua
    try {
      const res = await callLLM('structured-json', system, mkUser(count), {
        maxTokens: 3200,
        timeout: Math.min(45_000, Math.max(15_000, left)),
        temperature: 0.7,
        jsonMode: true,
        endpoint: 'game/create',
      });
      if (res.content) questions = extractQuestions(res.content, count);
      if (!questions && res.content) {
        // logging diagnostik: bentuk apa yang model kirim (400 char pertama)
        console.warn(`[game/create] parse gagal (attempt ${attempt}). Konten:`, res.content.slice(0, 400));
      }
    } catch {
      /* jatuh ke error di bawah */
    }
  }

  if (!questions) {
    return Response.json(
      { error: 'Gagal menyusun soal (generator lagi sibuk). Coba lagi — atau pakai topik lain.' },
      { status: 502 },
    );
  }

  const room = createRoom({ mode, topic, questions, hostName: name, hostAvatar: avatar });
  const host = [...room.players.values()][0];
  return Response.json({ ok: true, code: room.code, pid: host.id, count: questions.length });
};
