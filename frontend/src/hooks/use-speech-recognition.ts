'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { useScreenCv } from '@/hooks/use-screen-cv';
import { setupRecognitionGrammar } from '@/lib/speech-grammar';
import { registerSttStop, unregisterSttStop } from '@/lib/stt-controller';

const GROQ_CHUNK_INTERVAL = 10000; // 10s chunks (was 4s) - bigger chunks have valid webm headers
const NO_RESULT_TIMEOUT = 10000;
const MAX_WEBSPEECH_RESTARTS = 50;
const WEBSPEECH_RESTART_DELAY = 500;
const LIVE_ENHANCE_INTERVAL = 30000;
const WHISPER_BACKEND = '/api/whisper/transcribe';
// Screen capture: audio-only transcription via Groq Whisper

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

type SpeechRecognitionErrorEvent = { error: string; message?: string };
type SpeechRecognitionAlternative = {
  transcript: string;
  confidence: number;
};

type SpeechRecognitionInstance = {
  continuous: boolean; interimResults: boolean; lang: string; maxAlternatives: number;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onsoundstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onsoundend: (() => void) | null;
  onaudioend: (() => void) | null;
};

export interface STTLogEntry {
  time: string;
  type: 'info' | 'success' | 'error' | 'text';
  text: string;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function nowStr() {
  return new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Split text into sentences on .!? boundaries */
function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    buf += text[i];
    if ('.!?'.includes(text[i]) && (i + 1 >= text.length || /\s/.test(text[i + 1]))) {
      const s = buf.trim();
      if (s) sentences.push(s);
      buf = '';
    }
  }
  const rem = buf.trim();
  if (rem) sentences.push(rem);
  return sentences.length > 0 ? sentences : [text];
}

/** Pick best alternative using confidence score, not length */
function pickBestAlternative(result: SpeechRecognitionResult): string {
  const len = result.length;
  if (len === 0) return '';
  if (len === 1) return result[0].transcript;

  // Find highest confidence
  let bestIdx = 0;
  let bestConf = result[0].confidence ?? 0;
  for (let j = 1; j < len; j++) {
    const conf = result[j].confidence ?? 0;
    if (conf > bestConf) {
      bestConf = conf;
      bestIdx = j;
    }
  }
  return result[bestIdx].transcript;
}

