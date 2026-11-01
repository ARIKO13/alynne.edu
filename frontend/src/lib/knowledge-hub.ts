/**
 * knowledge-hub.ts — Personal Knowledge Hub (IndexedDB-backed)
 *
 * Folder/project system for organizing saved work:
 * - STT transcripts
 * - Generated PDFs
 * - Mindmaps
 * - Quiz results
 * - Notes
 * - Images
 *
 * Storage: IndexedDB (browser-side, persists across sessions, much larger
 * capacity than localStorage).
 *
 * Limits (designed to be generous but safe):
 *   - Max items:        5,000   (10x the old localStorage cap of 500)
 *   - Max projects:     100
 *   - Max per-item:     5 MB    (block large files; use Drive for those)
 *   - Max total size:   150 MB  (well within browser IDB quota which is
 *                               typically 500MB-2GB+ on desktop)
 *   - Warning at:       120 MB  (UI shows amber warning)
 *
 * Persistence: requests navigator.storage.persist() on first init so
 * browser won't auto-evict the data.
 *
 * Migration: on first init, if localStorage has old data (alynne-projects,
 * alynne-knowledge-items), it's copied to IndexedDB and the localStorage
 * keys are cleared.
 */

// ── Types ───────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description?: string;
  color: string; // hex color for folder icon
  sortOrder?: number; // for manual drag-drop ordering; undefined = auto (by updatedAt desc)
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeItem {
  id: string;
  projectId: string;
  type: 'stt' | 'pdf' | 'mindmap' | 'quiz' | 'note' | 'image';
  title: string;
  content: string; // text content or data URL for images
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface StorageInfo {
  itemCount: number;
  projectCount: number;
  totalSizeBytes: number;
  maxItems: number;
  maxProjects: number;
  maxTotalBytes: number;
  percentUsed: number;       // 0-100
  warningThreshold: number;  // 80 (warn user when percentUsed >= this)
  isPersistent: boolean;     // navigator.storage.persisted()
  browserQuotaBytes?: number; // navigator.storage.estimate().quota
  browserUsageBytes?: number; // navigator.storage.estimate().usage
}

// ── Limits ───────────────────────────────────────────────

export const LIMITS = {
  MAX_ITEMS: 5000,
  MAX_PROJECTS: 100,
  MAX_ITEM_SIZE_BYTES: 5 * 1024 * 1024,        // 5 MB per item
  MAX_TOTAL_SIZE_BYTES: 150 * 1024 * 1024,     // 150 MB total
  WARNING_THRESHOLD_BYTES: 120 * 1024 * 1024,  // 120 MB → start warning
} as const;

// ── IndexedDB setup ──────────────────────────────────────

const DB_NAME = 'alynne-knowledge';
const DB_VERSION = 1;
const PROJECTS_STORE = 'projects';
const ITEMS_STORE = 'items';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB not supported in this environment'));
  }
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        const store = db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(ITEMS_STORE)) {
        const store = db.createObjectStore(ITEMS_STORE, { keyPath: 'id' });
        store.createIndex('projectId', 'projectId');
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('type', 'type');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Run a transaction with a single object store, returning a promise. */
function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  return openDB().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      })
  );
}

/** Run a transaction across multiple stores, with a callback for custom logic. */
function txMulti<T>(
  mode: IDBTransactionMode,
  storeNames: string[],
  fn: (db: IDBDatabase, tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
  return openDB().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeNames, mode);
        let result: T;
        Promise.resolve(fn(db, transaction))
          .then(r => {
            result = r;
          })
          .catch(err => {
            try { transaction.abort(); } catch {}
            reject(err);
          });
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
      })
  );
}

/** Promise-wrapper for getAll on a store or index. */
function getAll<T>(storeName: string, indexName?: string, query?: IDBValidKey | IDBKeyRange): Promise<T[]> {
  return openDB().then(
    db =>
      new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const source = indexName ? store.index(indexName) : store;
        const req = source.getAll(query);
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
      })
  );
}

// ── Migration from localStorage (one-time) ───────────────

const LEGACY_PROJECTS_KEY = 'alynne-projects';
const LEGACY_ITEMS_KEY = 'alynne-knowledge-items';
const MIGRATION_FLAG_KEY = 'alynne-knowledge-migrated-v1';

let migrationDone = false;

