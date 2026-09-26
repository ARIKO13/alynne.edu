/**
 * whisper-fugood.ts - Hybrid Whisper dispatcher
 *
 * - Tiny & Small: client-side via Web Worker (transformers.js ONNX q8)
 * - Large Turbo & Large v3: server-side proxy (faster-whisper backend)
 *
 * API compatible across both modes.
 */

// ===== MODEL DEFINITIONS =====
export interface FugoodModel {
  id: string;
  name: string;
  url: string;
  sizeMB: number;
  category: 'unquantized' | 'quantized';
  type: 'unquantized' | 'q5_0' | 'q5_1' | 'q8';
  description: string;
  ramMB: number;
  speedX: string;
  accuracyRange: string;
  recommendedFor: string;
  /** 'client' = runs in browser Web Worker, 'server' = sent to backend */
  runtime: 'client' | 'server';
}

export const FUGOOD_MODELS: FugoodModel[] = [
  {
    id: 'tiny',
    name: 'Tiny (Client Q8)',
    category: 'quantized',
    type: 'q8',
    description:
      'Model paling ringan, jalan di browser (Mode Offline). Cepat, akurasi dasar untuk Bahasa Indonesia.',
    ramMB: 200,
    speedX: '5-10x realtime',
    accuracyRange: '65-75%',
    recommendedFor: 'HP jadul, RAM 1GB+ - Mode Offline',
    url: '',
    sizeMB: 40,
    runtime: 'client',
  },
  {
    id: 'small',
    name: 'Small (Client Q8) - RECOMMENDED',
    category: 'quantized',
    type: 'q8',
    description:
      'Model Small jalan di browser (Mode Offline). Balance akurasi & ukuran. Cocok untuk Bahasa Indonesia.',
    ramMB: 500,
    speedX: '1.5-2x realtime',
    accuracyRange: '82-88%',
    recommendedFor: 'HP modern, RAM 2GB+ - Mode Offline RECOMMENDED',
    url: '',
    sizeMB: 150,
    runtime: 'client',
  },
  {
    id: 'large-v3-turbo',
    name: 'Large v3 Turbo (Server)',
    category: 'quantized',
    type: 'q5_0',
    description:
      'Model turbo terbaik, dijalankan di server (Mode Online). Cepat & akurat untuk Bahasa Indonesia.',
    ramMB: 0,
    speedX: '1-2x realtime',
    accuracyRange: '88-96%',
    recommendedFor: 'Butuh akurasi tinggi - Mode Online',
    url: '/models/ggml-large-v3-turbo-q5_0.bin',
    sizeMB: 548,
    runtime: 'server',
  },
  {
    id: 'large-v3',
    name: 'Large v3 (Server)',
    category: 'quantized',
    type: 'q5_0',
    description:
      'Model terbesar dan paling akurat. Untuk akurasi maksimal. Diproses di server (Mode Online).',
    ramMB: 0,
    speedX: '0.3-0.5x realtime',
    accuracyRange: '90-97%',
    recommendedFor: 'Akurasi maksimal - Mode Online (lambat)',
    url: '/models/ggml-large-v3-q5_0.bin',
    sizeMB: 1100,
    runtime: 'server',
  },
];

// ===== STATE =====
const STORAGE_KEY = 'whisper-fugood-model';
let currentModelId: string | null = null;
let isLoading = false;

// Client-side worker state
let worker: Worker | null = null;
let workerReady: boolean = false;

// ===== HELPERS =====
export function getModel(id: string): FugoodModel | undefined {
  return FUGOOD_MODELS.find((m) => m.id === id);
}

export function isModelLoaded(): boolean {
  if (currentModelId === null) return false;
  const model = getModel(currentModelId);
  if (!model) return false;
  if (model.runtime === 'client') return workerReady;
  return true; // server always ready
}

export function getCurrentModel(): string | null {
  return currentModelId || getSavedModelId();
}

export function getSavedModelId(): string {
  if (typeof localStorage === 'undefined') return 'small';
  return localStorage.getItem(STORAGE_KEY) || 'small';
}

export function saveModelId(id: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, id);
}

export async function isModelCached(_modelId: string): Promise<boolean> {
  // Both modes: assume cached after first use
  return true;
}

export async function deleteModel(_modelId: string): Promise<boolean> {
  // Client: clear transformers.js cache
  if (typeof caches !== 'undefined') {
    try {
      const names = await caches.keys();
      for (const n of names) {
        if (n.includes('transformers')) await caches.delete(n);
      }
    } catch {}
  }
  // Free worker
  if (worker) {
    try { worker.postMessage({ type: 'free' }); } catch {}
  }
  workerReady = false;
  currentModelId = null;
  return true;
}

export function cancelLoad(): void {
  isLoading = false;
}

export function forceResetLoading(): void {
  isLoading = false;
  console.log('[Whisper] Loading state forcibly reset');
}

// ===== CLIENT-SIDE WORKER MANAGEMENT =====

