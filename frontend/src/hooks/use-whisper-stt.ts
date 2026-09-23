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
  loadModel as whisperCppLoadModel,
  transcribe as whisperCppTranscribe,
  freeModel as whisperCppFreeModel,
  isModelLoaded as whisperCppIsModelLoaded,
} from '@/lib/whisper-cpp-client';

// Re-export with different names for compatibility
const loadModel = whisperCppLoadModel;
const transcribe = whisperCppTranscribe;
const freeModel = whisperCppFreeModel;
const isModelLoaded = whisperCppIsModelLoaded;
const autoLoadSavedModel = async () => false;
const requestPersistentStorage = async () => false;
const isStoragePersistent = async () => false;
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
    // setCallbacks removed (not in whisper-cpp-client)
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
      const persisted = false; // requestPersistentStorage removed
        if (!cancelled) setStoragePersistent(persisted);
        console.log('[Whisper] Persistent storage:', persisted ? 'ACTIVE' : 'NOT GRANTED');

        if (!persisted) {
          const alreadyPersisted = false;
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
          const hfId = null;
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
        const hfId = null;
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
  /**
   * Start recording — full audio capture (bukan chunk-by-chunk)
   *
   * Flow:
   *   1. Pastikan model loaded
   *   2. Start MediaRecorder (capture full audio ke 1 blob)
   *   3. Saat stop → decode full blob → transcribe → tampilkan
   *
   * Kenapa bukan chunk real-time?
   *   - WebM/Opus chunks tiap 5s tidak punya valid WebM header
   *   - AudioContext.decodeAudioData gagal → EncodingError
   *   - Full blob punya valid header → decode sukses
   */
  /**
   * Start recording — pakai AudioWorklet (PCM direct, tanpa MediaRecorder)
   *
   * Kenapa AudioWorklet bukan MediaRecorder?
   *   - MediaRecorder capture WebM/Opus → AudioContext.decodeAudioData GAGAL (EncodingError)
   *   - AudioWorklet capture PCM Float32 langsung → ga perlu decode!
   *   - Bonus: 16kHz mono langsung (tanpa resample)
   *
   * Flow:
   *   1. Pastikan model loaded
   *   2. getUserMedia → AudioContext → AudioWorklet
   *   3. Capture PCM samples real-time (di worklet thread)
   *   4. Saat stop → combine samples → transcribe → tampilkan
   */
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const recordedSamplesRef = useRef<Float32Array | null>(null);

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
      // 1. getUserMedia
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
      console.log('[Whisper] Microphone stream acquired');

      // 2. Create AudioContext + load AudioWorklet
      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioContext;

      // Load worklet processor
      await audioContext.audioWorklet.addModule('/audio-recorder-worklet.js');
      console.log('[Whisper] AudioWorklet module loaded');

      // 3. Connect stream → AudioWorklet
      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, 'audio-recorder-processor');
      audioWorkletNodeRef.current = workletNode;

      // Listen for result saat stop
      workletNode.port.onmessage = async (e) => {
        if (e.data.type === 'result') {
          console.log('[Whisper] Got recorded samples:', e.data.data?.length || 0);

          // Process: transcribe
          setStatus('processing');
          try {
            let audioData = e.data.data as Float32Array;

            // ===== STEP 1: Validate basic =====
            if (!audioData || audioData.length === 0) {
              options.onError?.('Audio kosong — cek mikrofon');
              setStatus('idle');
              return;
            }

            // ===== STEP 2: Remove NaN/Infinity (causes OrtRun crash) =====
            let hasBadValues = false;
            for (let i = 0; i < audioData.length; i++) {
              if (!isFinite(audioData[i]) || isNaN(audioData[i])) {
                audioData[i] = 0;
                hasBadValues = true;
              }
            }
            if (hasBadValues) {
              console.warn('[Whisper] Audio had NaN/Infinity values — replaced with 0');
            }

            // ===== STEP 3: Get actual sample rate from AudioContext =====
            const actualSampleRate = audioContextRef.current?.sampleRate || SAMPLE_RATE;
            console.log(`[Whisper] Audio: ${audioData.length} samples @ ${actualSampleRate}Hz`);

            // ===== STEP 4: Resample ke 16kHz kalau perlu =====
            if (actualSampleRate !== SAMPLE_RATE) {
              console.log(`[Whisper] Resampling from ${actualSampleRate}Hz to ${SAMPLE_RATE}Hz`);
              const ratio = actualSampleRate / SAMPLE_RATE;
              const newLength = Math.floor(audioData.length / ratio);
              const resampled = new Float32Array(newLength);
              for (let i = 0; i < newLength; i++) {
                const srcIdx = i * ratio;
                const srcIdxFloor = Math.floor(srcIdx);
                const srcIdxCeil = Math.min(srcIdxFloor + 1, audioData.length - 1);
                const frac = srcIdx - srcIdxFloor;
                // Linear interpolation
                resampled[i] = audioData[srcIdxFloor] * (1 - frac) + audioData[srcIdxCeil] * frac;
              }
              audioData = resampled;
              console.log(`[Whisper] Resampled: ${audioData.length} samples @ ${SAMPLE_RATE}Hz`);
            }

            // ===== STEP 5: Validate length (min 0.5s = 8000 samples) =====
            if (audioData.length < SAMPLE_RATE * 0.5) {
              console.warn(`[Whisper] Audio too short: ${audioData.length} samples`);
              options.onError?.('Audio terlalu pendek (min 0.5 detik) — coba bicara lebih lama');
              setStatus('idle');
              return;
            }

            // ===== STEP 6: Check amplitude =====
            let maxAmp = 0;
            for (let i = 0; i < audioData.length; i++) {
              const abs = Math.abs(audioData[i]);
              if (abs > maxAmp) maxAmp = abs;
            }
            console.log(`[Whisper] Max amplitude: ${maxAmp}`);

            if (maxAmp === 0) {
              options.onError?.('Audio kosong (tidak ada suara) — cek mikrofon');
              setStatus('idle');
              return;
            }

            // Normalize kalau amplitude terlalu kecil (< 0.1)
            if (maxAmp < 0.1) {
              const scale = 1 / maxAmp;
              const normalized = new Float32Array(audioData.length);
              for (let i = 0; i < audioData.length; i++) {
                normalized[i] = Math.max(-1, Math.min(1, audioData[i] * scale));
              }
              audioData = normalized;
              console.log('[Whisper] Audio normalized (amplitude was too low)');
            }

            // ===== STEP 7: Clamp values to [-1, 1] (Whisper requirement) =====
            for (let i = 0; i < audioData.length; i++) {
              if (audioData[i] > 1) audioData[i] = 1;
              if (audioData[i] < -1) audioData[i] = -1;
            }

            console.log(`[Whisper] Final audio: ${audioData.length} samples (${(audioData.length / SAMPLE_RATE).toFixed(1)}s)`);

            // ===== STEP 8: Transcribe =====
            // Copy audio karena transcribe akan transfer buffer ke worker
            // Copy audio karena transcribe akan transfer buffer ke worker
            const audioCopy = new Float32Array(audioData);
            const result = await transcribe(audioCopy, 'indonesian');
            const text = result.text.trim();
            console.log(`[Whisper] Transcription: "${text.substring(0, 100)}..."`);

            if (text) {
              options.onTranscript?.(text, true);
            } else {
              options.onError?.('Transkripsi kosong — coba bicara lebih jelas');
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error('[Whisper] Transcribe error:', errMsg);
            if (errMsg.includes('OrtRun') || errMsg.includes('error code = 1') || errMsg.includes('offset')) {
              options.onError?.('Model error — coba pakai model Small atau download ulang');
            } else {
              options.onError?.(`Gagal transkripsi: ${errMsg}`);
            }
          } finally {
            setStatus('idle');
            if (ramCleanupTimerRef.current) clearTimeout(ramCleanupTimerRef.current);
            ramCleanupTimerRef.current = setTimeout(() => {
              console.log('[Whisper] 30s idle — freeing RAM');
              freeModel();
              setModelId(null);
            }, 30000);
          }
        }
      };

      // 4. Start recording
      workletNode.port.postMessage({ type: 'start' });
      source.connect(workletNode);
      // Note: tidak connect ke destination (no echo/playback)

      isRecordingRef.current = true;
      setStatus('recording');
      console.log('[Whisper] Recording started (AudioWorklet PCM)');
    } catch (err) {
      setStatus('error');
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Whisper] Start recording error:', msg);
      setError(`Recording failed: ${msg}`);
      options.onError?.(`Recording failed: ${msg}`);
    }
  }, [ensureModelLoaded, options]);

  /**
   * Stop recording.
   * Setelah stop, full audio akan di-transcribe (di onstop handler).
   */
  const stopRecording = useCallback(() => {
    console.log('[Whisper] Stop recording clicked');
    isRecordingRef.current = false;

    // Signal worklet to stop + send result
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.postMessage({ type: 'stop' });
    }

    // Disconnect + close audio context
    setTimeout(() => {
      if (audioWorkletNodeRef.current) {
        audioWorkletNodeRef.current.disconnect();
        audioWorkletNodeRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
      }
    }, 100);  // small delay to let worklet send result
  }, []);

  /**
   * Toggle recording (start/stop).
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
   * Deprecated: sekarang pakai full-blob approach di onstop handler.
   * Tetap ada untuk backward compatibility (kalau dipanggil dari kode lain).
   */
  const processChunk = useCallback(async (blob: Blob) => {
    // No-op: full audio diproses di onstop handler
    console.log('[Whisper] processChunk called (no-op, full blob processed at stop)');
  }, []);

  /**
   * Process pending chunks sequentially.
   * Deprecated: sekarang pakai full-blob approach.
   */
  const processQueue = useCallback(async () => {
    // No-op: full audio diproses di onstop handler
  }, []);

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
