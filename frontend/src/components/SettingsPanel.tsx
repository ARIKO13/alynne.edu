'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  HardDrive, Cpu, Trash2, AlertTriangle, CheckCircle2, RefreshCw,
  Database, FolderOpen, Zap, X, Loader2, Download,
} from 'lucide-react';
import {
  getFullStorageInfo,
  clearAllAlynneAIData,
  deleteModel,
  requestPersistentStorage,
  formatBytes,
  type StorageInfo,
  type CachedModel,
} from '@/lib/storage-manager';
import { useAppStore } from '@/lib/store';
import { toast } from 'sonner';

export function SettingsPanel() {
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const { setActiveTab } = useAppStore();

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
        toast.success(`Model ${modelId} berhasil dihapus dari disk`);
        await refresh();
      } else {
        toast.error('Gagal hapus model');
      }
    } catch (err) {
      toast.error('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDeleting(null);
    }
  };

  const handleRequestPersistent = async () => {
    const granted = await requestPersistentStorage();
    if (granted) {
      toast.success('Persistent storage aktif — model tidak akan hilang');
      await refresh();
    } else {
      toast.error('Browser menolak persistent storage');
    }
  };

  const handleClearAll = async () => {
    setClearingAll(true);
    try {
      const result = await clearAllAlynneAIData();
      const parts = [];
      if (result.opfsCleared) parts.push('OPFS');
      if (result.cacheCleared) parts.push('CacheStorage');
      if (result.indexedDBCleared) parts.push('IndexedDB');
      if (result.localStorageCleared) parts.push('localStorage');
      toast.success(`Berhasil hapus: ${parts.join(', ') || 'tidak ada data'}`);
      await refresh();
      setShowConfirmClear(false);
    } catch (err) {
      toast.error('Gagal clear all: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setClearingAll(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
        <Loader2 className="h-8 w-8 animate-spin text-[#8B5CF6]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-white">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => setActiveTab('stt')}
            className="text-sm text-zinc-400 hover:text-white mb-2 flex items-center gap-1"
          >
            <X className="h-3.5 w-3.5" /> Kembali ke STT
          </button>
          <h1 className="text-2xl font-bold text-white mb-1">Pengaturan</h1>
          <p className="text-sm text-zinc-400">Kelola penyimpanan model AI & cache di device Anda</p>
        </div>

        {/* Storage Overview */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <HardDrive className="h-4 w-4 text-[#8B5CF6]" />
            <h2 className="text-sm font-medium text-zinc-200">Penyimpanan Device</h2>
            <Button
              onClick={refresh}
              variant="ghost"
              size="sm"
              className="ml-auto text-zinc-400 hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-zinc-500 mb-1">Total Dipakai</p>
              <p className="text-lg font-semibold text-white">
                {storageInfo ? formatBytes(storageInfo.usage) : '-'}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">Kuota Tersedia</p>
              <p className="text-lg font-semibold text-white">
                {storageInfo ? formatBytes(storageInfo.quota) : '-'}
              </p>
            </div>
          </div>

          {/* Persistent storage status */}
          <div className="mt-4 flex items-center gap-2">
            {storageInfo?.persistent ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-400" />
                <span className="text-xs text-green-400">Persistent Storage Aktif</span>
                <span className="text-xs text-zinc-500 ml-2">— Model tidak akan hilang walau browser ditutup</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span className="text-xs text-amber-400">Persistent Storage Belum Aktif</span>
                <Button
                  onClick={handleRequestPersistent}
                  size="sm"
                  variant="outline"
                  className="ml-2 h-6 text-[10px] border-amber-500/30 text-amber-400"
                >
                  Aktifkan
                </Button>
              </>
            )}
          </div>

          {/* OPFS support */}
          <div className="mt-2 flex items-center gap-2">
            <Database className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-xs text-zinc-500">
              OPFS (Origin Private File System): {storageInfo?.opfsSupported ? 'Didukung' : 'Tidak Didukung'}
            </span>
          </div>
        </div>

        {/* Models List */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Cpu className="h-4 w-4 text-[#8B5CF6]" />
            <h2 className="text-sm font-medium text-zinc-200">Model AI yang Tersimpan</h2>
            <Badge variant="outline" className="ml-auto text-[10px] border-white/10 text-zinc-400">
              {storageInfo?.models.length || 0} model
            </Badge>
          </div>

          {storageInfo?.models.length === 0 ? (
            <div className="text-center py-8">
              <FolderOpen className="h-8 w-8 mx-auto mb-2 text-zinc-600" />
              <p className="text-sm text-zinc-500">Belum ada model tersimpan</p>
              <p className="text-xs text-zinc-600 mt-1">
                Download model dari halaman Speech to Text untuk mulai
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {storageInfo?.models.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  deleting={deleting === model.id}
                  onDelete={() => handleDeleteModel(model.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Danger Zone */}
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.02] p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <h2 className="text-sm font-medium text-red-300">Zona Berbahaya</h2>
          </div>
          <p className="text-xs text-zinc-400 mb-4">
            Hapus SEMUA data ALYNNE AI dari device: model, cache, dan pengaturan.
            Tindakan ini tidak dapat dibatalkan.
          </p>

          {!showConfirmClear ? (
            <Button
              onClick={() => setShowConfirmClear(true)}
              variant="outline"
              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Hapus Semua Data AI
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-red-500/30 bg-red-500/[0.05] p-3">
                <p className="text-xs text-red-300 font-medium mb-1">
                  Konfirmasi penghapusan
                </p>
                <p className="text-xs text-red-300/80">
                  Semua model Whisper yang sudah di-download akan dihapus.
                  Anda perlu download ulang untuk pakai STT lagi.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleClearAll}
                  disabled={clearingAll}
                  className="bg-red-500 hover:bg-red-600 text-white"
                >
                  {clearingAll ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Menghapus...</>
                  ) : (
                    <><Trash2 className="h-4 w-4 mr-2" /> Ya, Hapus Semua</>
                  )}
                </Button>
                <Button
                  onClick={() => setShowConfirmClear(false)}
                  variant="ghost"
                  className="text-zinc-400"
                >
                  Batal
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Info Section */}
        <div className="mt-6 rounded-lg border border-white/[0.04] bg-white/[0.02] p-4">
          <div className="flex items-start gap-2">
            <Zap className="h-4 w-4 text-[#8B5CF6] mt-0.5 shrink-0" />
            <div className="text-xs text-zinc-400 leading-relaxed">
              <p className="font-medium text-zinc-300 mb-1">Cara Kerja Penyimpanan</p>
              <p>• Model AI disimpan di <strong>disk device</strong> (HP/SSD/Laptop) via OPFS — bukan RAM.</p>
              <p>• RAM hanya dipakai saat <strong>recording aktif</strong>. Setelah stop 30 detik, RAM otomatis dibebaskan.</p>
              <p>• Model tetap di disk walau browser ditutup — tinggal pakai lagi tanpa download ulang.</p>
              <p>• Lokasi fisik: <code className="text-[#8B5CF6]">ALYNNE-AI/</code> di browser profile directory.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelRow({
  model,
  deleting,
  onDelete,
}: {
  model: CachedModel;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-white/[0.06] bg-white/[0.02]">
      <div className="h-9 w-9 rounded-lg bg-[#8B5CF6]/10 flex items-center justify-center shrink-0">
        <Cpu className="h-4 w-4 text-[#8B5CF6]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{model.name}</p>
        <div className="flex items-center gap-3 text-[10px] text-zinc-500 mt-0.5">
          <span>{model.sizeMB} MB</span>
          {model.lastUsed && (
            <span className="text-green-400/60">● Aktif terakhir</span>
          )}
        </div>
      </div>
      <Button
        onClick={onDelete}
        disabled={deleting}
        variant="ghost"
        size="sm"
        className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
      >
        {deleting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}
