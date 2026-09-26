/**
 * SpeechGrammarList helper for ALYNNE.EDU
 *
 * Adds domain-specific vocabulary (educational + tech terms) to the Web Speech
 * API recognition. This biases the engine toward these terms, reducing
 * misrecognition of common Indonesian/English homophones.
 *
 * Browser support:
 *   ✅ Chrome / Edge: webkitSpeechGrammarList supported
 *   ❌ Safari:        No SpeechGrammarList (silently no-op)
 *   ❌ Firefox:       No SpeechRecognition at all
 *
 * Format reference: https://www.w3.org/TR/jsgf/
 *
 * Why this matters:
 *   Web Speech API sends audio to Google's servers for recognition. The
 *   server-side model is generic, so subject-specific terms (e.g., "kloroplas",
 *   "trigonometri", "Arduino") often get misrecognized as similar-sounding
 *   common words. By providing a JSGF grammar, we hint to the engine that
 *   these terms are likely in this context.
 *
 * To extend: just add terms to the TERMS array below. JSGF weight=1 means
 * "highest priority" - the engine will prefer these over its default
 * vocabulary when there's ambiguity.
 */

// Subject-specific terms relevant to ALYNNE.EDU's curriculum.
// Keep total list small (<200 terms) for browser grammar size limits.
const TERMS: string[] = [
  // ── Tech (per user's examples) ──
  'Arduino', 'IoT', 'GOTO', 'saham', 'JavaScript', 'TypeScript', 'Python',
  'React', 'Node.js', 'GitHub', 'API', 'HTTP', 'JSON', 'HTML', 'CSS', 'SQL',
  'endpoint', 'server', 'client', 'frontend', 'backend', 'database', 'cloud',
  'algorithm', 'debugging', 'compiler', 'framework', 'library',

  // ── Fisika ──
  'fotosintesis', 'kloroplas', 'klorofil', 'parabola', 'percepatan',
  'kecepatan', 'momentum', 'energi kinetik', 'energi potensial',
  'hukum Newton', 'gaya', 'Joule', 'Watt', 'Volt', 'Ampere', 'hambatan',
  'tegangan', 'arus listrik', 'elektromagnet', 'frekuensi', 'amplitudo',
  'panjang gelombang', 'refraksi', 'refleksi', 'difraksi', 'interferensi',
  'resonansi', 'gravitasi', 'massa jenis', 'kapilaritas', 'osmosis',

  // ── Kimia ──
  'molekul', 'atom', 'ion', 'elektron', 'proton', 'neutron', 'isotop',
  'senyawa', 'larutan', 'pelarut', 'asam', 'basa', 'garam', 'pH', 'mol',
  'molaritas', 'katalis', 'oksidasi', 'reduksi', 'elektrolisis', 'hidrogen',
  'oksigen', 'karbon', 'nitrogen', 'enzim', 'protein', 'karbohidrat',
  'lipid', 'asam amino', 'polimer', 'reaksi eksoterm', 'reaksi endoterm',

  // ── Matematika ──
  'trigonometri', 'sinus', 'kosinus', 'tangen', 'hipotenusa', 'radian',
  'derajat', 'integral', 'diferensial', 'limit', 'turunan', 'fungsi',
  'persamaan', 'pertidaksamaan', 'koefisien', 'variabel', 'konstanta',
  'matriks', 'determinan', 'vektor', 'skalar', 'hiperbola', 'elips',
  'silinder', 'limas', 'prisma', 'kubus', 'balok', 'tabung', 'kerucut',
  'bola', 'pythagoras', 'aljabar', 'geometri',

  // ── Common Indonesian educational terms ──
  'kurikulum', 'silabus', 'evaluasi', 'penilaian', 'tugas', 'ujian',
  'kuis', 'praktikum', 'eksperimen', 'observasi', 'hipotesis',
  'kesimpulan', 'metodologi', 'analisis', 'sintesis', 'komprehensif',
];

export const ALYNNE_GRAMMAR_STRING = `#JSGF V1.0;
grammar alynne_terms;
public <term> = ${TERMS.join(' | ')} ;`;

/**
 * Attach the ALYNNE educational grammar to a SpeechRecognition instance.
 * No-op if the browser doesn't support SpeechGrammarList (Safari, Firefox).
 *
 * @param recognition  The SpeechRecognition instance to configure.
 * @returns true if grammar was attached, false if unsupported/failed.
 */
export function setupRecognitionGrammar(recognition: any): boolean {
  try {
    const GrammarListCtor =
      (window as any).SpeechGrammarList ||
      (window as any).webkitSpeechGrammarList;

    if (!GrammarListCtor) {
      // Safari/Firefox - silently skip. Web Speech API still works without grammar.
      return false;
    }

    const list = new GrammarListCtor();
    // Weight 1.0 = highest priority. Multiple grammars can be added with
    // different weights if needed in the future.
    list.addFromString(ALYNNE_GRAMMAR_STRING, 1.0);
    recognition.grammars = list;

    console.log(
      `[SpeechGrammar] ✓ Attached ${TERMS.length} educational terms ` +
      `(physics/chemistry/math/tech) to recognition.grammars`
    );
    return true;
  } catch (e) {
    console.warn('[SpeechGrammar] setup failed:', e);
    return false;
  }
}

/**
 * Quick check: does the current browser support SpeechGrammarList?
 * Useful for UI indicators.
 */
export function isSpeechGrammarSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(
    (window as any).SpeechGrammarList ||
    (window as any).webkitSpeechGrammarList
  );
}
