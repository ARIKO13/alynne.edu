/**
 * whisper-fugood.ts — Client-side Whisper via @fugood/whisper.node
 *
 * Pre-built whisper.cpp WASM yang dioptimasi untuk browser.
 * - Auto-fallback single-thread kalau tidak ada SharedArrayBuffer
 * - Cache model di browser Cache Storage
 * - Module Worker (UI tetap responsive)
 * - Support WebGPU (useGpu: true)
 */

import { configureWasm, initWhisper } from '@fugood/whisper.node';

export interface FugoodModel {
  id: string;
  name: string;
  url: string;
  sizeMB: number;
}

export const FUGOOD_MODELS: FugoodModel[] = [
  {
    id: 'tiny',
    name: 'Tiny (75MB)',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    sizeMB: 75,
  },
  {
    id: 'base',
    name: 'Base (142MB)',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    sizeMB: 142,
  },
  {
    id: 'small',
    name: 'Small (466MB)',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    sizeMB: 466,
  },
  {
    id: 'small-q5_0',
    name: 'Small Q5_0 (181MB)',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_0.bin',
    sizeMB: 181,
  },
  {
    id: 'large-v3-turbo-q5_0',
    name: 'Large v3 Turbo Q5_0 (580MB)',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    sizeMB: 580,
  },
  {
    id: 'large-v3-q5_0',
    name: 'Large v3 Q5_0 (1.1GB)',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin',
    sizeMB: 1100,
  },
];

let whisperInstance: any = null;
let currentModelId: string | null = null;
let isLoading = false;

export function getModel(id: string): FugoodModel | undefined {
  return FUGOOD_MODELS.find(m => m.id === id);
}

export function isModelLoaded(): boolean {
  return whisperInstance !== null;
}

export function getCurrentModel(): string | null {
  return currentModelId;
}

const STORAGE_KEY = 'whisper-fugood-model';

export function getSavedModelId(): string {
  if (typeof localStorage === 'undefined') return 'tiny';
  return localStorage.getItem(STORAGE_KEY) || 'tiny';
}

export function saveModelId(id: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, id);
}

export async function loadModel(
  modelId: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const model = getModel(modelId);
  if (!model) throw new Error('Unknown model: ' + modelId);

  if (currentModelId === modelId && whisperInstance) {
    return;
  }

  if (isLoading) {
    throw new Error('Another model is loading');
  }

  isLoading = true;

  try {
    // Release previous model
    if (whisperInstance) {
      try { await whisperInstance.release(); } catch {}
      whisperInstance = null;
      currentModelId = null;
    }

    console.log('[Whisper-Fugood] Loading model:', model.name, model.url);

    // Configure WASM dengan explicit paths ke public/
    configureWasm({
      worker: true,
      threads: typeof SharedArrayBuffer !== 'undefined',
      jsPath: '/whisper-fugood/whisper-node.js',
      wasmPath: '/whisper-fugood/whisper-node.wasm',
      threadsJsPath: '/whisper-fugood/whisper-node.threads.js',
      threadsWasmPath: '/whisper-fugood/whisper-node.threads.wasm',
      workerPath: '/whisper-fugood/worker.js',
    });

    // Init whisper with model URL
    // @fugood/whisper.node handles download + cache + FS write internally
    // Download model manually first (with progress tracking)
    onProgress?.(0);
    console.log('[Whisper-Fugood] Downloading model...');
    
    const response = await fetch(model.url);
    if (!response.ok) throw new Error('Failed to fetch model: ' + response.status);
    
    const contentLength = response.headers.get('content-length');
    const total = parseInt(contentLength, 10);
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) {
        const progress = (received / total) * 100;
        onProgress?.(progress);
        if (Math.round(progress) % 10 === 0) {
          console.log('[Whisper-Fugood] Download:', progress.toFixed(1) + '%');
        }
      }
    }
    
    // Create blob URL for cached model
    const blob = new Blob(chunks);
    const blobUrl = URL.createObjectURL(blob);
    console.log('[Whisper-Fugood] Model downloaded:', received, 'bytes');
    onProgress?.(100);
    
    whisperInstance = await initWhisper({
      filePath: blobUrl,
      useGpu: false,
    });

    currentModelId = modelId;
    isLoading = false;
    saveModelId(modelId);
    console.log('[Whisper-Fugood] Model loaded!');
    onProgress?.(100);
  } catch (err) {
    isLoading = false;
    console.error('[Whisper-Fugood] Load error:', err);
    throw err;
  }
}

export async function transcribe(
  audio: Float32Array,
  language: string = 'id'
): Promise<{ text: string }> {
  if (!whisperInstance) {
    throw new Error('Model not loaded');
  }

  console.log('[Whisper-Fugood] Transcribing:', audio.length, 'samples');

  try {
    // Convert Float32Array to WAV blob for transcribeFile
    const wavBlob = float32ToWavBlob(audio);

    // Create URL from blob
    const url = URL.createObjectURL(wavBlob);

    const { promise } = whisperInstance.transcribeFile(url, {
      language,
      maxThreads: typeof SharedArrayBuffer !== 'undefined' ? 4 : 1,
    });

    const result = await promise;
    URL.revokeObjectURL(url);

    const text = result?.text?.trim() || '';
    console.log('[Whisper-Fugood] Result:', text.substring(0, 100));
    return { text };
  } catch (err) {
    console.error('[Whisper-Fugood] Transcribe error:', err);
    throw err;
  }
}

export async function freeModel(): Promise<void> {
  if (whisperInstance) {
    try { await whisperInstance.release(); } catch {}
    whisperInstance = null;
    currentModelId = null;
    console.log('[Whisper-Fugood] Model freed');
  }
}

// WAV conversion (16kHz mono 16-bit)
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
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
