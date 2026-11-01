/**
 * Visualisasi Auto-Select Decision Tree (P1-A)
 *
 * Frontend module: determines chart type based on bab content keywords.
 * Used by StudyPipeline.tsx VisualisasiPanel.
 *
 * Decision tree priority (top-down):
 *   1. RUMUS (LaTeX) → if content contains math equations
 *   2. PROSES (Flowchart) → if "langkah", "proses", "urutan", "alur", "step"
 *   3. HIERARKI (Mindmap) → if "kategori", "jenis", "klasifikasi", "hierarki"
 *   4. BANDING (Tabel/Bar) → if "versus", "perbandingan", "beda", "perbedaan"
 *   5. DATA (Line chart) → if "tren", "perubahan", "grafik", "statistik"
 *   6. SIKLUS (Circular) → if "siklus", "daur", "berulang", "rotasi"
 *   7. RELASI (Network) → if "hubungan", "relasi", "interaksi", "jaringan"
 *   8. DEFAULT → Mindmap (safe default)
 */

export type ChartType =
  | 'flowchart'
  | 'tabel'
  | 'bar_chart'
  | 'line_chart'
  | 'mindmap'
  | 'latex'
  | 'circular'
  | 'network';

export interface VisualisasiDecision {
  type: ChartType;
  reason: string;
  renderHint: string;
  emoji: string;
}

interface Keyword {
  type: ChartType;
  keywords: string[];
  renderHint: string;
  emoji: string;
}

const KEYWORD_MAP: Keyword[] = [
  {
    type: 'latex',
    keywords: ['persamaan', 'rumus', 'equation', '=', 'integral', 'diferensial', 'aljabar', 'matematika'],
    renderHint: 'katex',
    emoji: '📐',
  },
  {
    type: 'flowchart',
    keywords: ['langkah', 'proses', 'urutan', 'alur', 'step', ' tahap ', 'fase', 'prosedur', 'metode'],
    renderHint: 'mermaid_flowchart',
    emoji: '🔀',
  },
  {
    type: 'mindmap',
    keywords: ['kategori', 'jenis', 'klasifikasi', 'hierarki', 'macam', 'tipe', 'kelompok'],
    renderHint: 'mermaid_mindmap',
    emoji: '🧠',
  },
  {
    type: 'tabel',
    keywords: ['versus', 'perbandingan', 'beda', 'perbedaan', 'dibanding', 'kontras', ' vs '],
    renderHint: 'html_table',
    emoji: '📊',
  },
  {
    type: 'bar_chart',
    keywords: ['jumlah', 'total', 'persentase', 'statistik', 'data', 'grafik batang'],
    renderHint: 'chartjs_bar',
    emoji: '📈',
  },
  {
    type: 'line_chart',
    keywords: ['tren', 'perubahan', 'waktu', 'periodik', 'historis', 'perkembangan'],
    renderHint: 'chartjs_line',
    emoji: '📉',
  },
  {
    type: 'circular',
    keywords: ['siklus', 'daur', 'berulang', 'rotasi', 'lingkaran', 'siklus hidup'],
    renderHint: 'svg_circular',
    emoji: '🔄',
  },
  {
    type: 'network',
    keywords: ['hubungan', 'relasi', 'interaksi', 'jaringan', 'koneksi', 'sistem'],
    renderHint: 'svg_network',
    emoji: '🕸️',
  },
];

const DEFAULT_DECISION: VisualisasiDecision = {
  type: 'mindmap',
  reason: 'No specific keywords detected, defaulting to mindmap (safe visualization)',
  renderHint: 'mermaid_mindmap',
  emoji: '🧠',
};

/**
 * Decide chart type based on bab content (penjelasan + konsep_kunci + judul).
 */
export function decideChart(
  judul: string,
  konsepKunci: string[],
  penjelasan: string,
): VisualisasiDecision {
  const fullText = `${judul} ${konsepKunci.join(' ')} ${penjelasan}`.toLowerCase();

  for (const kw of KEYWORD_MAP) {
    for (const keyword of kw.keywords) {
      if (fullText.includes(keyword.toLowerCase())) {
        return {
          type: kw.type,
          reason: `Detected keyword "${keyword}" → ${kw.type}`,
          renderHint: kw.renderHint,
          emoji: kw.emoji,
        };
      }
    }
  }

  return DEFAULT_DECISION;
}

/**
 * Get emoji per bab topic based on subject keywords.
 */
