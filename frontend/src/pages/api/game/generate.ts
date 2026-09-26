import type { APIRoute } from 'astro';

interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  context?: string;
  contextType?: 'code' | 'scenario' | 'none';
}

const PROGRAMMING_KEYWORDS = [
  'function', 'variable', 'loop', 'array', 'class', 'object', 'method', 'return',
  'if else', 'for loop', 'while', 'async', 'await', 'promise', 'api', 'react',
  'component', 'state', 'props', 'hook', 'css', 'html', 'javascript', 'typescript',
  'python', 'java', 'php', 'database', 'sql', 'query', 'git', 'framework',
  'node', 'npm', 'library', 'algorithm', 'data structure', 'string', 'integer',
  'boolean', 'null', 'undefined', 'console', 'render', 'import', 'export',
  'def ', 'print(', 'const ', 'let ', 'var ', '=>', '===', '!==',
  'foreach', 'map(', 'filter(', 'reduce(', 'try catch', 'error handling',
  'komputer', 'pemrograman', 'program', 'kode', 'coding', 'developer',
];

function isProgrammingTopic(transcript: string): boolean {
  const lower = transcript.toLowerCase();
  return PROGRAMMING_KEYWORDS.some(kw => lower.includes(kw));
}

function detectTopic(transcript: string): string {
  const lower = transcript.toLowerCase();
  const topicKeywords: Record<string, string[]> = {
    'Pemrograman': ['function', 'variable', 'loop', 'array', 'class', 'kode', 'programming', 'javascript', 'python', 'react', 'css', 'html', 'api', 'database', 'algorithm'],
    'Konten & Media Sosial': ['video', 'tiktok', 'instagram', 'youtube', 'konten', 'foto', 'review'],
    'Gaming & Esports': ['game', 'gaming', 'esport', 'multiplayer', 'rank', 'turnamen'],
    'Sains & Teknologi': ['sains', 'teknologi', 'robot', 'data', 'algoritma', 'komputer'],
    'Bisnis & Ekonomi': ['bisnis', 'uang', 'investasi', 'profit', 'market', 'jualan', 'harga'],
    'Pendidikan': ['belajar', 'kuliah', 'sekolah', 'pelajaran', 'guru', 'murid', 'kelas'],
  };
  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some((kw) => lower.includes(kw))) return topic;
  }
  return 'Umum';
}

function buildSystemPrompt(isProgramming: boolean): string {
  if (isProgramming) {
    return `Kamu adalah pembuat soal kuis pemrograman tingkat KOMPETISI. Tugasmu membuat soal yang bikin programmer berpikir "ooh, gini toh..." dan benar-benar menguji pemahaman mereka.

JENIS SOAL YANG HARUS ADA:
1. **Code Reading** - Beri potongan kode, tanya output/hasilnya. User HARUS trace manual, bukan sekadar hafal.
2. **Bug Hunting** - Beri kode yang ada bug, tanya mana yang salah dan kenapa. Distractor harus error yang plausible.
3. **Konsep Logic** - Tanyakan konsep dengan contoh konkret. Bukan definisi, tapi "mengapa" dan "bagaimana".
4. **Studi Kasus** - Beri skenario nyata (misal: "Seorang developer membuat API, tapi..."), tanya solusi terbaik.
5. **Edge Case** - Soal yang mengejutkan tentang corner case bahasa pemrograman.

ATURAN KETAT:
- context WAJIB berisi kode/skenario yang relevan dan sesuai materi transkrip
- contextType = "code" jika konten berisi kode, "scenario" jika skenario cerita
- Jangan buat soal definisi membosankan ("Apa itu function?") - buat soal AKSI ("Function X dipanggil dengan Y, outputnya?")
- Distractor HARUS plausible - salah satu distractor harus jawaban yang "hampir benar" tapi ada satu hal kecil yang salah
- explanation HARUS mengajarkan sesuatu - jelaskan MENGAPAI jawaban itu benar dan MENGAPA distractor lain salah
- Kode harus valid dan runnable (jangan pseudo-code asal-asalan)
- Soal HARUS dari materi transkrip, jangan asal bikin soal umum
- Koreksi semua typo STT dalam konten soal

DISTRIBUSI (10 soal):
- 3 EASY: Pemahaman dasar, recall dengan twist
- 4 MEDIUM: Code reading, bug hunting, aplikasi konsep
- 3 HARD: Studi kasus, edge case, complex logic

Kembalikan JSON SAJA tanpa markdown code block:`;
  }

  return `Kamu adalah pembuat soal kuis tingkat KOMPETISI. Tugasmu membuat soal yang bikin user berpikir "ooh, gini toh..." dan benar-benar menguji pemahaman mendalam mereka.

JENIS SOAL YANG HARUS ADA:
1. **Studi Kasus** - Beri skenario nyata dari materi, tanya apa yang sebaiknya dilakukan dan MENGAPA. Scenario harus detail dan realistis.
2. **Analisis Kausal** - "Jika X terjadi, maka Y karena..." - uji pemahaman sebab-akibat.
3. **Aplikasi Konsep** - "Dalam situasi Z, konsep A akan menghasilkan..." - uji transfer knowledge.
4. **Bandingkan & Kontraskan** - Tanyakan perbedaan dua konsep yang mirip tapi berbeda.
5. **Tebak Hasil** - Beri data/situasi, tanya hasil yang paling logis berdasarkan materi.

ATURAN KETAT:
- context WAJIB berisi skenario/case study yang relevan dan menarik
- contextType = "scenario" hampir selalu (kecuali ada data/fakta spesifik)
- Soal harus membuat user BERPIKIR, bukan sekadar menghafal
- Distractor HARUS plausible - setiap opsi harus terasa "bisa jadi benar" bagi yang tidak paham
- explanation HARUS mendalam - jelaskan konsep di balik jawaban, bukan sekadar "jawaban yang benar adalah A"
- Gunakan bahasa formal yang bersih (koreksi typo dari transkrip STT)
- Soal HARUS dari materi transkrip, jangan asal bikin soal umum
- Untuk soal studi kasus, buat skenario yang relevan dengan kehidupan nyata

DISTRIBUSI (10 soal):
- 3 EASY: Pemahaman konsep dasar dengan sedikit twist
- 4 MEDIUM: Analisis, perbandingan, aplikasi ke situasi baru
- 3 HARD: Studi kasus kompleks, penalaran multi-langkah

Kembalikan JSON SAJA tanpa markdown code block:`;
}

