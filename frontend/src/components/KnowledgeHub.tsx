/**
 * KnowledgeHub.tsx — Personal Knowledge Hub UI
 *
 * Folder/project system for organizing saved work.
 * User can:
 *   - Create projects (folders)
 *   - Save STT transcripts, PDFs, notes, quiz results to projects
 *   - Browse and search saved items
 *   - View item content
 *   - Delete items/projects
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
  Cloud,
  RefreshCw,
} from 'lucide-react';
import {
  getProjects,
  createProject,
  deleteProject,
  getItems,
  deleteItem,
  getHubStats,
  type Project,
  type KnowledgeItem,
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

export function KnowledgeHub({ open, onClose }: KnowledgeHubProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [search, setSearch] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [viewingItem, setViewingItem] = useState<KnowledgeItem | null>(null);
  const [gdriveConnected, setGdriveConnected] = useState(false);
  const [gdriveFiles, setGdriveFiles] = useState<Array<{id:string;name:string;modifiedTime:string}>>([]);
  const [gdriveLoading, setGdriveLoading] = useState(false);

  const refresh = useCallback(() => {
    setProjects(getProjects());
    if (activeProject) {
      setItems(getItems(activeProject.id));
    } else {
      setItems(getItems());
    }
  }, [activeProject]);

  useMemo(() => {
    if (open) refresh();
  }, [open, refresh]);

  const stats = useMemo(() => getHubStats(), [open, items]);

  // Google Drive functions
  const checkGDrive = useCallback(async () => {
    try {
      const res = await fetch("/api/gdrive/status");
      if (res.ok) {
        const data = await res.json();
        setGdriveConnected(data.connected);
      }
    } catch {}
  }, []);

  const loadGDriveFiles = useCallback(async () => {
    setGdriveLoading(true);
    try {
      const res = await fetch("/api/gdrive/list");
      if (res.ok) {
        const data = await res.json();
        setGdriveFiles(data.files || []);
      }
    } catch {}
    setGdriveLoading(false);
  }, []);

  const connectGDrive = useCallback(async () => {
    try {
      const res = await fetch("/api/gdrive/status");
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (e) {
      toast.error("Gagal connect Google Drive");
    }
  }, []);

  const syncToDrive = useCallback(async (item: KnowledgeItem) => {
    try {
      const res = await fetch("/api/gdrive/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: `${item.title}.txt`,
          content: item.content,
        }),
      });
      if (res.ok) {
        toast.success(`Tersimpan ke Google Drive: ${item.title}`);
        loadGDriveFiles();
      } else {
        toast.error("Gagal upload ke Drive");
      }
    } catch {
      toast.error("Gagal upload ke Drive");
    }
  }, [loadGDriveFiles]);

  // Check GDrive on open
  useEffect(() => {
    if (open) {
      checkGDrive();
      if (gdriveConnected) loadGDriveFiles();
    }
  }, [open, checkGDrive, gdriveConnected, loadGDriveFiles]);

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return;
    createProject(newProjectName.trim());
    setNewProjectName('');
    setShowNewProject(false);
    refresh();
    toast.success('Project dibuat!');
  };

  const handleDeleteProject = (id: string) => {
    if (confirm('Hapus project dan semua isinya?')) {
      deleteProject(id);
      if (activeProject?.id === id) setActiveProject(null);
      refresh();
      toast.success('Project dihapus');
    }
  };

  const handleDeleteItem = (id: string) => {
    deleteItem(id);
    refresh();
    toast.success('Item dihapus');
  };

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.content.toLowerCase().includes(q)
    );
  }, [items, search]);

  if (!open) return null;

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
          </DialogDescription>
        </DialogHeader>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-center">
            <Folder className="h-4 w-4 mx-auto mb-1 text-[#8B5CF6]" />
            <p className="text-lg font-semibold text-white">{stats.totalProjects}</p>
            <p className="text-[10px] text-zinc-500 uppercase">Project</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-center">
            <FileText className="h-4 w-4 mx-auto mb-1 text-blue-400" />
            <p className="text-lg font-semibold text-white">{stats.totalItems}</p>
            <p className="text-[10px] text-zinc-500 uppercase">Item</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-center">
            <Mic className="h-4 w-4 mx-auto mb-1 text-green-400" />
            <p className="text-lg font-semibold text-white">{stats.byType.stt || 0}</p>
            <p className="text-[10px] text-zinc-500 uppercase">STT</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-center">
            <Brain className="h-4 w-4 mx-auto mb-1 text-[#8B5CF6]" />
            <p className="text-lg font-semibold text-white">{(stats.byType.pdf || 0) + (stats.byType.mindmap || 0)}</p>
            <p className="text-[10px] text-zinc-500 uppercase">PDF+Map</p>
          </div>
        </div>

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
              <Badge variant="outline" className="ml-auto text-[9px]">{stats.totalItems}</Badge>
            </button>

            {/* Projects */}
            {projects.map((p) => (
              <div
                key={p.id}
                className={`group flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer ${
                  activeProject?.id === p.id
                    ? 'bg-[#8B5CF6]/10 text-[#8B5CF6]'
                    : 'text-zinc-400 hover:bg-white/[0.04]'
                }`}
                onClick={() => setActiveProject(p)}
              >
                <Folder className="h-4 w-4" style={{ color: p.color }} />
                <span className="truncate flex-1">{p.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteProject(p.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}

            {projects.length === 0 && !showNewProject && (
              <p className="text-xs text-zinc-600 px-3 py-4 text-center">
                Belum ada project.
                <br />
                Klik + untuk buat.
              </p>
            )}

            {/* Google Drive Section */}
            <div className="pt-3 mt-3 border-t border-white/[0.04]">
              <div className="flex items-center gap-2 mb-2">
                <Cloud className="h-4 w-4 text-blue-400" />
                <span className="text-xs font-medium text-zinc-300">Google Drive</span>
                {gdriveConnected && (
                  <Badge variant="outline" className="text-[8px] border-green-500/30 text-green-400 ml-auto">
                    Connected
                  </Badge>
                )}
              </div>
              {!gdriveConnected ? (
                <button
                  onClick={connectGDrive}
                  className="w-full px-3 py-2 rounded-md text-xs bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors border border-blue-500/20"
                >
                  Connect Google Drive
                </button>
              ) : (
                <div className="space-y-1">
                  <button
                    onClick={loadGDriveFiles}
                    className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300"
                  >
                    <RefreshCw className="h-2.5 w-2.5" />
                    Refresh files ({gdriveFiles.length})
                  </button>
                  {gdriveLoading && <p className="text-[10px] text-zinc-600">Loading...</p>}
                  {gdriveFiles.slice(0, 5).map((f) => (
                    <div key={f.id} className="text-[10px] text-zinc-500 truncate pl-2">
                      📄 {f.name}
                    </div>
                  ))}
                  {gdriveFiles.length > 5 && (
                    <p className="text-[9px] text-zinc-600 pl-2">+{gdriveFiles.length - 5} lainnya</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Items list */}
          <div className="md:col-span-2 space-y-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-600" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari item..."
                className="pl-8 h-8 text-xs bg-white/[0.04] border-white/[0.08]"
              />
            </div>

            {/* Items */}
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {filteredItems.map((item) => {
                const Icon = TYPE_ICONS[item.type] || FileText;
                const color = TYPE_COLORS[item.type] || 'text-zinc-400';
                return (
                  <div
                    key={item.id}
                    className="group flex items-start gap-3 p-2.5 rounded-md border border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.04] transition-colors cursor-pointer"
                    onClick={() => setViewingItem(item)}
                  >
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
                      </div>
                    </div>
                    {gdriveConnected && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          syncToDrive(item);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-blue-400 hover:text-blue-300 p-1"
                        title="Sync to Google Drive"
                      >
                        <Cloud className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteItem(item.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 p-1"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
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

        {/* Item viewer modal */}
        {viewingItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setViewingItem(null)}>
            <div
              className="bg-zinc-950 border border-white/10 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">{viewingItem.title}</h3>
                  <p className="text-xs text-zinc-500">
                    {new Date(viewingItem.createdAt).toLocaleString('id-ID')}
                  </p>
                </div>
                <Button onClick={() => setViewingItem(null)} size="sm" variant="ghost">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-4">
                <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono">
                  {viewingItem.content}
                </pre>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
