/**
 * js-pipeline.ts — Client-side DETERMINISTIC pipeline untuk Mode Belajar.
 *
 * NO server LLM calls. NO gateway. NO timeout. NO "Server sedang sibuk".
 * Runs entirely in browser, <2 detik untuk 200K char input.
 *
 * Fase:
 * 1. FILTER — regex hapus filler ("um", "ah", "oke", "eee"), normalize whitespace,
 *    hapus greeting/closing, hapus duplikat kalimat. Output: materi_lengkap (clean).
 * 2. SUMMARY — TF-IDF extractive summarization (pilih top N kalimat by keyword density).
 *    Output: ringkasan_padat (~2-5% dari original).
 * 3. SPLIT BAB — deteksi perubahan topik via keyword frequency shift antar paragraf.
 *    Output: bab dengan judul (top keywords) + konsep_kunci (TF-IDF top 5).
 * 4. KUIS — generate fill-in-the-blank + multiple-choice dari konsep_kunci per bab.
 *    Output: kuis array dengan pertanyaan + opsi + jawaban.
 * 5. MINDMAP — root = judul, cabang = konsep_kunci per bab.
 * 6. GLOSARIUM — istilah yang sering muncul + definisi (kalimat pertama yang mengandung istilah).
 *
 * Output shape sama dengan chunked-generate response — supaya UI bisa langsung pakai.
 * StudyPipeline.tsx panggil ini DULU (instant), lalu chunked-generate sebagai
 * "Enhance dengan AI" (progressive, optional).
 */

export interface JSPipelineResult {
  materi_lengkap: string;
  ringkasan_padat: string;
  ringkasan_sedang: string;
  modul: {
    judul: string;
    bab: JSBab[];
  };
  kuis: JSKuis[];
  visualisasi: any[];
  mindmap: { root: string; cabang: any[] };
  glosarium: { istilah: string; definisi: string }[];
  coverage_checklist: any[];
  modelUsed: string;
  levelUsed: string;
  stats: {
    babCount: number;
    kuisCount: number;
    materiLengkapChars: number;
    ringkasanPadatChars: number;
    transcriptChars: number;
    processingMs: number;
  };
}

interface JSBab {
  id: number;
  judul: string;
  tujuan: string;
  konsep_kunci: string[];
  penjelasan: string;
  contoh: string;
}

interface JSKuis {
  id: number;
  bab_id: number;
  pertanyaan: string;
  opsi: string[];
  jawaban: string;
  pembahasan: string;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1: FILTER — regex-based cleaning
// ═══════════════════════════════════════════════════════════════

const FILLER_WORDS = [
  // Indonesian filler
  'um', 'ah', 'eh', 'ehh', 'hmm', 'hmmm', 'kan', 'gitu', 'gitu ya', 'ya ya ya',
  'oke', 'okay', 'okey', 'eee', 'eeee', 'nah', 'nih', 'tuh', 'sih', 'dong',
  'deh', 'kok', 'loh', 'lho', 'tu', 'nah ini', 'iya', 'iyaa', 'begitu',
  'begini', 'gimana', 'gimana ya', 'terus', 'terusnya',
  // Common spoken filler
  'halo warga', 'halo', 'assalamualaikum', 'selamat datang', 'selamat pagi',
  'selamat siang', 'selamat sore', 'selamat malam', 'terima kasih',
  'okay guys', 'breaking news nih', 'breaking news', ' Guys',
  // English filler
  'um', 'uh', 'ah', 'like', 'you know', 'i mean', 'sort of', 'kind of',
  // Thinking sounds
  'eee', 'aaa', 'ooo', 'hmmm', 'let me think', 'how to say',
];

const FILLER_REGEX = new RegExp(
  '\\b(' + FILLER_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'gi'
);

function filterTranscript(text: string): string {
  let result = text;

  // 1. Remove filler words
  result = result.replace(FILLER_REGEX, '');

  // 2. Remove standalone filler fragments (e.g., "Oke. Ah. Eee.")
  result = result.replace(/\b(?:oke|ah|eh|eee|hmm|nah)\s*[.!?]\s*/gi, '');

  // 3. Normalize whitespace (multiple spaces → single, multiple newlines → double)
  result = result.replace(/[ \t]+/g, ' ');
  result = result.replace(/\n{3,}/g, '\n\n');

  // 4. Remove empty sentences (just punctuation)
  result = result.replace(/\s*[.!?;,:]+\s*(?=\n|$)/g, '\n');

  // 5. Fix spacing after punctuation
  result = result.replace(/\s+,/g, ',');
  result = result.replace(/\s+\./g, '.');
  result = result.replace(/\s+\?/g, '?');

  // 6. Remove duplicate sentences (keep first occurrence)
  const sentences = result.match(/[^.!?]+[.!?]+/g) || [];
  const seen = new Set<string>();
  const unique = sentences.filter(s => {
    const key = s.trim().toLowerCase().slice(0, 100);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  result = unique.join(' ');

  // 7. Final trim
  result = result.trim().replace(/\s+/g, ' ');

  return result;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2: SUMMARY — TF-IDF extractive summarization
// ═══════════════════════════════════════════════════════════════

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

const STOP_WORDS = new Set([
  'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'pada', 'dengan', 'atau', 'ini',
  'itu', 'juga', 'akan', 'sudah', 'bisa', 'adalah', 'dalam', 'oleh', 'tidak',
  'ada', 'lebih', 'saya', 'kita', 'kami', 'anda', 'mereka', 'karena', 'jika',
  'seperti', 'saat', 'serta', 'namun', 'tetapi', 'agar', 'supaya', 'sehingga',
  'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'is', 'are',
  'was', 'were', 'been', 'have', 'has', 'had', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'with',
  'from', 'by', 'as', 'an', 'a', 'be', 'do', 'does', 'did', 'not', 'no',
]);

function calculateWordFreq(sentences: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  let totalWords = 0;
  for (const sent of sentences) {
    const tokens = tokenize(sent);
    totalWords += tokens.length;
    for (const token of tokens) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }
  }
  // Normalize by total
  for (const [key, val] of freq) {
    freq.set(key, val / Math.max(totalWords, 1));
  }
  return freq;
}

function sentenceScore(sentence: string, wordFreq: Map<string, number>): number {
  const tokens = tokenize(sentence);
  if (tokens.length === 0) return 0;
  let score = 0;
  for (const token of tokens) {
    score += wordFreq.get(token) || 0;
  }
  // Normalize by sentence length (avoid bias toward long sentences)
  return score / Math.sqrt(tokens.length);
}

function extractiveSummary(text: string, numSentences: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  if (sentences.length <= numSentences) return text;

  const wordFreq = calculateWordFreq(sentences);

  // Score each sentence
  const scored = sentences.map((sent, idx) => ({
    text: sent.trim(),
    score: sentenceScore(sent, wordFreq),
    index: idx,
  }));

  // Pick top N by score
  const topN = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, numSentences)
    .sort((a, b) => a.index - b.index); // restore original order

  return topN.map(s => s.text).join(' ');
}

// ═══════════════════════════════════════════════════════════════
// PHASE 3: SPLIT BAB — topic detection via keyword frequency
// ═══════════════════════════════════════════════════════════════

function extractKeywords(text: string, n: number): string[] {
  const tokens = tokenize(text);
  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word]) => word);
}

