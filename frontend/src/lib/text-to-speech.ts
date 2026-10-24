/**
 * text-to-speech.ts — Browser TTS for reading materials aloud
 *
 * Uses Web Speech API (SpeechSynthesis).
 * 100% client-side, no server.
 *
 * Features:
 * - Read any text aloud
 * - Control speed, pitch
 * - Indonesian voice support
 * - Pause/resume/stop
 * - Highlight current sentence
 */

let currentUtterance: SpeechSynthesisUtterance | null = null;
let currentText = '';
let currentPos = 0;
let sentences: string[] = [];
let onProgressCallback: ((sentence: string, idx: number) => void) | null = null;

export function isTTSAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function getVoices(): SpeechSynthesisVoice[] {
  if (!isTTSAvailable()) return [];
  return window.speechSynthesis.getVoices();
}

export function getIndonesianVoice(): SpeechSynthesisVoice | null {
  const voices = getVoices();
  return (
    voices.find(v => v.lang.startsWith('id')) ||
    voices.find(v => v.lang.startsWith('en')) ||
    voices[0] ||
    null
  );
}

export function speak(
  text: string,
  options?: {
    rate?: number;
    pitch?: number;
    onProgress?: (sentence: string, idx: number) => void;
    onEnd?: () => void;
  }
): void {
  if (!isTTSAvailable()) return;

  stop();

  currentText = text;
  sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  currentPos = 0;
  onProgressCallback = options?.onProgress || null;

  const voice = getIndonesianVoice();

  const speakNext = () => {
    if (currentPos >= sentences.length) {
      currentUtterance = null;
      options?.onEnd?.();
      return;
    }

    const sentence = sentences[currentPos];
    const utterance = new SpeechSynthesisUtterance(sentence);
    
    if (voice) utterance.voice = voice;
    utterance.rate = options?.rate ?? 1.0;
    utterance.pitch = options?.pitch ?? 1.0;
    utterance.lang = 'id-ID';

    utterance.onend = () => {
      currentPos++;
      onProgressCallback?.(sentence, currentPos - 1);
      if (currentPos < sentences.length) {
        speakNext();
      } else {
        currentUtterance = null;
        options?.onEnd?.();
      }
    };

    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  };

  speakNext();
}

export function pause(): void {
  if (isTTSAvailable()) {
    window.speechSynthesis.pause();
  }
}

export function resume(): void {
  if (isTTSAvailable()) {
    window.speechSynthesis.resume();
  }
}

export function stop(): void {
  if (isTTSAvailable()) {
    window.speechSynthesis.cancel();
  }
  currentUtterance = null;
  currentPos = 0;
  sentences = [];
}

export function isSpeaking(): boolean {
  if (!isTTSAvailable()) return false;
  return window.speechSynthesis.speaking;
}

export function isPaused(): boolean {
  if (!isTTSAvailable()) return false;
  return window.speechSynthesis.paused;
}

export function getProgress(): { current: number; total: number } {
  return { current: currentPos, total: sentences.length };
}