async function migrateFromLocalStorage(): Promise<void> {
  if (migrationDone) return;
  if (typeof localStorage === 'undefined') return;
  // Skip if already migrated
  if (localStorage.getItem(MIGRATION_FLAG_KEY)) {
    migrationDone = true;
    return;
  }

  try {
    const oldProjects: Project[] = JSON.parse(localStorage.getItem(LEGACY_PROJECTS_KEY) || '[]');
    const oldItems: KnowledgeItem[] = JSON.parse(localStorage.getItem(LEGACY_ITEMS_KEY) || '[]');

    if (oldProjects.length === 0 && oldItems.length === 0) {
      // Nothing to migrate; mark as done
      localStorage.setItem(MIGRATION_FLAG_KEY, '1');
      migrationDone = true;
      return;
    }

    console.log(`[KnowledgeHub] Migrating ${oldProjects.length} projects + ${oldItems.length} items from localStorage to IndexedDB`);

    await openDB();
    await txMulti('readwrite', [PROJECTS_STORE, ITEMS_STORE], (_db, tx) => {
      const projectStore = tx.objectStore(PROJECTS_STORE);
      const itemStore = tx.objectStore(ITEMS_STORE);
      for (const p of oldProjects) {
        projectStore.put(p);
      }
      for (const i of oldItems) {
        itemStore.put(i);
      }
    });

    // Mark migrated BEFORE clearing, so we don't lose data on a crash mid-clear
    localStorage.setItem(MIGRATION_FLAG_KEY, '1');
    // Clear old localStorage data to free up the 5-10MB quota
    localStorage.removeItem(LEGACY_PROJECTS_KEY);
    localStorage.removeItem(LEGACY_ITEMS_KEY);
    migrationDone = true;
    console.log('[KnowledgeHub] Migration complete, localStorage cleared');
  } catch (err) {
    console.error('[KnowledgeHub] Migration failed (will retry next session):', err);
    // Don't set the flag — retry next time
  }
}

// ── Persistence ──────────────────────────────────────────

let persistenceRequested = false;

async function ensurePersistence(): Promise<void> {
  if (persistenceRequested) return;
  persistenceRequested = true;
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
  try {
    const already = await navigator.storage.persisted();
    if (!already) {
      const ok = await navigator.storage.persist();
      if (ok) console.log('[KnowledgeHub] Storage marked as persistent');
    }
  } catch {
    // ignore
  }
}

// ── Init ──────────────────────────────────────────────────

let initPromise: Promise<void> | null = null;

/** Must be called before any other function. Idempotent. */
export function initKnowledgeHub(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await openDB().catch(() => {}); // open may fail in SSR; ignore
      await migrateFromLocalStorage().catch(() => {});
      await ensurePersistence().catch(() => {});
    })();
  }
  return initPromise;
}

// ── Projects ─────────────────────────────────────────────

