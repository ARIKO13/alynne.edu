/**
 * KnowledgeHub.tsx — Personal Knowledge Hub UI (IndexedDB-backed, Explorer-like)
 *
 * Folder/project system for organizing saved work, with file-manager
 * ergonomics:
 *   - Double-click project name → inline rename
 *   - Drag-drop projects to reorder (sortOrder persisted)
 *   - Multi-select items with checkboxes + bulk delete
 *   - Sort items (date / name / type)
 *   - Per-item actions on hover: rename, edit content, move to project,
 *     duplicate, delete
 *   - Item viewer supports edit mode (title + content + project)
 *   - Storage usage indicator with warning at 80% of quota
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Folder,
  FolderOpen,
  FileText,
  Brain,
  Calculator,
  StickyNote,
  Mic,
  Plus,
  Trash2,
  Search,
  X,
  Clock,
  ChevronRight,
  HardDrive,
  AlertTriangle,
  Pencil,
  Copy,
  FolderInput,
  GripVertical,
  ArrowUpDown,
  CheckSquare,
  Square,
} from 'lucide-react';
import {
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  reorderProjects,
  getItems,
  deleteItem,
  deleteItems,
  updateItem,
  duplicateItem,
  moveItem,
  getHubStats,
  getStorageInfo,
  initKnowledgeHub,
  clearAll,
  type Project,
  type KnowledgeItem,
  type HubStats,
  type StorageInfo,
} from '@/lib/knowledge-hub';
import { toast } from 'sonner';

interface KnowledgeHubProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_ICONS: Record<string, typeof FileText> = {
  stt: Mic,
  pdf: FileText,
  mindmap: Brain,
  quiz: Calculator,
  note: StickyNote,
  image: FileText,
};

const TYPE_COLORS: Record<string, string> = {
  stt: 'text-green-400',
  pdf: 'text-blue-400',
  mindmap: 'text-[#8B5CF6]',
  quiz: 'text-amber-400',
  note: 'text-zinc-400',
  image: 'text-pink-400',
};

type SortBy = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc' | 'type';

const SORT_LABELS: Record<SortBy, string> = {
  'date-desc': 'Tanggal (Terbaru)',
  'date-asc': 'Tanggal (Terlama)',
  'name-asc': 'Nama (A-Z)',
  'name-desc': 'Nama (Z-A)',
  'type': 'Tipe',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function KnowledgeHub({ open, onClose }: KnowledgeHubProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [search, setSearch] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [viewingItem, setViewingItem] = useState<KnowledgeItem | null>(null);
  const [stats, setStats] = useState<HubStats | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Inline rename state (project)
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Drag-drop reorder state (projects)
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);

  // Multi-select state (items)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Sort
  const [sortBy, setSortBy] = useState<SortBy>('date-desc');

  // Edit mode in viewer
  const [editingItem, setEditingItem] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editProjectId, setEditProjectId] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, its, st, si] = await Promise.all([
        getProjects(),
        activeProject ? getItems(activeProject.id) : getItems(),
        getHubStats(),
        getStorageInfo(),
      ]);
      setProjects(ps);
      setItems(its);
      setStats(st);
      setStorageInfo(si);
      // Clear selection if any selected items are no longer in the list
      setSelectedIds(prev => {
        const ids = new Set(its.map(i => i.id));
        const next = new Set([...prev].filter(id => ids.has(id)));
        return next.size === prev.size ? prev : next;
      });
    } catch (err) {
      console.error('[KnowledgeHub] refresh failed:', err);
      toast.error('Gagal memuat data Knowledge Hub');
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => {
    if (open) {
      initKnowledgeHub().then(() => refresh());
    }
  }, [open, refresh]);

  // ── Project handlers ──

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      await createProject(newProjectName.trim());
      setNewProjectName('');
      setShowNewProject(false);
      await refresh();
      toast.success('Project dibuat!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membuat project');
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm('Hapus project dan semua isinya?')) return;
    try {
      await deleteProject(id);
      if (activeProject?.id === id) setActiveProject(null);
      await refresh();
      toast.success('Project dihapus');
    } catch (err) {
      toast.error('Gagal menghapus project');
    }
  };

  const startRenameProject = (p: Project) => {
    setRenamingProjectId(p.id);
    setRenameValue(p.name);
  };

  const commitRenameProject = async () => {
    if (!renamingProjectId) return;
    const name = renameValue.trim();
    if (!name) {
      setRenamingProjectId(null);
      return;
    }
    try {
      await updateProject(renamingProjectId, { name });
      setRenamingProjectId(null);
      await refresh();
      toast.success('Project di-rename');
    } catch (err) {
      toast.error('Gagal rename project');
    }
  };

  // Drag-drop handlers for projects
  const handleDragStartProject = (e: React.DragEvent, id: string) => {
    setDraggingProjectId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOverProject = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (draggingProjectId && draggingProjectId !== id) {
      setDragOverProjectId(id);
    }
  };

  const handleDropProject = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = draggingProjectId;
    setDraggingProjectId(null);
    setDragOverProjectId(null);
    if (!sourceId || sourceId === targetId) return;

    // Reorder: move sourceId to targetId's position
    const ids = projects.map(p => p.id);
    const sourceIdx = ids.indexOf(sourceId);
    const targetIdx = ids.indexOf(targetId);
    if (sourceIdx === -1 || targetIdx === -1) return;
    ids.splice(sourceIdx, 1);
    ids.splice(targetIdx, 0, sourceId);
    try {
      await reorderProjects(ids);
      await refresh();
    } catch (err) {
      toast.error('Gagal reorder project');
    }
  };

  // ── Item handlers ──

  const handleDeleteItem = async (id: string) => {
    try {
      await deleteItem(id);
      await refresh();
      toast.success('Item dihapus');
    } catch (err) {
      toast.error('Gagal menghapus item');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Hapus ${selectedIds.size} item terpilih?`)) return;
    try {
      await deleteItems([...selectedIds]);
      setSelectedIds(new Set());
      await refresh();
      toast.success(`${selectedIds.size} item dihapus`);
    } catch (err) {
      toast.error('Gagal hapus massal');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      if (prev.size === filteredItems.length) return new Set();
      return new Set(filteredItems.map(i => i.id));
    });
  };

  const handleDuplicate = async (id: string) => {
    try {
      await duplicateItem(id);
      await refresh();
      toast.success('Item diduplikasi');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal duplikasi item');
    }
  };

  const openItemViewer = (item: KnowledgeItem) => {
    setViewingItem(item);
    setEditingItem(false);
    setEditTitle(item.title);
    setEditContent(item.content);
    setEditProjectId(item.projectId);
  };

  const handleSaveItemEdit = async () => {
    if (!viewingItem) return;
    if (!editTitle.trim()) {
      toast.error('Judul tidak boleh kosong');
      return;
    }
    try {
      const moved = editProjectId !== viewingItem.projectId;
      await updateItem(viewingItem.id, {
        title: editTitle.trim(),
        content: editContent,
        projectId: editProjectId,
      });
      // If projectId changed, also use moveItem for clarity (it bumps
      // target project's updatedAt)
      if (moved) {
        await moveItem(viewingItem.id, editProjectId);
      }
      setEditingItem(false);
      await refresh();
      toast.success('Item disimpan');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal simpan item');
    }
  };

  // Filtered + sorted items
  const filteredItems = useMemo(() => {
    let list = items;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = items.filter(
        i => i.title.toLowerCase().includes(q) || i.content.toLowerCase().includes(q)
      );
    }
    const sorted = [...list];
    switch (sortBy) {
      case 'date-desc':
        sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        break;
      case 'date-asc':
        sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        break;
      case 'name-asc':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'name-desc':
        sorted.sort((a, b) => b.title.localeCompare(a.title));
        break;
      case 'type':
        sorted.sort((a, b) => a.type.localeCompare(b.type) || b.createdAt.localeCompare(a.createdAt));
        break;
    }
    return sorted;
  }, [items, search, sortBy]);

  if (!open) return null;

  const storageNearLimit = storageInfo && storageInfo.percentUsed >= storageInfo.warningThreshold;
  const storageFull = storageInfo && storageInfo.percentUsed >= 100;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl bg-zinc-950/95 border-white/10 text-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Folder className="h-5 w-5 text-[#8B5CF6]" />
            Knowledge Hub
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Simpan dan organize hasil kerja kamu dalam project/folder.
            <span className="text-zinc-600"> · Double-click folder untuk rename · Drag untuk reorder</span>
          </DialogDescription>
        </DialogHeader>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-center">
            <Folder className="h-4 w-4 mx-auto mb-1 text-[#8B5CF6]" />
            <p className="text-lg font-semibold text-white">{stats?.totalProjects ?? 0}</p>
            <p className="text-[10px] text-zinc-500 uppercase">Project</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-center">
            <FileText className="h-4 w-4 mx-auto mb-1 text-blue-400" />
            <p className="text-lg font-semibold text-white">{stats?.totalItems ?? 0}</p>
            <p className="text-[10px] text-zinc-500 uppercase">Item</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-center">
            <Mic className="h-4 w-4 mx-auto mb-1 text-green-400" />
            <p className="text-lg font-semibold text-white">{stats?.byType.stt || 0}</p>
            <p className="text-[10px] text-zinc-500 uppercase">STT</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-center">
            <Brain className="h-4 w-4 mx-auto mb-1 text-[#8B5CF6]" />
            <p className="text-lg font-semibold text-white">
              {(stats?.byType.pdf || 0) + (stats?.byType.mindmap || 0)}
            </p>
            <p className="text-[10px] text-zinc-500 uppercase">PDF+Map</p>
          </div>
        </div>

        {/* Storage usage indicator */}
        {storageInfo && (
          <div
            className={`rounded-lg border p-3 ${
              storageFull
                ? 'border-red-500/40 bg-red-500/5'
                : storageNearLimit
                ? 'border-amber-500/40 bg-amber-500/5'
                : 'border-white/[0.06] bg-white/[0.02]'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 text-xs">
                <HardDrive
                  className={`h-3.5 w-3.5 ${
                    storageFull ? 'text-red-400' : storageNearLimit ? 'text-amber-400' : 'text-zinc-400'
                  }`}
                />
                <span className="text-zinc-300">Storage</span>
                {storageFull && (
                  <span className="flex items-center gap-1 text-red-400">
                    <AlertTriangle className="h-3 w-3" /> Penuh
                  </span>
                )}
                {storageNearLimit && !storageFull && (
                  <span className="flex items-center gap-1 text-amber-400">
                    <AlertTriangle className="h-3 w-3" /> Hampir penuh
                  </span>
                )}
              </div>
              <span
                className={`text-xs font-medium ${
                  storageFull ? 'text-red-400' : storageNearLimit ? 'text-amber-400' : 'text-zinc-400'
                }`}
              >
                {formatBytes(storageInfo.totalSizeBytes)} / {formatBytes(storageInfo.maxTotalBytes)}
                {' · '}
                {storageInfo.itemCount}/{storageInfo.maxItems} items
              </span>
            </div>
            <Progress
              value={storageInfo.percentUsed}
              className={`h-1.5 ${
                storageFull
                  ? 'bg-red-500/20'
                  : storageNearLimit
                  ? 'bg-amber-500/20'
                  : 'bg-white/[0.06]'
              }`}
            />
            <p className="text-[9px] text-zinc-600 mt-1.5">
              Tersimpan di IndexedDB browser{storageInfo.isPersistent ? ' (persisten)' : ''}.
              {storageInfo.browserQuotaBytes && (
                <>
                  {' '}
                  Browser quota: {formatBytes(storageInfo.browserUsageBytes || 0)} /{' '}
                  {formatBytes(storageInfo.browserQuotaBytes)}
                </>
              )}
            </p>
          </div>
        )}

        {loading && (
          <div className="text-center py-4 text-xs text-zinc-500">Memuat…</div>
        )}

        {/* Project list + Items */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Projects sidebar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-300">Projects</h3>
              <Button
                onClick={() => setShowNewProject(!showNewProject)}
                size="sm"
                variant="ghost"
                className="h-7 text-[#8B5CF6]"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>

            {showNewProject && (
              <div className="flex gap-1">
                <Input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                  placeholder="Nama project..."
                  className="h-8 text-xs bg-white/[0.04] border-white/[0.08]"
                  autoFocus
                />
                <Button onClick={handleCreateProject} size="sm" className="h-8 bg-[#8B5CF6]">
                  OK
                </Button>
              </div>
            )}

            {/* All items button */}
            <button
              onClick={() => setActiveProject(null)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                !activeProject
                  ? 'bg-[#8B5CF6]/10 text-[#8B5CF6]'
                  : 'text-zinc-400 hover:bg-white/[0.04]'
              }`}
            >
              <FolderOpen className="h-4 w-4" />
              Semua Item
              <Badge variant="outline" className="ml-auto text-[9px]">{stats?.totalItems ?? 0}</Badge>
            </button>

            {/* Projects (draggable + renameable) */}
            {projects.map((p) => {
              const isRenaming = renamingProjectId === p.id;
              const isDragOver = dragOverProjectId === p.id;
              const isDragging = draggingProjectId === p.id;
              return (
                <div
                  key={p.id}
                  draggable={!isRenaming}
                  onDragStart={(e) => handleDragStartProject(e, p.id)}
                  onDragOver={(e) => handleDragOverProject(e, p.id)}
                  onDragLeave={() => setDragOverProjectId(null)}
                  onDrop={(e) => handleDropProject(e, p.id)}
                  className={`group flex items-center gap-1.5 px-2 py-2 rounded-md text-sm transition-colors cursor-pointer ${
                    activeProject?.id === p.id
                      ? 'bg-[#8B5CF6]/10 text-[#8B5CF6]'
                      : isDragOver
                      ? 'bg-[#8B5CF6]/20 ring-1 ring-[#8B5CF6]/40'
                      : 'text-zinc-400 hover:bg-white/[0.04]'
                  } ${isDragging ? 'opacity-50' : ''}`}
                  onClick={() => !isRenaming && setActiveProject(p)}
                  onDoubleClick={() => startRenameProject(p)}
                  title="Klik untuk buka · Double-click untuk rename · Drag untuk reorder"
                >
                  <GripVertical
                    className="h-3.5 w-3.5 text-zinc-600 opacity-0 group-hover:opacity-100 cursor-grab"
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                  <Folder className="h-4 w-4 shrink-0" style={{ color: p.color }} />
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRenameProject}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRenameProject();
                        if (e.key === 'Escape') setRenamingProjectId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 min-w-0 bg-white/[0.06] border border-[#8B5CF6]/40 rounded px-1.5 py-0.5 text-xs text-white outline-none"
                    />
                  ) : (
                    <span className="truncate flex-1">{p.name}</span>
                  )}
                  {!isRenaming && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startRenameProject(p);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300"
                      title="Rename"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProject(p.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300"
                    title="Hapus"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}

            {projects.length === 0 && !showNewProject && (
              <p className="text-xs text-zinc-600 px-3 py-4 text-center">
                Belum ada project.
                <br />
                Klik + untuk buat.
              </p>
            )}

            {/* Danger zone — wipe all data (for cleaning up test/placeholder projects) */}
            {(projects.length > 0 || (stats?.totalItems ?? 0) > 0) && (
              <div className="mt-4 pt-3 border-t border-white/[0.04]">
                <button
                  onClick={async () => {
                    const s = await getHubStats();
                    if (s.totalProjects === 0 && s.totalItems === 0) return;
                    if (!confirm(
                      `Hapus SEMUA data Knowledge Hub?\n` +
                      `${s.totalProjects} project + ${s.totalItems} item akan dihapus permanen.\n` +
                      `Tindakan ini tidak bisa dibatalkan.`
                    )) return;
                    try {
                      await clearAll();
                      await refresh();
                      toast.success('Semua data Knowledge Hub dihapus');
                    } catch (err) {
                      toast.error('Gagal wipe data');
                    }
                  }}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-[10px] text-zinc-600 hover:text-red-400 hover:bg-red-500/5 transition-colors"
                  title="Hapus semua project dan item permanen"
                >
                  <Trash2 className="h-3 w-3" />
                  Hapus Semua Data
                </button>
              </div>
            )}
          </div>

          {/* Items list */}
          <div className="md:col-span-2 space-y-2">
            {/* Toolbar: search + sort + bulk actions */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-600" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari item..."
                  className="pl-8 h-8 text-xs bg-white/[0.04] border-white/[0.08]"
                />
              </div>
              <div className="relative">
                <ArrowUpDown className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-600 pointer-events-none" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="h-8 pl-7 pr-6 text-xs bg-white/[0.04] border border-white/[0.08] rounded text-zinc-300 outline-none cursor-pointer appearance-none"
                  title="Sortir"
                >
                  {(Object.keys(SORT_LABELS) as SortBy[]).map(k => (
                    <option key={k} value={k} className="bg-zinc-900">{SORT_LABELS[k]}</option>
                  ))}
                </select>
              </div>
            </div>

            {filteredItems.length > 0 && (
              <div className="flex items-center gap-2 px-1">
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-zinc-300"
                >
                  {selectedIds.size === filteredItems.length && selectedIds.size > 0 ? (
                    <CheckSquare className="h-3 w-3 text-[#8B5CF6]" />
                  ) : (
                    <Square className="h-3 w-3" />
                  )}
                  {selectedIds.size > 0
                    ? `${selectedIds.size} terpilih`
                    : 'Pilih semua'}
                </button>
                {selectedIds.size > 0 && (
                  <button
                    onClick={handleBulkDelete}
                    className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="h-3 w-3" />
                    Hapus terpilih
                  </button>
                )}
              </div>
            )}

            {/* Items */}
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {filteredItems.map((item) => {
                const Icon = TYPE_ICONS[item.type] || FileText;
                const color = TYPE_COLORS[item.type] || 'text-zinc-400';
                const isSelected = selectedIds.has(item.id);
                const proj = projects.find(p => p.id === item.projectId);
                return (
                  <div
                    key={item.id}
                    className={`group flex items-start gap-2 p-2.5 rounded-md border transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-[#8B5CF6]/40 bg-[#8B5CF6]/5'
                        : 'border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.04]'
                    }`}
                    onClick={() => openItemViewer(item)}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(item.id);
                      }}
                      className="mt-0.5 shrink-0"
                      title="Pilih"
                    >
                      {isSelected ? (
                        <CheckSquare className="h-3.5 w-3.5 text-[#8B5CF6]" />
                      ) : (
                        <Square className="h-3.5 w-3.5 text-zinc-600 hover:text-zinc-400" />
                      )}
                    </button>
                    <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{item.title}</p>
                      <p className="text-[10px] text-zinc-500 truncate">
                        {item.content.substring(0, 80)}...
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] text-zinc-600 flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          {new Date(item.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                        </span>
                        <Badge variant="outline" className="text-[8px] h-3.5 px-1">
                          {item.type}
                        </Badge>
                        {proj && !activeProject && (
                          <span className="text-[8px] text-zinc-600 truncate">· {proj.name}</span>
                        )}
                      </div>
                    </div>
                    {/* Hover action buttons (Windows-explorer-like quick actions) */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDuplicate(item.id);
                        }}
                        className="text-zinc-500 hover:text-zinc-300 p-1"
                        title="Duplikasi"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openItemViewer(item);
                          setEditingItem(true);
                        }}
                        className="text-zinc-500 hover:text-zinc-300 p-1"
                        title="Edit"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteItem(item.id);
                        }}
                        className="text-red-400 hover:text-red-300 p-1"
                        title="Hapus"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-zinc-400" />
                  </div>
                );
              })}

              {filteredItems.length === 0 && (
                <div className="text-center py-8">
                  <FileText className="h-8 w-8 mx-auto mb-2 text-zinc-700" />
                  <p className="text-xs text-zinc-500">
                    {search ? 'Tidak ada item yang cocok' : 'Belum ada item tersimpan'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Item viewer / editor modal */}
        {viewingItem && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={() => {
              setViewingItem(null);
              setEditingItem(false);
            }}
          >
            <div
              className="bg-zinc-950 border border-white/10 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0 mr-3">
                  {editingItem ? (
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Judul..."
                      className="text-lg font-semibold text-white bg-white/[0.04] border-white/[0.08]"
                      autoFocus
                    />
                  ) : (
                    <h3 className="text-lg font-semibold text-white truncate">{viewingItem.title}</h3>
                  )}
                  <p className="text-xs text-zinc-500 mt-1">
                    Dibuat {new Date(viewingItem.createdAt).toLocaleString('id-ID')}
                    {viewingItem.updatedAt !== viewingItem.createdAt && (
                      <> · Diubah {new Date(viewingItem.updatedAt).toLocaleString('id-ID')}</>
                    )}
                    {' · '}{formatBytes(new Blob([viewingItem.content]).size)}
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setViewingItem(null);
                    setEditingItem(false);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {editingItem ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase">Pindah ke project</label>
                    <select
                      value={editProjectId}
                      onChange={(e) => setEditProjectId(e.target.value)}
                      className="mt-1 w-full h-9 px-3 text-sm bg-white/[0.04] border border-white/[0.08] rounded text-zinc-200 outline-none cursor-pointer"
                    >
                      {projects.map(p => (
                        <option key={p.id} value={p.id} className="bg-zinc-900">
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase">Konten</label>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="mt-1 w-full min-h-[300px] p-3 text-sm font-mono text-zinc-200 bg-white/[0.04] border border-white/[0.08] rounded outline-none resize-y"
                      placeholder="Isi konten..."
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      onClick={() => {
                        setEditingItem(false);
                        setEditTitle(viewingItem.title);
                        setEditContent(viewingItem.content);
                        setEditProjectId(viewingItem.projectId);
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      Batal
                    </Button>
                    <Button onClick={handleSaveItemEdit} size="sm" className="bg-[#8B5CF6]">
                      Simpan
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-4">
                    <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono">
                      {viewingItem.content}
                    </pre>
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                    <Button
                      onClick={() => handleDuplicate(viewingItem.id)}
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
                    >
                      <Copy className="h-3.5 w-3.5" /> Duplikasi
                    </Button>
                    <Button
                      onClick={() => setEditingItem(true)}
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
