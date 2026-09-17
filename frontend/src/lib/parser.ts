/**
 * Rule-based parser: markdown-like text → ModulOutput
 *
 * Formatting rules:
 *   # Text              → main title
 *   ## Text             → section heading (new kegiatanPembelajaran)
 *   ### Text            → sub-heading (appended to current kegiatan materi)
 *   - item              → list item (tujuanPembelajaran or materi)
 *   | h1 | h2 |         → table header
 *   > text              → blockquote (pendahuluan / stimulus / rangkuman context)
 *   ---                 → separator (ignored)
 *   plain text          → paragraph → materi
 */

import type { ModulOutput } from './manual-schema';

// ── Heuristic entity extraction ──

// Common Indonesian stop words to exclude from entity detection
const STOP_WORDS = new Set([
  'yang', 'dengan', 'untuk', 'dari', 'dalam', 'pada', 'adalah', 'mereka', 'kita',
  'tidak', 'akan', 'bisa', 'sudah', 'sebagai', 'oleh', 'juga', 'satu', 'setelah',
  'sebelum', 'ketika', 'karena', 'seperti', 'telah', 'masih', 'hanya', 'lebih',
  'atau', 'dan', 'ini', 'itu', 'di', 'ke', 'secara', 'tersebut', 'dapat', 'maka',
  'agar', 'supaya', 'yaitu', 'ialah', 'baik', 'serta', 'maupun', 'sedangkan',
  'selain', 'antara', 'melalui', 'tentang', 'suatu', 'setiap', 'saja', 'pun',
  'buat', 'sampe', 'pas', 'abis', 'nanti', 'kemarin', 'tadi', 'hari', 'waktu',
  'orang', 'bikin', 'nya', 'si', 'dong', 'deh', 'kan', 'kok', 'loh', 'sih',
  'nih', 'yah', 'gitu', 'nah', 'eh', 'apa', 'ya', 'toh', 'anu', 'banget',
  'bener', 'emang', 'udah', 'dah', 'tau', 'doang', 'dgn', 'dlm', 'utk', 'tp',
  'jg', 'krn', 'sm', 'yg', 'jgn', 'dlu', 'kalo', 'klo', 'kayak', 'gmn', 'spt',
  'jd', 'pdhl', 'klw', 'trus', 'gimana', 'lain', 'baru', 'wajib', 'harus',
  'perlu', 'bisa', 'akan', 'telah', 'sudah', 'akan', 'menggunakan', 'membuat',
  'melakukan', 'memiliki', 'menjadi', 'memberikan', 'mendapatkan', 'memahami',
  'menerapkan', 'menganalisis', 'merancang', 'mengembangkan', 'menjelaskan',
  'mengidentifikasi', 'menentukan', 'menghitung', 'mengukur', 'membandingkan',
  'menyusun', 'mengolah', 'mengintegrasikan', 'merepresentasikan', 'mengomunikasikan',
  'tidak', 'belum', 'dapat', 'harus', 'perlu', 'akan', 'telah', 'sudah',
  'jika', 'kalau', 'saat', 'sejak', 'hingga', 'sampai', 'sementara',
  'walau', 'walaupun', 'meskipun', 'biarpun', 'namun', 'tetapi', 'tapi',
  'lalu', 'kemudian', 'lalu', 'setelah', 'sebelum', 'sesudah',
  'tentang', 'mengenai', 'terhadap', 'bagi', 'kepada', 'pada',
  'modul', 'pembelajaran', 'kegiatan', 'materi', 'catatan', 'pertemuan',
  'topik', 'bab', 'sub', 'bagian', 'kelompok', 'siswa', 'mahasiswa',
  'dosen', 'guru', 'narasumber', 'peserta', 'pelajar',
]);

// Known tools/software patterns
const TOOL_PATTERN = /(?:Figma|Canva|Notion|Photoshop|Illustrator|Sketch|Adobe|XD|InVision|Zeplin|Framer|Webflow|Wix|WordPress|Shopify|VSCode|Visual Studio|IntelliJ|Eclipse|Xcode|Android Studio|Postman|Docker|Git|GitHub|GitLab|Bitbucket|Jira|Trello|Slack|Discord|Zoom|Google Meet|Teams|Excel|PowerPoint|Word|Access|SPSS|R Studio|Python|Java|JavaScript|TypeScript|React|Vue|Angular|Node|Express|Django|Flask|Laravel|MySQL|PostgreSQL|MongoDB|Firebase|AWS|GCP|Azure|Vercel|Netlify|Heroku|Linux|Windows|macOS|iOS|Android|TensorFlow|PyTorch|Scikit|Pandas|NumPy|Matplotlib|Tableau|Power BI)/gi;

