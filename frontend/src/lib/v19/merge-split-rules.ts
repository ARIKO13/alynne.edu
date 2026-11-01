/**
 * Merge/Split Rules — Post-processing for generated bab list
 *
 * v19 new feature. Runs AFTER Phase 2 generates bab array, BEFORE final response.
 *
 * Rules:
 *   - MERGE: if bab token count < 300, merge with adjacent bab (preserve order)
 *   - SPLIT: if bab token count > 5000, split into 2 bab at sentence boundary
 *   - OVERLAP CHECK: if 2 adjacent bab have >60% Jaccard similarity on key terms, merge them
 *
 * Also: adaptive quiz count per bab based on final token count.
 */
import { quizCountPerBab } from './phase0-extract';

export interface Bab {
  id: number;
  judul: string;
  tujuan: string;
  konsep_kunci: string[];
  penjelasan: string;
  contoh: string;
  // Enrichment fields (v19)
  analogy?: string;
  whyItMatters?: string;
  commonMistake?: string;
  eli5?: string;
  connectTo?: string;
  examTip?: string;
  mnemonic?: string;
  realWorldExample?: string;
}

const TOKEN_MERGE_THRESHOLD = 300;
const TOKEN_SPLIT_THRESHOLD = 5000;
const OVERLAP_SIMILARITY_THRESHOLD = 0.60;

/**
 * Estimate token count for a bab (rough: chars / 4).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Get total bab text for token estimation.
 */
function babTotalText(bab: Bab): string {
  return [
    bab.judul,
    bab.tujuan,
    bab.konsep_kunci.join(' '),
    bab.penjelasan,
    bab.contoh,
    bab.analogy || '',
    bab.whyItMatters || '',
    bab.commonMistake || '',
    bab.eli5 || '',
    bab.connectTo || '',
    bab.examTip || '',
    bab.mnemonic || '',
    bab.realWorldExample || '',
  ].join(' ');
}

/**
 * Jaccard similarity between 2 string sets.
 * Used for overlap detection.
 */
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const x of setA) {
    if (setB.has(x)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/**
 * Split a long bab at sentence boundary.
 * Returns 2 bab objects (id bumped for second one).
 */
function splitBab(bab: Bab, idOffset: number): [Bab, Bab] {
  const sentences = bab.penjelasan.match(/[^.!?]+[.!?]+/g) || [bab.penjelasan];
  const midpoint = Math.floor(sentences.length / 2);

  const part1Text = sentences.slice(0, midpoint).join(' ').trim();
  const part2Text = sentences.slice(midpoint).join(' ').trim();

  const bab1: Bab = {
    ...bab,
    judul: `${bab.judul} — Bagian 1`,
    penjelasan: part1Text,
  };

  const bab2: Bab = {
    ...bab,
    id: bab.id + idOffset,
    judul: `${bab.judul} — Bagian 2`,
    penjelasan: part2Text,
  };

  return [bab1, bab2];
}

/**
 * Merge 2 bab into 1.
 * Combines penjelasan, konsep_kunci, keeps lower id.
 */
function mergeBab(a: Bab, b: Bab): Bab {
  return {
    ...a,
    judul: `${a.judul} + ${b.judul}`.slice(0, 100),
    tujuan: `${a.tujuan} ${b.tujuan}`.trim(),
    konsep_kunci: Array.from(new Set([...a.konsep_kunci, ...b.konsep_kunci])),
    penjelasan: `${a.penjelasan}\n\n${b.penjelasan}`.trim(),
    contoh: `${a.contoh} ${b.contoh}`.trim(),
    analogy: a.analogy || b.analogy,
    whyItMatters: a.whyItMatters || b.whyItMatters,
    commonMistake: a.commonMistake || b.commonMistake,
    eli5: a.eli5 || b.eli5,
    connectTo: a.connectTo || b.connectTo,
    examTip: a.examTip || b.examTip,
    mnemonic: a.mnemonic || b.mnemonic,
    realWorldExample: a.realWorldExample || b.realWorldExample,
  };
}

/**
 * Apply merge/split rules to a bab array.
 * Re-numbers ids 1..N at the end.
 *
 * Pass 1: SPLIT — any bab > 5000 tokens → split into 2
 * Pass 2: MERGE — any bab < 300 tokens → merge with next
 * Pass 3: OVERLAP CHECK — adjacent bab with >60% similarity → merge
 * Pass 4: RENUMBER — sequential ids 1..N
 */
export function applyMergeSplitRules(babList: Bab[]): Bab[] {
  let result = [...babList];

  // Pass 1: SPLIT
  const afterSplit: Bab[] = [];
  for (const bab of result) {
    const tokens = estimateTokens(babTotalText(bab));
    if (tokens > TOKEN_SPLIT_THRESHOLD) {
      console.log(`[merge-split] SPLIT bab ${bab.id} (${tokens} tokens > ${TOKEN_SPLIT_THRESHOLD})`);
      const [part1, part2] = splitBab(bab, 1000); // temp offset, renumbered later
      afterSplit.push(part1, part2);
    } else {
      afterSplit.push(bab);
    }
  }
  result = afterSplit;

  // Pass 2: MERGE (small bab with next)
  const afterMerge: Bab[] = [];
  let i = 0;
  while (i < result.length) {
    let current = result[i];
    let j = i + 1;
    while (j < result.length) {
      const currentTokens = estimateTokens(babTotalText(current));
      if (currentTokens < TOKEN_MERGE_THRESHOLD) {
        console.log(`[merge-split] MERGE bab ${current.id} (small, ${currentTokens} tokens) with bab ${result[j].id}`);
        current = mergeBab(current, result[j]);
        j++;
      } else {
        break;
      }
    }
    afterMerge.push(current);
    i = j;
  }
  result = afterMerge;

  // Pass 3: OVERLAP CHECK (adjacent similarity)
  const afterOverlap: Bab[] = [];
  for (let k = 0; k < result.length; k++) {
    const current = result[k];
    if (afterOverlap.length === 0) {
      afterOverlap.push(current);
      continue;
    }
    const prev = afterOverlap[afterOverlap.length - 1];
    const sim = jaccardSimilarity(
      babTotalText(prev),
      babTotalText(current),
    );
    if (sim > OVERLAP_SIMILARITY_THRESHOLD) {
      console.log(`[merge-split] OVERLAP bab ${prev.id} & ${current.id} (${(sim * 100).toFixed(0)}% similarity > ${OVERLAP_SIMILARITY_THRESHOLD * 100}%) → merge`);
      afterOverlap[afterOverlap.length - 1] = mergeBab(prev, current);
    } else {
      afterOverlap.push(current);
    }
  }
  result = afterOverlap;

  // Pass 4: RENUMBER
  result = result.map((bab, idx) => ({ ...bab, id: idx + 1 }));

  console.log(`[merge-split] final: ${babList.length} → ${result.length} bab`);
  return result;
}

/**
 * Compute adaptive quiz count per bab based on final token count.
 * Returns Map<babId, quizCount>.
 */
export function computeAdaptiveQuizCounts(babList: Bab[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const bab of babList) {
    const tokens = estimateTokens(babTotalText(bab));
    const count = quizCountPerBab(tokens);
    counts.set(bab.id, count);
    console.log(`[merge-split] bab ${bab.id} quiz budget: ${count} (${tokens} tokens)`);
  }
  return counts;
}