export async function getProjects(): Promise<Project[]> {
  await initKnowledgeHub();
  const projects = await getAll<Project>(PROJECTS_STORE);
  // Sort: projects with explicit sortOrder come first (in that order),
  // then the rest by updatedAt desc (most recently touched first).
  return projects.sort((a, b) => {
    const sa = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const sb = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export async function createProject(name: string, description?: string): Promise<Project> {
  await initKnowledgeHub();
  const existing = await getProjects();
  if (existing.length >= LIMITS.MAX_PROJECTS) {
    throw new Error(`Maksimal ${LIMITS.MAX_PROJECTS} project. Hapus yang tidak terpakai untuk membuat baru.`);
  }
  const COLORS = [
    '#0F766E', '#3B82F6', '#10B981', '#F59E0B',
    '#EF4444', '#EC4899', '#06B6D4', '#84CC16',
  ];
  const now = new Date().toISOString();
  const project: Project = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    description,
    color: COLORS[existing.length % COLORS.length],
    createdAt: now,
    updatedAt: now,
  };
  await tx(PROJECTS_STORE, 'readwrite', s => s.add(project));
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  await initKnowledgeHub();
  await txMulti('readwrite', [PROJECTS_STORE, ITEMS_STORE], (_db, tx) => {
    tx.objectStore(PROJECTS_STORE).delete(id);
    // Cascade-delete all items in this project
    const itemStore = tx.objectStore(ITEMS_STORE);
    const idx = itemStore.index('projectId');
    idx.openCursor(IDBKeyRange.only(id)).onsuccess = (e: any) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  });
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<void> {
  await initKnowledgeHub();
  await txMulti('readwrite', [PROJECTS_STORE], (_db, tx) => {
    const store = tx.objectStore(PROJECTS_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as Project | undefined;
      if (!existing) return;
      const updated: Project = {
        ...existing,
        ...updates,
        // Always bump updatedAt (matches old behavior when called with {})
        updatedAt: new Date().toISOString(),
      };
      store.put(updated);
    };
  });
}

// ── Items ────────────────────────────────────────────────

export async function getItems(projectId?: string): Promise<KnowledgeItem[]> {
  await initKnowledgeHub();
  let items: KnowledgeItem[];
  if (projectId) {
    items = await getAll<KnowledgeItem>(ITEMS_STORE, 'projectId', IDBKeyRange.only(projectId));
  } else {
    items = await getAll<KnowledgeItem>(ITEMS_STORE);
  }
  // Newest first (matches old behavior)
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getItem(id: string): Promise<KnowledgeItem | null> {
  await initKnowledgeHub();
  const item = await tx<KnowledgeItem | undefined>(ITEMS_STORE, 'readonly', s => s.get(id));
  return item ?? null;
}

export async function saveItem(
  item: Omit<KnowledgeItem, 'id' | 'createdAt' | 'updatedAt'>
): Promise<KnowledgeItem> {
  await initKnowledgeHub();

  // Per-item size check
  const itemSize = new Blob([item.content]).size;
  if (itemSize > LIMITS.MAX_ITEM_SIZE_BYTES) {
    throw new Error(
      `Item terlalu besar (${(itemSize / 1024 / 1024).toFixed(1)} MB). ` +
      `Maksimal ${LIMITS.MAX_ITEM_SIZE_BYTES / 1024 / 1024} MB per item. ` +
      `Untuk file besar, gunakan Google Drive.`
    );
  }

  // Count + total size check
  const allItems = await getAll<KnowledgeItem>(ITEMS_STORE);
  const totalSize = allItems.reduce((sum, i) => sum + new Blob([i.content]).size, 0);
  if (allItems.length >= LIMITS.MAX_ITEMS) {
    throw new Error(
      `Mencapai batas ${LIMITS.MAX_ITEMS} item. Hapus yang tidak terpakai untuk menyimpan lagi.`
    );
  }
  if (totalSize + itemSize > LIMITS.MAX_TOTAL_SIZE_BYTES) {
    throw new Error(
      `Storage penuh (${(totalSize / 1024 / 1024).toFixed(1)} / ${LIMITS.MAX_TOTAL_SIZE_BYTES / 1024 / 1024} MB). ` +
      `Hapus item lama untuk menyimpan yang baru.`
    );
  }

  const now = new Date().toISOString();
  const newItem: KnowledgeItem = {
    ...item,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: now,
    updatedAt: now,
  };
  await tx(ITEMS_STORE, 'readwrite', s => s.add(newItem));
  // Bump project's updatedAt
  await updateProject(newItem.projectId, {});
  return newItem;
}

export async function deleteItem(id: string): Promise<void> {
  await initKnowledgeHub();
  await tx(ITEMS_STORE, 'readwrite', s => s.delete(id));
}

/** Partial update of an item (rename, edit content, move project, etc.). */
export async function updateItem(
  id: string,
  updates: Partial<Pick<KnowledgeItem, 'title' | 'content' | 'projectId' | 'type' | 'metadata'>>
): Promise<void> {
  await initKnowledgeHub();
  // Per-item size check if content is being replaced
  if (updates.content !== undefined) {
    const newSize = new Blob([updates.content]).size;
    if (newSize > LIMITS.MAX_ITEM_SIZE_BYTES) {
      throw new Error(
        `Item terlalu besar (${(newSize / 1024 / 1024).toFixed(1)} MB). ` +
        `Maksimal ${LIMITS.MAX_ITEM_SIZE_BYTES / 1024 / 1024} MB per item.`
      );
    }
  }
  await txMulti('readwrite', [ITEMS_STORE], (_db, tx) => {
    const store = tx.objectStore(ITEMS_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as KnowledgeItem | undefined;
      if (!existing) return;
      const updated: KnowledgeItem = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      store.put(updated);
    };
  });
}

/** Move an item to a different project (just updates projectId). */
export async function moveItem(id: string, newProjectId: string): Promise<void> {
  await updateItem(id, { projectId: newProjectId });
}

/** Duplicate an item under the same project with " (copy)" appended to title. */
export async function duplicateItem(id: string): Promise<KnowledgeItem | null> {
  await initKnowledgeHub();
  const original = await getItem(id);
  if (!original) return null;
  return saveItem({
    projectId: original.projectId,
    type: original.type,
    title: `${original.title} (copy)`,
    content: original.content,
    metadata: original.metadata,
  });
}

/** Bulk reorder projects by passing the desired order of IDs. */
export async function reorderProjects(orderedIds: string[]): Promise<void> {
  await initKnowledgeHub();
  await txMulti('readwrite', [PROJECTS_STORE], (_db, tx) => {
    const store = tx.objectStore(PROJECTS_STORE);
    for (let i = 0; i < orderedIds.length; i++) {
      const getReq = store.get(orderedIds[i]);
      getReq.onsuccess = () => {
        const p = getReq.result as Project | undefined;
        if (p) {
          store.put({ ...p, sortOrder: i });
        }
      };
    }
  });
}

/** Bulk delete multiple items in one transaction. */
export async function deleteItems(ids: string[]): Promise<void> {
  await initKnowledgeHub();
  if (ids.length === 0) return;
  await txMulti('readwrite', [ITEMS_STORE], (_db, tx) => {
    const store = tx.objectStore(ITEMS_STORE);
    for (const id of ids) {
      store.delete(id);
    }
  });
}

// ── Quick save helpers ───────────────────────────────────

export async function quickSaveSTT(transcript: string, projectName?: string): Promise<KnowledgeItem> {
  await initKnowledgeHub();
  let project: Project | undefined;
  if (projectName) {
    const all = await getProjects();
    project = all.find(p => p.name.toLowerCase() === projectName.toLowerCase());
  }
  if (!project) {
    project = await createProject(projectName || 'STT Transcripts');
  }
  return saveItem({
    projectId: project.id,
    type: 'stt',
    title: `STT ${new Date().toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
    content: transcript,
    metadata: { length: transcript.length },
  });
}

export async function quickSavePDF(title: string, content: string, projectName?: string): Promise<KnowledgeItem> {
  await initKnowledgeHub();
  let project: Project | undefined;
  if (projectName) {
    const all = await getProjects();
    project = all.find(p => p.name.toLowerCase() === projectName.toLowerCase());
  }
  if (!project) {
    project = await createProject(projectName || 'Modul PDF');
  }
  return saveItem({ projectId: project.id, type: 'pdf', title, content });
}

export async function quickSaveNote(title: string, content: string, projectName?: string): Promise<KnowledgeItem> {
  await initKnowledgeHub();
  let project: Project | undefined;
  if (projectName) {
    const all = await getProjects();
    project = all.find(p => p.name.toLowerCase() === projectName.toLowerCase());
  }
  if (!project) {
    project = await createProject(projectName || 'Catatan');
  }
  return saveItem({ projectId: project.id, type: 'note', title, content });
}

// ── Stats + Storage info ─────────────────────────────────

export interface HubStats {
  totalProjects: number;
  totalItems: number;
  byType: Record<string, number>;
  recentItems: KnowledgeItem[];
}

export async function getHubStats(): Promise<HubStats> {
  await initKnowledgeHub();
  const projects = await getAll<Project>(PROJECTS_STORE);
  const items = await getAll<KnowledgeItem>(ITEMS_STORE);
  const byType: Record<string, number> = {};
  for (const i of items) {
    byType[i.type] = (byType[i.type] || 0) + 1;
  }
  return {
    totalProjects: projects.length,
    totalItems: items.length,
    byType,
    recentItems: items
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5),
  };
}

export async function getStorageInfo(): Promise<StorageInfo> {
  await initKnowledgeHub();
  const [projects, items] = await Promise.all([
    getAll<Project>(PROJECTS_STORE),
    getAll<KnowledgeItem>(ITEMS_STORE),
  ]);
  const totalSizeBytes = items.reduce((sum, i) => sum + new Blob([i.content]).size, 0);
  const percentUsed = Math.min(100, (totalSizeBytes / LIMITS.MAX_TOTAL_SIZE_BYTES) * 100);

  let isPersistent = false;
  let browserQuotaBytes: number | undefined;
  let browserUsageBytes: number | undefined;
  if (typeof navigator !== 'undefined' && navigator.storage) {
    try {
      isPersistent = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      if (navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        browserQuotaBytes = est.quota;
        browserUsageBytes = est.usage;
      }
    } catch {}
  }

  return {
    itemCount: items.length,
    projectCount: projects.length,
    totalSizeBytes,
    maxItems: LIMITS.MAX_ITEMS,
    maxProjects: LIMITS.MAX_PROJECTS,
    maxTotalBytes: LIMITS.MAX_TOTAL_SIZE_BYTES,
    percentUsed: Math.round(percentUsed * 10) / 10,
    warningThreshold: Math.round((LIMITS.WARNING_THRESHOLD_BYTES / LIMITS.MAX_TOTAL_SIZE_BYTES) * 100),
    isPersistent,
    browserQuotaBytes,
    browserUsageBytes,
  };
}

// ── Danger zone: clear all ───────────────────────────────

export async function clearAll(): Promise<void> {
  await initKnowledgeHub();
  await txMulti('readwrite', [PROJECTS_STORE, ITEMS_STORE], (_db, tx) => {
    tx.objectStore(PROJECTS_STORE).clear();
    tx.objectStore(ITEMS_STORE).clear();
  });
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(LEGACY_PROJECTS_KEY);
    localStorage.removeItem(LEGACY_ITEMS_KEY);
  }
}
