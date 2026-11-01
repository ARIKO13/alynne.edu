import { useState, useRef, useCallback } from 'react';
import { useAppStore, type UploadedMaterial } from '@/lib/store';
import { extractTextFromFile, detectFileType, type ExtractableType } from '@/lib/file-extractor';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Upload,
  FileText,
  FileType,
  Presentation,
  File,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  CloudUpload,
  Plus,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const FILE_TYPE_CONFIG: Record<ExtractableType, { icon: typeof File; label: string; color: string; accept: string }> = {
  pdf:  { icon: FileText, label: 'PDF', color: 'text-red-400 bg-red-500/10 border-red-500/20', accept: '.pdf' },
  docx: { icon: FileType, label: 'DOCX', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20', accept: '.docx' },
  pptx: { icon: Presentation, label: 'PPTX', color: 'text-orange-400 bg-orange-500/10 border-orange-500/20', accept: '.pptx' },
  txt:  { icon: File, label: 'TXT', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', accept: '.txt,.md,.csv,.json,.html,.htm' },
  other: { icon: File, label: 'File', color: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20', accept: '' },
};

const ALL_ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.csv,.json,.html,.htm';

interface UploadTask {
  id: string;
  file: File;
  status: 'extracting' | 'done' | 'error';
  error?: string;
  material?: UploadedMaterial;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MaterialUpload({ compact = false }: { compact?: boolean }) {
  const { uploadedMaterials, addMaterial, removeMaterial, clearMaterials } = useAppStore();
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    const taskId = crypto.randomUUID();
    const type = detectFileType(file);

    setTasks(prev => [...prev, { id: taskId, file, status: 'extracting' }]);

    try {
      const text = await extractTextFromFile(file);

      if (!text || text.trim().length < 10) {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'error', error: 'Teks terlalu sedikit atau kosong' } : t));
        toast.error(`${file.name}: Teks terlalu sedikit`);
        return;
      }

      const material: UploadedMaterial = {
        id: taskId,
        name: file.name,
        type,
        size: file.size,
        text: text.trim(),
        uploadedAt: Date.now(),
      };

      addMaterial(material);
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'done', material } : t));
      toast.success(`${file.name} berhasil ditambahkan`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengekstrak file';
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'error', error: msg } : t));
      toast.error(`${file.name}: ${msg}`);
    }
  }, [addMaterial]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const supported = fileArray.filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      return ['pdf', 'docx', 'pptx', 'txt', 'md', 'csv', 'json', 'html', 'htm'].includes(ext);
    });

    if (supported.length === 0) {
      toast.error('Format tidak didukung. Gunakan PDF, DOCX, PPTX, TXT, MD, CSV, JSON, atau HTML.');
      return;
    }

    if (supported.length < fileArray.length) {
      toast.warning(`${fileArray.length - supported.length} file dilewati (format tidak didukung)`);
    }

    const concurrency = 3;
    for (let i = 0; i < supported.length; i += concurrency) {
      const batch = supported.slice(i, i + concurrency);
      await Promise.all(batch.map(f => processFile(f)));
    }
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleClick = () => fileInputRef.current?.click();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      e.target.value = '';
    }
  };

  const activeTasks = tasks.filter(t => t.status === 'extracting');
  const errorTasks = tasks.filter(t => t.status === 'error');

  return (
    <div className="space-y-3">
      {/* Drop Zone */}
      {!compact && (
        <div
          onClick={handleClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            'relative rounded-lg border-2 border-dashed cursor-pointer transition-colors duration-200 overflow-hidden',
            isDragOver
              ? 'border-[var(--accent)] bg-[var(--accent)]/[0.06] scale-[1.01]'
              : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.04]'
          )}
        >
          <div className="flex flex-col items-center justify-center py-8 px-6 text-center">
            <div className={cn(
              'rounded-full p-3 mb-3 transition-colors',
              isDragOver ? 'bg-[var(--accent)]/15' : 'bg-white/[0.04]'
            )}>
              <CloudUpload className={cn('h-7 w-7 transition-colors', isDragOver ? 'text-[var(--accent-soft)]' : 'text-zinc-500')} />
            </div>
            <p className="text-sm font-medium text-zinc-300 mb-1">
              {isDragOver ? 'Lepaskan file di sini' : 'Upload Materi Pendukung'}
            </p>
            <p className="text-[11px] text-zinc-600">
              Drag & drop atau klik untuk pilih file
            </p>
            <div className="flex items-center gap-2 mt-3">
              {['PDF', 'DOCX', 'PPTX', 'TXT'].map(fmt => (
                <span key={fmt} className="text-[9px] font-medium text-zinc-600 bg-white/[0.04] px-2 py-0.5 rounded-md border border-white/[0.06]">
                  {fmt}
                </span>
              ))}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ALL_ACCEPT}
            multiple
            onChange={handleInputChange}
            className="hidden"
          />
        </div>
      )}

      {/* Compact mode: just a button */}
      {compact && (
        <div className="flex items-center gap-2">
          <Button
            onClick={handleClick}
            variant="outline"
            size="sm"
            className="gap-2 border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]"
          >
            <Plus className="h-3.5 w-3.5" />
            Upload Materi
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ALL_ACCEPT}
            multiple
            onChange={handleInputChange}
            className="hidden"
          />
        </div>
      )}

      {/* Active extraction tasks */}
      {activeTasks.length > 0 && (
        <div className="space-y-2">
          {activeTasks.map(task => {
            const type = detectFileType(task.file);
            const config = FILE_TYPE_CONFIG[type];
            const Icon = config.icon;
            return (
              <div key={task.id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg border', config.color)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-zinc-300 truncate">{task.file.name}</p>
                  <p className="text-[10px] text-zinc-600">Mengekstrak teks...</p>
                </div>
                <Loader2 className="h-4 w-4 text-[var(--accent-soft)] animate-spin shrink-0" />
              </div>
            );
          })}
        </div>
      )}

      {/* Error tasks */}
      {errorTasks.length > 0 && (
        <div className="space-y-2">
          {errorTasks.map(task => (
            <div key={task.id} className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/[0.03] px-4 py-3">
              <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-300 truncate">{task.file.name}</p>
                <p className="text-[10px] text-red-400/80">{task.error}</p>
              </div>
              <button
                onClick={() => setTasks(prev => prev.filter(t => t.id !== task.id))}
                className="text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Uploaded Materials List */}
      {uploadedMaterials.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-sky-400" />
              <span className="text-xs font-medium text-zinc-300">
                Materi Pendukung ({uploadedMaterials.length})
              </span>
            </div>
            {uploadedMaterials.length > 1 && (
              <button
                onClick={clearMaterials}
                className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-red-400 transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                Hapus Semua
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-white/[0.03]">
            {uploadedMaterials.map((m) => {
              const config = FILE_TYPE_CONFIG[m.type] || FILE_TYPE_CONFIG.other;
              const Icon = config.icon;
              return (
                <div key={m.id} className="px-4 py-2.5 flex items-center gap-3 group hover:bg-white/[0.02] transition-colors">
                  <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg border shrink-0', config.color)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-zinc-300 truncate font-medium">{m.name}</p>
                    <p className="text-[10px] text-zinc-600">
                      {formatFileSize(m.size)} · {m.text.length.toLocaleString('id-ID')} karakter
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[9px] border-white/[0.08] text-zinc-500 uppercase shrink-0">
                    {m.type}
                  </Badge>
                  <button
                    onClick={() => removeMaterial(m.id)}
                    className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
