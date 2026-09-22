/**
 * whisper-client.ts — Client-side Whisper STT manager
 *
 * Fitur:
 *   - Load model via Web Worker (tidak block UI)
 *   - Cache model di IndexedDB (sekali download, ga ulang)
 *   - Reuse worker untuk multiple transcribe sessions
 *   - Audio capture via MediaRecorder → decode → Float32Array → worker
 *   - Progress callback untuk UI feedback
 *   - Streaming: capture audio in 5s chunks, transcribe as they come
 */

import { getModel } from './whisper-models';

export type WorkerMessage =
  | { type: 'loading'; progress: number; model: string; file?: string }
  | { type: 'loaded'; model: string }
  | { type: 'transcribing'; progress: number; sessionId?: string }
  | { type: 'result'; text: string; chunks: any[]; sessionId?: string }
  | { type: 'error'; error: string; phase: string; sessionId?: string }
  | { type: 'freed' };

export type WorkerMessageType = WorkerMessage['type'];

interface WhisperClientOptions {
  onLoading?: (progress: number, file?: string) => void;
  onLoaded?: () => void;
  onTranscribing?: (progress: number) => void;
  onResult?: (text: string, chunks: any[]) => void;
  onError?: (error: string, phase: string) => void;
}

let worker: Worker | null = null;
let currentModelId: string | null = null;
let isLoading = false;
let loadingModel: string | null = null;
let loadingPromise: Promise<void> | null = null;
let pendingTranscriptions: Map<string, (text: string, chunks: any[]) => void> = new Map();
let pendingErrors: Map<string, (err: string) => void> = new Map();
let options: WhisperClientOptions = {};
let sessionIdCounter = 0;

function ensureWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(
    new URL('./whisper-worker.ts', import.meta.url),
    { type: 'module' }
  );

  worker.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
    const msg = e.data;
    switch (msg.type) {
      case 'loading':
        options.onLoading?.(msg.progress, msg.file);
        break;
      case 'loaded':
        isLoading = false;
        currentModelId = msg.model;
        options.onLoaded?.();
        break;
      case 'transcribing':
        options.onTranscribing?.(msg.progress);
        break;
      case 'result': {
        const resolve = pendingTranscriptions.get(msg.sessionId || '');
        if (resolve) {
          resolve(msg.text, msg.chunks);
          pendingTranscriptions.delete(msg.sessionId || '');
          pendingErrors.delete(msg.sessionId || '');
        }
        options.onResult?.(msg.text, msg.chunks);
        break;
      }
      case 'error': {
        if (msg.phase === 'transcribe') {
          const reject = pendingErrors.get(msg.sessionId || '');
          if (reject) {
            reject(msg.error);
            pendingTranscriptions.delete(msg.sessionId || '');
            pendingErrors.delete(msg.sessionId || '');
          }
        }
        options.onError?.(msg.error, msg.phase);
        break;
      }
      case 'freed':
        currentModelId = null;
        break;
    }
  });

  worker.addEventListener('error', (e) => {
    options.onError?.(e.message || 'Worker error', 'worker');
    isLoading = false;
  });

  return worker;
}

/**
 * Load Whisper model.
 * @param modelId One of: 'small' | 'medium' | 'large-turbo' | 'large-full'
 * @param inlineOpts Optional inline callbacks (merge with global options)
 */
export async function loadModel(
  modelId: string,
  inlineOpts?: WhisperClientOptions
): Promise<void> {
  const model = getModel(modelId);
  if (!model) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  // Already loaded → done
  if (currentModelId === model.hfId) {
    inlineOpts?.onLoaded?.();
    return;
  }

  // Same model is currently loading → WAIT for it (don't error)
  if (isLoading && loadingModel === model.hfId && loadingPromise) {
    console.log('[Whisper] Model already loading, waiting for it...');
    await loadingPromise;
    inlineOpts?.onLoaded?.();
    return;
  }

  // Different model loading → cancel it first, then load new one
  if (isLoading && loadingModel !== model.hfId) {
    console.log('[Whisper] Different model loading, aborting previous...');
    if (abortController) abortController.abort();
    // Wait a bit for abort to complete
    if (loadingPromise) {
      try { await loadingPromise; } catch {}
    }
  }

  isLoading = true;
  loadingModel = model.hfId;
  const w = ensureWorker();

  // Merge inline opts with global
  const mergedOpts: WhisperClientOptions = { ...options, ...inlineOpts };
  if (inlineOpts) {
    options = mergedOpts;
  }

  // Create loading promise that concurrent callers can wait on
  const loadPromise = new Promise<void>((resolve, reject) => {
    loadingPromise = loadPromise;
    const timeout = setTimeout(() => {
      reject(new Error('Model load timeout (10 min)'));
      isLoading = false;
    }, 10 * 60 * 1000);

    const originalOnLoaded = options.onLoaded;
    options.onLoaded = () => {
      clearTimeout(timeout);
      options.onLoaded = originalOnLoaded;
      originalOnLoaded?.();
      isLoading = false;
      loadingModel = null;
      loadingPromise = null;
      resolve();
    };

    const originalOnError = options.onError;
    options.onError = (err, phase) => {
      clearTimeout(timeout);
      options.onError = originalOnError;
      originalOnError?.(err, phase);
      isLoading = false;
      loadingModel = null;
      loadingPromise = null;
      reject(new Error(err));
    };

    w.postMessage({ type: 'load', model: model.hfId });
  });

  loadingPromise = loadPromise;
  return loadPromise;
}