export function useSpeechRecognition() {
  const {
    sttStatus, setSttStatus, sttSource, setSttSource,
    sttAudioMode, transcript, appendTranscript,
    interimTranscript, setInterimTranscript, setSttError,
    isReconnecting, setIsReconnecting, apiKeys,
  } = useAppStore();

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // Hybrid STT: separate MediaRecorder for full audio (whisper)
  const whisperRecorderRef = useRef<MediaRecorder | null>(null);
  const whisperChunksRef = useRef<Blob[]>([]);
  const [isWhisperProcessing, setIsWhisperProcessing] = useState(false);
  const groqTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStoppingRef = useRef(false);
  const manualStopRef = useRef(false);
  const [webspeechSupported, setWebspeechSupported] = useState(false);
  const [activityLog, setActivityLog] = useState<STTLogEntry[]>([]);
  const [isGroqProcessing, setIsGroqProcessing] = useState(false);
  const isWhisperProcessingRef = useRef(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const isEnhancingRef = useRef(false);
  const [sttWarning, setSttWarning] = useState('');
  const chunkCountRef = useRef(0);
  const liveEnhanceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastEnhancedIdxRef = useRef(0);

  // Audio visualizer refs
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(32).fill(0));
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  // System audio rolling recorder (for Zoom/Meet/Discord — Web Speech API can't capture system audio)
  const systemAudioRecorderRef = useRef<MediaRecorder | null>(null);
  const systemAudioChunksRef = useRef<Blob[]>([]);
  const systemAudioIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const systemAudioSegmentNumRef = useRef(0);

  const isRecordingRef = useRef(false);
  const hasReceivedResultRef = useRef(false);
  const skipWebspeechReconnectRef = useRef(false);
  const webspeechRestartCountRef = useRef(0);
  const webspeechRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastErrorWasNoSpeechRef = useRef(false);

  // Track which result indexes have been finalized & appended to the transcript.
  // Why: Chrome's Web Speech API sometimes fires onresult with event.resultIndex = 0
  // even after result[0] has already been finalized and appended. Without this guard,
  // the same final text gets appended a second time → transcript shows "halo halo"
  // until the next result arrives and "replaces" the duplicate visually.
  //
  // This Set is reset every time a new SpeechRecognition instance is created
  // (in onstart handler) so that fresh result indexes can be processed normally.
  const processedFinalIdxRef = useRef<Set<number>>(new Set());



  const addLog = useCallback((type: STTLogEntry['type'], text: string) => {
    const entry: STTLogEntry = { time: nowStr(), type, text };
    setActivityLog((prev) => [...prev.slice(-50), entry]);
    console.log(`[STT ${type}] ${text}`);
  }, []);

  // ── Fire-and-forget fuzzy-correct for Web Speech API final text ──
  // Why: Previously only OCR text was sent to /api/stt/fuzzy-correct, which
  // means Web Speech API recognition failures (unknown words) were NEVER
  // logged to the STTFailure D1 table. Admin panel showed "No failures logged"
  // even after extensive STT use.
  //
  // This helper runs after each Web Speech final result to:
  //   1. Server-side: log raw text + unknown words to STTFailure table
  //      (auto-logged inside fuzzy-correct.ts when unknownWords > 0)
  //   2. Client-side: surface a tiny log entry so the user knows it was logged
  //
  // Fire-and-forget is intentional — we don't block the onresult callback,
  // and the actual transcript correction still happens later via enhanceNewEntries.
  const logWebspeechFailures = useCallback((rawText: string) => {
    const text = (rawText || '').trim();
    if (!text) return;
    fetch('/api/stt/fuzzy-correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, source: 'webspeech' }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const unknown = data.stats?.unknownWords ?? 0;
        if (unknown > 0) {
          addLog('info', `Web Speech: ${unknown} kata tidak dikenali → logged ke STT Failures`);
        } else if (data.stats && (data.stats.fuzzyFixed || data.stats.slangFixed)) {
          addLog('info', `Web Speech fuzzy-corrected: ${data.stats.fuzzyFixed || 0} typo, ${data.stats.slangFixed || 0} slang`);
        }
      })
      .catch(() => {
        // Silent fail — don't disrupt recording for logging failures
      });
  }, [addLog]);

  // ── Audio Visualizer (Web Audio API) — uses an EXISTING stream, never calls getUserMedia ──
  const startVisualizer = useCallback((stream: MediaStream) => {
    try {
      // Skip if already visualizing this stream
      if (audioContextRef.current && analyserRef.current) {
        console.log('[STT] Visualizer already running, reusing.');
        return;
      }
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      // Do NOT connect to destination — we only analyze, don't play

      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      // We do NOT own this stream — don't store it, don't stop it

      const bufLen = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufLen);
      const barCount = 32;

      const update = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const bars: number[] = [];
        const step = Math.max(1, Math.floor(bufLen / barCount));
        for (let i = 0; i < barCount; i++) {
          let sum = 0;
          for (let j = 0; j < step; j++) {
            sum += dataArray[i * step + j] || 0;
          }
          bars.push(Math.min(100, (sum / step / 255) * 100 * 1.5));
        }
        setAudioLevels(bars);
        animFrameRef.current = requestAnimationFrame(update);
      };
      update();
      console.log('[STT] Audio visualizer started');
    } catch (e) {
      console.error('[STT] Visualizer failed:', e);
    }
  }, []);

  const stopVisualizer = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    // Do NOT stop stream tracks — we don't own the stream
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevels(new Array(32).fill(0));
  }, []);

  // ── Combined CV pipeline: OCR (tesseract.js) + frame diff (slide change) ──
  // Only active during screen-capture mode. OCR samples every 5s, frame diff
  // every 1s. Results are appended to the transcript inline (with visual tags)
  // so the user sees the COMBINED output: speech + screen text + slide events.
  const {
    start: startScreenCv,
    stop: stopScreenCv,
    isOcrProcessing: screenCvIsOcrProcessing,
    isModelLoading: screenCvIsModelLoading,
    modelProgress: screenCvModelProgress,
    lastOcrAt: screenCvLastOcrAt,
    lastSlideChangeAt: screenCvLastSlideChangeAt,
    slideChangeCount: screenCvSlideChangeCount,
    ocrChunkCount: screenCvOcrChunkCount,
    error: screenCvError,
  } = useScreenCv({
    onOcrText: async (text, confidence) => {
      // Fuzzy-correct OCR text before appending to transcript.
      // OCR (tesseract.js) is less accurate than whisper for Indonesian, so
      // we apply the same dictionary + Levenshtein corrections as Web Speech.
      let corrected = text;
      try {
        const res = await fetch('/api/stt/fuzzy-correct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, source: 'ocr' }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.corrected && data.corrected !== text) {
            corrected = data.corrected;
            addLog('info', `OCR fuzzy-corrected: ${data.stats?.fuzzyFixed || 0} typos, ${data.stats?.slangFixed || 0} slang`);
          }
        }
      } catch (e) {
        // Silent fail — fall back to original text
        console.warn('[OCR] fuzzy-correct failed:', e);
      }
      addLog('success', `OCR: "${corrected.slice(0, 80)}${corrected.length > 80 ? '...' : ''}" (${confidence.toFixed(0)}%)`);
      appendTranscript(`[🖼️ OCR] ${corrected}`);
    },
    onSlideChange: (diffPct) => {
      addLog('info', `🖼️ Slide berubah (${(diffPct * 100).toFixed(0)}% pixel changed)`);
      appendTranscript(`[🔄 Slide berubah — ${(diffPct * 100).toFixed(0)}% pixel berubah]`);
    },
  });

  // ── Incremental AI correction — only fixes NEW entries since last correction ──
  // This minimizes bias: LLM sees small fresh chunks, not accumulated errors
  const enhanceNewEntries = useCallback(async (): Promise<boolean> => {
    if (isEnhancingRef.current) return false;

    const entries = useAppStore.getState().transcriptEntries;
    const fromIdx = lastEnhancedIdxRef.current;

    if (fromIdx >= entries.length) return false;

    const pendingEntries = entries.slice(fromIdx);
    const rawText = pendingEntries.map(e => e.text).join(' ');

    if (rawText.trim().length < 20) {
      lastEnhancedIdxRef.current = entries.length;
      return false;
    }

    isEnhancingRef.current = true;
    setIsEnhancing(true);
    addLog('info', `Memperbaiki ${pendingEntries.length} entri baru dengan AI...`);

    try {
      const res = await fetch('/api/stt/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const enhanced = (data.text as string || '').trim();

      // Capture entries that arrived DURING the API call
      const currentEntries = useAppStore.getState().transcriptEntries;
      const tailEntries = currentEntries.slice(entries.length);

      if (!enhanced || enhanced === rawText.trim()) {
        addLog('info', 'Teks sudah bagus, tidak perlu perbaikan');
        lastEnhancedIdxRef.current = currentEntries.length - tailEntries.length;
        return false;
      }

      // Split enhanced text into sentences with estimated timestamps
      const sentences = splitIntoSentences(enhanced);
      const firstTime = pendingEntries[0].time;
      const [hh, mm, ss] = firstTime.split(':').map(Number);

      const correctedEntries = sentences.map((sentence, i) => {
        const totalSec = hh * 3600 + mm * 60 + ss + i * 5;
        const h = Math.floor(totalSec / 3600) % 24;
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        return {
          time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
          text: sentence,
        };
      });

      // Merge: corrected entries + any entries that arrived during API call
      useAppStore.getState().replaceEntriesFrom(fromIdx, [...correctedEntries, ...tailEntries]);
      lastEnhancedIdxRef.current = fromIdx + correctedEntries.length;
      addLog('success', `${correctedEntries.length} kalimat diperbaiki AI`);
      return true;
    } catch {
      addLog('info', 'AI enhancement tidak tersedia');
      lastEnhancedIdxRef.current = entries.length;
      return false;
    } finally {
      isEnhancingRef.current = false;
      setIsEnhancing(false);
    }
  }, [addLog]);

  useEffect(() => {
    const supported = typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
    setWebspeechSupported(supported);
    console.log('[STT] Web Speech API supported:', supported);
  }, []);

  useEffect(() => { return () => { cleanup(); stopVisualizer(); }; }, []);

  const cleanup = useCallback(() => {
    stopScreenCv();
    if (groqTimerRef.current) { clearInterval(groqTimerRef.current); groqTimerRef.current = null; }
    if (noResultTimerRef.current) { clearTimeout(noResultTimerRef.current); noResultTimerRef.current = null; }
    if (webspeechRestartTimerRef.current) { clearTimeout(webspeechRestartTimerRef.current); webspeechRestartTimerRef.current = null; }
    if (liveEnhanceTimerRef.current) { clearInterval(liveEnhanceTimerRef.current); liveEnhanceTimerRef.current = null; }
    if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} recognitionRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
      mediaRecorderRef.current = null;
    }
    if (whisperRecorderRef.current && whisperRecorderRef.current.state !== 'inactive') {
      try { whisperRecorderRef.current.stop(); } catch {}
      whisperRecorderRef.current = null;
    }
    // Cleanup system audio rolling recorder
    if (systemAudioIntervalRef.current) { clearInterval(systemAudioIntervalRef.current); systemAudioIntervalRef.current = null; }
    if (systemAudioRecorderRef.current && systemAudioRecorderRef.current.state !== 'inactive') {
      try { systemAudioRecorderRef.current.stop(); } catch {}
      systemAudioRecorderRef.current = null;
    }
    if (mediaStreamRef.current) {
      // Cleanup hybrid capture inline (new structure)
      const hybrid = (mediaStreamRef.current as any)?.__hybridCleanup;
      if (hybrid?.audioContext) { try { hybrid.audioContext.close(); } catch {} }
      if (hybrid?.displayStream) { hybrid.displayStream.getTracks().forEach((t: MediaStreamTrack) => { try { t.stop(); } catch {} }); }
      if (hybrid?.micStream) { hybrid.micStream.getTracks().forEach((t: MediaStreamTrack) => { try { t.stop(); } catch {} }); }
      if (hybrid?.destination) { try { hybrid.destination.disconnect(); } catch {} }
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    audioChunksRef.current = [];
    whisperChunksRef.current = [];
    setSttStatus('idle');
    setIsReconnecting(false);
  }, [stopVisualizer, setSttStatus, setIsReconnecting, stopScreenCv]);

  const stopAll = useCallback(() => {
    isStoppingRef.current = true;
    manualStopRef.current = true;
    isRecordingRef.current = false;
    stopScreenCv();
    // Cleanup hybrid capture (new ref structure)
    const streamRef = mediaStreamRef.current as any;
    const hybrid = streamRef?.__hybridCleanup;
    if (hybrid?.audioContext) {
      try { hybrid.audioContext.close(); } catch {}
    }
    if (hybrid?.displayStream) {
      hybrid.displayStream.getTracks().forEach((t: MediaStreamTrack) => { try { t.stop(); } catch {} });
    }
    if (hybrid?.micStream) {
      hybrid.micStream.getTracks().forEach((t: MediaStreamTrack) => { try { t.stop(); } catch {} });
    }
    if (noResultTimerRef.current) { clearTimeout(noResultTimerRef.current); noResultTimerRef.current = null; }
    if (groqTimerRef.current) { clearInterval(groqTimerRef.current); groqTimerRef.current = null; }
    if (webspeechRestartTimerRef.current) { clearTimeout(webspeechRestartTimerRef.current); webspeechRestartTimerRef.current = null; }
    if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} recognitionRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
      mediaRecorderRef.current = null;
    }
    if (whisperRecorderRef.current && whisperRecorderRef.current.state !== 'inactive') {
      try { whisperRecorderRef.current.stop(); } catch {}
      whisperRecorderRef.current = null;
    }
    // Cleanup system audio rolling recorder
    if (systemAudioIntervalRef.current) { clearInterval(systemAudioIntervalRef.current); systemAudioIntervalRef.current = null; }
    if (systemAudioRecorderRef.current && systemAudioRecorderRef.current.state !== 'inactive') {
      try { systemAudioRecorderRef.current.stop(); } catch {}
      systemAudioRecorderRef.current = null;
    }
    if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach((t) => t.stop()); mediaStreamRef.current = null; }
  }, []);

  // ── Send full audio to local faster-whisper backend for precise transcription ──
  const sendToWhisperBackend = useCallback(async () => {
    if (whisperChunksRef.current.length === 0) return false;
    isWhisperProcessingRef.current = true;
    setIsWhisperProcessing(true);
    addLog('info', 'Mengirim audio ke faster-whisper untuk presisi...');

    try {
      const blob = new Blob(whisperChunksRef.current, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('file', blob, 'recording.webm');
      formData.append('language', 'id');

      console.log('[STT-Whisper] Sending to backend. Chunks:', whisperChunksRef.current.length, 'Blob size:', blob.size);
      addLog('info', `Mengirim ${blob.size > 0 ? Math.round(blob.size/1024) + 'KB' : 'empty'} audio ke whisper...`);

      const res = await fetch(WHISPER_BACKEND, {
        method: 'POST',
        body: formData,
      });
      console.log('[STT-Whisper] Response status:', res.status);
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('[STT-Whisper] Error response:', errText);
        throw new Error(`${res.status}: ${errText.slice(0, 100)}`);
      }
      const data = await res.json();
      console.log('[STT-Whisper] Response data:', { text_len: data.text?.length, processing_time: data.processing_time, chunks: data.chunk_count });
      const text = (data.text || '').trim();

      if (!text) {
        addLog('info', `faster-whisper: tidak ada teks terdeteksi (duration: ${data.duration}s, processing: ${data.processing_time}s)`);
        return false;
      }

      addLog('success', `faster-whisper: ${text.length} chars in ${data.processing_time}s${data.chunked ? ` (${data.chunk_count} chunks)` : ''}`);

      // Replace all transcript entries with whisper result
      const sentences = splitIntoSentences(text);
      const startTime = useAppStore.getState().transcriptEntries[0]?.time || '00:00:00';
      const [hh, mm, ss] = startTime.split(':').map(Number);
      const correctedEntries = sentences.map((sentence, i) => {
        const totalSec = hh * 3600 + mm * 60 + ss + i * 5;
        const h = Math.floor(totalSec / 3600) % 24;
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        return {
          time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
          text: sentence,
        };
      });
      useAppStore.getState().replaceEntriesFrom(0, correctedEntries);
      return true;
    } catch (e) {
      addLog('info', `faster-whisper tidak tersedia: ${e instanceof Error ? e.message : 'unknown'}`);
      return false;
    } finally {
      isWhisperProcessingRef.current = false;
      setIsWhisperProcessing(false);
    }
  }, [addLog]);

  // ── Send audio chunk to Groq Whisper API ──
  const sendAudioToGroq = useCallback(async (audioBlob: Blob, chunkNum: number) => {
    const sizeKB = (audioBlob.size / 1024).toFixed(1);
    addLog('info', `Chunk #${chunkNum} (${sizeKB}KB) dikirim ke Groq...`);
    setIsGroqProcessing(true);
    try {
      const clientKey = useAppStore.getState().apiKeys.groq?.trim();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (clientKey) headers['x-groq-api-key'] = clientKey;
      const base64Audio = await blobToBase64(audioBlob);
      const res = await fetch('/api/stt/groq', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          audio: base64Audio,
          mimeType: audioBlob.type || 'audio/webm',
          model: 'whisper-large-v3-turbo',
          language: 'id',
          response_format: 'text',
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        addLog('error', `Groq error: ${res.status} — ${err.slice(0, 80)}`);
        throw new Error(err);
      }
      const data = await res.json();
      const text = (data.text as string || '').trim();
      if (text) {
        addLog('success', `"${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`);
      } else {
        addLog('info', `Chunk #${chunkNum}: tidak ada teks terdeteksi`);
      }
      return text;
    } catch (e) {
      console.error('Groq STT error:', e);
      return null;
    } finally {
      setIsGroqProcessing(false);
    }
  }, [addLog]);

  // ── Send audio chunk to local Whisper backend (more robust than Groq for chunks) ──
  const sendAudioToWhisperLocal = useCallback(async (audioBlob: Blob, chunkNum: number) => {
    const sizeKB = (audioBlob.size / 1024).toFixed(1);
    addLog('info', `Chunk #${chunkNum} (${sizeKB}KB) → whisper local...`);
    setIsGroqProcessing(true); // reuse same state for "processing" indicator
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, `chunk-${chunkNum}.webm`);
      formData.append('language', 'id');
      formData.append('chunk_mode', 'off'); // chunks are short, no need to chunk again

      const res = await fetch('/api/whisper/transcribe', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        console.error('[Whisper-local] error:', res.status, err);
        return null;
      }
      const data = await res.json();
      const text = (data.text || '').trim();
      if (text) {
        addLog('success', `Chunk #${chunkNum}: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`);
      } else {
        addLog('info', `Chunk #${chunkNum}: tidak ada teks (duration: ${data.duration}s)`);
      }
      return text;
    } catch (e) {
      console.error('[Whisper-local] exception:', e);
      return null;
    } finally {
      setIsGroqProcessing(false);
    }
  }, [addLog]);

  // ── System Audio Rolling Recorder (for Zoom/Meet/Discord — Web Speech API can't capture system audio) ──
  // Strategy: Every 30s, stop recorder → get FULL valid webm blob → send to whisper-backend → start new recorder.
  // This produces valid webm files (not fragments) that whisper/ffmpeg can process.
  const startSystemAudioRollingRecorder = useCallback((stream: MediaStream) => {
    // Cross-browser mimeType detection
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    let mimeType = '';
    for (const t of types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) { mimeType = t; break; }
    }
    systemAudioSegmentNumRef.current = 0;
    systemAudioChunksRef.current = [];

    const startNewSegment = () => {
      if (!isRecordingRef.current || manualStopRef.current) return;
      try {
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        systemAudioRecorderRef.current = recorder;
        systemAudioChunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) systemAudioChunksRef.current.push(e.data);
        };

        recorder.onstop = async () => {
          // Get full valid webm blob
          if (systemAudioChunksRef.current.length > 0) {
            const blob = new Blob(systemAudioChunksRef.current, { type: 'audio/webm' });
            systemAudioChunksRef.current = [];
            systemAudioSegmentNumRef.current += 1;
            const segNum = systemAudioSegmentNumRef.current;
            const sizeKB = (blob.size / 1024).toFixed(1);
            addLog('info', `System audio #${segNum} (${sizeKB}KB) → whisper...`);

            // Send to whisper-backend SYNC endpoint (blocks until done, returns text directly)
            try {
              const formData = new FormData();
              formData.append('file', blob, `system-audio-${segNum}.webm`);
              formData.append('language', 'id');
              formData.append('chunk_mode', 'off');
              formData.append('timeout', '120');

              const res = await fetch('/api/whisper/transcribe/sync', {
                method: 'POST',
                body: formData,
              });
              if (res.ok) {
                const data = await res.json();
                // Sync endpoint returns: {status: "completed", result: {text: "..."}}
                const text = (data.result?.text || data.text || '').trim();
                if (text) {
                  addLog('success', `System #${segNum}: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`);
                  appendTranscript(text);
                } else {
                  addLog('info', `System #${segNum}: no speech detected`);
                }
              } else {
                console.error('[SystemAudio] transcribe error:', res.status);
                addLog('info', `System #${segNum}: transcribe failed (${res.status})`);
              }
            } catch (e) {
              console.error('[SystemAudio] send error:', e);
              addLog('info', `System #${segNum}: send error`);
            }
          }

          // Start new segment (rolling) — unless user stopped
          if (isRecordingRef.current && !manualStopRef.current) {
            setTimeout(() => startNewSegment(), 100);
          }
        };

        recorder.onerror = (e) => {
          console.error('[SystemAudio] recorder error:', e);
        };

        recorder.start();
      } catch (e) {
        console.error('[SystemAudio] start segment failed:', e);
      }
    };

    // Start first segment
    startNewSegment();
    addLog('info', 'System audio recorder aktif (30s rolling segments).');

    // Stop recorder every 30s to produce valid webm blob
    systemAudioIntervalRef.current = setInterval(() => {
      const r = systemAudioRecorderRef.current;
      if (r && r.state === 'recording') {
        try { r.stop(); } catch {}
      }
    }, 30000);
  }, [addLog, appendTranscript]);

  // ── Record from a MediaStream via Groq/Whisper (shared by mic-fallback & screen-capture) ──
  const startRecordingFromStream = useCallback((
    stream: MediaStream,
    source: 'groq' | 'screen-capture',
    recordStream?: MediaStream,
  ) => {
    mediaStreamRef.current = stream;
    const targetStream = recordStream || stream;
    // Cross-browser mimeType detection
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    let mimeType = '';
    for (const t of types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) { mimeType = t; break; }
    }
    const mediaRecorder = mimeType
      ? new MediaRecorder(targetStream, { mimeType })
      : new MediaRecorder(targetStream);
    mediaRecorderRef.current = mediaRecorder;
    audioChunksRef.current = [];
    chunkCountRef.current = 0;

    // VAD: track whether audio has speech using analyser RMS
    const vadHasSpeech = (): boolean => {
      if (!analyserRef.current) return true; // no analyser = always send
      const data = new Float32Array(analyserRef.current.fftSize);
      analyserRef.current.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      return rms > 0.008; // threshold tuned for system audio
    };
    const hasSpeechRef = { value: false };
    let silentCount = 0;
    const SILENT_SKIP = 2; // skip this many silent intervals before allowing a send

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        const speaking = vadHasSpeech();
        if (speaking) {
          hasSpeechRef.value = true;
          silentCount = 0;
          audioChunksRef.current.push(e.data);
        } else {
          silentCount++;
          // Keep buffer up to SILENT_SKIP silent chunks after speech
          // This captures trailing words before silence
          if (hasSpeechRef.value && silentCount <= SILENT_SKIP) {
            audioChunksRef.current.push(e.data);
          } else if (!hasSpeechRef.value) {
            // Never had speech, discard silently
            return;
          }
          // If silent for too long after speech, send what we have and reset
          if (hasSpeechRef.value && silentCount > SILENT_SKIP && audioChunksRef.current.length > 0) {
            // Will be picked up by the next interval check
          }
        }
      }
    };

    mediaRecorder.onerror = (e) => {
      addLog('error', `MediaRecorder error: ${e.error?.name || 'unknown'} — ${e.error?.message || ''}`);
    };

    mediaRecorder.start(GROQ_CHUNK_INTERVAL);
    setSttSource(source);
    startVisualizer(stream);
    addLog('info', source === 'screen-capture' ? 'Merekam system audio (screen)...' : 'Merekam via mikrofon (Groq Whisper)...');
    addLog('info', `MediaRecorder mimeType: ${mimeType}, timeslice: ${GROQ_CHUNK_INTERVAL}ms`);
    addLog('info', 'VAD aktif: hanya mengirim audio saat ada suara (hemat quota).');
    addLog('success', 'Audio aktif! Teks akan muncul otomatis saat ada suara terdeteksi.');

    // Send each chunk — 3-tier fallback: Groq → Whisper local
    let groqRateLimited = false; // once Groq hits rate limit, switch to whisper permanently
    groqTimerRef.current = setInterval(async () => {
      if (audioChunksRef.current.length === 0) return;
      chunkCountRef.current++;
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      audioChunksRef.current = [];
      hasSpeechRef.value = false;
      silentCount = 0;

      let text: string | null = null;

      if (source === 'screen-capture' || groqRateLimited) {
        // Screen mode OR Groq was rate-limited → use whisper-local directly
        text = await sendAudioToWhisperLocal(blob, chunkCountRef.current);
      } else {
        // Try Groq first
        text = await sendAudioToGroq(blob, chunkCountRef.current);
        // If Groq returned null (error/rate-limit), fallback to whisper-local
        if (text === null) {
          addLog('info', 'Groq rate-limited/error, beralih ke Whisper lokal...');
          groqRateLimited = true; // switch permanently to avoid repeated failures
          text = await sendAudioToWhisperLocal(blob, chunkCountRef.current);
        }
      }

      if (text && text.trim()) {
        appendTranscript(text.trim());
      }
      // No log for empty results — VAD handles silent detection
    }, GROQ_CHUNK_INTERVAL);
  }, [sendAudioToGroq, sendAudioToWhisperLocal, setSttSource, appendTranscript, setSttWarning, addLog, startVisualizer]);

  // ── Switch from Web Speech API to Groq (fallback) ──
  const switchToGroq = useCallback(async () => {
    if (manualStopRef.current || isStoppingRef.current) return;
    skipWebspeechReconnectRef.current = true;
    if (noResultTimerRef.current) { clearTimeout(noResultTimerRef.current); noResultTimerRef.current = null; }
    if (webspeechRestartTimerRef.current) { clearTimeout(webspeechRestartTimerRef.current); webspeechRestartTimerRef.current = null; }
    if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} recognitionRef.current = null; }

    addLog('info', 'Beralih ke Groq Whisper API...');
    setSttWarning('Web Speech API tidak merespons. Otomatis beralih ke Groq Whisper.');

    // Reuse existing mic stream if available (from initial getUserMedia in startRecording)
    const existingStream = mediaStreamRef.current;
    if (existingStream && existingStream.getTracks().some(t => t.readyState === 'live')) {
      addLog('info', 'Menggunakan mic stream yang sudah aktif...');
      startRecordingFromStream(existingStream, 'groq');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 44100 }
      });
      startRecordingFromStream(stream, 'groq');
    } catch (e) {
      addLog('error', 'Gagal akses mikrofon untuk Groq fallback.');
      setSttError('Gagal mengakses mikrofon.');
      setSttStatus('error');
      isRecordingRef.current = false;
    }
  }, [startRecordingFromStream, addLog, setSttError, setSttStatus, setSttWarning]);

  // ── Restart Web Speech API (called from onend) ──
  const restartWebSpeech = useCallback(() => {
    if (manualStopRef.current || isStoppingRef.current || !isRecordingRef.current) return;
    if (skipWebspeechReconnectRef.current) return;

    if (lastErrorWasNoSpeechRef.current) {
      lastErrorWasNoSpeechRef.current = false;
    } else {
      const count = webspeechRestartCountRef.current;
      if (count >= MAX_WEBSPEECH_RESTARTS) {
        addLog('info', `Web Speech API gagal ${count}x. Coba fallback ke Groq...`);
        switchToGroq();
        return;
      }
      webspeechRestartCountRef.current = count + 1;
      if (count > 0) addLog('info', `Web Speech API berhenti, restart #${count + 1}...`);
    }

    recognitionRef.current = null;

    webspeechRestartTimerRef.current = setTimeout(() => {
      if (manualStopRef.current || isStoppingRef.current || !isRecordingRef.current) return;
      const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognitionCtor) { switchToGroq(); return; }

      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'id-ID';
      recognition.maxAlternatives = 5;
      setupRecognitionGrammar(recognition);

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        hasReceivedResultRef.current = true;
        webspeechRestartCountRef.current = 0;

        if (noResultTimerRef.current) clearTimeout(noResultTimerRef.current);
        noResultTimerRef.current = setTimeout(() => {
          if (isRecordingRef.current && !manualStopRef.current && !isStoppingRef.current) {
            addLog('info', 'Web Speech: menunggu suara...');
          }
        }, NO_RESULT_TIMEOUT);

        let interim = '', finalText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            // Skip if this final result index was already appended to the transcript
            // (Chrome sometimes re-fires onresult with stale resultIndex, causing duplicates)
            if (processedFinalIdxRef.current.has(i)) continue;
            const best = pickBestAlternative(event.results[i]);
            if (best) {
              finalText += best;
              processedFinalIdxRef.current.add(i);
            }
          } else {
            const best = pickBestAlternative(event.results[i]);
            if (best) interim += best;
          }
        }
        if (finalText) {
          appendTranscript(finalText);
          // Auto-log unknown words to STT Failures table (D1) via fuzzy-correct
          logWebspeechFailures(finalText);
          addLog('success', `"${finalText.slice(0, 100)}${finalText.length > 100 ? '...' : ''}"`);
        }
        setInterimTranscript(interim);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'not-allowed') {
          addLog('error', 'Akses mikrofon ditolak.');
          setSttError('Akses mikrofon ditolak');
          setSttStatus('error');
          isRecordingRef.current = false;
          return;
        }
        if (event.error === 'no-speech') {
          lastErrorWasNoSpeechRef.current = true;
          return;
        }
        if (event.error === 'network') {
          addLog('info', 'Web Speech: error jaringan, akan restart...');
          return;
        }
        addLog('info', `Web Speech error: ${event.error}`);
      };

      recognition.onend = () => {
        restartWebSpeech();
      };

      try {
        // New recognition instance → fresh result array. Clear the processed-final
        // tracker so result indexes from this new session can be appended normally.
        processedFinalIdxRef.current.clear();
        recognition.start();
        recognitionRef.current = recognition;
      } catch (e) {
        console.error('[STT] restart failed:', e);
        switchToGroq();
      }
    }, WEBSPEECH_RESTART_DELAY);
  }, [addLog, setSttError, setSttStatus, appendTranscript, setInterimTranscript, switchToGroq, logWebspeechFailures]);



  // ── Entire Screen / System Audio Capture (audio-only transcript) ──
  const startScreenCapture = useCallback(async () => {
    try {
      addLog('info', 'Meminta akses screen share...');
      addLog('info', 'Pilih "Entire Screen" + centang "Share system audio" di picker.');

      // Step 1: Get display media (system audio + screen video)
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as MediaTrackConstraints,
      });

      // Check if system audio track exists
      const systemAudioTracks = displayStream.getAudioTracks();
      if (systemAudioTracks.length === 0) {
        addLog('error', 'System audio tidak tercapture. Pastikan centang "Share system audio" di picker.');
        // Stop video track since we won't use it
        displayStream.getTracks().forEach(t => t.stop());
        setSttError('System audio tidak tercapture. Ulangi dan centang "Share system audio".');
        setSttStatus('error');
        return;
      }

      addLog('success', 'System audio tercapture (suara dari Zoom/Meet/dll).');

      // Step 2: Get microphone (user's own voice)
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 44100,
          },
        });
        addLog('success', 'Microphone tercapture (suara kamu akan ikut direkam).');
      } catch (e) {
        addLog('error', 'Gagal akses mikrofon. Hanya system audio yang akan direkam.');
        console.warn('[STT] Mic access failed:', e);
      }

      // Step 3: Mix system audio + microphone via Web Audio API
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();

      // Connect system audio
      const systemSource = audioContext.createMediaStreamSource(new MediaStream(systemAudioTracks));
      const systemGain = audioContext.createGain();
      systemGain.gain.value = 1.0;  // Full volume for system audio
      systemSource.connect(systemGain).connect(destination);

      // Connect microphone (with slight gain reduction to prevent echo)
      if (micStream) {
        const micSource = audioContext.createMediaStreamSource(micStream);
        const micGain = audioContext.createGain();
        micGain.gain.value = 0.85;  // Slightly lower to balance
        micSource.connect(micGain).connect(destination);
      }

      // Step 4: Create audio-only stream from mixed destination
      const mixedAudioTracks = destination.stream.getAudioTracks();
      const audioOnlyStream = new MediaStream(mixedAudioTracks);

      // NOTE: Previously, video tracks were stopped here. We now KEEP them alive
      // for the OCR + frame-diff (CV) pipelines. They are stopped in stopAll()
      // when recording ends.
      // Start OCR + frame diff pipelines on the display stream
      void startScreenCv(displayStream);

      // Step 5: Store reference for cleanup
      // IMPORTANT: Store on a separate ref, not mediaStreamRef (which gets overwritten by startRecordingFromStream)
      const hybridCleanupRef = {
        __audioContext: audioContext,
        __displayStream: displayStream,
        __micStream: micStream,
        __destination: destination,
      };
      (mediaStreamRef.current as any) = hybridCleanupRef;

      addLog('info', 'Hybrid capture aktif: System Audio + Microphone di-mix real-time.');
      addLog('success', 'Audio aktif! Suara Zoom + suara kamu akan ditranskrip.');

      // Log audio track info for debugging
      console.log('[STT-Hybrid] audioOnlyStream tracks:', audioOnlyStream.getAudioTracks().length);
      console.log('[STT-Hybrid] mixedAudioTracks:', mixedAudioTracks);
      audioOnlyStream.getAudioTracks().forEach((t, i) => {
        console.log(`[STT-Hybrid] Track ${i}: enabled=${t.enabled}, muted=${t.muted}, readyState=${t.readyState}, settings=`, t.getSettings());
      });

      // Step 6: Start Groq live recorder (uses mediaRecorderRef)
      // Clone the stream so it doesn't conflict with whisper recorder
      const groqStream = new MediaStream(audioOnlyStream.getAudioTracks());
      startRecordingFromStream(groqStream, 'screen-capture');

      // Step 7: ALSO start whisper recorder (for final precision transcription)
      // Use a separate clone of the stream
      try {
        const whisperStream = new MediaStream(audioOnlyStream.getAudioTracks());
        const whisperMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        console.log('[STT-Hybrid] Starting whisper recorder, mimeType:', whisperMimeType);
        const whisperRecorder = new MediaRecorder(whisperStream, { mimeType: whisperMimeType });
        whisperRecorderRef.current = whisperRecorder;
        whisperChunksRef.current = [];

        whisperRecorder.ondataavailable = (e) => {
          console.log('[STT-Hybrid] Whisper chunk:', e.data.size, 'bytes');
          if (e.data.size > 0) whisperChunksRef.current.push(e.data);
        };

        whisperRecorder.onerror = (e) => {
          console.error('[STT-Hybrid] Whisper recorder error:', e);
          addLog('error', `Whisper recorder error: ${e.error?.name || 'unknown'}`);
        };

        whisperRecorder.onstart = () => {
          console.log('[STT-Hybrid] Whisper recorder started');
          addLog('info', 'Whisper recorder aktif — akan kirim audio ke faster-whisper saat stop.');
        };

        whisperRecorder.onstop = () => {
          console.log('[STT-Hybrid] Whisper recorder stopped. Total chunks:', whisperChunksRef.current.length);
        };

        // Request data every 10 seconds
        whisperRecorder.start(10000);
      } catch (e) {
        console.warn('[STT-Hybrid] Whisper recorder failed to start:', e);
        addLog('info', `Whisper recorder tidak aktif: ${e instanceof Error ? e.message : 'unknown'}`);
      }

      // Handle case where user stops sharing via browser UI
      displayStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        addLog('info', 'Screen share dihentikan via browser.');
        stopAll();
      });
    } catch (e) {
      addLog('error', 'Gagal capture system audio. Coba pilih "Entire Screen" di picker.');
      setSttError('Gagal mengakses screen share. Pastikan pilih "Entire Screen" dan centang "Share system audio".');
      setSttStatus('error');
      isRecordingRef.current = false;
    }
  }, [startRecordingFromStream, addLog, setSttError, setSttStatus, stopAll, startScreenCv]);

  // ── Web Speech API (PRIMARY STT) ──
  const tryStartWebSpeech = useCallback(
    (): Promise<boolean> => {
      return new Promise((resolve) => {
        if (!webspeechSupported) { resolve(false); return; }
        const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognitionCtor) { resolve(false); return; }

        const recognition = new SpeechRecognitionCtor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'id-ID';
        recognition.maxAlternatives = 5;
        setupRecognitionGrammar(recognition);

        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            addLog('error', 'Web Speech API: timeout saat start (5 detik). onstart tidak pernah di-call.');
            try { recognition.abort(); } catch {}
            resolve(false);
          }
        }, 5000);

        // ── Deep audio pipeline logging ──
        recognition.onaudiostart = () => { addLog('info', '[pipeline] onaudiostart — mic mulai mengirim audio ke browser'); };
        recognition.onsoundstart = () => { addLog('info', '[pipeline] onsoundstart — suara terdeteksi di mic'); };
        recognition.onspeechstart = () => { addLog('info', '[pipeline] onspeechstart — speech-like suara terdeteksi'); };
        recognition.onspeechend = () => { addLog('info', '[pipeline] onspeechend'); };
        recognition.onsoundend = () => { addLog('info', '[pipeline] onsoundend'); };
        recognition.onaudioend = () => { addLog('info', '[pipeline] onaudioend — mic audio berhenti'); };

        recognition.onstart = () => {
          clearTimeout(timeout);
          // New recognition instance → fresh result array. Clear the processed-final
          // tracker so result indexes from this new session can be appended normally.
          processedFinalIdxRef.current.clear();
          addLog('success', 'Web Speech API ONSTART — engine aktif');
          if (!resolved) {
            resolved = true;
            recognitionRef.current = recognition;
            setSttSource('webspeech');
            addLog('info', 'Mendengarkan... coba bicara sekarang.');
            resolve(true);
          }
        };

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          addLog('success', `[pipeline] ONRESULT! ${event.results.length} results`);
          hasReceivedResultRef.current = true;
          webspeechRestartCountRef.current = 0;

          if (noResultTimerRef.current) clearTimeout(noResultTimerRef.current);

          let interim = '', finalText = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              // Skip if this final result index was already appended to the transcript
              // (Chrome sometimes re-fires onresult with stale resultIndex, causing duplicates)
              if (processedFinalIdxRef.current.has(i)) continue;
              const best = pickBestAlternative(event.results[i]);
              if (best) {
                finalText += best;
                processedFinalIdxRef.current.add(i);
              }
            } else {
              const best = pickBestAlternative(event.results[i]);
              if (best) interim += best;
            }
          }
          if (finalText) {
            appendTranscript(finalText);
            // Auto-log unknown words to STT Failures table (D1) via fuzzy-correct
            logWebspeechFailures(finalText);
            addLog('success', `"${finalText.slice(0, 100)}${finalText.length > 100 ? '...' : ''}"`);
          }
          setInterimTranscript(interim);
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          clearTimeout(timeout);
          addLog('error', `[pipeline] ONERROR: ${event.error}`);
          if (event.error === 'not-allowed') {
            if (!resolved) { resolved = true; resolve(false); }
            addLog('error', 'Akses mikrofon ditolak oleh browser. Izinkan mic di address bar.');
            setSttError('Akses mikrofon ditolak');
            setSttStatus('error');
            isRecordingRef.current = false;
            return;
          }
          if (event.error === 'no-speech') {
            lastErrorWasNoSpeechRef.current = true;
            return;
          }
          if (event.error === 'aborted') return;
          addLog('info', `Web Speech error: ${event.error}`);
        };

        recognition.onend = () => {
          addLog('info', '[pipeline] ONEND — recognition berhenti');
          clearTimeout(timeout);
          if (isRecordingRef.current && !manualStopRef.current && !isStoppingRef.current && !skipWebspeechReconnectRef.current) {
            restartWebSpeech();
          }
        };

        console.log('[STT] Calling recognition.start()...');
        try {
          recognition.start();
        } catch (e) {
          clearTimeout(timeout);
          console.error('[STT] recognition.start() threw:', e);
          if (!resolved) {
            resolved = true;
            addLog('error', `Web Speech API gagal start: ${e}`);
            resolve(false);
          }
        }
      });
    },
    [webspeechSupported, setSttSource, appendTranscript, setInterimTranscript, setSttError, setSttStatus, restartWebSpeech, addLog, logWebspeechFailures]
  );

  // ── Start no-result timer — auto-switch to Groq if Web Speech produces nothing ──
  const startNoResultTimer = useCallback(() => {
    if (noResultTimerRef.current) clearTimeout(noResultTimerRef.current);
    noResultTimerRef.current = setTimeout(() => {
      if (isRecordingRef.current && !manualStopRef.current && !isStoppingRef.current && !hasReceivedResultRef.current) {
        addLog('info', `Web Speech API tidak menghasilkan teks dalam ${NO_RESULT_TIMEOUT / 1000} detik. Auto-switch ke Groq...`);
        switchToGroq();
      }
    }, NO_RESULT_TIMEOUT);
  }, [addLog, switchToGroq]);

  // ── Main start recording ──
  const startRecording = useCallback(async () => {
    isStoppingRef.current = false;
    manualStopRef.current = false;
    isRecordingRef.current = true;
    hasReceivedResultRef.current = false;
    lastErrorWasNoSpeechRef.current = false;
    skipWebspeechReconnectRef.current = false;
    webspeechRestartCountRef.current = 0;
    // Fresh recording session → clear processed-final tracker so result indexes
    // from any previous recording don't accidentally suppress new appends.
    processedFinalIdxRef.current.clear();
    setSttError('');
    setSttWarning('');
    setSttStatus('recording');
    setInterimTranscript('');
    setActivityLog([]);
    chunkCountRef.current = 0;

    // === UNIFIED FLOW for both mic & screen modes ===
    // Cross-device: Chrome, Safari, Firefox, Edge, mobile
    // 3-tier fallback: Web Speech API → Groq → Whisper lokal

    let micStream: MediaStream | null = null;
    let displayStream: MediaStream | null = null;

    // Helper: detect supported MediaRecorder mimeType
    const getSupportedMimeType = (): string => {
        const types = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/mp4',           // Safari iOS
          'audio/ogg;codecs=opus', // Firefox
          'audio/ogg',
        ];
        for (const t of types) {
          if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
        }
        return ''; // let browser choose default
    };

    // Helper: safe AudioContext (Safari uses webkitAudioContext)
    const createAudioContext = (): AudioContext => {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        return new AC();
    };

    // Step 1: If screen mode, get display media (system audio)
    // Note: getDisplayMedia NOT available on mobile browsers — only desktop
    if (sttAudioMode === 'screen' && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
      addLog('info', 'Mode: Entire Screen (System Audio + Mic hybrid)');
      addLog('info', 'Pilih "Entire Screen" + centang "Share system audio" di picker.');
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          } as MediaTrackConstraints,
        });
        const sysTracks = displayStream.getAudioTracks();
        if (sysTracks.length === 0) {
          addLog('error', 'System audio tidak tercapture. Pastikan centang "Share system audio".');
          displayStream.getTracks().forEach(t => t.stop());
          setSttError('System audio tidak tercapture. Ulangi dan centang "Share system audio".');
          setSttStatus('error');
          isRecordingRef.current = false;
          return;
        }
        addLog('success', 'System audio tercapture (suara Zoom/Meet/dll).');
        // Stop video tracks immediately
        displayStream.getVideoTracks().forEach(t => t.stop());
      } catch (e) {
        addLog('error', 'Gagal akses screen share.');
        setSttError('Gagal mengakses screen share.');
        setSttStatus('error');
        isRecordingRef.current = false;
        return;
      }
    } else {
      addLog('info', 'Mode: Mikrofon');
    }

    // Step 2: Get microphone (always required for Web Speech API + recording)
    // Enhanced audio constraints for noisy environments:
    //   - echoCancellation: removes echo from speakers
    //   - noiseSuppression: filters background noise (fans, AC, traffic)
    //   - autoGainControl: normalizes volume (whispers → audible, shouts → not clipped)
    //   - channelCount: 1 (mono — speech recognition works better with mono)
    // Feature-detect: Safari iOS rejects unknown constraints, so we fall back
    // to `audio: true` if any constraint is unsupported.
    try {
      // Try enhanced constraints first
      const enhancedConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
      };
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: enhancedConstraints,
        });
      } catch (constraintErr) {
        // Safari iOS / older browsers reject unknown constraints — fall back
        console.warn('[STT] Enhanced audio constraints rejected, falling back to default:', constraintErr);
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      mediaStreamRef.current = micStream;
      startVisualizer(micStream);
      addLog('success', 'Microphone aktif (noise suppression + echo cancellation ON).');
    } catch (e) {
      addLog('error', 'Gagal akses mikrofon: ' + (e instanceof Error ? e.message : 'unknown'));
      setSttError('Gagal mengakses mikrofon. Izinkan akses mic di browser.');
      setSttStatus('error');
      isRecordingRef.current = false;
      return;
    }

    // Step 3: Start Web Speech API as PRIMARY live transcription
    let webspeechStarted = false;
    if (webspeechSupported) {
      addLog('info', 'Memulai Web Speech API (live transcription)...');
      const success = await tryStartWebSpeech();
      if (success) {
        addLog('success', 'Web Speech API aktif! Bicara sekarang.');
        startNoResultTimer();
        webspeechStarted = true;

        // Mobile safety: set 5s timeout — if Web Speech doesn't produce results, auto-fallback to Groq
        // This catches: Safari iOS (Web Speech "starts" but onresult never fires)
        setTimeout(() => {
          if (isRecordingRef.current && !manualStopRef.current && !hasReceivedResultRef.current && !skipWebspeechReconnectRef.current) {
            addLog('info', 'Web Speech API tidak merespons dalam 5 detik. Beralih ke Groq/Whisper...');
            // Stop Web Speech
            if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} recognitionRef.current = null; }
            skipWebspeechReconnectRef.current = true;
            // Start Groq/Whisper fallback
            startRecordingFromStream(micStream!, 'groq');
          }
        }, 5000);
      } else {
        addLog('info', 'Web Speech API gagal start, fallback ke Groq API...');
      }
    } else {
      addLog('info', 'Browser tidak support Web Speech API. Menggunakan Groq API untuk live transcription.');
    }

    // Step 3b: FALLBACK — if Web Speech API not available, use Groq/whisper live transcription
    if (!webspeechStarted) {
      addLog('info', 'Memulai live transcription via Groq API...');
      skipWebspeechReconnectRef.current = true;
      startRecordingFromStream(micStream, 'groq');
    }

    // Step 4: Background recording for whisper final precision pass
    // Record BOTH mic + system audio (if available) by mixing via Web Audio API
    // Cross-browser: Safari iOS uses audio/mp4, Chrome uses audio/webm
    try {
      const audioContext = createAudioContext();
      const destination = audioContext.createMediaStreamDestination();

      // Always connect mic
      const micSource = audioContext.createMediaStreamSource(micStream);
      const micGain = audioContext.createGain();
      micGain.gain.value = 1.0;
      micSource.connect(micGain).connect(destination);

      // Connect system audio if available (screen mode)
      if (displayStream) {
        const sysTracks = displayStream.getAudioTracks();
        if (sysTracks.length > 0) {
          const sysSource = audioContext.createMediaStreamSource(new MediaStream(sysTracks));
          const sysGain = audioContext.createGain();
          sysGain.gain.value = 1.0;
          sysSource.connect(sysGain).connect(destination);
          addLog('info', 'Hybrid recording: mic + system audio di-mix untuk whisper final.');
        }
      }

      const mixedStream = new MediaStream(destination.stream.getAudioTracks());
      const wMime = getSupportedMimeType();
      const wRecorder = wMime
        ? new MediaRecorder(mixedStream, { mimeType: wMime })
        : new MediaRecorder(mixedStream);
      whisperRecorderRef.current = wRecorder;
      whisperChunksRef.current = [];
      wRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) whisperChunksRef.current.push(e.data);
      };
      wRecorder.start(5000); // collect chunks every 5s
      addLog('info', `Background recording aktif (${wMime || 'default format'}).`);

      // Store cleanup refs
      (mediaStreamRef.current as any).__hybridCleanup = {
        micStream,
        displayStream,
        audioContext,
        destination,
      };
    } catch (e) {
      console.warn('[STT] Background recording failed:', e);
      // Fallback: record mic only (no mixing)
      try {
        const wMime = getSupportedMimeType();
        const wRecorder = wMime
          ? new MediaRecorder(micStream, { mimeType: wMime })
          : new MediaRecorder(micStream);
        whisperRecorderRef.current = wRecorder;
        whisperChunksRef.current = [];
        wRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) whisperChunksRef.current.push(e.data);
        };
        wRecorder.start(5000);
        addLog('info', 'Background recording aktif (mic only).');
        (mediaStreamRef.current as any).__hybridCleanup = { micStream, displayStream };
      } catch (e2) {
        addLog('info', 'Background recording gagal, hanya live transcription yang aktif.');
      }
    }

    // Step 5: For screen mode, ALSO start system audio rolling recorder
    // Web Speech API can't capture system audio (Zoom/Meet/Discord) — only mic.
    // So we record system audio separately and transcribe via whisper-backend every 30s.
    if (sttAudioMode === 'screen' && displayStream) {
      const sysTracks = displayStream.getAudioTracks();
      if (sysTracks.length > 0) {
        const sysStream = new MediaStream(sysTracks);
        startSystemAudioRollingRecorder(sysStream);
        addLog('success', 'Sistem audio (Zoom/Meet/Discord) akan ditranskrip tiap 30 detik.');
      }
    }
  }, [sttAudioMode, webspeechSupported, tryStartWebSpeech, startNoResultTimer, startVisualizer, setSttError, setSttStatus, addLog, startSystemAudioRollingRecorder, startRecordingFromStream]);

  // ── Stop recording (public) ──
  const stopRecordingFn = useCallback(async () => {
    isStoppingRef.current = true;
    manualStopRef.current = true;
    isRecordingRef.current = false;
    setSttStatus('idle');
    setInterimTranscript('');
    setIsReconnecting(false);
    setSttWarning('');
    stopVisualizer();

    if (noResultTimerRef.current) { clearTimeout(noResultTimerRef.current); noResultTimerRef.current = null; }
    if (groqTimerRef.current) { clearInterval(groqTimerRef.current); groqTimerRef.current = null; }
    if (webspeechRestartTimerRef.current) { clearTimeout(webspeechRestartTimerRef.current); webspeechRestartTimerRef.current = null; }
    if (liveEnhanceTimerRef.current) { clearInterval(liveEnhanceTimerRef.current); liveEnhanceTimerRef.current = null; }

    // Stop whisper background recorder
    if (whisperRecorderRef.current && whisperRecorderRef.current.state !== 'inactive') {
      try { whisperRecorderRef.current.stop(); } catch {}
      whisperRecorderRef.current = null;
    }

    // Hybrid STT: if Web Speech was used AND we have whisper audio, send to faster-whisper
    if (sttSource === 'webspeech' && whisperChunksRef.current.length > 0) {
      const entries = useAppStore.getState().transcriptEntries;
      if (entries.length > 0) {
        addLog('info', 'Memperbaiki teks dengan faster-whisper...');
        setSttStatus('processing');
        const success = await sendToWhisperBackend();
        if (!success) {
          // Fallback: do LLM enhance if whisper fails
          const hasUnenhanced = lastEnhancedIdxRef.current < entries.length;
          if (hasUnenhanced) await enhanceNewEntries();
        }
        setSttStatus('idle');
      }
    } else if (sttSource === 'webspeech') {
      // No whisper audio, use LLM enhance as before
      const hasUnenhanced = lastEnhancedIdxRef.current < useAppStore.getState().transcriptEntries.length;
      if (hasUnenhanced) {
        setSttStatus('processing');
        await enhanceNewEntries();
        setSttStatus('idle');
      }
    }

    if ((sttSource === 'groq' || sttSource === 'screen-capture') && audioChunksRef.current.length > 0) {
      addLog('info', 'Memproses sisa audio terakhir...');
      setSttStatus('processing');
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      audioChunksRef.current = [];
      const text = await sendAudioToGroq(blob, chunkCountRef.current++);
      if (text?.trim()) appendTranscript(text.trim());
      setSttStatus('idle');
    }

    const finalLen = useAppStore.getState().transcript.length;
    addLog('info', `Recording dihentikan. Total: ${finalLen} karakter.`);

    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') { try { mediaRecorderRef.current.stop(); } catch {} mediaRecorderRef.current = null; }
    whisperChunksRef.current = [];
    if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach((t) => t.stop()); mediaStreamRef.current = null; }
  }, [sttSource, sendAudioToGroq, appendTranscript, setSttStatus, setInterimTranscript, setIsReconnecting, setSttWarning, stopVisualizer, enhanceNewEntries, sendToWhisperBackend, addLog]);

  const toggleRecording = useCallback(() => {
    if (sttStatus === 'recording' || sttStatus === 'processing') stopRecordingFn();
    else startRecording();
  }, [sttStatus, startRecording, stopRecordingFn]);

  // ── Register stop function to global STT controller ──
  // Allows the app header (or any other component) to stop recording without
  // being inside <STTPanel/>. Used by the global "Stop" button in the header
  // so the user can stop recording from any tab — not just the STT tab.
  useEffect(() => {
    registerSttStop(stopRecordingFn);
    return () => unregisterSttStop();
  }, [stopRecordingFn]);

  const clearTranscript = useCallback(() => {
    useAppStore.getState().setTranscript('');
    setInterimTranscript('');
    setActivityLog([]);
  }, [setInterimTranscript]);

  return {
    sttStatus, sttSource, transcript, interimTranscript,
    sttError: useAppStore((s) => s.sttError),
    isReconnecting, webspeechSupported,
    toggleRecording, startRecording, stopRecording: stopRecordingFn, clearTranscript,
    mediaStreamRef,
    activityLog, isGroqProcessing, isEnhancing, isWhisperProcessing, sttWarning,
    audioLevels,
    // Combined-method screen CV state
    screenCv: {
      isOcrProcessing: screenCvIsOcrProcessing,
      isModelLoading: screenCvIsModelLoading,
      modelProgress: screenCvModelProgress,
      lastOcrAt: screenCvLastOcrAt,
      lastSlideChangeAt: screenCvLastSlideChangeAt,
      slideChangeCount: screenCvSlideChangeCount,
      ocrChunkCount: screenCvOcrChunkCount,
      error: screenCvError,
    },
  };
}
