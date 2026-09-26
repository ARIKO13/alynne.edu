/**
 * use-whisper-stt.ts — Hook untuk client-side Whisper STT
 *
 * Hybrid architecture:
 *   1. toggleRecording() → cek apakah model sudah di-load
 *      - Belum: open ModelSelector popup
 *      - Sudah: start recording
 *   2. Recording: MediaRecorder captures audio
 *   3. Stop recording → decode to Float32Array → whisper transcribe
 *   4. Result appended to transcript
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  loadModel as fgLoadModel,
  transcribe as fgTranscribe,
  freeModel as fgFreeModel,
  isModelLoaded as fgIsModelLoaded,
  getCurrentModel as fgGetCurrentModel,
  getSavedModelId as fgGetSavedModelId,
  getModel as fgGetModel,
  isModelCached as fgIsModelCached,
} from '@/lib/whisper-fugood';

const SAMPLE_RATE = 16000;

export type WhisperSTTStatus =
  | 'idle'
  | 'loading-model'
  | 'recording'
  | 'processing'
  | 'error';

export interface UseWhisperSTTOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onInterim?: (text: string) => void;
  onError?: (error: string) => void;
  onModelRequired?: () => void; // Trigger popup model selector
}

export function useWhisperSTT(options: UseWhisperSTTOptions = {}) {
  const [status, setStatus] = useState<WhisperSTTStatus>('idle');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [modelId, setModelId] = useState<string | null>(null);
  const [isAutoLoading, setIsAutoLoading] = useState(false);
  const [storagePersistent, setStoragePersistent] = useState(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const isRecordingRef = useRef(false);
  const ramCleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFinalTextRef = useRef<string>('');

  // ===== AUTO-LOAD SAVED MODEL + PERSISTENT STORAGE =====
  useEffect(() => {
    let cancelled = false;

    const initStorage = async () => {
      // 1. Request persistent storage (background, ga blocking)
      try {
        if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
          const persisted = await navigator.storage.persist();
          if (!cancelled) setStoragePersistent(persisted);
          console.log(
            '[Whisper] Persistent storage:',
            persisted ? 'ACTIVE' : 'NOT GRANTED'
          );
        }
      } catch (err) {
        console.warn('[Whisper] Persistent storage request failed:', err);
      }

      // 2. Cek apakah ada saved model di localStorage
      let savedId: string | null = null;
      try {
        savedId = fgGetSavedModelId();
      } catch {
        return;
      }

      if (!savedId) {
        console.log('[Whisper] No saved model in localStorage - skip auto-load');
        return;
      }

      // 3. Cek apakah model masih ada di cache (quick check, ga download)
      // CATATAN: Kami TIDAK auto-load di sini lagi. Auto-load di background
      // conflict dengan user-initiated download di ModelSelector (race condition
      // pada `isLoading` flag). Model akan di-load on-demand saat user klik
      // Record (lihat ensureModelLoaded).
      console.log('[Whisper] Saved model:', savedId, '- will load on-demand');
      try {
        const cached = await fgIsModelCached(savedId);
        if (cached) {
          console.log('[Whisper] Model is cached, will load when user records');
        } else {
          console.log('[Whisper] Model not in cache - user needs to re-download');
        }
      } catch {
        // Cache check failed — ignore, user can manually load
      }
    };

    initStorage();

    return () => {
      cancelled = true;
    };
  }, []);

  // Check current model on mount + periodically (untuk sync state dengan module-level)
  useEffect(() => {
    const checkModel = () => {
      if (fgIsModelLoaded()) {
        const current = fgGetCurrentModel();
        if (current && current !== modelId) {
          setModelId(current);
        }
      }
    };
    checkModel();
    const interval = setInterval(checkModel, 1000);
    return () => clearInterval(interval);
  }, [modelId]);

  /**
   * Pastikan model sudah di-load sebelum recording.
   *
   * Flow:
   *   1. Kalau model sudah di RAM → return true (instant)
   *   2. Kalau ada saved model di localStorage & di cache → auto-load dari disk
   *   3. Kalau belum pernah download → buka popup (first time only)
   */
  const ensureModelLoaded = useCallback(async (): Promise<boolean> => {
    // 1. Model sudah di RAM — siap pakai
    if (fgIsModelLoaded()) return true;

    // 2. Cek localStorage — kalau user pernah download, auto-load dari disk
    let savedId: string | null = null;
    try {
      savedId = fgGetSavedModelId();
    } catch {
      savedId = null;
    }

    if (savedId) {
      const model = fgGetModel(savedId);
      if (model) {
        // Cek cache dulu — kalau ga ada, jangan auto-download (user harus konfirmasi)
        try {
          const cached = await fgIsModelCached(savedId);
          if (!cached) {
            console.log(
              '[Whisper] Saved model not in cache - opening popup for re-download'
            );
            options.onModelRequired?.();
            return false;
          }
        } catch {
          // Cache check failed — proceed anyway
        }

        // Auto-load dari disk dengan timeout 60 detik
        try {
          setStatus('loading-model');
          setLoadProgress(0);
          console.log('[Whisper] Loading model from disk:', savedId);

          const loadPromise = fgLoadModel(savedId, (p) => setLoadProgress(p));
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error('Timeout loading model (60s)')),
              60000
            );
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
          try {
            localStorage.removeItem('whisper-fugood-model');
          } catch {}
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
   * Start recording — full audio capture (bukan chunk-by-chunk)
   *
   * Flow:
   *   1. Pastikan model loaded
   *   2. Start MediaRecorder (capture full audio ke 1 blob)
   *   3. Saat stop → decode full blob → transcribe → tampilkan
   */
  const startRecording = useCallback(async () => {
    setError(null);
    console.log('[Whisper] Start recording clicked');

    // Cancel pending RAM cleanup
    if (ramCleanupTimerRef.current) {
      clearTimeout(ramCleanupTimerRef.current);
      ramCleanupTimerRef.current = null;
    }

    let ready: boolean;
    try {
      ready = await ensureModelLoaded();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[Whisper] ensureModelLoaded error:', errMsg);
      options.onError?.('Error: ' + errMsg);
      return;
    }
    if (!ready) {
      console.log('[Whisper] Model not ready');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      mediaStreamRef.current = stream;
      console.log('[Whisper] Microphone stream acquired');

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      isRecordingRef.current = true;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        console.log('[Whisper] Recorder stopped, processing...');
        isRecordingRef.current = false;
        setStatus('processing');

        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
          mediaStreamRef.current = null;
        }

        if (chunksRef.current.length === 0) {
          console.warn('[Whisper] No audio chunks!');
          options.onError?.('Audio kosong');
          setStatus('idle');
          return;
        }

        const fullBlob = new Blob(chunksRef.current, { type: mimeType });
        console.log('[Whisper] Full audio:', fullBlob.size, 'bytes');

        try {
          const arrayBuffer = await fullBlob.arrayBuffer();
          const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
          const decoded = await audioContext.decodeAudioData(arrayBuffer);
          audioContext.close();

          let audioData: Float32Array;
          if (decoded.numberOfChannels > 1) {
            audioData = new Float32Array(decoded.length);
            for (let i = 0; i < decoded.length; i++) {
              let sum = 0;
              for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
                sum += decoded.getChannelData(ch)[i];
              }
              audioData[i] = sum / decoded.numberOfChannels;
            }
          } else {
            audioData = decoded.getChannelData(0);
          }

          // Resample jika perlu
          if (decoded.sampleRate !== SAMPLE_RATE) {
            console.log(
              '[Whisper] Resampling from',
              decoded.sampleRate,
              'to',
              SAMPLE_RATE
            );
            const ratio = decoded.sampleRate / SAMPLE_RATE;
            const newLen = Math.floor(audioData.length / ratio);
            const resampled = new Float32Array(newLen);
            for (let i = 0; i < newLen; i++) {
              const srcIdx = i * ratio;
              const f = Math.floor(srcIdx);
              const cl = Math.min(f + 1, audioData.length - 1);
              const frac = srcIdx - f;
              resampled[i] = audioData[f] * (1 - frac) + audioData[cl] * frac;
            }
            audioData = resampled;
          }

          // Clamp NaN/Infinity
          for (let i = 0; i < audioData.length; i++) {
            if (!isFinite(audioData[i])) audioData[i] = 0;
            if (audioData[i] > 1) audioData[i] = 1;
            if (audioData[i] < -1) audioData[i] = -1;
          }

          console.log(
            '[Whisper] Final audio:',
            audioData.length,
            'samples',
            (audioData.length / SAMPLE_RATE).toFixed(1) + 's'
          );

          if (audioData.length < SAMPLE_RATE * 0.5) {
            options.onError?.('Audio terlalu pendek');
            setStatus('idle');
            return;
          }

          console.log('[Whisper] Sending to Whisper...');
          const result = await fgTranscribe(audioData, 'id');
          const text = result.text.trim();
          console.log('[Whisper] Transcription:', text.substring(0, 100));

          if (text) {
            options.onTranscript?.(text, true);
          } else {
            options.onError?.('Transkripsi kosong');
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('[Whisper] Process error:', errMsg);
          options.onError?.('Gagal: ' + errMsg);
        } finally {
          setStatus('idle');
          // Auto-free model setelah 5 menit idle (hemat RAM)
          if (ramCleanupTimerRef.current) clearTimeout(ramCleanupTimerRef.current);
          ramCleanupTimerRef.current = setTimeout(() => {
            console.log('[Whisper] 5min idle - freeing RAM');
            fgFreeModel();
            setModelId(null);
          }, 5 * 60 * 1000);
        }
      };

      console.log('[Whisper] MediaRecorder state:', recorder.state);
      recorder.start(1000);
      console.log('[Whisper] MediaRecorder started, state:', recorder.state);
      setStatus('recording');
    } catch (err) {
      setStatus('error');
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Whisper] Start error:', msg);
      options.onError?.('Recording failed: ' + msg);
    }
  }, [ensureModelLoaded, options]);

  const stopRecording = useCallback(() => {
    console.log('[Whisper] Stop recording clicked');
    isRecordingRef.current = false;
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.requestData(); // Force dataavailable sebelum stop
      setTimeout(() => {
        if (
          mediaRecorderRef.current &&
          mediaRecorderRef.current.state !== 'inactive'
        ) {
          mediaRecorderRef.current.stop();
        }
      }, 200);
    }
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecordingRef.current) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [startRecording, stopRecording]);

  /**
   * Transcribe a full File (upload mode).
   */
  const transcribeFile = useCallback(
    async (file: File): Promise<string> => {
      let ready = true;
      try {
        if (!fgIsModelLoaded()) {
          const savedId = fgGetSavedModelId();
          console.log('[Whisper] Auto-loading from cache:', savedId);
          await fgLoadModel(savedId);
        }
        ready = fgIsModelLoaded();
      } catch (err) {
        console.warn('[Whisper] Auto-load failed:', err);
        ready = false;
      }
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

        const result = await fgTranscribe(channelData, 'id');
        setStatus('idle');
        return result.text.trim();
      } catch (err) {
        setStatus('error');
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      }
    },
    [ensureModelLoaded]
  );

  /**
   * Switch model (free current, load new).
   */
  const switchModel = useCallback(
    async (newModelId: string, onProgress?: (p: number) => void) => {
      setStatus('loading-model');
      setLoadProgress(0);
      try {
        // Free current model first
        if (fgIsModelLoaded()) {
          await fgFreeModel();
        }
        // Load new model
        await fgLoadModel(newModelId, onProgress);
        setModelId(newModelId);
        setStatus('idle');
        console.log('[Whisper] Switched to model:', newModelId);
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
        console.error('[Whisper] Switch model failed:', err);
      }
    },
    []
  );

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
    isModelLoaded: fgIsModelLoaded(),
    toggleRecording,
    startRecording,
    stopRecording,
    transcribeFile,
    switchModel,
    reset,
  };
}