/**
 * Transcribe audio buffer.
 * @param audio Float32Array PCM mono 16kHz
 * @param language BCP-47 language code (default: 'indonesian')
 * @returns { text, chunks }
 */
export async function transcribe(
  audio: Float32Array,
  language: string = 'indonesian'
): Promise<{ text: string; chunks: any[] }> {
  if (!currentModelId) {
    throw new Error('Model not loaded. Call loadModel() first.');
  }

  const w = ensureWorker();
  const sessionId = `s${++sessionIdCounter}`;

  return new Promise((resolve, reject) => {
    pendingTranscriptions.set(sessionId, (text, chunks) => resolve({ text, chunks }));
    pendingErrors.set(sessionId, (err) => reject(new Error(err)));

    // Transfer audio buffer (avoid copy)
    w.postMessage({ type: 'transcribe', audio, language, sessionId }, [audio.buffer]);
  });
}

/**
 * Free model from memory (untuk switch model atau release RAM).
 */
export function freeModel(): void {
  if (!worker) return;
  worker.postMessage({ type: 'free' });
  currentModelId = null;
}

/**
 * Cancel ongoing model download.
 * Worker akan abort fetch + cleanup.
 */
export function cancelLoad(): void {
  if (!worker) return;
  worker.postMessage({ type: 'cancel' });
  isLoading = false;
  // Reset callbacks yang di-take over sama loadModel
  options.onLoading?.(0);
  options.onLoaded = undefined;
  options.onError = undefined;
}

/**
 * Delete cached model dari IndexedDB + CacheStorage browser.
 * Berguna untuk hemat storage device.
 *
 * @param modelId ID model (e.g., 'small', 'large-turbo')
 * @returns true kalau ada yang dihapus
 */
export async function deleteModel(modelId: string): Promise<boolean> {
  const model = getModel(modelId);
  if (!model) return false;

  // Kalau model lagi di-load, cancel dulu
  if (isLoading) {
    cancelLoad();
  }

  // Kalau model ini lagi di-memory, free dulu
  if (currentModelId === model.hfId) {
    freeModel();
  }

  // Hapus dari cache storage
  let deleted = false;
  
  // Cache API
  if (typeof caches !== 'undefined') {
    try {
      const cacheList = await caches.keys();
      for (const cacheName of cacheList) {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        for (const req of keys) {
          const url = req.url.toLowerCase();
          if (url.includes(model.hfId.toLowerCase()) || 
              url.includes(model.hfId.split('/').pop()!.toLowerCase())) {
            await cache.delete(req);
            deleted = true;
          }
        }
      }
    } catch (e) {
      console.warn('Cache API delete failed:', e);
    }
  }

  // IndexedDB (transformers.js v2 pakai ini)
  if (typeof indexedDB !== 'undefined') {
    try {
      // transformers.js pakai DB name 'transformers-cache' dengan object store 'keyval'
      const dbReq = indexedDB.open('transformers-cache');
      await new Promise<void>((resolve) => {
        dbReq.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (db.objectStoreNames.contains('keyval')) {
            const tx = db.transaction('keyval', 'readwrite');
            const store = tx.objectStore('keyval');
            const allKeysReq = store.getAllKeys();
            allKeysReq.onsuccess = () => {
              const keys = allKeysReq.result as (string | number)[];
              for (const k of keys) {
                const keyStr = String(k);
                if (keyStr.toLowerCase().includes(model.hfId.toLowerCase())) {
                  store.delete(k);
                  deleted = true;
                }
              }
              db.close();
              resolve();
            };
            allKeysReq.onerror = () => {
              db.close();
              resolve();
            };
          } else {
            db.close();
            resolve();
          }
        };
        dbReq.onerror = () => resolve();
        dbReq.onupgradeneeded = () => resolve();
      });
    } catch (e) {
      console.warn('IndexedDB delete failed:', e);
    }
  }

  return deleted;
}

/**
 * Check apakah model tertentu sudah di-cache di browser.
 * Cek CacheStorage + IndexedDB (transformers.js pakai ini).
 */
