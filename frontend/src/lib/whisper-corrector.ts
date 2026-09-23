/**
 * whisper-corrector.ts — Whisper sebagai post-processor koreksi
 *
 * Flow:
 *   1. Web Speech API capture audio + transkrip real-time (text kasar)
 *   2. Audio juga di-capture via AudioWorklet (PCM 16kHz)
 *   3. Saat stop, Whisper process audio → text akurat
 *   4. Compare text Web Speech API vs Whisper → pick yang lebih akurat
 *   5. Atau merge: pakai Whisper sebagai final (lebih akurat)
 */

import { transcribe, isModelLoaded, loadModel, getCurrentModel } from '@/lib/whisper-client';

export interface CorrectionResult {
  originalText: string;        // text dari Web Speech API
  whisperText: string;         // text dari Whisper
  finalText: string;           // text final (biasanya whisperText)
  usedWhisper: boolean;        // true kalau pakai Whisper, false kalau Web Speech API
  confidence: number;          // 0-1, seberapa beda Web Speech vs Whisper
}

/**
 * Koreksi text Web Speech API pakai Whisper.
 *
 * @param webSpeechText Text dari Web Speech API
 * @param audioData Float32Array PCM 16kHz mono (dari AudioWorklet)
 * @returns CorrectionResult
 */
export async function correctWithWhisper(
  webSpeechText: string,
  audioData: Float32Array
): Promise<CorrectionResult> {
  const originalText = webSpeechText.trim();

  // Cek apakah Whisper model sudah loaded
  if (!isModelLoaded()) {
    console.log('[Whisper-Corrector] Model not loaded, return Web Speech API text');
    return {
      originalText,
      whisperText: '',
      finalText: originalText,
      usedWhisper: false,
      confidence: 0,
    };
  }

  // Cek apakah audio valid
  if (!audioData || audioData.length < SAMPLE_RATE * 0.5) {
    // Audio kurang dari 0.5 detik, skip Whisper
    console.log('[Whisper-Corrector] Audio too short, return Web Speech API text');
    return {
      originalText,
      whisperText: '',
      finalText: originalText,
      usedWhisper: false,
      confidence: 0,
    };
  }

  try {
    console.log(`[Whisper-Corrector] Processing audio: ${audioData.length} samples (${(audioData.length / SAMPLE_RATE).toFixed(1)}s)`);
    const result = await transcribe(audioData, 'indonesian');
    const whisperText = result.text.trim();
    console.log(`[Whisper-Corrector] Whisper text: "${whisperText.substring(0, 100)}..."`);

    // Confidence: seberapa mirip text Web Speech API vs Whisper
    const confidence = calculateSimilarity(originalText, whisperText);
    console.log(`[Whisper-Corrector] Similarity: ${(confidence * 100).toFixed(1)}%`);

    // Decision: pakai Whisper kalau text-nya tidak kosong
    // Whisper umumnya lebih akurat untuk Bahasa Indonesia
    const useWhisper = whisperText.length > 0;
    const finalText = useWhisper ? whisperText : originalText;

    return {
      originalText,
      whisperText,
      finalText,
      usedWhisper: useWhisper,
      confidence,
    };
  } catch (err) {
    console.error('[Whisper-Corrector] Whisper failed:', err);
    // Fallback: pakai text Web Speech API
    return {
      originalText,
      whisperText: '',
      finalText: originalText,
      usedWhisper: false,
      confidence: 0,
    };
  }
}

const SAMPLE_RATE = 16000;

/**
 * Hitung similarity antara 2 text (0-1).
 * Pakai Levenshtein distance normalized.
 */
function calculateSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aWords = a.toLowerCase().split(/\s+/).filter(w => w);
  const bWords = b.toLowerCase().split(/\s+/).filter(w => w);

  if (aWords.length === 0 || bWords.length === 0) return 0;

  const maxLen = Math.max(aWords.length, bWords.length);
  const dist = wordLevenshtein(aWords, bWords);
  return 1 - dist / maxLen;
}

function wordLevenshtein(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}
