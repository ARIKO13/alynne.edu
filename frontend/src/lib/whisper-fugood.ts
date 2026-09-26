/**
 * whisper-fugood.ts — Client-side Whisper via @fugood/whisper.node
 *
 * Pre-built whisper.cpp WASM yang dioptimasi untuk browser.
 * - Auto-fallback single-thread kalau tidak ada SharedArrayBuffer
 * - Cache model di browser Cache Storage (key: whisper.node.wasm.models)
 * - Module Worker (UI tetap responsive)
 * - Model di-serve LOKAL dari /models/ (no CORS/network issues)
 * - Real progress tracking via pre-fetch
 * - Cancel download via AbortController
 */

import {
  configureWasm,
  initWhisper,
  toggleNativeLog,
  addNativeLogListener,
} from '@fugood/whisper.node';

// ===== WASM CONFIG + NATIVE LOGGING =====
// Configure once at module load (browser only)
//
// WASM_VERSION: bump this when replacing WASM files to bust browser cache.
// The browser caches WASM files aggressively (even with max-age=0, Web Workers
// may reuse cached versions). Appending ?v=N forces a fresh fetch.
const WASM_VERSION = 'v113';
if (typeof window !== 'undefined') {
  const isCrossOriginIsolated =
    typeof window.crossOriginIsolated === 'boolean' && window.crossOriginIsolated;
  configureWasm({
    worker: true,
    threads: isCrossOriginIsolated && typeof SharedArrayBuffer !== 'undefined',
    jsPath: `/whisper-fugood/whisper-node.js?${WASM_VERSION}`,
    wasmPath: `/whisper-fugood/whisper-node.wasm?${WASM_VERSION}`,
    threadsJsPath: `/whisper-fugood/whisper-node.threads.js?${WASM_VERSION}`,
    threadsWasmPath: `/whisper-fugood/whisper-node.threads.wasm?${WASM_VERSION}`,
    workerPath: `/whisper-fugood/worker.js?${WASM_VERSION}`,
  });

  // Enable native log forwarding (worker → main thread → console)
  // This captures whisper.cpp internal logs (WHISPER_LOG_INFO/ERROR/etc)
  // which are critical for debugging model load failures.
  try {
    toggleNativeLog(true);
    addNativeLogListener((level: string, text: string) => {
      const tag = `[Whisper-Native ${level.toUpperCase()}]`;
      if (level === 'error') {
        console.error(tag, text);
      } else if (level === 'warn') {
        console.warn(tag, text);
      } else {
        console.log(tag, text);
      }
    });
    console.log('[Whisper-Fugood] Native log forwarding enabled');
  } catch (err) {
    console.warn('[Whisper-Fugood] Failed to enable native log forwarding:', err);
  }
}

// ===== MODEL DEFINITIONS =====
export interface FugoodModel {
  id: string;
  name: string;
  /** Local URL — served from /models/ */
  url: string;
  sizeMB: number;
  category: 'unquantized' | 'quantized';
  type: 'unquantized' | 'q5_0' | 'q5_1';
  description: string;
  ramMB: number;
  speedX: string;
  accuracyRange: string;
  recommendedFor: string;
}

