/**
 * whisper-fugood.ts — Server-side Whisper proxy
 *
 * Client-side Whisper attempts (@fugood WASM, transformers.js ONNX) all
 * crashed in the browser. This module proxies to the server-side
 * faster-whisper backend (running on port 8000 via PM2, healthy 12+ days).
 *
 * The server has 8GB RAM and handles the "small" model (82-88% Indonesian
 * accuracy) easily. Audio is sent once per recording (not streaming), so
 * server CPU load is minimal.
 *
 * Hybrid architecture (in stt-panel.tsx):
 *   - Web Speech API: real-time transcription (instant feedback, 100% client)
 *   - This module: post-processing with server Whisper (better accuracy)
 *
 * API compatible with previous client-side implementations.
 */

// ===== MODEL DEFINITIONS (server picks the model via WHISPER_MODEL env) =====
export interface FugoodModel {
  id: string;
  name: string;
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
    name: 'Tiny (Server)',
    category: 'unquantized',
    type: 'unquantized',
    description:
      'Model paling ringan, dijalankan di server. Cepat, akurasi dasar untuk Bahasa Indonesia.',
    ramMB: 0,
    speedX: '5-10x realtime',
    accuracyRange: '65-75%',
    recommendedFor: 'Default — cepat, hemat battery HP',
    url: '/models/ggml-tiny.bin',
    sizeMB: 75,
  },
  {
    id: 'base',
    name: 'Base (Server)',
    category: 'unquantized',
    type: 'unquantized',
    description:
      'Model Base dijalankan di server. Akurasi menengah untuk Bahasa Indonesia.',
    ramMB: 0,
    speedX: '3-5x realtime',
    accuracyRange: '72-82%',
    recommendedFor: 'Akurasi lebih baik, masih cepat',
    url: '/models/ggml-base.bin',
    sizeMB: 142,
  },
  {
    id: 'small',
    name: 'Small (Server) — RECOMMENDED',
    category: 'quantized',
    type: 'q5_1',
    description:
      'Model Small dijalankan di server. Balance akurasi dan kecepatan. Cocok untuk Bahasa Indonesia.',
    ramMB: 0,
    speedX: '1.5-2x realtime',
    accuracyRange: '82-88%',
    recommendedFor: 'RECOMMENDED — akurasi baik untuk Indonesia',
    url: '/models/ggml-small-q5_1.bin',
    sizeMB: 182,
  },
  {
    id: 'large-v3-turbo',
    name: 'Large v3 Turbo (Server)',
    category: 'quantized',
    type: 'q5_0',
    description:
      'Model terbaik untuk Bahasa Indonesia. Cepat (turbo) dan akurat. Diproses di server.',
    ramMB: 0,
    speedX: '1-2x realtime',
    accuracyRange: '88-96%',
    recommendedFor: 'PC/laptop dengan koneksi internet cepat',
    url: '/models/ggml-large-v3-turbo-q5_0.bin',
    sizeMB: 548,
  },
  {
    id: 'large-v3',
    name: 'Large v3 (Server)',
    category: 'quantized',
    type: 'q5_0',
    description:
      'Model terbesar dan paling akurat. Untuk akurasi maksimal. Diproses di server.',
    ramMB: 0,
    speedX: '0.3-0.5x realtime',
    accuracyRange: '90-97%',
    recommendedFor: 'Akurasi maksimal (lambat)',
    url: '/models/ggml-large-v3-q5_0.bin',
    sizeMB: 1100,
  },
];

// ===== STATE =====
const STORAGE_KEY = 'whisper-fugood-model';
let currentModelId: string | null = null;

// ===== HELPERS =====
export function getModel(id: string): FugoodModel | undefined {
  return FUGOOD_MODELS.find((m) => m.id === id);
}

export function isModelLoaded(): boolean {
  return true; // always "loaded" — server handles it
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

// Cache management — no-op for server-side (server handles caching)
export async function isModelCached(_modelId: string): Promise<boolean> {
  return true; // always "cached" — it's on the server
}

export async function deleteModel(_modelId: string): Promise<boolean> {
  return true; // no-op — can't delete server model from client
}

export function cancelLoad(): void {
  // no-op — nothing to cancel
}

export function forceResetLoading(): void {
  // no-op — no loading state to reset
}

// ===== LOAD MODEL (no-op for server-side) =====
export async function loadModel(
  modelId: string,
  _onProgress?: (progress: number) => void
): Promise<void> {
  const model = getModel(modelId);
  if (!model) throw new Error('Unknown model: ' + modelId);

  // Just record the selection — server already has models loaded
  currentModelId = modelId;
  saveModelId(modelId);
  console.log('[Whisper-Server] Model selected:', model.name);

  // Simulate brief loading for UI feedback
  _onProgress?.(50);
  await new Promise((r) => setTimeout(r, 200));
  _onProgress?.(100);
}

// ===== TRANSCRIBE (server-side) =====

/**
 * Transcribe audio using the server-side faster-whisper backend.
 *
 * Flow:
 *   1. Convert Float32Array → WAV Blob
 *   2. POST to /api/whisper/transcribe/sync (proxied to localhost:8000)
 *   3. Parse JSON response → return text
 */
export async function transcribe(
  audio: Float32Array,
  language: string = 'id'
): Promise<{ text: string }> {
  console.log('[Whisper-Server] Transcribing:', audio.length, 'samples');

  try {
    const wavBlob = float32ToWavBlob(audio);
    console.log('[Whisper-Server] WAV blob:', wavBlob.size, 'bytes');

    const formData = new FormData();
    formData.append('file', wavBlob, 'recording.wav');
    formData.append('language', language);

    console.log('[Whisper-Server] Sending to /api/whisper/transcribe/sync...');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min

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
      console.log('[Whisper-Server] Result:', JSON.stringify(result).substring(0, 300));

      // Backend returns: { status: "completed", result: { text: "...", model: "..." }, ... }
      const text = result?.result?.text?.trim() || result?.text?.trim() || '';
      console.log('[Whisper-Server] Final text:', text.substring(0, 200));
      return { text };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.error('[Whisper-Server] Transcribe error:', err);
    throw err;
  }
}

// ===== FREE (no-op for server-side) =====
export async function freeModel(): Promise<void> {
  // no-op — server manages model lifecycle
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
