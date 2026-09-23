/**
 * whisper-cpp-client.ts — Client manager untuk whisper.cpp WASM
 *
 * Manages Web Worker lifecycle:
 *   - Create worker
 *   - Load model (fetch + write to WASM FS)
 *   - Transcribe audio (send PCM to worker)
 *   - Free model (cleanup RAM)
 */

export interface WhisperCppModel {
  id: string;
  name: string;
  filename: string;
  sizeMB: number;
  type: 'unquantized' | 'q5_0';
}

export const WHISPER_CPP_MODELS: WhisperCppModel[] = [
  {
    id: 'tiny',
    name: 'Tiny (Unquantized)',
    filename: 'ggml-tiny.bin',
    sizeMB: 75,
    type: 'unquantized',
  },
  {
    id: 'base',
    name: 'Base (Unquantized)',
    filename: 'ggml-base.bin',
    sizeMB: 142,
    type: 'unquantized',
  },
  {
    id: 'small-q5_0',
    name: 'Small (Q5_0)',
    filename: 'ggml-small-q5_0.bin',
    sizeMB: 181,
    type: 'q5_0',
  },
  {
    id: 'large-v3-turbo-q5_0',
    name: 'Large v3 Turbo (Q5_0)',
    filename: 'ggml-large-v3-turbo-q5_0.bin',
    sizeMB: 580,
    type: 'q5_0',
  },
  {
    id: 'large-v3-q5_0',
    name: 'Large v3 (Q5_0)',
    filename: 'ggml-large-v3-q5_0.bin',
    sizeMB: 1100,
    type: 'q5_0',
  },
];

let worker: Worker | null = null;
let isReady = false;
let modelLoaded = false;
let loadProgress = 0;
let pendingResolve: ((text: string) => void) | null = null;
let pendingReject: ((err: Error) => void) | null = null;
let interimText = '';

export function getModel(id: string): WhisperCppModel | undefined {
  return WHISPER_CPP_MODELS.find(m => m.id === id);
}

function ensureWorker(): Worker {
  if (worker) return worker;

  worker = new Worker('/whisper-wasm/whisper-cpp-worker.js');

  worker.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data;
    switch (msg.type) {
      case 'ready':
        isReady = true;
        console.log('[whisper-cpp] Worker ready');
        break;
      case 'model-loading':
        loadProgress = msg.progress || 0;
        break;
      case 'model-loaded':
        modelLoaded = true;
        loadProgress = 100;
        console.log('[whisper-cpp] Model loaded');
        break;
      case 'interim':
        interimText = msg.text || '';
        break;
      case 'transcribing':
        console.log('[whisper-cpp] Transcribing...', msg.progress);
        break;
      case 'result':
        if (pendingResolve) {
          pendingResolve(msg.text || '');
          pendingResolve = null;
          pendingReject = null;
        }
        break;
      case 'error':
        if (pendingReject) {
          pendingReject(new Error(msg.error || 'Unknown error'));
          pendingResolve = null;
          pendingReject = null;
        }
        break;
      case 'freed':
        modelLoaded = false;
        console.log('[whisper-cpp] Model freed');
        break;
    }
  });

  worker.addEventListener('error', (e) => {
    console.error('[whisper-cpp] Worker error:', e.message);
    if (pendingReject) {
      pendingReject(new Error(e.message || 'Worker error'));
      pendingResolve = null;
      pendingReject = null;
    }
  });

  return worker;
}

export async function loadModel(modelId: string): Promise<void> {
  const model = getModel(modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);

  const w = ensureWorker();

  // Wait for worker to be ready
  let waited = 0;
  while (!isReady && waited < 30000) {
    await new Promise(r => setTimeout(r, 500));
    waited += 500;
  }
  if (!isReady) {
    throw new Error('Worker not ready (timeout 30s)');
  }

  // Free previous model if loaded
  if (modelLoaded) {
    w.postMessage({ type: 'free' });
    await new Promise(r => setTimeout(r, 1000));
  }

  modelLoaded = false;
  loadProgress = 0;

  // Load model
  const modelUrl = `/models/${model.filename}`;
  w.postMessage({ type: 'load-model', modelUrl });

  // Wait for model to load
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Model load timeout (10 min)'));
    }, 10 * 60 * 1000);

    const checkLoaded = setInterval(() => {
      if (modelLoaded) {
        clearTimeout(timeout);
        clearInterval(checkLoaded);
        resolve();
      }
    }, 500);
  });
}

export async function transcribe(
  audio: Float32Array,
  language: string = 'id'
): Promise<string> {
  if (!modelLoaded) {
    throw new Error('Model not loaded');
  }

  const w = ensureWorker();
  interimText = '';

  return new Promise((resolve, reject) => {
    pendingResolve = resolve;
    pendingReject = reject;

    const timeout = setTimeout(() => {
      if (pendingReject) {
        pendingReject(new Error('Transcription timeout (5 min)'));
        pendingResolve = null;
        pendingReject = null;
      }
    }, 5 * 60 * 1000);

    w.postMessage({ type: 'transcribe', audio, language });

    // Clear timeout when resolved
    const origResolve = pendingResolve;
    pendingResolve = (text: string) => {
      clearTimeout(timeout);
      origResolve?.(text);
    };
  });
}

export function freeModel(): void {
  if (!worker) return;
  worker.postMessage({ type: 'free' });
  modelLoaded = false;
}

export function isModelLoaded(): boolean {
  return modelLoaded;
}

export function getLoadProgress(): number {
  return loadProgress;
}

export function getInterimText(): string {
  return interimText;
}

const STORAGE_KEY = 'whisper-cpp-model';

export function getSavedModelId(): string {
  if (typeof localStorage === 'undefined') return 'tiny';
  return localStorage.getItem(STORAGE_KEY) || 'tiny';
}

export function saveModelId(id: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, id);
}