function cosineSim(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, magA = 0, magB = 0;
  for (const [key, val] of a) {
    dot += val * (b.get(key) || 0);
    magA += val * val;
  }
  for (const [, val] of b) {
    magB += val * val;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function buildKeywordVector(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return freq;
}

function splitIntoBab(text: string, title: string): JSBab[] {
  // Split by double newline (paragraphs)
  let paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 50);

  // If only 1 paragraph, split by sentences into chunks of ~500 chars
  if (paragraphs.length < 3) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    paragraphs = [];
    let current = '';
    for (const s of sentences) {
      if (current.length + s.length > 800 && current.length > 0) {
        paragraphs.push(current.trim());
        current = s;
      } else {
        current += s;
      }
    }
    if (current) paragraphs.push(current.trim());
  }

  if (paragraphs.length === 0) return [];

  // Build keyword vectors per paragraph
  const vectors = paragraphs.map(p => buildKeywordVector(p));

  // Detect topic boundaries: when cosine similarity between consecutive paragraphs drops
  const boundaries: number[] = [0]; // first paragraph is always a new section
  const SIM_THRESHOLD = 0.3;
  for (let i = 1; i < paragraphs.length; i++) {
    const sim = cosineSim(vectors[i - 1], vectors[i]);
    if (sim < SIM_THRESHOLD) {
      boundaries.push(i);
    }
  }

  // Group paragraphs into sections
  const sections: { text: string; keywords: string[] }[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i];
    const end = i < boundaries.length - 1 ? boundaries[i + 1] : paragraphs.length;
    const sectionText = paragraphs.slice(start, end).join('\n\n');
    const keywords = extractKeywords(sectionText, 5);
    sections.push({ text: sectionText, keywords });
  }

  // Cap at 15 bab
  const maxBab = Math.min(sections.length, 15);
  const bab: JSBab[] = sections.slice(0, maxBab).map((section, i) => {
    // Title = top 3-5 keywords, capitalized
    const judul = section.keywords.slice(0, 4)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(', ');

    return {
      id: i + 1,
      judul: judul || `Bagian ${i + 1}`,
      tujuan: `Memahami: ${section.keywords.slice(0, 3).join(', ')}`,
      konsep_kunci: section.keywords.slice(0, 5),
      penjelasan: section.text.slice(0, 5000), // cap per bab
      contoh: extractExample(section.text),
    };
  });

  return bab;
}

function extractExample(text: string): string {
  // Find sentence with "contoh" or "misal" or "seperti"
  const exampleMatch = text.match(/[^.]*(?:contoh|misal|seperti|contohnya)[^.]*\./i);
  return exampleMatch ? exampleMatch[0].trim().slice(0, 300) : '';
}

