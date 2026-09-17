/**
 * Manual Input Schema
 * 
 * Types for the manual module data structure.
 * ModulOutput is the output of the rule-based parser and is compatible
 * with PdfModuleData from pdf-generator.ts (the PDF generator adds
 * date/totalChars/materialCount/branding client-side).
 */

// ── Core output schema (parser output → PDF generator input) ──

export interface ModulOutput {
  title: string;
  identitas: {
    mataPelajaran: string;
    kelas: string;
  };
  pendahuluan: string;
  tujuanPembelajaran: string[];
  kegiatanPembelajaran: {
    title: string;
    stimulus: string;
    materi: string[];
    steps: string[] | null;
    reviewNotes: string[] | null;
  }[];
  rangkumanAkhir: string[];
  entitasPenting: {
    tools: string[];
    namaOrang: string[];
    angkaAturan: string[];
    istilahTeknis: string[];
    kodeRumus: string[];
  };
}

// ── Intermediate section format (used during parsing) ──

export type SectionType = 'heading' | 'paragraph' | 'list' | 'table' | 'code';

export interface ManualSection {
  type: SectionType;
  level?: number;      // for heading: 1, 2, 3
  text?: string;        // for heading, paragraph
  items?: string[];     // for list
  headers?: string[];   // for table
  rows?: string[][];    // for table
  lang?: string;        // for code
  code?: string;        // for code
}
