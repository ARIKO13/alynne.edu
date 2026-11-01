/**
 * whisper-fugood.ts - Offline Whisper dispatcher (100% client-side)
 *
 * SEMUA model (Tiny s/d Large v3) jalan di browser via Web Worker
 * (transformers.js ONNX q8). File model di-download LANGSUNG dari
 * Hugging Face CDN ke Cache Storage browser user — VPS tidak ikut
 * menyentuh trafik model sama sekali (tanpa proxy).
 *
 * Ukuran file (sizeMB) = total file ONNX q8 yang benar-benar di-download,
 * diverifikasi dari Hugging Face (encoder + decoder_model_merged):
 *   tiny 41 · base 77 · small 250 · medium 775 · turbo 1085 · large-v3 1560
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
  /** Keterangan spek device minimal untuk model ini */
  deviceSupport: string;
  /** Peringatan khusus (mis. model besar yang ga cocok untuk HP) */
  warning?: string;
}

export const FUGOOD_MODELS: FugoodModel[] = [
  {
    id: 'tiny',
    name: 'Tiny',
    category: 'quantized',
    type: 'q8',
    description:
      'Paling ringan & cepat. Akurasi dasar — cukup untuk catatan pendek.',
    ramMB: 400,
    speedX: '±5-10x realtime',
    accuracyRange: '65-75%',
    recommendedFor: 'HP lama / entry-level',
    deviceSupport: 'Semua HP & laptop · RAM device ≥ 1 GB',
    url: '',
    sizeMB: 41,
  },
  {
    id: 'base',
    name: 'Base',
    category: 'quantized',
    type: 'q8',
    description:
      'Sedikit lebih akurat dari Tiny, masih enteng di-download & dipakai.',
    ramMB: 700,
    speedX: '±3-5x realtime',
    accuracyRange: '72-80%',
    recommendedFor: 'HP budget',
    deviceSupport: 'HP & laptop · RAM device ≥ 2 GB',
    url: '',
    sizeMB: 77,
  },
  {
    id: 'small',
    name: 'Small',
    category: 'quantized',
    type: 'q8',
    description:
      'Balance terbaik antara akurasi & ukuran untuk Bahasa Indonesia.',
    ramMB: 1300,
    speedX: '±1-2x realtime',
    accuracyRange: '82-88%',
    recommendedFor: 'Pemakaian sehari-hari',
    deviceSupport: 'HP modern & laptop · RAM device ≥ 3 GB',
    url: '',
    sizeMB: 250,
  },
  {
    id: 'medium',
    name: 'Medium',
    category: 'quantized',
    type: 'q8',
    description:
      'Akurasi tinggi untuk transkrip panjang. File ±775 MB.',
    ramMB: 3000,
    speedX: '±0.3-0.7x realtime',
    accuracyRange: '85-92%',
    recommendedFor: 'Laptop / PC',
    deviceSupport: 'Laptop/PC · RAM ≥ 6 GB · HP flagship saja',
    warning:
      'Sangat lambat di HP dan bisa crash kalau RAM kurang. Untuk harian, Small/Turbo lebih praktis.',
    url: '',
    sizeMB: 775,
  },
  {
    id: 'large-v3-turbo',
    name: 'Large v3 Turbo',
    category: 'quantized',
    type: 'q8',
    description:
      'Akurasi mendekati Large tapi decoder-nya jauh lebih kecil. File ±1 GB.',
    ramMB: 4000,
    speedX: '±0.2-0.4x realtime',
    accuracyRange: '88-96%',
    recommendedFor: 'Laptop / PC RAM 8GB+',
    deviceSupport: 'Laptop/PC · RAM ≥ 8 GB',
    warning:
      'File besar & berat — di HP umumnya gagal muat (memori browser habis).',
    url: '',
    sizeMB: 1085,
  },
  {
    id: 'large-v3',
    name: 'Large v3',
    category: 'quantized',
    type: 'q8',
    description:
      'Paling akurat, paling berat. Hanya masuk akal di laptop/PC RAM besar.',
    ramMB: 6000,
    speedX: '±0.1-0.3x realtime',
    accuracyRange: '90-97%',
    recommendedFor: 'Laptop / PC RAM 16GB+',
    deviceSupport: 'Laptop/PC · RAM ≥ 16 GB · Tidak untuk HP',
    warning:
      'Model 1.5 GB — di HP hampir pasti gagal muat, di laptop WASM butuh kesabaran.',
    url: '',
    sizeMB: 1560,
  },
];

