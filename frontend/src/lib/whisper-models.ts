/**
 * whisper-models.ts — Konfigurasi model Whisper untuk client-side STT
 *
 * 6 model tersedia:
 *
 * TANPA KUANTISASI (full precision FP16 — akurasi maksimal, ukuran asli):
 *   1. Tiny      (75 MB)    - paling ringan, akurasi minimal Indonesia
 *   2. Base      (145 MB)   - ringan, akurasi dasar Indonesia
 *
 * DENGAN KUANTISASI Q5_0/Q8 (compressed, akurasi turun <1%, ukuran 60-80% lebih kecil):
 *   3. Small     (155 MB)   - HP modern, RAM ≥ 2GB
 *   4. Medium    (470 MB)   - HP flagship / laptop, RAM ≥ 4GB
 *   5. Large-v3-Turbo (580 MB) - PC modern, RAM ≥ 4GB (recommended)
 *   6. Large-v3 (1.1 GB)   - PC high-end, RAM ≥ 8GB
 */

export interface WhisperModel {
  id: string;
  hfId: string;              // HuggingFace model ID
  name: string;
  sizeMB: number;
  ramMB: number;
  speedX: string;
  werRange: string;
  accuracyRange: string;
  recommendedFor: string;
  description: string;
  quantized: boolean;        // true jika pakai versi quantized (lebih kecil)
  category: 'unquantized' | 'quantized';
}

export const WHISPER_MODELS: WhisperModel[] = [
  // === TANPA KUANTISASI (FP16, ukuran asli) ===
  {
    id: 'tiny',
    hfId: 'Xenova/whisper-tiny',
    name: 'Tiny (Unquantized)',
    sizeMB: 75,
    ramMB: 350,
    speedX: '5-10x realtime',
    werRange: '25-35%',
    accuracyRange: '65-75%',
    recommendedFor: 'HP jadul, RAM ≥ 1GB, koneksi internet lemot',
    description: 'Model paling ringan TANPA kuantisasi. Ukuran asli FP16. Akurasi rendah untuk Bahasa Indonesia, cocok untuk preview cepat atau device sangat terbatas. Bisa dijalankan di HP lama.',
    quantized: false,
    category: 'unquantized',
  },
  {
    id: 'base',
    hfId: 'Xenova/whisper-base',
    name: 'Base (Unquantized)',
    sizeMB: 145,
    ramMB: 500,
    speedX: '3-5x realtime',
    werRange: '18-28%',
    accuracyRange: '72-82%',
    recommendedFor: 'HP jadul, RAM ≥ 1.5GB, butuh akurasi lebih dari Tiny',
    description: 'Model Base TANPA kuantisasi. Ukuran asli FP16. Akurasi dasar untuk Bahasa Indonesia, lebih baik dari Tiny. Cocok untuk device entry-level yang butuh akurasi minimal.',
    quantized: false,
    category: 'unquantized',
  },
  // === DENGAN KUANTISASI (Q5/Q8, compressed) ===
  {
    id: 'small',
    hfId: 'Xenova/whisper-small',
    name: 'Small (Quantized)',
    sizeMB: 155,
    ramMB: 800,
    speedX: '1.5-2x realtime',
    werRange: '12-18%',
    accuracyRange: '82-88%',
    recommendedFor: 'HP modern, laptop entry-level (RAM ≥ 2GB)',
    description: 'Model Small dengan kuantisasi Q8. Paling ringan yang masih layak untuk Bahasa Indonesia. Cocok untuk HP Android/iOS modern dengan koneksi internet terbatas. Akurasi cukup untuk percakapan sehari-hari.',
    quantized: true,
    category: 'quantized',
  },
  {
    id: 'medium',
    hfId: 'Xenova/whisper-medium',
    name: 'Medium (Quantized)',
    sizeMB: 470,
    ramMB: 1800,
    speedX: '0.5-0.8x realtime',
    werRange: '8-12%',
    accuracyRange: '88-92%',
    recommendedFor: 'HP flagship, laptop modern (RAM ≥ 4GB)',
    description: 'Model Medium dengan kuantisasi Q8. Balance antara akurasi dan ukuran. Cocok untuk mayoritas pengguna dengan perangkat modern. Akurasi bagus untuk Bahasa Indonesia formal maupun informal.',
    quantized: true,
    category: 'quantized',
  },
  {
    id: 'large-turbo',
    hfId: 'onnx-community/whisper-large-v3-turbo_timestamped',
    name: 'Large v3 Turbo (Quantized)',
    sizeMB: 580,
    ramMB: 900,
    speedX: '1-2x realtime',
    werRange: '4-12%',
    accuracyRange: '88-96%',
    recommendedFor: 'PC/laptop modern (RAM ≥ 4GB) — RECOMMENDED',
    description: 'Model terbaik untuk Bahasa Indonesia. Cepat (turbo) dan akurat. Sweet spot untuk STT Indonesia. Bisa handle audio bising dan multiple speaker dengan baik.',
    quantized: true,
    category: 'quantized',
  },
  {
    id: 'large-full',
    hfId: 'Xenova/whisper-large-v3',
    name: 'Large v3 Full (Quantized)',
    sizeMB: 1100,
    ramMB: 2500,
    speedX: '0.3-0.5x realtime',
    werRange: '3-10%',
    accuracyRange: '90-97%',
    recommendedFor: 'PC high-end (RAM ≥ 8GB) — maksimal akurasi',
    description: 'Model terbesar dan paling akurat. Untuk pengguna yang butuh akurasi maksimal dan tidak keberatan download 1.1 GB. Lebih lambat dari Turbo tapi akurasi lebih tinggi di audio bising.',
    quantized: true,
    category: 'quantized',
  },
];

