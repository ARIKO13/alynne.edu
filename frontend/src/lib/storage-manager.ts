/**
 * storage-manager.ts - Manager untuk persistent storage di browser
 *
 * Implementasi:
 *   1. Origin Private File System (OPFS) - folder "ALYNNE AI" di disk
 *      - Model Whisper disimpan di sini (persistent, ga hilang walau browser ditutup)
 *      - Lokasi fisik: browser profile directory (user ga bisa akses langsung lewat file explorer)
 *      - Tapi user bisa hapus via Settings page atau browser settings
 *
 *   2. CacheStorage + IndexedDB - fallback kalau OPFS tidak support
 *      - transformers.js default pakai ini
 *
 *   3. Persistent Storage API - request agar browser tidak auto-evict
 *      - navigator.storage.persist()
 *
 *   4. Settings UI controls:
 *      - Get storage estimate (usage/quota)
 *      - List cached models
 *      - Delete specific model
 *      - Clear all AI data
 */

const ALYNNE_FOLDER = 'ALYNNE-AI';

export interface StorageInfo {
  usage: number;          // bytes
  quota: number;          // bytes
  persistent: boolean;    // persistent storage aktif?
  opfsSupported: boolean;
  models: CachedModel[];  // list model yang tersimpan
}

export interface CachedModel {
  id: string;             // e.g., 'large-turbo'
  name: string;           // e.g., 'Large v3 Turbo'
  sizeMB: number;
  cachedAt: string;       // ISO date
  lastUsed: string;       // ISO date
}

/**
 * Cek apakah OPFS (Origin Private File System) support di browser ini.
 */
export function isOPFSSupported(): boolean {
  return typeof navigator !== 'undefined' &&
         navigator.storage !== undefined &&
         typeof navigator.storage.getDirectory === 'function';
}

/**
 * Request persistent storage - browser tidak akan auto-evict.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) {
    return false;
  }
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * Cek apakah persistent storage sudah aktif.
 */
export async function isStoragePersistent(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persisted) {
    return false;
  }
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

/**
 * Dapatkan estimasi storage usage (bytes used / quota).
 */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number }> {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) {
    return { usage: 0, quota: 0 };
  }
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage || 0, quota: est.quota || 0 };
  } catch {
    return { usage: 0, quota: 0 };
  }
}

/**
 * Dapatkan root directory OPFS untuk ALYNNE AI.
 * Struktur: /ALYNNE-AI/models/<model-id>/...
 */
async function getAlynneDir(): Promise<FileSystemDirectoryHandle | null> {
  if (!isOPFSSupported()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(ALYNNE_FOLDER, { create: true });
  } catch {
    return null;
  }
}

/**
 * Dapatkan directory handle untuk model tertentu.
 */
async function getModelDir(modelId: string): Promise<FileSystemDirectoryHandle | null> {
  const alynneDir = await getAlynneDir();
  if (!alynneDir) return null;
  try {
    return await alynneDir.getDirectoryHandle('models', { create: true })
      .then(d => d.getDirectoryHandle(modelId, { create: true }));
  } catch {
    return null;
  }
}

/**
 * Simpan file model ke OPFS.
 */