export function getBabEmoji(judul: string, konsepKunci: string[]): string {
  const text = `${judul} ${konsepKunci.join(' ')}`.toLowerCase();

  const emojiMap: { keywords: string[]; emoji: string }[] = [
    { keywords: ['matematika', 'aljabar', 'geometri', 'kalkulus', 'statistik'], emoji: '📐' },
    { keywords: ['fisika', 'mekanika', 'gelombang', 'listrik', 'magnet', 'energi'], emoji: '⚛️' },
    { keywords: ['kimia', 'reaksi', 'molekul', 'atom', 'senyawa', 'asam', 'basa'], emoji: '🧪' },
    { keywords: ['biologi', 'sel', 'organisme', 'genetika', 'ekosistem', 'tanaman', 'hewan'], emoji: '🧬' },
    { keywords: ['sejarah', 'perang', 'kerajaan', 'revolusi', 'kemerdekaan'], emoji: '📜' },
    { keywords: ['geografi', 'iklim', 'bumi', 'lingkungan', 'pegunungan', 'laut'], emoji: '🌍' },
    { keywords: ['ekonomi', 'pasar', 'uang', 'inflasi', 'perdagangan'], emoji: '💰' },
    { keywords: ['hukum', 'peraturan', 'konstitusi', 'undang-undang'], emoji: '⚖️' },
    { keywords: ['sastra', 'puisi', 'novel', 'prosa', 'cerpen'], emoji: '📚' },
    { keywords: ['bahasa', 'tata bahasa', 'kalimat', 'morfolgi', 'sintaksis'], emoji: '✍️' },
    { keywords: ['seni', 'musik', 'lukis', 'teater', 'tari'], emoji: '🎨' },
    { keywords: ['olahraga', 'sepak bola', 'basket', 'voli', 'atletik'], emoji: '⚽' },
    { keywords: ['programming', 'kode', 'algoritma', 'software', 'database'], emoji: '💻' },
    { keywords: ['psikologi', 'mental', 'emosi', 'kognitif'], emoji: '🧠' },
    { keywords: ['kedokteran', 'penyakit', 'obat', 'anatomi', 'fisiologi'], emoji: '⚕️' },
  ];

  for (const { keywords, emoji } of emojiMap) {
    if (keywords.some(k => text.includes(k))) return emoji;
  }

  return '📖'; // default book emoji
}

/**
 * Build callout component data from bab enrichment fields.
 * Maps enrichment fields to 3 callout types:
 *   💡 Insight → from analogy + realWorldExample
 *   ⚠️ Misconception → from commonMistake
 *   📌 Key Takeaway → from examTip + mnemonic
 */
export interface Callout {
  type: 'insight' | 'misconception' | 'takeaway';
  icon: string;
  title: string;
  content: string;
  color: string;
}

export function buildCallouts(bab: {
  analogy?: string;
  realWorldExample?: string;
  commonMistake?: string;
  examTip?: string;
  mnemonic?: string;
}): Callout[] {
  const callouts: Callout[] = [];

  // 💡 Insight (analogy + realWorldExample combined)
  const insightContent = [bab.analogy, bab.realWorldExample]
    .filter(s => s && s.length > 20 && !s.startsWith('Tidak ada'))
    .join(' ');
  if (insightContent.length > 20) {
    callouts.push({
      type: 'insight',
      icon: '💡',
      title: 'Insight',
      content: insightContent.slice(0, 300),
      color: '#F59E0B', // amber-500
    });
  }

  // ⚠️ Misconception (commonMistake)
  if (bab.commonMistake && bab.commonMistake.length > 20 && !bab.commonMistake.startsWith('Tidak ada')) {
    callouts.push({
      type: 'misconception',
      icon: '⚠️',
      title: 'Misconception',
      content: bab.commonMistake.slice(0, 300),
      color: '#EF4444', // red-500
    });
  }

  // 📌 Key Takeaway (examTip + mnemonic combined)
  const takeawayContent = [bab.examTip, bab.mnemonic]
    .filter(s => s && s.length > 10 && !s.startsWith('Tidak ada') && !s.startsWith('Pahami'))
    .join(' ');
  if (takeawayContent.length > 20) {
    callouts.push({
      type: 'takeaway',
      icon: '📌',
      title: 'Key Takeaway',
      content: takeawayContent.slice(0, 300),
      color: '#6366F1', // indigo-500 (primary)
    });
  }

  return callouts;
}

/**
 * Consistent color palette for all visualizations.
 */
export const VIZ_PALETTE = {
  primary: '#6366F1',      // indigo-500
  secondary: '#F59E0B',    // amber-500
  neutral: '#64748B',      // slate-500
  success: '#10B981',      // emerald-500
  warning: '#F59E0B',      // amber-500
  danger: '#EF4444',       // red-500
  background: '#F8FAFC',   // slate-50
  textMuted: '#64748B',    // slate-500
};

/**
 * CSS classes for consistent margin/caption styling.
 */
export const VIZ_CSS = {
  margin: '16px',
  captionSize: '12px',
  captionColor: '#64748B',
  titleSize: '14px',
  titleWeight: 600,
};