// Number/rule patterns
const NUMBER_PATTERN = /(?:\d{1,3}(?:\.\d{3})*(?:,\d+)?%?)\b|(?:SKS|CPMK|CPL|PBL|UTS|UAS|Tugas|Kuis)\s*\d*/gi;

// Code/formula patterns
const CODE_FORMULA_PATTERN = /`[^`]+`|\$\$[^$]+\$\$|\b[A-Z][A-Z0-9_]{2,}\b/g;

// Person name pattern: 2-3 capitalized words not in stop words
const PERSON_PATTERN = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;

function extractEntities(text: string): ModulOutput['entitasPenting'] {
  const tools: string[] = [];
  const namaOrang: string[] = [];
  const angkaAturan: string[] = [];
  const istilahTeknis: string[] = [];
  const kodeRumus: string[] = [];

  const seen = new Set<string>();

  // 1. Tools
  const toolMatches = text.match(TOOL_PATTERN);
  if (toolMatches) {
    for (const t of toolMatches) {
      const key = t.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        tools.push(t);
      }
    }
  }

  // 2. Numbers / rules
  const numMatches = text.match(NUMBER_PATTERN);
  if (numMatches) {
    for (const n of numMatches) {
      const key = n.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        angkaAturan.push(n.trim());
      }
    }
  }

  // 3. Code / formula / all-caps identifiers
  const codeMatches = text.match(CODE_FORMULA_PATTERN);
  if (codeMatches) {
    for (const c of codeMatches) {
      const cleaned = c.replace(/^[`$]+|[`$]+$/g, '').trim();
      if (cleaned.length >= 2 && !seen.has(cleaned.toLowerCase())) {
        seen.add(cleaned.toLowerCase());
        kodeRumus.push(cleaned);
      }
    }
  }

  // 4. Person names: capitalized 2-3 word sequences not in stop words
  const personMatches = text.match(PERSON_PATTERN);
  if (personMatches) {
    for (const name of personMatches) {
      const words = name.split(/\s+/);
      const allContentWords = words.every(w => !STOP_WORDS.has(w.toLowerCase()));
      // At least one word must be 3+ chars, and not a common word
      const hasSubstantive = words.some(w => w.length >= 3 && !STOP_WORDS.has(w.toLowerCase()) && !/^(ini|itu|dia|dia|kita|mereka|saya|anda|kami|mereka)$/i.test(w));
      if (allContentWords && hasSubstantive && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        namaOrang.push(name);
      }
    }
  }

  // 5. Technical terms: capitalized single words (not in stop words, not already captured)
  const capWordPattern = /\b([A-Z][a-z]{2,}(?:[A-Z][a-z]+)*)\b/g;
  const capMatches = text.match(capWordPattern);
  if (capMatches) {
    for (const w of capMatches) {
      const key = w.toLowerCase();
      if (!seen.has(key) && !STOP_WORDS.has(key)) {
        seen.add(key);
        istilahTeknis.push(w);
      }
    }
  }

  return { tools, namaOrang, angkaAturan, istilahTeknis, kodeRumus };
}

// ── Line classification ──

type LineKind =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'list'; text: string }
  | { kind: 'table-header'; cells: string[] }
  | { kind: 'table-row'; cells: string[] }
  | { kind: 'blockquote'; text: string }
  | { kind: 'separator' }
  | { kind: 'code-start'; lang?: string }
  | { kind: 'code-end' }
  | { kind: 'paragraph'; text: string };

function classifyLine(line: string): LineKind {
  const trimmed = line.trimEnd();

  // Separator
  if (/^---+$/.test(trimmed) || /^===+$/.test(trimmed)) {
    return { kind: 'separator' };
  }

  // Code block boundaries
  const codeStart = trimmed.match(/^```(\w*)$/);
  if (codeStart) {
    return { kind: 'code-start', lang: codeStart[1] || undefined };
  }
  if (trimmed === '```') {
    return { kind: 'code-end' };
  }

  // Headings
  const h1 = trimmed.match(/^#\s+(.+)/);
  if (h1) return { kind: 'h1', text: h1[1].trim() };

  const h2 = trimmed.match(/^##\s+(.+)/);
  if (h2) return { kind: 'h2', text: h2[1].trim() };

  const h3 = trimmed.match(/^###\s+(.+)/);
  if (h3) return { kind: 'h3', text: h3[1].trim() };

  // List items
  const list = trimmed.match(/^[-*+]\s+(.+)/);
  if (list) return { kind: 'list', text: list[1].trim() };

  // Table rows
  const tableRow = trimmed.match(/^\|(.+)\|$/);
  if (tableRow) {
    const cells = tableRow[1].split('|').map(c => c.trim());
    // Check if it's a separator row like |---|---|
    const isSep = cells.every(c => /^[-:]+$/.test(c));
    if (isSep) return { kind: 'separator' };
    return { kind: 'table-row', cells };
  }

  // Blockquote
  const bq = trimmed.match(/^>\s?(.+)/);
  if (bq) return { kind: 'blockquote', text: bq[1].trim() };

  // Empty line → paragraph (empty)
  if (trimmed === '') {
    return { kind: 'paragraph', text: '' };
  }

  // Default: paragraph
  return { kind: 'paragraph', text: trimmed };
}

// ── Main parser ──

export function parseManualInput(rawText: string): ModulOutput {
  const lines = rawText.split('\n');
  const classified = lines.map(classifyLine);

  // State
  let title = 'Modul Pembelajaran';
  let pendahuluanParts: string[] = [];
  let tujuanPembelajaran: string[] = [];
  const kegiatanPembelajaran: ModulOutput['kegiatanPembelajaran'] = [];
  let rangkumanAkhir: string[] = [];
  let pendahuluanDone = false; // becomes true after first ##
  let inRangkuman = false;
  let currentKegiatan: ModulOutput['kegiatanPembelajaran'][0] | null = null;
  let currentTableHeaders: string[] | null = null;
  let currentTableRows: string[][] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeLang = '';

  // Check if previous line was a table header to mark this line as table-header
  // (we need a lookahead — but let's do a simple 2-pass approach for tables)
  // Actually, we'll just treat the first table-row as header if followed by separator.
  // Simpler: any table-row before a separator-row is a header.

  const flushTable = () => {
    if (currentTableHeaders && currentTableRows.length > 0) {
      const headerLine = currentTableHeaders.join(' | ');
      const dataLines = currentTableRows.map(r => r.join(' | '));
      const tableText = [headerLine, ...dataLines].join('\n');
      if (inRangkuman) {
        rangkumanAkhir.push(tableText);
      } else if (currentKegiatan) {
        currentKegiatan.materi.push(tableText);
      } else {
        pendahuluanParts.push(tableText);
      }
    }
    currentTableHeaders = null;
    currentTableRows = [];
  };

  const flushCode = () => {
    if (codeBuffer.length > 0) {
      const codeText = '```' + codeLang + '\n' + codeBuffer.join('\n') + '\n```';
      if (inRangkuman) {
        rangkumanAkhir.push(codeText);
      } else if (currentKegiatan) {
        currentKegiatan.materi.push(codeText);
      } else {
        pendahuluanParts.push(codeText);
      }
    }
    codeBuffer = [];
    codeLang = '';
  };

  const addMateri = (text: string) => {
    if (inRangkuman) {
      rangkumanAkhir.push(text);
    } else if (currentKegiatan) {
      currentKegiatan.materi.push(text);
    } else {
      pendahuluanParts.push(text);
    }
  };

  // Pre-scan: find if there's a table header (first table row followed by separator)
  // We'll detect this inline by peeking at the next classified line
  for (let i = 0; i < classified.length; i++) {
    const line = classified[i];

    // Handle code blocks
    if (inCodeBlock) {
      if (line.kind === 'code-end') {
        inCodeBlock = false;
        flushCode();
      } else {
        codeBuffer.push(lines[i]);
      }
      continue;
    }

    if (line.kind === 'code-start') {
      flushTable();
      inCodeBlock = true;
      codeLang = line.lang || '';
      continue;
    }

    switch (line.kind) {
      case 'h1':
        flushTable();
        title = line.text;
        break;

      case 'h2': {
        flushTable();
        // Finalize previous kegiatan if any
        if (currentKegiatan) {
          kegiatanPembelajaran.push(currentKegiatan);
        }
        // Check if this is a rangkuman section
        const h2Lower = line.text.toLowerCase();
        inRangkuman = /rangkuman|kesimpulan|ringkasan|summary|conclusion/.test(h2Lower);

        if (!inRangkuman) {
          pendahuluanDone = true;
          currentKegiatan = {
            title: line.text,
            stimulus: '',
            materi: [],
            steps: null,
            reviewNotes: null,
          };
        }
        break;
      }

      case 'h3':
        flushTable();
        addMateri(line.text);
        break;

      case 'list': {
        flushTable();
        if (pendahuluanDone && currentKegiatan && !inRangkuman) {
          // Inside a kegiatan → materi
          currentKegiatan.materi.push(line.text);
        } else if (inRangkuman) {
          rangkumanAkhir.push(line.text);
        } else if (!pendahuluanDone) {
          // Before first ## → tujuanPembelajaran
          tujuanPembelajaran.push(line.text);
        } else {
          // After pendahuluanDone but no current kegiatan yet (shouldn't happen normally)
          pendahuluanParts.push(line.text);
        }
        break;
      }

      case 'blockquote': {
        flushTable();
        if (currentKegiatan && !inRangkuman && !currentKegiatan.stimulus) {
          // First blockquote in kegiatan → stimulus
          currentKegiatan.stimulus = line.text;
        } else {
          addMateri(line.text);
        }
        break;
      }

      case 'table-row': {
        // Peek ahead: is the next non-empty classified line a separator?
        if (!currentTableHeaders) {
          // Check if next line is separator → this is a header
          let nextIdx = i + 1;
          while (nextIdx < classified.length && classified[nextIdx].kind === 'paragraph' && (classified[nextIdx] as { kind: 'paragraph'; text: string }).text === '') {
            nextIdx++;
          }
          const next = classified[nextIdx];
          if (next && next.kind === 'separator') {
            currentTableHeaders = line.cells;
            i = nextIdx; // skip the separator
            continue;
          }
        }
        // Data row
        if (currentTableHeaders) {
          currentTableRows.push(line.cells);
        } else {
          // No header detected, treat as plain text
          addMateri(line.cells.join(' | '));
        }
        break;
      }

      case 'separator':
        flushTable();
        break;

      case 'paragraph':
        if (line.text.trim() !== '') {
          addMateri(line.text);
        }
        break;
    }
  }

  // Flush remaining
  flushTable();
  if (inCodeBlock) flushCode();
  if (currentKegiatan) {
    kegiatanPembelajaran.push(currentKegiatan);
  }

  // If no kegiatan were created but there's pendahuluan content,
  // create a single default kegiatan from the pendahuluan
  if (kegiatanPembelajaran.length === 0 && pendahuluanParts.length > 0) {
    kegiatanPembelajaran.push({
      title: 'Materi Pembelajaran',
      stimulus: 'Perhatikan materi berikut.',
      materi: pendahuluanParts.splice(0),
      steps: null,
      reviewNotes: null,
    });
  }

  // Fallback: if no pendahuluan, create one from tujuan or a generic one
  const pendahuluan = pendahuluanParts.length > 0
    ? pendahuluanParts.join('\n\n')
    : tujuanPembelajaran.length > 0
      ? `Modul ini membahas tentang ${title.toLowerCase()}. Berikut adalah tujuan yang ingin dicapai.`
      : `Modul ini membahas tentang ${title.toLowerCase()}.`;

  // Extract entities from full text
  const allText = rawText;
  const entitasPenting = extractEntities(allText);

  // Ensure rangkumanAkhir has at least one entry
  if (rangkumanAkhir.length === 0 && kegiatanPembelajaran.length > 0) {
    rangkumanAkhir.push(`Modul ini membahas ${kegiatanPembelajaran.length} topik utama tentang ${title.toLowerCase()}.`);
  }

  return {
    title,
    identitas: {
      mataPelajaran: 'Umum',
      kelas: '-',
    },
    pendahuluan,
    tujuanPembelajaran,
    kegiatanPembelajaran,
    rangkumanAkhir,
    entitasPenting,
  };
}
