/**
 * ModelSelector.tsx — Popup pilih model Whisper untuk STT
 *
 * Fitur:
 *   - List 5 model (2 unquantized + 3 quantized)
 *   - Download dengan REAL progress bar (pre-fetch ke Cache Storage)
 *   - CANCEL download (langsung stop via AbortController)
 *   - UNINSTALL model (hapus dari Cache Storage untuk hemat storage)
 *   - Status indicator: cached / loaded / downloading
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  Download,
  Loader2,
  Cpu,
  HardDrive,
  Gauge,
  AlertTriangle,
  X,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  FUGOOD_MODELS,
  getModel,
  getSavedModelId,
  saveModelId,
  loadModel,
  getCurrentModel,
  cancelLoad,
  deleteModel,
  isModelCached,
  isModelLoaded,
  forceResetLoading,
  type FugoodModel,
} from '@/lib/whisper-fugood';

interface ModelSelectorProps {
  open: boolean;
  onClose: () => void;
  onModelReady: (modelId: string) => void;
  forceShow?: boolean;
}

export function ModelSelector({ open, onClose, onModelReady, forceShow }: ModelSelectorProps) {
  const [selectedId, setSelectedId] = useState<string>(getSavedModelId());
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [cachedModels, setCachedModels] = useState<Set<string>>(new Set());
  const [uninstalling, setUninstalling] = useState<string | null>(null);

  // Refresh cached models list ketika popup dibuka
  const refreshCachedModels = useCallback(async () => {
    const cached = new Set<string>();
    for (const model of FUGOOD_MODELS) {
      try {
        if (await isModelCached(model.id)) {
          cached.add(model.id);
        }
      } catch {}
    }
    setCachedModels(cached);
  }, []);

  useEffect(() => {
    if (open) {
      setError(null);
      setLoadProgress(0);
      refreshCachedModels();
      // Sinkronkan dengan state global whisper-fugood
      const current = getCurrentModel();
      if (current && !forceShow) {
        setLoadedModelId(current);
        setSelectedId(current);
      } else {
        // Cek apakah model sudah di-load (e.g. dari session sebelumnya)
        if (isModelLoaded() && current) {
          setLoadedModelId(current);
          setSelectedId(current);
        } else {
          setLoadedModelId(null);
        }
      }
    }
  }, [open, forceShow, refreshCachedModels]);

  const handleSelect = (id: string) => {
    if (loading) return; // ga boleh switch pas loading
    setSelectedId(id);
    setError(null);
  };

  const handleDownload = async () => {
    setLoading(true);
    setError(null);
    setLoadProgress(0);

    // Forcibly reset any stuck loading state from previous auto-load attempts.
    // This prevents "Another model is loading" error when the background
    // auto-load hung on initWhisper.
    forceResetLoading();

    try {
      const model = getModel(selectedId);
      if (!model) throw new Error('Model tidak dikenal');

      await loadModel(selectedId, (progress) => {
        setLoadProgress(progress);
      });
      saveModelId(selectedId);
      setLoadedModelId(selectedId);
      // Tambah ke cached set
      setCachedModels((prev) => new Set(prev).add(selectedId));
      setLoading(false);

      // Beri jeda 600ms agar user lihat 100% progress
      setTimeout(() => {
        onModelReady(selectedId);
        onClose();
      }, 600);
    } catch (err) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.toLowerCase().includes('abort') ||
        msg.toLowerCase().includes('cancel') ||
        msg.toLowerCase().includes('signal')
      ) {
        // User cancel — ga usah tampilin error
        setLoadProgress(0);
      } else {
        setError(msg);
      }
    }
  };

  const handleCancel = () => {
    cancelLoad();
    setLoading(false);
    setLoadProgress(0);
  };

  const handleUninstall = async (modelId: string) => {
    setUninstalling(modelId);
    try {
      const deleted = await deleteModel(modelId);
      if (deleted) {
        // Update cached list
        setCachedModels((prev) => {
          const next = new Set(prev);
          next.delete(modelId);
          return next;
        });
        // Kalau yang di-uninstall adalah model yang sekarang di-memory, reset
        if (loadedModelId === modelId) {
          setLoadedModelId(null);
        }
      }
    } catch (err) {
      setError(`Gagal uninstall: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUninstalling(null);
    }
  };

  const handleUseExisting = () => {
    if (loadedModelId) {
      onModelReady(loadedModelId);
      onClose();
    }
  };

  const selectedModel = getModel(selectedId);
  const isAlreadyLoaded = loadedModelId === selectedId;
  const isCached = cachedModels.has(selectedId);

  // Kalau model sudah loaded, tombol utama = "Gunakan Model Ini"
  // Kalau cached tapi belum loaded, tombol = "Gunakan Model (Cache)" — akan load dari cache
  // Kalau belum cached, tombol = "Download & Gunakan"

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !loading && onClose()}>
      <DialogContent className="max-w-2xl bg-zinc-950/95 border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Cpu className="h-5 w-5 text-[#8B5CF6]" />
            Pilih Model Speech-to-Text
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Model dijalankan langsung di browser Anda. Download sekali, tersimpan
            di cache browser untuk penggunaan berikutnya.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[450px] overflow-y-auto pr-2">
          {/* Group: Unquantized */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-medium text-amber-400">
                Tanpa Kuantisasi (FP16 — Ukuran Asli)
              </h3>
            </div>
            <div className="space-y-2">
              {FUGOOD_MODELS.filter((m) => m.category === 'unquantized').map(
                (model) => (
                  <ModelOption
                    key={model.id}
                    model={model}
                    selected={selectedId === model.id}
                    loaded={loadedModelId === model.id}
                    cached={cachedModels.has(model.id)}
                    uninstalling={uninstalling === model.id}
                    disabled={loading}
                    onSelect={() => handleSelect(model.id)}
                    onUninstall={() => handleUninstall(model.id)}
                  />
                )
              )}
            </div>
          </div>

          {/* Group: Quantized */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="h-4 w-4 text-[#8B5CF6]" />
              <h3 className="text-sm font-medium text-[#8B5CF6]">
                Kuantisasi (Q5 — Lebih Kecil, Akurasi Hampir Sama)
              </h3>
            </div>
            <div className="space-y-2">
              {FUGOOD_MODELS.filter((m) => m.category === 'quantized').map(
                (model) => (
                  <ModelOption
                    key={model.id}
                    model={model}
                    selected={selectedId === model.id}
                    loaded={loadedModelId === model.id}
                    cached={cachedModels.has(model.id)}
                    uninstalling={uninstalling === model.id}
                    disabled={loading}
                    onSelect={() => handleSelect(model.id)}
                    onUninstall={() => handleUninstall(model.id)}
                  />
                )
              )}
            </div>
          </div>
        </div>

        {loading && (
          <div className="rounded-lg border border-[#8B5CF6]/30 bg-[#8B5CF6]/[0.05] p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-[#8B5CF6]">
                <Loader2 className="h-4 w-4 animate-spin" />
                {loadProgress < 100
                  ? `Mengunduh ${selectedModel?.name}...`
                  : `Menginisialisasi ${selectedModel?.name}...`}
              </span>
              <span className="text-zinc-400">{loadProgress.toFixed(1)}%</span>
            </div>
            <Progress value={loadProgress} className="h-2" />
            <p className="text-xs text-zinc-500">
              Model di-cache di browser. Klik Record berikutnya tidak perlu
              download ulang.
            </p>
            <Button
              onClick={handleCancel}
              variant="outline"
              size="sm"
              className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10"
              disabled={loadProgress >= 100}
            >
              <X className="h-3 w-3 mr-2" />
              {loadProgress >= 100 ? 'Sedang inisialisasi...' : 'Cancel Download'}
            </Button>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/[0.05] p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <div className="text-xs text-red-300">
              <p className="font-medium mb-1">Gagal memuat model</p>
              <p className="text-red-300/80">{error}</p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={loading}
            className="text-zinc-400 hover:text-white"
          >
            Batal
          </Button>
          <Button
            onClick={isAlreadyLoaded ? handleUseExisting : handleDownload}
            disabled={loading || !selectedModel}
            className="bg-[#8B5CF6] hover:bg-[#7C3AED]"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isCached ? 'Memuat dari cache...' : 'Mengunduh...'}{' '}
                {loadProgress.toFixed(0)}%
              </>
            ) : isAlreadyLoaded ? (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Gunakan Model Ini
              </>
            ) : isCached ? (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Gunakan Model (Cache)
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Download &amp; Gunakan
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ModelOptionProps {
  model: FugoodModel;
  selected: boolean;
  loaded: boolean;
  cached: boolean;
  uninstalling: boolean;
  disabled: boolean;
  onSelect: () => void;
  onUninstall: () => void;
}

function ModelOption({
  model,
  selected,
  loaded,
  cached,
  uninstalling,
  disabled,
  onSelect,
  onUninstall,
}: ModelOptionProps) {
  const isRecommended = model.id === 'large-v3-turbo-q5_0';
  return (
    <div
      onClick={disabled ? undefined : onSelect}
      className={`
        relative rounded-lg border p-3 transition-all
        ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
        ${
          selected
            ? 'border-[#8B5CF6]/50 bg-[#8B5CF6]/[0.08]'
            : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.04]'
        }
      `}
    >
      <div className="flex items-start gap-3">
        <input
          type="radio"
          checked={selected}
          onChange={onSelect}
          disabled={disabled}
          className="mt-1 accent-[#8B5CF6]"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-medium text-white text-sm">{model.name}</span>
            {loaded && (
              <Badge
                variant="outline"
                className="bg-green-500/10 text-green-400 border-green-500/30 text-[10px]"
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Di Memory
              </Badge>
            )}
            {cached && !loaded && (
              <Badge
                variant="outline"
                className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-[10px]"
              >
                <Download className="h-3 w-3 mr-1" />
                Tersimpan
              </Badge>
            )}
            {isRecommended && (
              <Badge
                variant="outline"
                className="bg-[#8B5CF6]/10 text-[#8B5CF6] border-[#8B5CF6]/30 text-[10px]"
              >
                RECOMMENDED
              </Badge>
            )}
            {model.category === 'unquantized' && (
              <Badge
                variant="outline"
                className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]"
              >
                FP16
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-zinc-400 mb-1.5 leading-relaxed">
            {model.description}
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
            <div className="flex items-center gap-1">
              <HardDrive className="h-3 w-3" />
              <span>{model.sizeMB} MB</span>
            </div>
            <div className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              <span>RAM: {model.ramMB} MB</span>
            </div>
            <div className="flex items-center gap-1">
              <Gauge className="h-3 w-3" />
              <span>{model.speedX}</span>
            </div>
            <div className="flex items-center gap-1">
              <span>Akurasi: {model.accuracyRange}</span>
            </div>
          </div>
        </div>
        {/* Uninstall button — only show if cached or loaded */}
        {(cached || loaded) && !uninstalling && !disabled && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUninstall();
            }}
            className="shrink-0 p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title={`Uninstall ${model.name} (hemat ${model.sizeMB} MB)`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        {uninstalling && (
          <Loader2 className="h-4 w-4 animate-spin text-red-400 shrink-0 mt-1" />
        )}
      </div>
    </div>
  );
}
