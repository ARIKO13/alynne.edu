/**
 * rag.ts — Retrieval-Augmented Generation for AI Assistant
 *
 * Simple client-side RAG:
 *   1. Index documents (STT transcript, uploaded materials) into chunks
 *   2. When user asks question, find most relevant chunks (keyword + TF-IDF)
 *   3. Return context string to include in AI prompt
 *
 * 100% client-side, no vector database needed.
 */

export interface DocumentChunk {
  id: string;
  source: string; // 'stt' | 'material' | 'chat-history'
  content: string;
  wordCount: number;
  keywords: Set<string>;
}

// ── Text processing ──

const STOP_WORDS = new Set([
  // Indonesian
  'yang', 'dan', 'atau', 'tidak', 'untuk', 'dengan', 'dari', 'ke', 'di',
  'ini', 'itu', 'ada', 'sudah', 'akan', 'bisa', 'harus', 'lebih',
  'saya', 'kamu', 'dia', 'kami', 'kita', 'mereka', 'apa', 'siapa',
  'karena', 'kalau', 'jika', 'tetapi', 'tapi', 'namun', 'juga', 'saja',
  'pada', 'dalam', 'adalah', 'ialah', 'yaitu', 'seperti', 'sehingga',
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
  'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'why',
  'how', 'what', 'who', 'whom', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her',
  'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their',
]);

/**
 * Tokenize text into keywords (lowercase, remove stopwords, remove punctuation).
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Split text into chunks of ~200 words with overlap.
 */
function chunkText(text: string, source: string, chunkSize: number = 200): DocumentChunk[] {
  const words = text.split(/\s+/);
  const chunks: DocumentChunk[] = [];

  for (let i = 0; i < words.length; i += chunkSize - 50) {
    const chunkWords = words.slice(i, i + chunkSize);
    const content = chunkWords.join(' ');
    if (content.trim().length < 20) continue;

    const keywords = new Set(tokenize(content));
    chunks.push({
      id: `${source}-${i}`,
      source,
      content,
      wordCount: chunkWords.length,
      keywords,
    });
  }

  return chunks;
}

// ── RAG Index ──

class RAGIndex {
  private chunks: DocumentChunk[] = [];
  private documentFreq: Map<string, number> = new Map(); // word -> doc count

  /**
   * Index a document (replace existing with same source).
   */
  index(source: string, text: string): void {
    // Remove existing chunks from this source
    this.chunks = this.chunks.filter((c) => c.source !== source);

    // Split into chunks
    const newChunks = chunkText(text, source);
    this.chunks.push(...newChunks);

    // Rebuild document frequency
    this.rebuildDF();
  }

  /**
   * Clear all indexed documents.
   */
  clear(): void {
    this.chunks = [];
    this.documentFreq.clear();
  }

  /**
   * Search for relevant chunks given a query.
   * Uses TF-IDF-like scoring with keyword overlap.
   */
  search(query: string, topK: number = 3): DocumentChunk[] {
    if (this.chunks.length === 0) return [];

    const queryKeywords = tokenize(query);
    if (queryKeywords.length === 0) return [];

    const scores = this.chunks.map((chunk) => {
      let score = 0;
      const totalDocs = this.chunks.length;

      for (const kw of queryKeywords) {
        if (chunk.keywords.has(kw)) {
          // TF-IDF-like: term frequency in chunk * inverse doc frequency
          const df = this.documentFreq.get(kw) || 1;
          const idf = Math.log(totalDocs / df);
          score += idf;
        }
      }

      // Bonus for exact phrase match
      const queryLower = query.toLowerCase();
      if (chunk.content.toLowerCase().includes(queryLower.substring(0, 30))) {
        score += 2;
      }

      return { chunk, score };
    });

    // Sort by score, return top K
    return scores
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => s.chunk);
  }

  /**
   * Get context string for AI prompt.
   * Returns formatted string with relevant chunks.
   */
  getContext(query: string, maxChars: number = 2000): string {
    const results = this.search(query, 5);
    if (results.length === 0) return '';

    let context = '';
    for (const r of results) {
      const entry = `[${r.source.toUpperCase()}] ${r.content}\n\n`;
      if (context.length + entry.length > maxChars) break;
      context += entry;
    }

    return context.trim();
  }

  /**
   * Get stats about indexed documents.
   */
  getStats(): { totalChunks: number; sources: string[]; totalWords: number } {
    const sources = new Set(this.chunks.map((c) => c.source));
    const totalWords = this.chunks.reduce((s, c) => s + c.wordCount, 0);
    return {
      totalChunks: this.chunks.length,
      sources: Array.from(sources),
      totalWords,
    };
  }

  private rebuildDF(): void {
    this.documentFreq.clear();
    for (const chunk of this.chunks) {
      for (const kw of chunk.keywords) {
        this.documentFreq.set(kw, (this.documentFreq.get(kw) || 0) + 1);
      }
    }
  }
}

// Singleton instance
export const ragIndex = new RAGIndex();

/**
 * Index STT transcript for RAG.
 */
export function indexTranscript(transcript: string): void {
  if (transcript && transcript.trim().length > 20) {
    ragIndex.index('stt', transcript);
    console.log('[RAG] Indexed STT transcript:', transcript.length, 'chars');
  }
}

/**
 * Index uploaded material text for RAG.
 */
export function indexMaterial(name: string, text: string): void {
  if (text && text.trim().length > 20) {
    ragIndex.index(`material:${name}`, text);
    console.log('[RAG] Indexed material:', name, text.length, 'chars');
  }
}

/**
 * Get RAG context for AI prompt.
 */
export function getRAGContext(query: string): string {
  return ragIndex.getContext(query);
}