// Repo Hugging Face untuk tiap model — dipakai worker untuk download &
// untuk cek cache. SEMUA di-download browser langsung dari HF CDN
// (tanpa proxy, tanpa lewat VPS).
export const HF_MODELS: Record<string, string> = {
  tiny: 'Xenova/whisper-tiny',
  base: 'Xenova/whisper-base',
  small: 'Xenova/whisper-small',
  medium: 'Xenova/whisper-medium',
  'large-v3-turbo': 'onnx-community/whisper-large-v3-turbo',
  'large-v3': 'Xenova/whisper-large-v3',
};

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
  return currentModelId !== null && workerReady;
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

export async function isModelCached(modelId: string): Promise<boolean> {
  // Cek BENERAN di Cache Storage browser. transformers.js menyimpan file
  // model di cache yang namanya mengandung "transformers", key = URL HF
  // (mis. https://huggingface.co/Xenova/whisper-tiny/resolve/main/...).
  if (typeof caches === 'undefined') return false;
  try {
    const repo = HF_MODELS[modelId];
    if (!repo) return false;
    const names = await caches.keys();
    const cacheName = names.find((n) => n.toLowerCase().includes('transformers'));
    if (!cacheName) return false;
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    return keys.some((req) => req.url.includes(repo));
  } catch {
    return false;
  }
}

export async function deleteModel(modelId: string): Promise<boolean> {
  // Hapus HANYA file model ini dari cache — uninstall Large ga boleh
  // ikut menghapus Tiny/Small yang user simpan juga.
  const repo = HF_MODELS[modelId];
  if (repo && typeof caches !== 'undefined') {
    try {
      const names = await caches.keys();
      const cacheName = names.find((n) => n.toLowerCase().includes('transformers'));
      if (cacheName) {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        for (const req of keys) {
          if (req.url.includes(repo)) await cache.delete(req);
        }
      }
    } catch {}
  }
  // Kalau yang dihapus = model yang lagi di memory, bebaskan worker
  if (worker && currentModelId === modelId) {
    try { worker.postMessage({ type: 'free' }); } catch {}
    workerReady = false;
    currentModelId = null;
  }
  return true;
}

// Rejector untuk proses load yang lagi jalan — dipakai cancelLoad() biar
// tombol Cancel beneran menghentikan download (worker di-terminate),
// bukan cuma mengabaikan UI-nya.
let activeLoadReject: ((err: Error) => void) | null = null;

export function cancelLoad(): void {
  isLoading = false;
  const reject = activeLoadReject;
  activeLoadReject = null;
  if (reject) reject(new Error('Download dibatalkan'));
  if (worker) {
    try { worker.terminate(); } catch {}
    worker = null;
  }
  workerReady = false;
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
    const model = getModel(modelId);
    // Timeout proporsional ukuran model: minimal 5 menit, model besar
    // dihitung dengan asumsi koneksi ±1 MB/s.
    const minutes = Math.max(5, Math.ceil((model?.sizeMB ?? 150) / 60));
    const timeout = setTimeout(() => {
      activeLoadReject = null;
      reject(
        new Error(
          `Timeout memuat model (${minutes} menit). Koneksi mungkin terlalu lambat untuk download ±${model?.sizeMB ?? '?'} MB.`
        )
      );
    }, minutes * 60 * 1000);

    activeLoadReject = (err) => {
      clearTimeout(timeout);
      reject(err);
    };

    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress' && onProgress) {
        onProgress(msg.progress);
      } else if (msg.type === 'loaded') {
        w.removeEventListener('message', handler);
        activeLoadReject = null;
        clearTimeout(timeout);
        workerReady = true;
        resolve();
      } else if (msg.type === 'error') {
        w.removeEventListener('message', handler);
        activeLoadReject = null;
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
    // Model berat (medium/large) di WASM butuh waktu jauh lebih lama
    // untuk audio panjang — kasih timeout lebih longgar.
    const sizeMB = (currentModelId ? getModel(currentModelId)?.sizeMB : undefined) ?? 0;
    const timeoutMs = (sizeMB >= 700 ? 20 : 5) * 60 * 1000;
    const timeout = setTimeout(() => {
      reject(new Error('Transcribe timeout — audio terlalu panjang untuk model ini'));
    }, timeoutMs);

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

// ===== UNIFIED API =====

export async function loadModel(
  modelId: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const model = getModel(modelId);
  if (!model) throw new Error('Unknown model: ' + modelId);

  if (currentModelId === modelId) {
    // Model ini sudah di-load di worker — ga perlu load ulang
    if (workerReady) return;
  }

  if (isLoading) {
    throw new Error('Another model is loading');
  }

  isLoading = true;

  try {
    console.log('[Whisper] Loading model (client):', model.name);
    await loadClientModel(modelId, onProgress);

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

  console.log('[Whisper] Transcribing (client):', audio.length, 'samples');

  try {
    // Copy audio because worker transfer will detach the original
    const audioCopy = new Float32Array(audio);
    return await transcribeClient(audioCopy, language);
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