function ensureWorker(): Worker {
  if (!worker && typeof Worker !== 'undefined') {
    worker = new Worker(
      new URL('./whisper-client-worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      console.log('[Whisper-Client] Worker message:', msg.type);
      if (msg.type === 'error') {
        console.error('[Whisper-Client] Worker error:', msg.error);
      }
    };

    worker.onerror = (e: ErrorEvent) => {
      console.error('[Whisper-Client] Worker error event:', e.message);
      workerReady = false;
      isLoading = false;
    };
  }
  return worker!;
}

async function loadClientModel(
  modelId: string,
  onProgress?: (p: number) => void
): Promise<void> {
  const w = ensureWorker();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Client model load timeout (5 min)'));
    }, 5 * 60 * 1000);

    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress' && onProgress) {
        onProgress(msg.progress);
      } else if (msg.type === 'loaded') {
        w.removeEventListener('message', handler);
        clearTimeout(timeout);
        workerReady = true;
        resolve();
      } else if (msg.type === 'error') {
        w.removeEventListener('message', handler);
        clearTimeout(timeout);
        workerReady = false;
        reject(new Error(msg.error));
      }
    };
    w.addEventListener('message', handler);

    w.postMessage({ type: 'load', modelId });
  });
}

async function transcribeClient(
  audio: Float32Array,
  language: string
): Promise<{ text: string }> {
  if (!worker || !workerReady) {
    throw new Error('Client model not loaded');
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Transcribe timeout (5 min)'));
    }, 5 * 60 * 1000);

    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'result') {
        worker!.removeEventListener('message', handler);
        clearTimeout(timeout);
        resolve({ text: msg.text });
      } else if (msg.type === 'error') {
        worker!.removeEventListener('message', handler);
        clearTimeout(timeout);
        reject(new Error(msg.error));
      }
    };
    worker!.addEventListener('message', handler);

    // Transfer audio buffer (zero-copy)
    worker!.postMessage(
      { type: 'transcribe', audio, language },
      [audio.buffer]
    );
  });
}

// ===== SERVER-SIDE PROXY =====

async function loadServerModel(
  _modelId: string,
  onProgress?: (p: number) => void
): Promise<void> {
  // Server models are always ready - just record selection
  onProgress?.(50);
  await new Promise((r) => setTimeout(r, 200));
  onProgress?.(100);
}

async function transcribeServer(
  audio: Float32Array,
  language: string
): Promise<{ text: string }> {
  const wavBlob = float32ToWavBlob(audio);
  const formData = new FormData();
  formData.append('file', wavBlob, 'recording.wav');
  formData.append('language', language);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

  try {
    const response = await fetch('/api/whisper/transcribe/sync', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Server error ${response.status}: ${errText.substring(0, 200)}`);
    }

    const result = await response.json();
    const text = result?.result?.text?.trim() || result?.text?.trim() || '';
    return { text };
  } finally {
    clearTimeout(timeout);
  }
}

// ===== UNIFIED API =====

export async function loadModel(
  modelId: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const model = getModel(modelId);
  if (!model) throw new Error('Unknown model: ' + modelId);

  if (currentModelId === modelId) {
    // Already loaded (client: worker ready, server: always ready)
    if (model.runtime === 'client' && !workerReady) {
      // Fall through to load
    } else {
      return;
    }
  }

  if (isLoading) {
    throw new Error('Another model is loading');
  }

  isLoading = true;

  try {
    console.log('[Whisper] Loading model:', model.name, '(' + model.runtime + ')');

    if (model.runtime === 'client') {
      await loadClientModel(modelId, onProgress);
    } else {
      await loadServerModel(modelId, onProgress);
    }

    currentModelId = modelId;
    saveModelId(modelId);
    isLoading = false;
    console.log('[Whisper] Model loaded:', model.name);
  } catch (err) {
    isLoading = false;
    console.error('[Whisper] Load error:', err);
    throw err;
  }
}

export async function transcribe(
  audio: Float32Array,
  language: string = 'id'
): Promise<{ text: string }> {
  const modelId = currentModelId || getSavedModelId();
  const model = getModel(modelId);
  if (!model) throw new Error('No model selected');

  console.log('[Whisper] Transcribing via', model.runtime, ':', audio.length, 'samples');

  try {
    if (model.runtime === 'client') {
      // Copy audio because worker transfer will detach the original
      const audioCopy = new Float32Array(audio);
      return await transcribeClient(audioCopy, language);
    } else {
      return await transcribeServer(audio, language);
    }
  } catch (err) {
    console.error('[Whisper] Transcribe error:', err);
    throw err;
  }
}

export async function freeModel(): Promise<void> {
  if (worker) {
    try {
      worker.postMessage({ type: 'free' });
    } catch {}
    workerReady = false;
  }
  currentModelId = null;
  console.log('[Whisper] Model freed');
}

// ===== WAV CONVERSION (16kHz mono 16-bit) =====

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
  view.setUint16(20, 1, true);
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
