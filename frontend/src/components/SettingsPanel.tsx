import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  HardDrive, Cpu, Trash2, AlertTriangle, CheckCircle2, RefreshCw,
  Database, FolderOpen, Zap, X, Loader2,
} from 'lucide-react';
import {
  getFullStorageInfo,
  clearAllAlynneAIData,
  deleteModel,
  requestPersistentStorage,
  formatBytes,
} from '@/lib/storage-manager';
import { toast } from 'sonner';

export default function SettingsPanel() {
  const [storageInfo, setStorageInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const info = await getFullStorageInfo();
      setStorageInfo(info);
    } catch (err) {
      toast.error('Gagal memuat info storage');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDeleteModel = async (modelId: string) => {
    setDeleting(modelId);
    try {
      const deleted = await deleteModel(modelId);
      if (deleted) {
        toast.success('Model ' + modelId + ' berhasil dihapus dari disk');
        await refresh();
      } else {
        toast.error('Gagal hapus model');
      }
    } catch (err) {
      toast.error('Error');
    } finally {
      setDeleting(null);
    }
  };

  const handleRequestPersistent = async () => {
    const granted = await requestPersistentStorage();
    if (granted) {
      toast.success('Persistent storage aktif');
      await refresh();
    } else {
      toast.error('Browser menolak persistent storage');
    }
  };

  const handleClearAll = async () => {
    setClearingAll(true);
    try {
      const result = await clearAllAlynneAIData();
      toast.success('Semua data AI berhasil dihapus');
      await refresh();
      setShowConfirmClear(false);
    } catch (err) {
      toast.error('Gagal clear all');
    } finally {
      setClearingAll(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0D0C0A]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-soft)]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0D0C0A] text-white">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-8">
          <button
            onClick={() => window.history.back()}
            className="text-sm text-stone-400 hover:text-white mb-2 flex items-center gap-1"
          >
            <X className="h-3.5 w-3.5" /> Kembali
          </button>
          <h1 className="text-2xl font-bold text-white mb-1">Pengaturan</h1>
          <p className="text-sm text-stone-400">Kelola penyimpanan model AI di device Anda</p>
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <HardDrive className="h-4 w-4 text-[var(--accent-soft)]" />
            <h2 className="text-sm font-medium text-stone-200">Penyimpanan Device</h2>
            <Button onClick={refresh} variant="ghost" size="sm" className="ml-auto text-stone-400 hover:text-white">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-stone-500 mb-1">Total Dipakai</p>
              <p className="text-lg font-semibold text-white">
                {storageInfo ? formatBytes(storageInfo.usage) : '-'}
              </p>
            </div>
            <div>
              <p className="text-xs text-stone-500 mb-1">Kuota Tersedia</p>
              <p className="text-lg font-semibold text-white">
                {storageInfo ? formatBytes(storageInfo.quota) : '-'}
              </p>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            {storageInfo?.persistent ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-400" />
                <span className="text-xs text-green-400">Persistent Storage Aktif</span>
                <span className="text-xs text-stone-500 ml-2">- Model tidak akan hilang walau browser ditutup</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span className="text-xs text-amber-400">Persistent Storage Belum Aktif</span>
                <Button onClick={handleRequestPersistent} size="sm" variant="outline" className="ml-2 h-6 text-[10px] border-amber-500/30 text-amber-400">
                  Aktifkan
                </Button>
              </>
            )}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <Database className="h-3.5 w-3.5 text-stone-500" />
            <span className="text-xs text-stone-500">
              OPFS: {storageInfo?.opfsSupported ? 'Didukung' : 'Tidak Didukung'}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Cpu className="h-4 w-4 text-[var(--accent-soft)]" />
            <h2 className="text-sm font-medium text-stone-200">Model AI yang Tersimpan</h2>
            <Badge variant="outline" className="ml-auto text-[10px] border-white/10 text-stone-400">
              {storageInfo?.models?.length || 0} model
            </Badge>
          </div>

          {storageInfo?.models?.length === 0 ? (
            <div className="text-center py-8">
              <FolderOpen className="h-8 w-8 mx-auto mb-2 text-stone-600" />
              <p className="text-sm text-stone-500">Belum ada model tersimpan</p>
              <p className="text-xs text-stone-600 mt-1">Download model dari halaman Speech to Text</p>
            </div>
          ) : (
            <div className="space-y-2">
              {storageInfo?.models?.map((model: any) => (
                <div key={model.id} className="flex items-center gap-3 p-3 rounded-lg border border-white/[0.06] bg-white/[0.02]">
                  <div className="h-9 w-9 rounded-lg bg-stone-400/10 flex items-center justify-center shrink-0">
                    <Cpu className="h-4 w-4 text-[var(--accent-soft)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{model.name}</p>
                    <div className="flex items-center gap-3 text-[10px] text-stone-500 mt-0.5">
                      <span>{model.sizeMB} MB</span>
                      {model.lastUsed && <span className="text-green-400/60">Aktif terakhir</span>}
                    </div>
                  </div>
                  <Button
                    onClick={() => handleDeleteModel(model.id)}
                    disabled={deleting === model.id}
                    variant="ghost"
                    size="sm"
                    className="text-stone-500 hover:text-red-400 hover:bg-red-500/10"
                  >
                    {deleting === model.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.02] p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <h2 className="text-sm font-medium text-red-300">Zona Berbahaya</h2>
          </div>
          <p className="text-xs text-stone-400 mb-4">
            Hapus SEMUA data ALYNNE AI dari device: model, cache, dan pengaturan.
          </p>

          {!showConfirmClear ? (
            <Button onClick={() => setShowConfirmClear(true)} variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10">
              <Trash2 className="h-4 w-4 mr-2" /> Hapus Semua Data AI
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-red-500/30 bg-red-500/[0.05] p-3">
                <p className="text-xs text-red-300 font-medium mb-1">Konfirmasi penghapusan</p>
                <p className="text-xs text-red-300/80">Semua model akan dihapus. Anda perlu download ulang.</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleClearAll} disabled={clearingAll} className="bg-red-500 hover:bg-red-600 text-white">
                  {clearingAll ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Menghapus...</> : <><Trash2 className="h-4 w-4 mr-2" /> Ya, Hapus Semua</>}
                </Button>
                <Button onClick={() => setShowConfirmClear(false)} variant="ghost" className="text-stone-400">Batal</Button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 rounded-lg border border-white/[0.04] bg-white/[0.02] p-4">
          <div className="flex items-start gap-2">
            <Zap className="h-4 w-4 text-[var(--accent-soft)] mt-0.5 shrink-0" />
            <div className="text-xs text-stone-400 leading-relaxed">
              <p className="font-medium text-stone-300 mb-1">Cara Kerja Penyimpanan</p>
              <p>Model AI disimpan di disk device (HP/SSD/Laptop) via OPFS - bukan RAM.</p>
              <p>RAM hanya dipakai saat recording aktif. Setelah stop 30 detik, RAM otomatis dibebaskan.</p>
              <p>Model tetap di disk walau browser ditutup - tinggal pakai lagi tanpa download ulang.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
