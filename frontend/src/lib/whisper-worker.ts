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

import { pipeline, env } from '@xenova/transformers';

env.allowRemoteModels = true;
env.allowLocalModels = false;
env.useBrowserCache = true;

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

    if (currentModel === model) {
      self.postMessage({ type: 'loaded', model });
      return;
    }

    if (loadingModel === model) {
      return; // Already loading
    }

    // Cancel any ongoing load
    if (abortController) {
      abortController.abort();
    }

    loadingModel = model;
    abortController = new AbortController();
    self.postMessage({ type: 'loading', progress: 0, model });

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

      // Determine quantization
      // Default: quantized=true untuk semua kecuali tiny & base
      const useQuantized = quantized !== undefined ? quantized : !model.includes('tiny') && !model.includes('base');

      transcriber = await pipeline('automatic-speech-recognition', model, {
        quantized: useQuantized,
        progress_callback: (p: any) => {
          if (p.status === 'progress') {
            self.postMessage({
              type: 'loading',
              progress: p.progress || 0,
              file: p.file,
              loaded: p.loaded,
              total: p.total,
              model,
            });
          } else if (p.status === 'ready') {
            self.postMessage({ type: 'loading', progress: 100, model });
          }
        },
      });

      currentModel = model;
      loadingModel = null;
      abortController = null;
      self.postMessage({ type: 'loaded', model });
    } catch (err: any) {
      const isAborted = abortController?.signal.aborted || 
                       err?.name === 'AbortError' ||
                       err?.message?.includes('abort');
      loadingModel = null;
      abortController = null;
      
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

      const output: any = await (transcriber as any)(audio, {
        language,
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
        callback: (batch: any) => {
          if (batch?.progress != null) {
            self.postMessage({
              type: 'transcribing',
              progress: batch.progress,
              sessionId,
            });
          }
        },
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
