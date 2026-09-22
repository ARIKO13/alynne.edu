/**
 * use-whisper-stt.ts — Hook untuk client-side Whisper STT
 *
 * Replaces use-speech-recognition.ts (yang pakai Web Speech API).
 *
 * Flow:
 *   1. toggleRecording() → cek apakah model sudah di-load
 *      - Belum: open ModelSelector popup
 *      - Sudah: start recording
 *   2. Recording: MediaRecorder captures audio in 5s chunks
 *   3. Each chunk → decode to Float32Array → worker transcribe
 *   4. Hasil transkripsi langsung append ke transcript
 *   5. Stop recording → flush pending chunks → selesai
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  loadModel,
  transcribe,
  blobToFloat32Audio,
  isModelLoaded,
  getCurrentModel,
  setCallbacks,
  freeModel,
  autoLoadSavedModel,
  requestPersistentStorage,
  isStoragePersistent,
} from '@/lib/whisper-client';
import { getModel, getSavedModelId, WHISPER_MODELS } from '@/lib/whisper-models';

const CHUNK_DURATION_MS = 5000; // 5 detik per chunk
const SAMPLE_RATE = 16000;

export type WhisperSTTStatus = 'idle' | 'loading-model' | 'recording' | 'processing' | 'error';

export interface UseWhisperSTTOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onInterim?: (text: string) => void;
  onError?: (error: string) => void;
  onModelRequired?: () => void;  // Trigger popup model selector
}

export function useWhisperSTT(options: UseWhisperSTTOptions = {}) {
  const [status, setStatus] = useState<WhisperSTTStatus>('idle');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [modelId, setModelId] = useState<string | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const isRecordingRef = useRef(false);
  const pendingChunksRef = useRef<Float32Array[]>([]);
  const isProcessingRef = useRef(false);
  const sessionBufferRef = useRef<Float32Array>(new Float32Array(0));
  const ramCleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFinalTextRef = useRef<string>('');

  // Set callbacks on mount
  useEffect(() => {
    setCallbacks({
      onLoading: (progress) => setLoadProgress(progress),
      onLoaded: () => {
        setLoadProgress(100);
        setStatus('idle');
      },
      onError: (err, phase) => {
        setError(`${phase}: ${err}`);
        setStatus('error');
        options.onError?.(err);
      },
    });
  }, [options]);


  // ===== AUTO-LOAD SAVED MODEL + PERSISTENT STORAGE =====
  // Saat hook pertama kali jalan, coba auto-load model yang sudah tersaved
  // Silent: ga ubah UI kecuali model bener2 berhasil di-load
  // Timeout 15 detik: kalau lebih, anggap gagal (user bisa manual load via popup)
  const [isAutoLoading, setIsAutoLoading] = useState(false);
  const [storagePersistent, setStoragePersistent] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const initStorage = async () => {
      // 1. Request persistent storage (background, ga blocking)
      try {
        const persisted = await requestPersistentStorage();
        if (!cancelled) setStoragePersistent(persisted);
        console.log('[Whisper] Persistent storage:', persisted ? 'ACTIVE' : 'NOT GRANTED');

        if (!persisted) {
          const alreadyPersisted = await isStoragePersistent();
          if (!cancelled) setStoragePersistent(alreadyPersisted);
        }
      } catch (err) {
        console.warn('[Whisper] Persistent storage request failed:', err);
      }

      // 2. Cek apakah ada saved model di localStorage
      let savedId: string | null = null;
      try {
        savedId = localStorage.getItem('whisper-selected-model');
      } catch {
        return;
      }

      if (!savedId) {
        console.log('[Whisper] No saved model in localStorage - skip auto-load');
        return;
      }

      // 3. Cek apakah model masih ada di cache (quick check, ga download)
      // Pakai Promise.race dengan timeout 5 detik untuk isModelCached
      // Kalau cache check lambat, skip auto-load (jangan block UI)
      console.log('[Whisper] Checking cache for model:', savedId);

      // 4. Auto-load dengan timeout 15 detik total
      // Silent: ga set isAutoLoading true (jangan show Loading di UI)
      // Kalau timeout, user bisa manual load via popup
      const loadPromise = autoLoadSavedModel();
      const timeoutPromise = new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 15000);
      });

      try {
        const loaded = await Promise.race([loadPromise, timeoutPromise]);

        if (cancelled) return;

        if (loaded) {
          const hfId = getCurrentModel();
          const model = WHISPER_MODELS.find(m => m.hfId === hfId);
          if (model) {
            setModelId(model.id);
            console.log('[Whisper] Auto-loaded model from cache:', model.id);
          }
        } else {
          console.log('[Whisper] Auto-load skipped or timed out - user can manually load');
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[Whisper] Auto-load failed:', err);
        }
      }
    };

    initStorage();

    return () => {
      cancelled = true;
    };
  }, []);

  // Check current model on mount
  useEffect(() => {
    const checkModel = () => {
      if (isModelLoaded()) {
        const hfId = getCurrentModel();
        const model = WHISPER_MODELS.find(m => m.hfId === hfId);
        if (model) setModelId(model.id);
      }
    };
    checkModel();
    const interval = setInterval(checkModel, 1000);
    return () => clearInterval(interval);
  }, []);

  /**
   * Pastikan model sudah di-load sebelum recording.
   *
   * Flow:
   *   1. Kalau model sudah di RAM → return true (instant)
   *   2. Kalau ada saved model di localStorage → auto-load dari disk (instant, ga popup)
   *      - Ini yang membuat user "tinggal pakai" setelah download sekali
   *   3. Kalau belum pernah download → buka popup (first time only)
   */
  const ensureModelLoaded = useCallback(async (): Promise<boolean> => {
    // 1. Model sudah di RAM — siap pakai
    if (isModelLoaded()) return true;

    // 2. Cek localStorage — kalau user pernah download, auto-load dari disk
    let savedId: string | null = null;
    try {
      savedId = localStorage.getItem('whisper-selected-model');
    } catch {
      savedId = null;
    }

    if (savedId) {
      const model = getModel(savedId);
      if (model) {
        // Auto-load dari disk dengan timeout 60 detik
        try {
          setStatus('loading-model');
          setLoadProgress(0);
          console.log('[Whisper] Loading model from disk:', savedId);

          const loadPromise = loadModel(savedId);
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Timeout loading model (60s)')), 60000);
          });

          await Promise.race([loadPromise, timeoutPromise]);
          setModelId(savedId);
          setStatus('idle');
          console.log('[Whisper] Model loaded successfully');
          return true;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('[Whisper] Auto-load failed:', errMsg);
          setStatus('error');
          setError(`Gagal memuat model: ${errMsg}`);
          options.onError?.(`Gagal memuat model: ${errMsg}`);
          // Hapus saved model kalau corrupt
          try { localStorage.removeItem('whisper-selected-model'); } catch {}
          options.onModelRequired?.();
          return false;
        }
      }
    }

    // 3. Belum pernah download — buka popup (first time)
    console.log('[Whisper] No saved model — opening popup');
    options.onModelRequired?.();
    return false;
  }, [options]);

  /**
   * Start recording from microphone.
   */
  const startRecording = useCallback(async () => {
    setError(null);
    console.log('[Whisper] Start recording clicked');

    // Cancel pending RAM cleanup (user mau record lagi)
    if (ramCleanupTimerRef.current) {
      clearTimeout(ramCleanupTimerRef.current);
      ramCleanupTimerRef.current = null;
      console.log('[Whisper] Cancelled RAM cleanup — user starting recording again');
    }

    // Pastikan model loaded (kalau belum, auto-load dari disk)
    let ready: boolean;
    try {
      ready = await ensureModelLoaded();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[Whisper] ensureModelLoaded error:', errMsg);
      options.onError?.(`Error: ${errMsg}`);
      return;
    }
    if (!ready) {
      console.log('[Whisper] Model not ready — popup should be open');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
        },
      });
      mediaStreamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 16000,
      });
      mediaRecorderRef.current = recorder;

      chunksRef.current = [];
      sessionBufferRef.current = new Float32Array(0);
      lastFinalTextRef.current = '';
      isRecordingRef.current = true;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          // Process this chunk
          processChunk(e.data);
        }
      };

      recorder.onstop = () => {
        isRecordingRef.current = false;
        // Process remaining chunks
        flushPendingChunks();
      };

      // Capture in 5s chunks
      recorder.start(CHUNK_DURATION_MS);
      setStatus('recording');
    } catch (err) {
      setStatus('error');
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Microphone access failed: ${msg}`);
      options.onError?.(msg);
    }
  }, [ensureModelLoaded, options]);

  /**
   * Stop recording.
   * Setelah stop, model akan di-free dari RAM setelah 30 detik idle (auto-cleanup).
   * Model tetap tersimpan di disk (OPFS/CacheStorage) — tinggal load lagi saat user mau record lagi.
   */
  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (status === 'recording') {
      setStatus('processing');
    }

    // ===== AUTO-FREE RAM setelah 30 detik idle =====
    // Model tetap di disk (OPFS/IndexedDB), cuma RAM yang dibebaskan
    // User bisa start recording lagi kapan saja — model akan di-load ulang dari disk (instant, ~1-2 detik)
    if (ramCleanupTimerRef.current) {
      clearTimeout(ramCleanupTimerRef.current);
    }
    ramCleanupTimerRef.current = setTimeout(() => {
      console.log('[Whisper] 30s idle — freeing RAM (model tetap di disk)');
      freeModel();
      setModelId(null);
      // Reset status ke idle (bukan error)
      setStatus('idle');
    }, 30000);  // 30 detik
  }, [status]);

  /**
   * Toggle recording.
   */
  const toggleRecording = useCallback(() => {
    if (isRecordingRef.current) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [startRecording, stopRecording]);

  /**
   * Process a single audio chunk (Blob → Float32 → transcribe).
   */
  const processChunk = useCallback(async (blob: Blob) => {
    try {
      const audioData = await blobToFloat32Audio(blob);

      // Append to session buffer (untuk context whisper)
      const newBuffer = new Float32Array(sessionBufferRef.current.length + audioData.length);
      newBuffer.set(sessionBufferRef.current);
      newBuffer.set(audioData, sessionBufferRef.current.length);
      sessionBufferRef.current = newBuffer;

      pendingChunksRef.current.push(audioData);
      processQueue();
    } catch (err) {
      console.error('processChunk error:', err);
    }
  }, []);

  /**
   * Process pending chunks sequentially.
   */
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current) return;
    if (pendingChunksRef.current.length === 0) return;

    isProcessingRef.current = true;

    while (pendingChunksRef.current.length > 0) {
      const chunk = pendingChunksRef.current.shift()!;
      try {
        // Transcribe this chunk
        const result = await transcribe(chunk, 'indonesian');
        const text = result.text.trim();

        if (text) {
          // Interim update
          setInterimText(text);
          options.onInterim?.(text);

          // Final: append to transcript
          if (!isRecordingRef.current && pendingChunksRef.current.length === 0) {
            // Recording stopped + this is last chunk → final
            const finalText = (lastFinalTextRef.current + ' ' + text).trim();
            lastFinalTextRef.current = finalText;
            setInterimText('');
            options.onTranscript?.(text, true);
          } else {
            // Still recording → still interim
            options.onTranscript?.(text, false);
          }
        }
      } catch (err) {
        console.error('transcribe error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Transcription failed: ${msg}`);
      }
    }

    isProcessingRef.current = false;

    // If recording stopped and all chunks processed, set idle
    if (!isRecordingRef.current && status === 'processing') {
      setStatus('idle');
    }
  }, [options, status]);

  /**
   * Flush remaining chunks after stop.
   */
  const flushPendingChunks = useCallback(() => {
    if (pendingChunksRef.current.length > 0) {
      processQueue();
    } else if (status === 'processing') {
      setStatus('idle');
    }
  }, [processQueue, status]);

  /**
   * Transcribe a full File (upload mode).
   */
  const transcribeFile = useCallback(async (file: File): Promise<string> => {
    const ready = await ensureModelLoaded();
    if (!ready) throw new Error('Model not loaded');

    setStatus('processing');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      const decoded = await audioContext.decodeAudioData(arrayBuffer);
      audioContext.close();

      // Mix down to mono
      let channelData: Float32Array;
      if (decoded.numberOfChannels > 1) {
        channelData = new Float32Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) {
          let sum = 0;
          for (let c = 0; c < decoded.numberOfChannels; c++) {
            sum += decoded.getChannelData(c)[i];
          }
          channelData[i] = sum / decoded.numberOfChannels;
        }
      } else {
        channelData = decoded.getChannelData(0);
      }

      const result = await transcribe(channelData, 'indonesian');
      setStatus('idle');
      return result.text.trim();
    } catch (err) {
      setStatus('error');
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    }
  }, [ensureModelLoaded]);

  /**
   * Switch model (free current, load new).
   */
  const switchModel = useCallback(async (newModelId: string) => {
    setStatus('loading-model');
    setLoadProgress(0);
    try {
      // Free current model first
      if (isModelLoaded()) {
        freeModel();
      }
      await loadModel(newModelId);
      setModelId(newModelId);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /**
   * Reset state.
   */
  const reset = useCallback(() => {
    setStatus('idle');
    setInterimText('');
    setError(null);
    setLoadProgress(0);
  }, []);

  return {
    status,
    interimText,
    error,
    loadProgress,
    modelId,
    isAutoLoading,
    storagePersistent,
    isRecording: isRecordingRef.current,
    isModelLoaded: isModelLoaded(),
    toggleRecording,
    startRecording,
    stopRecording,
    transcribeFile,
    switchModel,
    reset,
  };
}
