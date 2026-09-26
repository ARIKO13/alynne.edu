/**
 * whisper-client.ts - Main-thread Whisper (no Web Worker)
 * Uses @huggingface/transformers v4 with WebGPU support
 */

import { pipeline, env } from '@huggingface/transformers';
import { getModel } from './whisper-models';

env.allowRemoteModels = true;
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

type Pipeline = Awaited<ReturnType<typeof pipeline>>;

let transcriber: Pipeline | null = null;
let currentModelId: string | null = null;
let isLoading = false;

export interface WhisperClientOptions {
  onLoading?: (progress: number, file?: string) => void;
  onLoaded?: () => void;
  onTranscribing?: (progress: number) => void;
  onResult?: (text: string, chunks: any[]) => void;
  onError?: (error: string, phase: string) => void;
}

let options: WhisperClientOptions = {};

export function setCallbacks(opts: WhisperClientOptions): void {
  options = { ...options, ...opts };
}

export async function loadModel(
  modelId: string,
  inlineOpts?: WhisperClientOptions
): Promise<void> {
  const model = getModel(modelId);
  if (!model) throw new Error('Unknown model: ' + modelId);

  if (currentModelId === model.hfId) {
    inlineOpts?.onLoaded?.();
    return;
  }

  if (isLoading) throw new Error('Another model is loading');

  isLoading = true;

  try {
    // WebGPU detection
    let useDevice = 'wasm';
    try {
      if (navigator.gpu) {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          useDevice = 'webgpu';
          console.log('[Whisper] WebGPU available! Using GPU');
        } else {
          console.log('[Whisper] WebGPU no adapter, using WASM');
        }
      } else {
        console.log('[Whisper] WebGPU not supported, using WASM');
      }
    } catch (e) {
      console.log('[Whisper] WebGPU check failed:', e);
    }

    const pipelineOpts: any = {
      progress_callback: (p: any) => {
        if (p.status === 'progress') {
          inlineOpts?.onLoading?.(p.progress || 0, p.file);
        } else if (p.status === 'ready') {
          inlineOpts?.onLoading?.(100);
        }
      },
    };

    if (useDevice === 'webgpu') {
      pipelineOpts.device = 'webgpu';
      pipelineOpts.dtype = 'fp32';
    } else {
      pipelineOpts.device = 'wasm';
      pipelineOpts.dtype = model.quantized ? 'q8' : 'fp32';
    }

    console.log('[Whisper] Loading:', model.hfId, pipelineOpts.device, pipelineOpts.dtype);
    
    transcriber = await pipeline('automatic-speech-recognition', model.hfId, pipelineOpts);
    currentModelId = model.hfId;
    isLoading = false;
    console.log('[Whisper] Model loaded!');
    inlineOpts?.onLoaded?.();
  } catch (err) {
    isLoading = false;
    throw err;
  }
}

export async function transcribe(
  audio: Float32Array,
  language: string = 'indonesian'
): Promise<{ text: string; chunks: any[] }> {
  if (!transcriber) throw new Error('Model not loaded');

  console.log('[Whisper] Transcribing:', audio.length, 'samples');
  const result: any = await (transcriber as any)(audio, {
    language,
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
  });

  const text = result?.text?.trim() || '';
  const chunks = result?.chunks || [];
  console.log('[Whisper] Result:', text.substring(0, 100));
  return { text, chunks };
}

export function freeModel(): void {
  if (transcriber) {
    try { (transcriber as any).dispose?.(); } catch {}
    transcriber = null;
    currentModelId = null;
    console.log('[Whisper] Model freed');
  }
}

export function cancelLoad(): void {
  isLoading = false;
}

export function isModelLoaded(): boolean {
  return currentModelId !== null;
}

export function getCurrentModel(): string | null {
  return currentModelId;
}

export async function isModelCached(modelId: string): Promise<boolean> {
  return false;
}

export async function deleteModel(modelId: string): Promise<boolean> {
  return false;
}

export async function autoLoadSavedModel(): Promise<boolean> {
  return false;
}

export async function requestPersistentStorage(): Promise<boolean> {
  return false;
}

export async function isStoragePersistent(): Promise<boolean> {
  return false;
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number }> {
  return { usage: 0, quota: 0 };
}

export async function blobToFloat32Audio(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await audioContext.decodeAudioData(arrayBuffer);
    return decoded.getChannelData(0);
  } finally {
    audioContext.close();
  }
}