export async function isModelCached(modelId: string): Promise<boolean> {
  const model = getModel(modelId);
  if (!model) return false;

  const hfIdLower = model.hfId.toLowerCase();
  const modelNameLower = model.hfId.split('/').pop()!.toLowerCase();

  // 1. Cek CacheStorage
  if (typeof caches !== 'undefined') {
    try {
      const cacheList = await caches.keys();
      for (const cacheName of cacheList) {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        for (const req of keys) {
          const url = req.url.toLowerCase();
          if (url.includes(hfIdLower) || url.includes(modelNameLower)) {
            return true;
          }
        }
      }
    } catch {}
  }

  // 2. Cek IndexedDB (transformers.js v2 pakai ini)
  if (typeof indexedDB !== 'undefined') {
    try {
      const result = await new Promise<boolean>((resolve) => {
        const dbReq = indexedDB.open('transformers-cache');
        dbReq.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (db.objectStoreNames.contains('keyval')) {
            const tx = db.transaction('keyval', 'readonly');
            const store = tx.objectStore('keyval');
            const allKeys = store.getAllKeys();
            (allKeys as IDBRequest).onsuccess = () => {
              const keys = (allKeys as IDBRequest).result as (string | number)[];
              for (const k of keys) {
                const keyStr = String(k).toLowerCase();
                if (keyStr.includes(hfIdLower) || keyStr.includes(modelNameLower)) {
                  resolve(true);
                  return;
                }
              }
              resolve(false);
            };
            (allKeys as IDBRequest).onerror = () => resolve(false);
          } else {
            resolve(false);
          }
          db.close();
        };
        dbReq.onerror = () => resolve(false);
        dbReq.onupgradeneeded = () => resolve(false);
      });
      if (result) return true;
    } catch {}
  }

  return false;
}

/**
 * Check if a model is currently loaded.
 */
export function isModelLoaded(): boolean {
  return currentModelId !== null;
}

/**
 * Get current loaded model HuggingFace ID.
 */
export function getCurrentModel(): string | null {
  return currentModelId;
}

/**
 * Set callbacks for events.
 */
export function setCallbacks(opts: WhisperClientOptions): void {
  options = { ...options, ...opts };
}

/**
 * Convert Blob (from MediaRecorder) to Float32Array PCM mono 16kHz.
 * Required format for Whisper.
 */
export async function blobToFloat32Audio(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await audioContext.decodeAudioData(arrayBuffer);
    // Mix down to mono
    let channelData: Float32Array;
    if (decoded.numberOfChannels > 1) {
      // Average all channels
      const allChannels: Float32Array[] = [];
      for (let i = 0; i < decoded.numberOfChannels; i++) {
        allChannels.push(decoded.getChannelData(i));
      }
      channelData = new Float32Array(allChannels[0].length);
      for (let i = 0; i < channelData.length; i++) {
        let sum = 0;
        for (let c = 0; c < allChannels.length; c++) {
          sum += allChannels[c][i];
        }
        channelData[i] = sum / allChannels.length;
      }
    } else {
      channelData = decoded.getChannelData(0);
    }
    return channelData;
  } finally {
    audioContext.close();
  }
}

/**
 * Convert File (audio upload) to Float32Array PCM mono 16kHz.
 */
export async function fileToFloat32Audio(file: File): Promise<Float32Array> {
  return blobToFloat32Audio(file);
}

/**
 * Record audio from MediaStream for a duration, return Float32Array.
 * Used for live STT.
 */
export async function recordForDuration(
  stream: MediaStream,
  durationMs: number
): Promise<Float32Array> {
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];

  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: mimeType });
        const audio = await blobToFloat32Audio(blob);
        resolve(audio);
      } catch (err) {
        reject(err);
      }
    };
    recorder.onerror = (e) => reject(e);

    recorder.start();
    setTimeout(() => {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    }, durationMs);
  });
}


/**
 * Request persistent storage dari browser.
 * Setelah granted, browser TIDAK akan auto-evict IndexedDB/CacheStorage
 * bahkan kalau storage mulai penuh.
 *
 * User data (model Whisper) akan persist forever di browser.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) {
    return false;
  }
  try {
    const isPersisted = await navigator.storage.persisted();
    if (isPersisted) {
      return true;
    }
    const granted = await navigator.storage.persist();
    return granted;
  } catch (err) {
    return false;
  }
}

/**
 * Cek apakah persistent storage sudah aktif.
 */
export async function isStoragePersistent(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persisted) {
    return false;
  }
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

/**
 * Cek estimasi storage yang tersedia di browser.
 */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number }> {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) {
    return { usage: 0, quota: 0 };
  }
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage || 0, quota: est.quota || 0 };
  } catch {
    return { usage: 0, quota: 0 };
  }
}

/**
 * Auto-load model yang sudah tersaved di localStorage.
 * Dipanggil saat app start untuk instant resume.
 *
 * Returns true kalau model berhasil di-load dari cache (instant, no download).
 */
export async function autoLoadSavedModel(): Promise<boolean> {
  // Cek dulu apakah model sudah di-memory
  if (isModelLoaded()) {
    return true;
  }

  // Cek localStorage untuk model ID yang tersaved
  try {
    const savedId = localStorage.getItem('whisper-selected-model');
    if (!savedId) {
      return false;
    }

    // Cek apakah model masih ada di cache (IndexedDB/CacheStorage)
    const cached = await isModelCached(savedId);
    if (!cached) {
      // Model hilang dari cache (mungkin user clear data), hapus localStorage
      localStorage.removeItem('whisper-selected-model');
      return false;
    }

    // Load model dari cache (instant, no download)
    await loadModel(savedId);
    return true;
  } catch (err) {
    return false;
  }
}
