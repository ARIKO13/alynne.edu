/**
 * whisper-fugood.ts — Client-side Whisper via transformers.js v4 (ONNX)
 *
 * Uses @huggingface/transformers v4 with ONNX Runtime Web.
 * Models: Xenova/whisper-{tiny,base,small} with q8 quantization.
 *
 * Hybrid architecture:
 *   - Web Speech API: real-time transcription (instant feedback)
 *   - This module: post-processing with Whisper for better accuracy
 *
 * All processing happens in browser. No server CPU usage.
 * Models cached in browser Cache Storage after first download.
 */

// ===== MODEL DEFINITIONS =====
export interface FugoodModel {
  id: string;
  name: string;
  /** HuggingFace model ID */
  hfId: string;
  sizeMB: number;
  category: 'unquantized' | 'quantized';
  type: 'unquantized' | 'q8';
  description: string;
  ramMB: number;
  speedX: string;
  accuracyRange: string;
  recommendedFor: string;
  url: string; // kept for API compat (unused)
}

export const FUGOOD_MODELS: FugoodModel[] = [
  {
    id: 'tiny',
    name: 'Tiny (Q8)',
    hfId: 'Xenova/whisper-tiny',
    category: 'quantized',
    type: 'q8',
    description:
      'Model paling ringan, quantized Q8. Cepat, akurasi dasar untuk Bahasa Indonesia. Client-side ONNX.',
    ramMB: 200,
    speedX: '5-10x realtime',
    accuracyRange: '65-75%',
    recommendedFor: 'HP jadul, RAM minimal 1GB',
    url: '',
    sizeMB: 40,
  },
  {
    id: 'base',
    name: 'Base (Q8)',
    hfId: 'Xenova/whisper-base',
    category: 'quantized',
    type: 'q8',
    description:
      'Model Base quantized Q8. Akurasi menengah untuk Bahasa Indonesia. Client-side ONNX.',
    ramMB: 300,
    speedX: '3-5x realtime',
    accuracyRange: '72-82%',
    recommendedFor: 'HP entry-level, RAM 1.5GB+',
    url: '',
    sizeMB: 75,
  },
  {
    id: 'small',
    name: 'Small (Q8) — RECOMMENDED',
    hfId: 'Xenova/whisper-small',
    category: 'quantized',
    type: 'q8',
    description:
      'Model Small quantized Q8. Balance akurasi dan ukuran. Cocok untuk Bahasa Indonesia. Client-side ONNX.',
    ramMB: 500,
    speedX: '1.5-2x realtime',
    accuracyRange: '82-88%',
    recommendedFor: 'HP modern, RAM 2GB+ — RECOMMENDED',
    url: '',
    sizeMB: 150,
  },
];

// ===== STATE =====
const STORAGE_KEY = 'whisper-fugood-model';
const CACHE_NAME = 'transformers-models';

let transcriber: any = null;
let currentModelId: string | null = null;
let isLoading = false;

// ===== HELPERS =====
export function getModel(id: string): FugoodModel | undefined {
  return FUGOOD_MODELS.find((m) => m.id === id);
}

export function isModelLoaded(): boolean {
  return transcriber !== null;
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

// Cache management (transformers.js handles its own cache, these are stubs)
export async function isModelCached(modelId: string): Promise<boolean> {
  const model = getModel(modelId);
  if (!model) return false;
  // transformers.js caches in browser Cache Storage under transformers.js namespace
  // We just check if cache API is available
  if (typeof caches === 'undefined') return false;
  try {
    const cacheNames = await caches.keys();
    return cacheNames.some((name) => name.includes('transformers') || name.includes(model.hfId));
  } catch {
    return false;
  }
}

export async function deleteModel(modelId: string): Promise<boolean> {
  // transformers.js manages its own cache; we can try to clear it
  if (typeof caches === 'undefined') return false;
  try {
    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
      if (name.includes('transformers')) {
        await caches.delete(name);
      }
    }
    if (currentModelId === modelId && transcriber) {
      transcriber = null;
      currentModelId = null;
    }
    return true;
  } catch {
    return false;
  }
}

export function cancelLoad(): void {
  // transformers.js doesn't support cancel natively
  // We just reset the loading flag
  isLoading = false;
}

export function forceResetLoading(): void {
  isLoading = false;
  console.log('[Whisper-Transformers] Loading state forcibly reset');
}

// ===== LOAD MODEL =====

export async function loadModel(
  modelId: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const model = getModel(modelId);
  if (!model) throw new Error('Unknown model: ' + modelId);

  if (currentModelId === modelId && transcriber) {
    return; // already loaded
  }

  if (isLoading) {
    throw new Error('Another model is loading');
  }

  isLoading = true;

  try {
    // Release previous model
    if (transcriber) {
      try {
        await transcriber.dispose();
      } catch {}
      transcriber = null;
      currentModelId = null;
    }

    console.log('[Whisper-Transformers] Loading model:', model.name, '(', model.hfId, ')');

    // Dynamic import — only load transformers.js in browser
    const { pipeline, env } = await import('@huggingface/transformers');

    // Configure env for browser
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    onProgress?.(10);

    // Create ASR pipeline with q8 quantization (smaller memory)
    // device: 'wasm' for CPU, 'webgpu' if available
    const hasWebGPU = typeof navigator !== 'undefined' && !!(navigator as any).gpu;
    console.log('[Whisper-Transformers] WebGPU available:', hasWebGPU);

    onProgress?.(30);

    transcriber = await pipeline(
      'automatic-speech-recognition',
      model.hfId,
      {
        dtype: {
          encoder_model: 'q8',
          decoder_model_merged: 'q8',
        },
        device: hasWebGPU ? 'webgpu' : 'wasm',
        progress_callback: (data: any) => {
          console.log('[Whisper-Transformers] Progress:', data);
          if (data.status === 'progress' && data.progress) {
            // data.progress is 0-100
            onProgress?.(30 + (data.progress / 100) * 60);
          } else if (data.status === 'done') {
            onProgress?.(90);
          }
        },
      }
    );

    onProgress?.(100);
    currentModelId = modelId;
    saveModelId(modelId);
    isLoading = false;
    console.log('[Whisper-Transformers] Model loaded:', model.name);
  } catch (err) {
    isLoading = false;
    console.error('[Whisper-Transformers] Load error:', err);
    throw err;
  }
}

// ===== TRANSCRIBE =====

export async function transcribe(
  audio: Float32Array,
  language: string = 'id'
): Promise<{ text: string }> {
  if (!transcriber) {
    throw new Error('Model not loaded');
  }

  console.log('[Whisper-Transformers] Transcribing:', audio.length, 'samples');

  try {
    // transformers.js expects Float32Array at 16kHz
    const result = await transcriber(audio, {
      language: language,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });

    console.log('[Whisper-Transformers] Result:', JSON.stringify(result).substring(0, 300));

    const text = result?.text?.trim() || '';
    console.log('[Whisper-Transformers] Final text:', text.substring(0, 200));
    return { text };
  } catch (err) {
    console.error('[Whisper-Transformers] Transcribe error:', err);
    throw err;
  }
}

// ===== FREE =====

export async function freeModel(): Promise<void> {
  if (transcriber) {
    try {
      await transcriber.dispose();
    } catch {}
    transcriber = null;
    currentModelId = null;
    console.log('[Whisper-Transformers] Model freed');
  }
}