export const FUGOOD_MODELS: FugoodModel[] = [
  {
    id: 'tiny',
    name: 'Tiny',
    category: 'unquantized',
    type: 'unquantized',
    description:
      'Model paling ringan TANPA kuantisasi. Cepat, akurasi dasar untuk Bahasa Indonesia.',
    ramMB: 350,
    speedX: '5-10x realtime',
    accuracyRange: '65-75%',
    recommendedFor: 'HP jadul, RAM minimal 1GB',
    url: '/models/ggml-tiny.bin',
    sizeMB: 75,
  },
  {
    id: 'base',
    name: 'Base',
    category: 'unquantized',
    type: 'unquantized',
    description:
      'Model Base TANPA kuantisasi. Akurasi menengah untuk Bahasa Indonesia.',
    ramMB: 500,
    speedX: '3-5x realtime',
    accuracyRange: '72-82%',
    recommendedFor: 'HP entry-level, RAM 1.5GB+',
    url: '/models/ggml-base.bin',
    sizeMB: 142,
  },
  {
    id: 'small-q5_1',
    name: 'Small (Q5_1)',
    category: 'quantized',
    type: 'q5_1',
    description:
      'Model Small dengan kuantisasi Q5_1. Balance akurasi dan ukuran. Cocok untuk HP modern.',
    ramMB: 800,
    speedX: '1.5-2x realtime',
    accuracyRange: '82-88%',
    recommendedFor: 'HP modern, RAM 2GB+',
    url: '/models/ggml-small-q5_1.bin',
    sizeMB: 182,
  },
  {
    id: 'large-v3-turbo-q5_0',
    name: 'Large v3 Turbo (Q5_0)',
    category: 'quantized',
    type: 'q5_0',
    description:
      'Model terbaik untuk Bahasa Indonesia. Cepat (turbo) dan akurat.',
    ramMB: 900,
    speedX: '1-2x realtime',
    accuracyRange: '88-96%',
    recommendedFor: 'PC/laptop modern (RAM 4GB+) — RECOMMENDED',
    url: '/models/ggml-large-v3-turbo-q5_0.bin',
    sizeMB: 548,
  },
  {
    id: 'large-v3-q5_0',
    name: 'Large v3 (Q5_0)',
    category: 'quantized',
    type: 'q5_0',
    description:
      'Model terbesar dan paling akurat. Untuk akurasi maksimal.',
    ramMB: 2500,
    speedX: '0.3-0.5x realtime',
    accuracyRange: '90-97%',
    recommendedFor: 'PC high-end (RAM 8GB+)',
    url: '/models/ggml-large-v3-q5_0.bin',
    sizeMB: 1100,
  },
];

// ===== STATE =====
const CACHE_NAME = 'whisper.node.wasm.models';
const STORAGE_KEY = 'whisper-fugood-model';

let whisperInstance: any = null;
let currentModelId: string | null = null;
let isLoading = false;
let abortController: AbortController | null = null;

// ===== HELPERS =====
export function getModel(id: string): FugoodModel | undefined {
  return FUGOOD_MODELS.find((m) => m.id === id);
}

/**
 * Forcibly reset the loading flag. Use this before starting a new user-initiated
 * load, in case a previous auto-load or failed load left `isLoading` stuck.
 *
 * This does NOT cancel an in-flight initWhisper call (which can't really be
 * cancelled) — it just unblocks the next loadModel call so the user can retry.
 *
 * If an in-flight loadModel eventually completes, its result will be silently
 * applied to whisperInstance, which is acceptable (user can always re-load).
 */
export function forceResetLoading(): void {
  if (abortController) {
    try {
      abortController.abort();
    } catch {}
    abortController = null;
  }
  isLoading = false;
  console.log('[Whisper-Fugood] Loading state forcibly reset');
}

export function isModelLoaded(): boolean {
  return whisperInstance !== null;
}

export function getCurrentModel(): string | null {
  return currentModelId;
}

export function getSavedModelId(): string {
  if (typeof localStorage === 'undefined') return 'tiny';
  return localStorage.getItem(STORAGE_KEY) || 'tiny';
}

export function saveModelId(id: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, id);
}

/**
 * Resolve model.url ke absolute URL (untuk cache key yang konsisten
 * dengan @fugood/whisper.node internals).
 */
function getModelCacheKey(model: FugoodModel): string {
  if (typeof window === 'undefined') return model.url;
  try {
    return new URL(model.url, window.location.href).href;
  } catch {
    return model.url;
  }
}

// ===== CACHE MANAGEMENT =====

/**
 * Cek apakah model sudah tersimpan di Cache Storage browser.
 * (Tidak cek apakah model sudah di-load ke WASM memory.)
 */
export async function isModelCached(modelId: string): Promise<boolean> {
  const model = getModel(modelId);
  if (!model) return false;
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const key = getModelCacheKey(model);
    const response = await cache.match(key);
    return !!response;
  } catch {
    return false;
  }
}