export async function saveModelFile(
  modelId: string,
  filename: string,
  data: ArrayBuffer
): Promise<boolean> {
  const modelDir = await getModelDir(modelId);
  if (!modelDir) return false;
  try {
    const fileHandle = await modelDir.getFileHandle(filename, { create: true });
    const writable = await (fileHandle as any).createWritable();
    await writable.write(data);
    await writable.close();
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Baca file model dari OPFS.
 */
export async function readModelFile(
  modelId: string,
  filename: string
): Promise<ArrayBuffer | null> {
  const modelDir = await getModelDir(modelId);
  if (!modelDir) return null;
  try {
    const fileHandle = await modelDir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * List semua model yang tersimpan di OPFS.
 */
export async function listCachedModelsOPFS(): Promise<string[]> {
  const alynneDir = await getAlynneDir();
  if (!alynneDir) return [];
  try {
    const modelsDir = await alynneDir.getDirectoryHandle('models', { create: false });
    const modelIds: string[] = [];
    // @ts-ignore - async iterator
    for await (const [name, handle] of modelsDir.entries()) {
      if (handle.kind === 'directory') {
        modelIds.push(name);
      }
    }
    return modelIds;
  } catch {
    return [];
  }
}

/**
 * Hapus model tertentu dari OPFS.
 */
export async function deleteModelOPFS(modelId: string): Promise<boolean> {
  const alynneDir = await getAlynneDir();
  if (!alynneDir) return false;
  try {
    const modelsDir = await alynneDir.getDirectoryHandle('models', { create: false });
    await modelsDir.removeEntry(modelId, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Hapus SEMUA data ALYNNE AI dari OPFS (factory reset).
 */
export async function clearAllAlynneData(): Promise<boolean> {
  if (!isOPFSSupported()) return false;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(ALYNNE_FOLDER, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Cek apakah model tertentu ada di OPFS.
 */
export async function isModelInOPFS(modelId: string): Promise<boolean> {
  const modelDir = await getModelDir(modelId);
  return modelDir !== null;
}

/**
 * Hitung total size sebuah model di OPFS.
 */
async function getModelSizeOPFS(modelId: string): Promise<number> {
  const modelDir = await getModelDir(modelId);
  if (!modelDir) return 0;
  let totalSize = 0;
  try {
    // @ts-ignore - async iterator
    for await (const [name, handle] of modelDir.entries()) {
      if (handle.kind === 'file') {
        const file = await handle.getFile();
        totalSize += file.size;
      }
    }
  } catch {}
  return totalSize;
}

/**
 * Dapatkan info lengkap storage: usage, quota, persistent, list models.
 *
 * Combine info dari:
 *   - navigator.storage.estimate() - total usage
 *   - OPFS listing - model files
 *   - CacheStorage listing - fallback cache
 *   - localStorage - saved model ID
 */
export async function getFullStorageInfo(): Promise<StorageInfo> {
  const [estimate, persistent] = await Promise.all([
    getStorageEstimate(),
    isStoragePersistent(),
  ]);

  // List models dari OPFS + CacheStorage
  const opfsModels = await listCachedModelsOPFS();
  const cacheModels = await listCachedModelsCacheStorage();

  // Merge unique
  const allModelIds = new Set([...opfsModels, ...cacheModels]);

  // Build model info list
  const models: CachedModel[] = [];
  for (const id of allModelIds) {
    let sizeMB = 0;
    // Cek OPFS size
    const opfsSize = await getModelSizeOPFS(id);
    sizeMB += opfsSize / (1024 * 1024);
    // CacheStorage size sulit dihitung per-model, skip untuk sekarang

    // Cek localStorage untuk lastUsed
    let lastUsed = '';
    try {
      const saved = localStorage.getItem('whisper-selected-model');
      if (saved === id) {
        lastUsed = new Date().toISOString();
      }
    } catch {}

    // Approximate dari model metadata
    const modelMeta = getModelMeta(id);

    models.push({
      id,
      name: modelMeta?.name || id,
      sizeMB: Math.round(sizeMB * 10) / 10 || modelMeta?.sizeMB || 0,
      cachedAt: '',  // OPFS ga track creation time
      lastUsed,
    });
  }

  return {
    usage: estimate.usage,
    quota: estimate.quota,
    persistent,
    opfsSupported: isOPFSSupported(),
    models,
  };
}

// Helper: model metadata lookup
function getModelMeta(id: string): { name: string; sizeMB: number } | null {
  const meta: Record<string, { name: string; sizeMB: number }> = {
    'tiny': { name: 'Tiny (Unquantized)', sizeMB: 75 },
    'base': { name: 'Base (Unquantized)', sizeMB: 145 },
    'small': { name: 'Small (Quantized)', sizeMB: 155 },
    'medium': { name: 'Medium (Quantized)', sizeMB: 470 },
    'large-turbo': { name: 'Large v3 Turbo (Quantized)', sizeMB: 580 },
    'large-full': { name: 'Large v3 Full (Quantized)', sizeMB: 1100 },
  };
  return meta[id] || null;
}

/**
 * List model di CacheStorage (fallback kalau OPFS ga support).
 */
async function listCachedModelsCacheStorage(): Promise<string[]> {
  if (typeof caches === 'undefined') return [];
  try {
    const cacheNames = await caches.keys();
    const models: string[] = [];
    for (const cacheName of cacheNames) {
      // transformers.js cache namanya biasanya: 'transformers-cache' atau 'onnx-cache'
      if (cacheName.includes('transformers') || cacheName.includes('onnx')) {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        for (const req of keys) {
          // URL pattern: https://huggingface.co/Xenova/whisper-small/...
          // Extract model ID dari URL
          const url = req.url.toLowerCase();
          for (const [modelId, hfId] of Object.entries({
            'tiny': 'xenova/whisper-tiny',
            'base': 'xenova/whisper-base',
            'small': 'xenova/whisper-small',
            'medium': 'xenova/whisper-medium',
            'large-turbo': 'whisper-large-v3-turbo',
            'large-full': 'xenova/whisper-large-v3',
          })) {
            if (url.includes(hfId)) {
              models.push(modelId);
              break;
            }
          }
        }
      }
    }
    return [...new Set(models)];
  } catch {
    return [];
  }
}

/**
 * Hapus model dari CacheStorage (fallback).
 */
export async function deleteModelCacheStorage(modelId: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  const hfIdMap: Record<string, string> = {
    'tiny': 'xenova/whisper-tiny',
    'base': 'xenova/whisper-base',
    'small': 'xenova/whisper-small',
    'medium': 'xenova/whisper-medium',
    'large-turbo': 'whisper-large-v3-turbo',
    'large-full': 'xenova/whisper-large-v3',
  };
  const hfId = hfIdMap[modelId];
  if (!hfId) return false;

  let deleted = false;
  try {
    const cacheNames = await caches.keys();
    for (const cacheName of cacheNames) {
      if (cacheName.includes('transformers') || cacheName.includes('onnx')) {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        for (const req of keys) {
          if (req.url.toLowerCase().includes(hfId)) {
            await cache.delete(req);
            deleted = true;
          }
        }
      }
    }
  } catch {}
  return deleted;
}

/**
 * Hapus model dari OPFS + CacheStorage + IndexedDB.
 * Also remove from localStorage if it's the active model.
 */
export async function deleteModel(modelId: string): Promise<boolean> {
  let deleted = false;

  // 1. Hapus dari OPFS
  const opfsDeleted = await deleteModelOPFS(modelId);
  if (opfsDeleted) deleted = true;

  // 2. Hapus dari CacheStorage
  const cacheDeleted = await deleteModelCacheStorage(modelId);
  if (cacheDeleted) deleted = true;

  // 3. Hapus dari IndexedDB (transformers.js cache)
  try {
    const dbReq = indexedDB.open('transformers-cache');
    await new Promise<void>((resolve) => {
      dbReq.onsuccess = async (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (db.objectStoreNames.contains('keyval')) {
          const tx = db.transaction('keyval', 'readwrite');
          const store = tx.objectStore('keyval');
          const allKeys = store.getAllKeys();
          (allKeys as IDBRequest).onsuccess = async () => {
            const keys = (allKeys as IDBRequest).result as (string | number)[];
            const hfIdMap: Record<string, string> = {
              'tiny': 'xenova/whisper-tiny',
              'base': 'xenova/whisper-base',
              'small': 'xenova/whisper-small',
              'medium': 'xenova/whisper-medium',
              'large-turbo': 'whisper-large-v3-turbo',
              'large-full': 'xenova/whisper-large-v3',
            };
            const hfId = hfIdMap[modelId];
            for (const k of keys) {
              if (String(k).toLowerCase().includes(hfId)) {
                store.delete(k);
                deleted = true;
              }
            }
            db.close();
            resolve();
          };
        } else {
          db.close();
          resolve();
        }
      };
      dbReq.onerror = () => resolve();
      dbReq.onupgradeneeded = () => resolve();
    });
  } catch {}

  // 4. Hapus dari localStorage kalau model ini yang aktif
  try {
    const saved = localStorage.getItem('whisper-selected-model');
    if (saved === modelId) {
      localStorage.removeItem('whisper-selected-model');
    }
  } catch {}

  return deleted;
}

/**
 * Hapus SEMUA data AI (models + cache + settings).
 * Factory reset untuk ALYNNE AI.
 */
export async function clearAllAlynneAIData(): Promise<{
  opfsCleared: boolean;
  cacheCleared: boolean;
  indexedDBCleared: boolean;
  localStorageCleared: boolean;
}> {
  const result = {
    opfsCleared: false,
    cacheCleared: false,
    indexedDBCleared: false,
    localStorageCleared: false,
  };

  // 1. OPFS - hapus folder ALYNNE-AI
  result.opfsCleared = await clearAllAlynneData();

  // 2. CacheStorage - hapus semua cache transformers/onnx
  if (typeof caches !== 'undefined') {
    try {
      const cacheNames = await caches.keys();
      for (const cacheName of cacheNames) {
        if (cacheName.includes('transformers') || cacheName.includes('onnx') || cacheName.includes('whisper')) {
          await caches.delete(cacheName);
          result.cacheCleared = true;
        }
      }
    } catch {}
  }

  // 3. IndexedDB - hapus DB transformers-cache
  try {
    const dbReq = indexedDB.deleteDatabase('transformers-cache');
    await new Promise<void>((resolve) => {
      dbReq.onsuccess = () => { result.indexedDBCleared = true; resolve(); };
      dbReq.onerror = () => resolve();
      dbReq.onblocked = () => resolve();
    });
  } catch {}

  // 4. localStorage - hapus key whisper-*
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('whisper-'));
    for (const k of keys) {
      localStorage.removeItem(k);
    }
    result.localStorageCleared = keys.length > 0;
  } catch {}

  return result;
}

/**
 * Format bytes ke human readable.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}
