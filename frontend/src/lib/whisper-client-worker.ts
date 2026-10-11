/**
 * whisper-client-worker.ts — Web Worker untuk client-side Whisper
 *
 * Runs transformers.js v4 ONNX in isolated Web Worker thread.
 * Main thread never crashes — only this worker can crash.
 *
 * Messages from main thread:
 *   { type: 'load', modelId: 'tiny' | 'small' }
 *   { type: 'transcribe', audio: Float32Array, language: 'id' }
 *   { type: 'free' }
 *
 * Messages to main thread:
 *   { type: 'progress', progress: 0-100 }
 *   { type: 'loaded' }
 *   { type: 'result', text: string }
 *   { type: 'error', error: string }
 */

/// <reference lib="webworker" />

export {}; // make this a module so its top-level functions don't pollute global scope

interface LoadMessage {
  type: 'load';
  modelId: string;
}

interface TranscribeMessage {
  type: 'transcribe';
  audio: Float32Array;
  language: string;
}

interface FreeMessage {
  type: 'free';
}

type Message = LoadMessage | TranscribeMessage | FreeMessage;

const MODELS: Record<string, string> = {
  tiny: 'Xenova/whisper-tiny',
  small: 'Xenova/whisper-small',
};

let transcriber: any = null;
let currentModelId: string | null = null;

async function loadModel(modelId: string): Promise<void> {
  if (currentModelId === modelId && transcriber) return;

  const hfId = MODELS[modelId];
  if (!hfId) throw new Error('Unknown client model: ' + modelId);

  // Release previous
  if (transcriber) {
    try { await transcriber.dispose(); } catch {}
    transcriber = null;
    currentModelId = null;
  }

  console.log('[Worker] Loading model:', modelId, '→', hfId);

  const { pipeline, env } = await import('@huggingface/transformers');

  // Configure for browser
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  (env as any).backends ??= {};
  (env as any).backends.onnx ??= {};
  (env as any).backends.onnx.wasm = {
    wasmPaths: '/onnx/',
    numThreads: 1, // single thread for stability
    simd: true,
  };

  postMessage({ type: 'progress', progress: 10 });

  transcriber = await pipeline('automatic-speech-recognition', hfId, {
    dtype: {
      encoder_model: 'q8',
      decoder_model_merged: 'q8',
    },
    device: 'wasm',
    progress_callback: (data: any) => {
      console.log('[Worker] Progress:', data);
      if (data.status === 'progress' && data.progress) {
        postMessage({ type: 'progress', progress: 10 + (data.progress / 100) * 80 });
      } else if (data.status === 'done') {
        postMessage({ type: 'progress', progress: 90 });
      }
    },
  });

  currentModelId = modelId;
  postMessage({ type: 'progress', progress: 100 });
  postMessage({ type: 'loaded' });
  console.log('[Worker] Model loaded:', modelId);
}

async function transcribe(audio: Float32Array, language: string): Promise<void> {
  if (!transcriber) {
    postMessage({ type: 'error', error: 'Model not loaded' });
    return;
  }

  console.log('[Worker] Transcribing:', audio.length, 'samples');

  try {
    const result = await transcriber(audio, {
      language,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });

    const text = result?.text?.trim() || '';
    console.log('[Worker] Result:', text.substring(0, 200));
    postMessage({ type: 'result', text });
  } catch (err) {
    postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function free(): Promise<void> {
  if (transcriber) {
    try { await transcriber.dispose(); } catch {}
    transcriber = null;
    currentModelId = null;
    console.log('[Worker] Model freed');
  }
}

self.onmessage = async (e: MessageEvent<Message>) => {
  const msg = e.data;
  console.log('[Worker] Received:', msg.type);

  try {
    if (msg.type === 'load') {
      await loadModel(msg.modelId);
    } else if (msg.type === 'transcribe') {
      await transcribe(msg.audio, msg.language);
    } else if (msg.type === 'free') {
      await free();
    }
  } catch (err) {
    postMessage({
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

console.log('[Worker] whisper-client-worker initialized');