/**
 * Hapus model dari Cache Storage. Kalau model sedang di-load ke memory,
 * juga release dari memory.
 */
export async function deleteModel(modelId: string): Promise<boolean> {
  const model = getModel(modelId);
  if (!model) return false;

  // Kalau ini model yang sedang aktif di memory, free dulu
  if (currentModelId === modelId && whisperInstance) {
    try {
      await whisperInstance.release();
    } catch {}
    whisperInstance = null;
    currentModelId = null;
  }

  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const key = getModelCacheKey(model);
    const deleted = await cache.delete(key);
    console.log('[Whisper-Fugood] Deleted model from cache:', modelId, deleted);
    return deleted;
  } catch {
    return false;
  }
}

// ===== PRE-FETCH WITH PROGRESS =====

/**
 * Pre-fetch model dari /models/ ke Cache Storage dengan progress tracking.
 * Setelah pre-fetch, initWhisper akan langsung ambil dari cache (instant).
 */
async function prefetchModel(
  model: FugoodModel,
  onProgress?: (p: number) => void
): Promise<void> {
  const url = getModelCacheKey(model);

  // 1. Cek cache dulu — kalau ada, skip download
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) {
        console.log('[Whisper-Fugood] Model found in cache:', url);
        onProgress?.(100);
        return;
      }
    } catch {}
  }

  // 2. Fetch dengan progress
  console.log('[Whisper-Fugood] Downloading model:', url);
  abortController = new AbortController();

  // Use cache: 'no-cache' to always revalidate with server (avoids stale
  // cached model from previous deployments)
  const response = await fetch(url, {
    signal: abortController.signal,
    cache: 'no-cache',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} — ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      received += value.byteLength;
      if (contentLength > 0) {
        onProgress?.((received / contentLength) * 100);
      } else {
        // No content-length — show indeterminate progress (received MB)
        onProgress?.(Math.min(95, (received / (model.sizeMB * 1024 * 1024)) * 100));
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  // 3. Combine chunks
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  if (total === 0) throw new Error('Downloaded 0 bytes — model file empty');

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // 4. Simpan ke Cache Storage dengan key yang sama dengan @fugood/whisper.node internals
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = new Response(buffer, {
        headers: { 'content-type': 'application/octet-stream' },
      });
      await cache.put(url, cachedResponse);
      console.log('[Whisper-Fugood] Model cached:', url, '(' + total + ' bytes)');
    } catch (err) {
      console.warn('[Whisper-Fugood] Cache write failed (non-fatal):', err);
    }
  }

  onProgress?.(100);
  abortController = null;
}

// ===== CANCEL =====

/**
 * Cancel download yang sedang berjalan. Tidak bisa cancel kalau model
 * sudah masuk ke fase initWhisper (setelah download selesai).
 */
export function cancelLoad(): void {
  if (abortController) {
    console.log('[Whisper-Fugood] Cancelling download...');
    abortController.abort();
    abortController = null;
  }
  isLoading = false;
}

// ===== LOAD MODEL =====