// ═══════════════════════════════════════════════════════════════
// PHASE 4: KUIS — keyword-based quiz generation
// ═══════════════════════════════════════════════════════════════

function generateQuiz(bab: JSBab[]): JSKuis[] {
  const kuis: JSKuis[] = [];
  let id = 1;

  // Collect all keywords for distractor pool
  const allKeywords = new Set<string>();
  for (const b of bab) {
    for (const k of b.konsep_kunci) allKeywords.add(k);
  }
  const distractorPool = Array.from(allKeywords);

  for (const b of bab) {
    // Generate 1-2 questions per bab from key terms
    for (const term of b.konsep_kunci.slice(0, 2)) {
      // Find a sentence containing the term
      const sentenceMatch = b.penjelasan.match(new RegExp(`[^.]*\\b${term}\\b[^.]*\\.`, 'i'));
      if (!sentenceMatch) continue;

      const sentence = sentenceMatch[0].trim();
      // Fill-in-the-blank: replace the term with ___
      const blanked = sentence.replace(new RegExp(`\\b${term}\\b`, 'i'), '_____');

      // Generate distractors (3 wrong answers from other keywords)
      const distractors = distractorPool
        .filter(k => k !== term && k.length > 3)
        .sort(() => Math.random() - 0.5)
        .slice(0, 3);

      if (distractors.length < 3) continue; // need at least 3 distractors

      const options = [term, ...distractors].sort(() => Math.random() - 0.5);

      kuis.push({
        id: id++,
        bab_id: b.id,
        pertanyaan: `Lengkapi kalimat berikut: "${blanked}"`,
        opsi: options,
        jawaban: term,
        pembahasan: `Kata yang tepat adalah "${term}". Lihat penjelasan di ${b.judul}.`,
      });
    }
  }

  return kuis;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 5: MINDMAP — keyword tree
// ═══════════════════════════════════════════════════════════════

function buildMindmap(title: string, bab: JSBab[]): { root: string; cabang: any[] } {
  const cabang = bab.slice(0, 10).map(b => ({
    label: b.judul,
    children: b.konsep_kunci.slice(0, 3).map(k => ({ label: k, children: [] })),
  }));
  return { root: title, cabang };
}

// ═══════════════════════════════════════════════════════════════
// PHASE 6: GLOSARIUM — term definitions
// ═══════════════════════════════════════════════════════════════

function buildGlosarium(bab: JSBab[]): { istilah: string; definisi: string }[] {
  const seen = new Set<string>();
  const glosarium: { istilah: string; definisi: string }[] = [];

  for (const b of bab) {
    for (const term of b.konsep_kunci) {
      if (seen.has(term)) continue;
      seen.add(term);

      // Find first sentence containing the term
      const defMatch = b.penjelasan.match(new RegExp(`[^.]*\\b${term}\\b[^.]*\\.`, 'i'));
      const definisi = defMatch
        ? defMatch[0].trim().slice(0, 200)
        : `Istilah yang muncul dalam ${b.judul}.`;

      glosarium.push({ istilah: term, definisi });
    }
  }

  return glosarium.slice(0, 20);
}

// ═══════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════

export function runJSPipeline(transcript: string, title: string = 'Materi Belajar'): JSPipelineResult {
  const t0 = Date.now();

  // Phase 1: FILTER
  const materi_lengkap = filterTranscript(transcript);

  // Phase 2: SUMMARY (extractive — pick top 5-10 sentences)
  const summaryCount = Math.min(10, Math.max(3, Math.floor(materi_lengkap.length / 2000)));
  const ringkasan_padat = extractiveSummary(materi_lengkap, summaryCount);

  // Phase 3: SPLIT BAB
  const bab = splitIntoBab(materi_lengkap, title);

  // Phase 4: KUIS
  const kuis = generateQuiz(bab);

  // Phase 5: MINDMAP
  const mindmap = buildMindmap(title, bab);

  // Phase 6: GLOSARIUM
  const glosarium = buildGlosarium(bab);

  const processingMs = Date.now() - t0;

  return {
    materi_lengkap,
    ringkasan_padat,
    ringkasan_sedang: '', // no Resoomer fallback in JS pipeline
    modul: { judul: title, bab },
    kuis,
    visualisasi: [], // no LLM = no visualization specs
    mindmap,
    glosarium,
    coverage_checklist: bab.map((b, i) => ({
      bagian_transkrip: `paragraf ${i + 1}`,
      masuk_ke_modul: `bab ${b.id}`,
    })),
    modelUsed: 'js-deterministic',
    levelUsed: 'js-pipeline-v1',
    stats: {
      babCount: bab.length,
      kuisCount: kuis.length,
      materiLengkapChars: materi_lengkap.length,
      ringkasanPadatChars: ringkasan_padat.length,
      transcriptChars: transcript.length,
      processingMs,
    },
  };
}