const JSON_FORMAT = `{
  "topic": "...",
  "questions": [
    {
      "id": 1,
      "question": "...",
      "context": "...potongan kode atau skenario...",
      "contextType": "code" atau "scenario" atau "none",
      "options": ["...", "...", "...", "..."],
      "correctIndex": 0,
      "explanation": "...penjelasan mendalam...",
      "difficulty": "easy"
    }
  ]
}`;

function extractJson(text: string): string {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];
  return text;
}

function normalizeQuestion(q: any, idx: number): QuizQuestion {
  return {
    id: idx + 1,
    question: String(q.question || ''),
    context: q.context ? String(q.context) : undefined,
    contextType: q.contextType === 'code' ? 'code' : q.contextType === 'scenario' ? 'scenario' : 'none',
    options: Array.isArray(q.options) ? q.options.slice(0, 6).map(String) : ['A', 'B', 'C', 'D'],
    correctIndex: typeof q.correctIndex === 'number' ? q.correctIndex : 0,
    explanation: String(q.explanation || 'Jawaban ini sesuai dengan materi yang dipelajari.'),
    difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
  };
}

// ─── Local Fallback Generator ───

function splitSentences(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split(/[!?\n]+/).map(s => s.trim()).filter(s => s.length >= 15 && s.split(/\s+/).length >= 5);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function localFallback(transcript: string, topic: string): { questions: QuizQuestion[]; topic: string } {
  const sentences = splitSentences(transcript);
  const questions: QuizQuestion[] = [];

  for (let i = 0; i < Math.min(sentences.length, 10); i++) {
    const s = sentences[i];
    const words = s.split(/\s+/).filter(w => w.length >= 4);
    const keyPhrase = words.sort((a, b) => b.length - a.length)[0] || s.slice(0, 30);
    const blanked = s.replace(new RegExp(escapeRegex(keyPhrase), 'i'), '______');

    questions.push({
      id: i + 1,
      question: `Lengkapi: "${blanked.trim()}"`,
      options: shuffle([keyPhrase, 'Tidak disebutkan', 'Semua benar', 'Tidak ada hubungan']).slice(0, 4),
      correctIndex: 0,
      explanation: `Jawaban yang benar adalah "${keyPhrase}" sesuai materi.`,
      difficulty: i < 3 ? 'easy' : i < 7 ? 'medium' : 'hard',
    });
  }

  while (questions.length < 10) {
    questions.push({
      id: questions.length + 1,
      question: 'Apa manfaat utama memahami materi yang dipelajari?',
      options: ['Meningkatkan pemahaman dan retensi', 'Tidak ada manfaat', 'Hanya untuk ujian', 'Membuang waktu'],
      correctIndex: 0,
      explanation: 'Memahami materi membantu meningkatkan retensi jangka panjang.',
      difficulty: 'easy',
    });
  }

  return { questions: questions.slice(0, 10), topic };
}

// ─── Main Handler ───

export const POST: APIRoute = async ({ request }) => {
  try {
    const { transcript } = await request.json();
    if (!transcript || transcript.trim().length < 20) {
      return Response.json({ error: 'Transkrip terlalu pendek (min 20 karakter)' }, { status: 400 });
    }

    const isProg = isProgrammingTopic(transcript);
    const topic = detectTopic(transcript);
    const apiKey = process.env.GATEWAY_API_KEY;

    // Try LLM generation
    if (apiKey && transcript.trim().length > 100) {
      try {
        const systemPrompt = buildSystemPrompt(isProg) + '\n' + JSON_FORMAT;
        const userPrompt = `Berikut transkrip dari materi ${topic}. Buat 10 soal kuis BERKUALITAS TINGGI dari materi ini.

--- TRANSKRIP ---
${transcript.slice(0, 15000)}`;

        const res = await fetch('https://gateway.polyvorlabs.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'vy/gemini-3.6-flash',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.4,
            max_tokens: 12000,
          }),
          signal: AbortSignal.timeout(90_000),
        });

        if (res.ok) {
          const data = await res.json();
          const raw = data.choices?.[0]?.message?.content || '';
          const jsonStr = extractJson(raw);
          const parsed = JSON.parse(jsonStr);

          if (Array.isArray(parsed.questions) && parsed.questions.length >= 5) {
            const questions = parsed.questions.slice(0, 10).map((q: any, i: number) => normalizeQuestion(q, i));
            return Response.json({ questions, topic: parsed.topic || topic });
          }
        }
        console.warn('[game/generate] LLM returned invalid format, falling back');
      } catch (err) {
        console.warn('[game/generate] LLM failed, using fallback:', err);
      }
    }

    // Local fallback
    const fallback = localFallback(transcript, topic);
    return Response.json(fallback);
  } catch (error) {
    console.error('Quiz generation error:', error);
    const msg = error instanceof Error ? error.message : 'Gagal generate quiz';
    return Response.json({ error: msg }, { status: 500 });
  }
};