export async function loadModel(
  modelId: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const model = getModel(modelId);
  if (!model) throw new Error('Unknown model: ' + modelId);

  if (currentModelId === modelId && whisperInstance) {
    return; // sudah loaded
  }

  if (isLoading) {
    throw new Error('Another model is loading');
  }

  isLoading = true;

  try {
    // 1. Release previous model
    if (whisperInstance) {
      try {
        await whisperInstance.release();
      } catch {}
      whisperInstance = null;
      currentModelId = null;
    }

    console.log('[Whisper-Fugood] Loading model:', model.name, '(', model.sizeMB, 'MB )');

    // 2. Pre-fetch model dengan progress tracking
    await prefetchModel(model, onProgress);

    // 3. Init whisper — akan ambil model dari cache (instant)
    //    Pakai absolute URL agar cache key konsisten
    const modelUrl = getModelCacheKey(model);
    console.log('[Whisper-Fugood] Initializing WASM with model URL:', modelUrl);

    // Verify cache contents before init
    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(CACHE_NAME);
        const cachedResp = await cache.match(modelUrl);
        if (cachedResp) {
          const cachedSize = Number(cachedResp.headers.get('content-length') || 0);
          const actualSize = (await cachedResp.clone().arrayBuffer()).byteLength;
          console.log(
            '[Whisper-Fugood] Cache verify: key=' + modelUrl,
            'declared=' + cachedSize,
            'actual=' + actualSize,
            'expected~=' + (model.sizeMB * 1024 * 1024)
          );
        } else {
          console.error('[Whisper-Fugood] Model NOT in cache after prefetch!');
        }
      } catch (e) {
        console.warn('[Whisper-Fugood] Cache verify failed:', e);
      }
    }

    console.log('[Whisper-Fugood] Calling initWhisper... (watch native logs above/below)');

    try {
      whisperInstance = await initWhisper({
        filePath: modelUrl,
        useGpu: false,
        maxModelBytes: 2 * 1024 * 1024 * 1024, // 2GB limit (aman untuk large-v3 1.1GB)
        cacheModel: true,
      });
      console.log('[Whisper-Fugood] initWhisper returned successfully');
    } catch (initErr) {
      console.error('[Whisper-Fugood] initWhisper FAILED:', initErr);
      // Kalau init gagal, mungkin cache korup. Hapus cache & retry sekali.
      console.warn('[Whisper-Fugood] Clearing cache and retrying once...');
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.delete(modelUrl);
      } catch {}
      // Re-fetch + re-init
      await prefetchModel(model, onProgress);
      whisperInstance = await initWhisper({
        filePath: modelUrl,
        useGpu: false,
        maxModelBytes: 2 * 1024 * 1024 * 1024,
        cacheModel: true,
      });
    }

    currentModelId = modelId;
    saveModelId(modelId);
    isLoading = false;
    abortController = null;
    console.log('[Whisper-Fugood] Model loaded successfully:', model.name);
  } catch (err) {
    isLoading = false;
    abortController = null;
    console.error('[Whisper-Fugood] Load error:', err);
    throw err;
  }
}

// ===== TRANSCRIBE =====

export async function transcribe(
  audio: Float32Array,
  language: string = 'id'
): Promise<{ text: string }> {
  if (!whisperInstance) {
    throw new Error('Model not loaded');
  }

  console.log('[Whisper-Fugood] Transcribing:', audio.length, 'samples');

  try {
    const wavBlob = float32ToWavBlob(audio);
    console.log('[Whisper-Fugood] WAV blob:', wavBlob.size, 'bytes');

    const url = URL.createObjectURL(wavBlob);
    try {
      const { promise } = whisperInstance.transcribeFile(url, {
        language,
        maxThreads:
          typeof SharedArrayBuffer !== 'undefined' &&
          typeof window !== 'undefined' &&
          window.crossOriginIsolated === true
            ? 4
            : 1,
        temperature: 0,
      });

      // Timeout 5 menit
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('Transcribe timeout (5 min)')),
          5 * 60 * 1000
        );
      });

      const result = await Promise.race([promise, timeoutPromise]);
      console.log(
        '[Whisper-Fugood] Raw result:',
        JSON.stringify(result).substring(0, 500)
      );

      const text = result?.text?.trim() || result?.result?.trim() || '';
      console.log('[Whisper-Fugood] Final text:', text.substring(0, 200));
      return { text };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.error('[Whisper-Fugood] Transcribe error:', err);
    throw err;
  }
}

// ===== FREE =====

export async function freeModel(): Promise<void> {
  if (whisperInstance) {
    try {
      await whisperInstance.release();
    } catch {}
    whisperInstance = null;
    currentModelId = null;
    console.log('[Whisper-Fugood] Model freed');
  }
}

// ===== WAV CONVERSION =====

const SAMPLE_RATE = 16000;

function float32ToWavBlob(samples: Float32Array): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const bufferSize = 44 + dataSize;

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
