/**
 * whisper-worker.ts — Web Worker untuk Whisper STT (client-side)
 *
 * Supported models:
 *   UNQUANTIZED (FP16, ukuran asli):
 *     - Xenova/whisper-tiny        (~75 MB)
 *     - Xenova/whisper-base        (~145 MB)
 *
 *   QUANTIZED (Q5/Q8, compressed):
 *     - Xenova/whisper-small       (~155 MB)
 *     - Xenova/whisper-medium      (~470 MB)
 *     - onnx-community/whisper-large-v3-turbo (~580 MB)
 *     - Xenova/whisper-large-v3    (~1.1 GB)
 *
 * Fitur:
 *   - Load model dengan progress callback
 *   - CANCEL download (via AbortController)
 *   - Transcribe audio Float32Array
 *   - Free model dari memory (untuk switch atau hemat RAM)
 */

import { pipeline, env } from '@huggingface/transformers';

// ===== WebGPU config (fix OrtRun error + enable GPU acceleration) =====
env.allowRemoteModels = true;
env.allowLocalModels = false;
env.useBrowserCache = true;

// PRIMARY: WebGPU backend (GPU acceleration, avoids WASM OrtRun crash)
// WebGPU allocates memory di GPU VRAM (bukan RAM), bisa handle model besar
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.simd = true;

// WebGPU will be used as device parameter in pipeline() call
// Fallback ke WASM kalau WebGPU tidak support

type Pipeline = Awaited<ReturnType<typeof pipeline>>;

let transcriber: Pipeline | null = null;
let currentModel: string | null = null;
let loadingModel: string | null = null;
let abortController: AbortController | null = null;

self.addEventListener('message', async (e: MessageEvent) => {
  const data = e.data || {};
  const { type } = data;

  if (type === 'load') {
    const { model, quantized } = data;

    // Already loaded
    if (currentModel === model) {
      self.postMessage({ type: 'loaded', model });
      return;
    }

    // Same model already loading — ignore (don't start another)
    if (loadingModel === model) {
      return;
    }

    // Cancel any ongoing load
    if (abortController) {
      abortController.abort();
      // Wait a tiny bit for abort to complete
      await new Promise(r => setTimeout(r, 100));
    }

    loadingModel = model;
    abortController = new AbortController();
    self.postMessage({ type: 'loading', progress: 0, model, status: 'Initializing model (5-30s)...' });

    // ===== Timeout: 5 menit untuk load (cache atau download) =====
    let timeoutHandle: any = null;
    const loadTimeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error('Download timeout (10 min) - model terlalu besar atau koneksi lambat — coba refresh page'));
      }, 10 * 60 * 1000);
    });

    try {
      // Free previous model
      if (transcriber) {
        try {
          // @ts-ignore
          transcriber.dispose?.();
        } catch {}
        transcriber = null;
        currentModel = null;
      }

      const useQuantized = quantized !== undefined ? quantized : !model.includes('tiny') && !model.includes('base');

      // WebGPU detection
      let useDevice = 'wasm';
      try {
        if (typeof navigator !== 'undefined' && navigator.gpu) {
          const adapter = await navigator.gpu.requestAdapter();
          if (adapter) {
            useDevice = 'webgpu';
            console.log('[Worker] WebGPU available! Using GPU');
          } else {
            console.log('[Worker] WebGPU no adapter, using WASM');
          }
        } else {
          console.log('[Worker] WebGPU not supported, using WASM');
        }
      } catch (e) {
        console.log('[Worker] WebGPU check failed:', e);
      }

      // v4 API: device + dtype for WebGPU
      const pipelineOpts = {
        progress_callback: (p) => {
          if (p.status === 'progress') {
            self.postMessage({ type: 'loading', progress: p.progress || 0, model });
          } else if (p.status === 'ready') {
            self.postMessage({ type: 'loading', progress: 100, model });
          }
        },
      };
      if (useDevice === 'webgpu') {
        pipelineOpts.device = 'webgpu';
        pipelineOpts.dtype = 'fp32';
      } else {
        pipelineOpts.device = 'wasm';
        pipelineOpts.dtype = useQuantized ? 'q8' : 'fp32';
      }
      console.log('[Worker] Pipeline:', pipelineOpts.device, pipelineOpts.dtype);
      const pipelinePromise = pipeline('automatic-speech-recognition', model, pipelineOpts);
      transcriber = await Promise.race([pipelinePromise, loadTimeout]);

      // Success
      clearTimeout(timeoutHandle);
      currentModel = model;
      loadingModel = null;
      abortController = null;
      self.postMessage({ type: 'loaded', model });
    } catch (err: any) {
      clearTimeout(timeoutHandle);
      loadingModel = null;
      abortController = null;
      
      const isAborted = err?.name === 'AbortError' ||
                       err?.message?.includes('abort');
      
      if (isAborted) {
        self.postMessage({ type: 'cancelled', model });
      } else {
        self.postMessage({
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
          phase: 'load',
        });
      }
    }
  } else if (type === 'cancel') {
    // Cancel ongoing download
    if (abortController) {
      abortController.abort();
      self.postMessage({ type: 'cancelling', model: loadingModel });
    } else {
      self.postMessage({ type: 'cancelled', model: null });
    }
  } else if (type === 'transcribe') {
    if (!transcriber) {
      self.postMessage({
        type: 'error',
        error: 'Model not loaded. Call load() first.',
        phase: 'transcribe',
        sessionId: data.sessionId,
      });
      return;
    }

    const { audio, language = 'indonesian', sessionId } = data;

    try {
      if (!audio || audio.length === 0) {
        self.postMessage({
          type: 'error',
          error: 'Empty audio data',
          phase: 'transcribe',
          sessionId,
        });
        return;
      }

      // Validate audio before sending to model
      if (audio.length < 8000) {  // min 0.5s @ 16kHz
        self.postMessage({
          type: 'error',
          error: 'Audio too short for Whisper (min 0.5s required)',
          phase: 'transcribe',
          sessionId,
        });
        return;
      }

      // No padding needed — chunking handles short audio internally
      // chunk_length_s: 30 will split audio into 30s chunks
      // Short audio (< 30s) will be processed as single chunk
      const audioCopy = new Float32Array(audio);

      // ===== Chunking ACTIVE — hemat RAM (proses 30s chunk, bukan full audio) =====
      // chunk_length_s: proses audio dalam chunk 30 detik
      // stride_length_s: overlap 5 detik antar chunk (avoid missing words di boundary)
      // return_timestamps: true untuk proper chunk handling
      const output: any = await (transcriber as any)(audioCopy, {
        language,
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
      });

      const text = output?.text?.trim() || '';
      const chunks = output?.chunks || [];

      self.postMessage({
        type: 'result',
        text,
        chunks: chunks.map((c: any) => ({
          text: c.text?.trim() || '',
          timestamp: c.timestamp,
        })),
        sessionId,
      });
    } catch (err) {
      self.postMessage({
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
        phase: 'transcribe',
        sessionId,
      });
    }
  } else if (type === 'free') {
    if (transcriber) {
      try {
        // @ts-ignore
        transcriber.dispose?.();
      } catch {}
      transcriber = null;
      currentModel = null;
      self.postMessage({ type: 'freed' });
    } else {
      self.postMessage({ type: 'freed' });
    }
  }
});

export {};