export const DEFAULT_MODEL_ID = 'large-turbo';

export function getModel(id: string): WhisperModel | undefined {
  return WHISPER_MODELS.find(m => m.id === id);
}

export function getModelByHfId(hfId: string): WhisperModel | undefined {
  return WHISPER_MODELS.find(m => m.hfId === hfId);
}

const STORAGE_KEY = 'whisper-selected-model';

export function getSavedModelId(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_MODEL_ID;
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_MODEL_ID;
}

export function saveModelId(id: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, id);
}

/**
 * List model yang sudah di-cache di IndexedDB browser.
 * Pakai Cache API + IndexedDB check via transformers.js internal.
 */
export async function getCachedModels(): Promise<string[]> {
  if (typeof window === 'undefined') return [];
  
  // transformers.js cache di CacheStorage dengan prefix 'transformers-cache:'
  if ('caches' in window) {
    try {
      const cacheList = await caches.keys();
      const modelCache = cacheList.filter(k => k.includes('transformers') || k.includes('whisper') || k.includes('xenova') || k.includes('onnx'));
      return modelCache;
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Hapus cache model tertentu dari IndexedDB + CacheStorage.
 * Return true kalau berhasil hapus.
 */
export async function deleteModelCache(modelHfId: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  
  let deleted = false;
  
  // 1. Hapus dari CacheStorage (untuk download transformers.js)
  if ('caches' in window) {
    try {
      const cacheList = await caches.keys();
      for (const cacheName of cacheList) {
        if (cacheName.includes(modelHfId.split('/')[0]) || 
            cacheName.includes(modelHfId.split('/').pop() || '') ||
            cacheName.includes('transformers') ||
            cacheName.includes('onnx')) {
          // Buka cache, hapus entries yang relate ke model ini
          const cache = await caches.open(cacheName);
          const keys = await cache.keys();
          for (const req of keys) {
            const url = req.url.toLowerCase();
            if (url.includes(modelHfId.toLowerCase()) || 
                url.includes(modelHfId.split('/').pop()!.toLowerCase())) {
              await cache.delete(req);
              deleted = true;
            }
          }
        }
      }
    } catch (e) {
      console.warn('CacheStorage delete failed:', e);
    }
  }
  
  // 2. Hapus dari IndexedDB (transformers.js juga simpan di sini)
  if ('indexedDB' in window) {
    try {
      const dbReq = indexedDB.open('transformers-cache');
      dbReq.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (db.objectStoreNames.contains('keyval')) {
          const tx = db.transaction('keyval', 'readwrite');
          const store = tx.objectStore('keyval');
          const allKeys = store.getAllKeys();
          (allKeys as IDBRequest).onsuccess = () => {
            const keys = (allKeys as IDBRequest).result as (string | number)[];
            for (const k of keys) {
              const keyStr = String(k);
              if (keyStr.toLowerCase().includes(modelHfId.toLowerCase())) {
                store.delete(k);
                deleted = true;
              }
            }
          };
        }
        db.close();
      };
      dbReq.onerror = () => {
        // DB mungkin ga ada, abaikan
      };
    } catch (e) {
      console.warn('IndexedDB delete failed:', e);
    }
  }
  
  return deleted;
}

/**
 * Hapus SEMUA model cache (untuk clear all storage).
 */
export async function clearAllModelCaches(): Promise<number> {
  if (typeof window === 'undefined') return 0;
  
  let count = 0;
  if ('caches' in window) {
    try {
      const cacheList = await caches.keys();
      for (const cacheName of cacheList) {
        if (cacheName.includes('transformers') || 
            cacheName.includes('whisper') || 
            cacheName.includes('xenova') || 
            cacheName.includes('onnx')) {
          await caches.delete(cacheName);
          count++;
        }
      }
    } catch {}
  }
  return count;
}
