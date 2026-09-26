/**
 * stt-chapter-splitter.ts — Split STT transcript into chapters/bab
 *
 * Splits long transcript into smaller chunks based on:
 * 1. Sentence boundaries (split on . ! ?)
 * 2. Topic keywords (Bab, Pertama, Kedua, Selanjutnya, etc.)
 * 3. Max chunk size (~500 chars per chapter)
 *
 * All processing client-side, no server needed.
 */

export interface Chapter {
  id: number;
  title: string;
  content: string;
  startTime?: string;
  wordCount: number;
}

/** Topic transition keywords in Indonesian */
const TOPIC_KEYWORDS = [
  /^(bab|chapter)\s+\d+/i,
  /^(pertama|kedua|ketiga|keempat|kelima|keenam|ketujuh|kedelapan|kesembilan|kesepuluh)/i,
  /^(selanjutnya|kemudian|setelah itu|lalu|berikutnya)/i,
  /^(jadi|oleh karena itu|karena itu|makanya)/i,
  /^(sekarang|tadi|tadi itu)/i,
  /^(kesimpulan|ringkasan|intinya|singkatnya)/i,
];

/**
 * Split transcript into chapters.
 * @param transcript Full STT text
 * @param maxCharsPerChapter Max chars per chapter (default 800, ~150 words)
 * @returns Array of Chapter objects
 */
export function splitTranscriptIntoChapters(
  transcript: string,
  maxCharsPerChapter: number = 800
): Chapter[] {
  if (!transcript || transcript.trim().length === 0) {
    return [];
  }

  // Step 1: Normalize whitespace
  const text = transcript.replace(/\s+/g, ' ').trim();

  // Step 2: Split into sentences
  const sentences = splitIntoSentences(text);

  // Step 3: Group sentences into chapters
  const chapters: Chapter[] = [];
  let currentChapter: string[] = [];
  let currentLength = 0;
  let chapterId = 1;

  for (const sentence of sentences) {
    const sentenceLength = sentence.length;

    // Check if this sentence starts a new topic
    const startsNewTopic = TOPIC_KEYWORDS.some((kw) => kw.test(sentence.trim()));

    // Decide if we should start a new chapter
    const isTooLong = currentLength + sentenceLength > maxCharsPerChapter;
    const shouldSplit = (startsNewTopic && currentLength > 200) || isTooLong;

    if (shouldSplit && currentChapter.length > 0) {
      // Finalize current chapter
      chapters.push(createChapter(chapterId, currentChapter.join(' ')));
      chapterId++;
      currentChapter = [];
      currentLength = 0;
    }

    currentChapter.push(sentence);
    currentLength += sentenceLength;
  }

  // Add remaining as last chapter
  if (currentChapter.length > 0) {
    chapters.push(createChapter(chapterId, currentChapter.join(' ')));
  }

  return chapters;
}

/**
 * Split text into sentences (Indonesian-aware).
 */
function splitIntoSentences(text: string): string[] {
  // Split on . ! ? followed by space or end
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Create a Chapter object with auto-generated title from first 50 chars.
 */
function createChapter(id: number, content: string): Chapter {
  const trimmed = content.trim();
  // Title: first 5-7 words or 50 chars
  const words = trimmed.split(/\s+/).slice(0, 7).join(' ');
  const title = (words.length > 50 ? words.slice(0, 50) : words) + '...';

  return {
    id,
    title,
    content: trimmed,
    wordCount: trimmed.split(/\s+/).length,
  };
}

/**
 * Generate quiz questions from a chapter.
 * Returns array of { question, options, correctAnswer, explanation }.
 *
 * Quiz type: Fill-in-the-blank (remove a key word from sentence).
 * This is simple, deterministic, and works offline.
 */
export interface QuizQuestion {
  id: number;
  type: 'fill-blank' | 'multiple-choice';
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation?: string;
}

export function generateQuizFromChapter(chapter: Chapter, numQuestions: number = 3): QuizQuestion[] {
  const questions: QuizQuestion[] = [];
  const sentences = splitIntoSentences(chapter.content);

  // Pick sentences with >= 8 words (more likely to have meaningful keywords)
  const goodSentences = sentences.filter((s) => s.split(/\s+/).length >= 8);

  const usedSentences = new Set<number>();
  let qId = 1;

  for (let i = 0; i < numQuestions && i < goodSentences.length; i++) {
    // Pick random sentence
    let idx = Math.floor(Math.random() * goodSentences.length);
    while (usedSentences.has(idx) && usedSentences.size < goodSentences.length) {
      idx = Math.floor(Math.random() * goodSentences.length);
    }
    usedSentences.add(idx);

    const sentence = goodSentences[idx];
    const words = sentence.split(/\s+/);

    // Find a key word (5+ chars, not stopword) to blank out
    const stopWords = new Set([
      'yang', 'dan', 'atau', 'tidak', 'untuk', 'dengan', 'dari', 'ke', 'di',
      'ini', 'itu', 'ada', 'sudah', 'akan', 'bisa', 'harus', 'lebih',
      'saya', 'kamu', 'dia', 'kami', 'kita', 'mereka', 'pada', 'dalam',
      'adalah', 'ialah', 'yaitu', 'seperti', 'sehingga', 'karena',
      'tetapi', 'tapi', 'namun', 'juga', 'saja', 'secara', 'serta',
    ]);

    const keyWordIdx = words.findIndex(
      (w, i) =>
        w.length >= 5 &&
        !stopWords.has(w.toLowerCase()) &&
        !/^\d+$/.test(w) &&
        i > 1 &&
        i < words.length - 1
    );

    if (keyWordIdx === -1) continue;

    const correctWord = words[keyWordIdx].replace(/[.,!?;:]/g, '');
    if (!correctWord || correctWord.length < 4) continue;

    // Create fill-in-blank question
    words[keyWordIdx] = '_____';
    const question = words.join(' ');

    // Generate fake options (distractors) from other chapters
    // For simplicity, just use other words from the same text
    const allWords = chapter.content
      .split(/\s+/)
      .map((w) => w.replace(/[.,!?;:]/g, ''))
      .filter((w) => w.length >= 5 && !stopWords.has(w.toLowerCase()) && w !== correctWord);

    const distractors = shuffle(allWords).slice(0, 3);
    const options = shuffle([correctWord, ...distractors]);

    questions.push({
      id: qId++,
      type: 'multiple-choice',
      question: `Lengkapi: "${question}"`,
      options,
      correctAnswer: correctWord,
      explanation: `Kata yang tepat adalah "${correctWord}".`,
    });
  }

  return questions;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Generate a simple text-based mindmap structure from chapters.
 * Returns nested object for rendering.
 */
export interface MindMapNode {
  label: string;
  children?: MindMapNode[];
}

export function generateMindMapFromChapters(chapters: Chapter[]): MindMapNode {
  if (chapters.length === 0) {
    return { label: 'Materi', children: [] };
  }

  // Extract title from transcript (first chapter's first sentence, trimmed)
  const rootTitle = chapters[0].title.split(' ').slice(0, 4).join(' ');

  return {
    label: rootTitle || 'Materi STT',
    children: chapters.map((c) => ({
      label: `Bab ${c.id}: ${c.title}`,
      children: [
        { label: `${c.wordCount} kata` },
        { label: `Kuis ${generateQuizFromChapter(c, 1).length} soal` },
      ],
    })),
  };
}
