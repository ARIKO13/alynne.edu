'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  BookOpen, Trash2, Plus, Loader2, Check, Search, Download, Upload,
  AlertCircle, Sparkles, Brain,
} from 'lucide-react';
import {
  getAllPersonalEntries,
  confirmWord,
  deleteWord,
  clearAllPersonalDict,
  getPersonalDictStats,
  exportPersonalDict,
  importPersonalDict,
  PERSONAL_DICT_CONSTANTS,
  type PersonalDict,
} from '@/lib/personal-dict';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface PersonalDictPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PersonalDictPanel({ open, onOpenChange }: PersonalDictPanelProps) {
  const [entries, setEntries] = useState<PersonalDict>({});
  const [stats, setStats] = useState({ total: 0, confirmed: 0, candidates: 0 });
  const [search, setSearch] = useState('');
  const [newWord, setNewWord] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showImportInput, setShowImportInput] = useState(false);
  const [importText, setImportText] = useState('');

  const refresh = useCallback(() => {
    setEntries(getAllPersonalEntries());
    setStats(getPersonalDictStats());
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleAddWord = () => {
    const w = newWord.trim().toLowerCase();
    if (!w) return;
    if (w.length < 3) {
      toast.error('Kata minimal 3 huruf');
      return;
    }
    confirmWord(w);
    setNewWord('');
    refresh();
    toast.success(`"${w}" ditambahkan ke personal dict`);
  };

  const handleDelete = (word: string) => {
    deleteWord(word);
    refresh();
    toast.success(`"${word}" dihapus`);
  };

  const handleConfirmCandidate = (word: string) => {
    confirmWord(word);
    refresh();
    toast.success(`"${word}" dikonfirmasi`);
  };

  const handleClearAll = () => {
    clearAllPersonalDict();
    setShowClearConfirm(false);
    refresh();
    toast.success('Personal dict dikosongkan');
  };

  const handleExport = () => {
    const json = exportPersonalDict();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alynne-personal-dict-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Personal dict di-export');
  };

  const handleImport = () => {
    const result = importPersonalDict(importText);
    setShowImportInput(false);
    setImportText('');
    refresh();
    if (result.added > 0) {
      toast.success(`Imported ${result.added} kata baru (+${result.skipped} merged)`);
    } else if (result.skipped > 0) {
      toast.success(`Merged ${result.skipped} kata (sudah ada)`);
    } else {
      toast.error('Import gagal — format JSON tidak valid');
    }
  };

  // Filter entries by search
  const filteredEntries = Object.entries(entries)
    .filter(([word]) => word.toLowerCase().includes(search.toLowerCase()))
    .sort(([, a], [, b]) => b.lastHeard - a.lastHeard);

  const confirmedEntries = filteredEntries.filter(([, e]) => e.confirmed);
  const candidateEntries = filteredEntries.filter(([, e]) => !e.confirmed);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-white/[0.06] bg-[#18181b] p-0 overflow-hidden">
        <div className="px-6 pt-6 pb-2">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-[#8B5CF6]" />
              <DialogTitle className="text-zinc-100">Personal Dictionary</DialogTitle>
            </div>
            <DialogDescription className="text-zinc-500">
              Kata yang dipelajari otomatis dari STT. Confidence &gt; {PERSONAL_DICT_CONSTANTS.CONFIDENCE_THRESHOLD},
              muncul {PERSONAL_DICT_CONSTANTS.PROMOTION_THRESHOLD}+ kali → dikonfirmasi.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pb-4 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-white/[0.06] bg-[#0c0c0e] p-3 text-center">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Total</p>
              <p className="text-xl font-semibold text-zinc-200 mt-0.5">{stats.total}</p>
            </div>
            <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.03] p-3 text-center">
              <p className="text-[10px] text-emerald-400/70 uppercase tracking-wider">Confirmed</p>
              <p className="text-xl font-semibold text-emerald-400 mt-0.5">{stats.confirmed}</p>
            </div>
            <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.03] p-3 text-center">
              <p className="text-[10px] text-amber-400/70 uppercase tracking-wider">Candidates</p>
              <p className="text-xl font-semibold text-amber-400 mt-0.5">{stats.candidates}</p>
            </div>
          </div>

          {/* Add new word */}
          <div className="flex gap-2">
            <Input
              type="text"
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddWord(); }}
              placeholder="Tambah kata manual (e.g. 'goceh', 'anomali')..."
              className="border-white/[0.08] bg-[#0c0c0e] text-zinc-200 placeholder:text-zinc-600"
            />
            <Button
              onClick={handleAddWord}
              disabled={!newWord.trim()}
              className="bg-[#8B5CF6] hover:bg-[#7c3aed] text-white rounded-lg gap-1.5 shrink-0"
            >
              <Plus className="h-4 w-4" />
              Tambah
            </Button>
          </div>

          {/* Search + actions */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" />
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari kata..."
                className="pl-8 border-white/[0.08] bg-[#0c0c0e] text-zinc-200 text-xs placeholder:text-zinc-600 h-8"
              />
            </div>
            <Button
              onClick={handleExport}
              variant="outline"
              size="sm"
              className="border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] h-8 text-xs gap-1.5"
              title="Export ke JSON"
            >
              <Download className="h-3 w-3" />
              Export
            </Button>
            <Button
              onClick={() => setShowImportInput(!showImportInput)}
              variant="outline"
              size="sm"
              className="border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] h-8 text-xs gap-1.5"
              title="Import dari JSON"
            >
              <Upload className="h-3 w-3" />
              Import
            </Button>
            {stats.total > 0 && (
              <Button
                onClick={() => setShowClearConfirm(true)}
                variant="outline"
                size="sm"
                className="border-red-500/20 text-red-400 hover:text-white hover:bg-red-600/80 h-8 text-xs gap-1.5"
              >
                <Trash2 className="h-3 w-3" />
                Hapus Semua
              </Button>
            )}
          </div>

          {/* Import textarea */}
          {showImportInput && (
            <div className="rounded-lg border border-white/[0.06] bg-[#0c0c0e] p-3 space-y-2">
              <p className="text-[11px] text-zinc-400">Paste JSON dari hasil export:</p>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder='{"word1": {"count": 2, "confirmed": true, ...}}'
                className="w-full h-24 text-[11px] font-mono bg-[#18181b] border border-white/[0.06] rounded p-2 text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:border-[#8B5CF6]/40"
              />
              <div className="flex gap-2 justify-end">
                <Button
                  onClick={() => { setShowImportInput(false); setImportText(''); }}
                  variant="outline"
                  size="sm"
                  className="border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] h-7 text-xs"
                >
                  Batal
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={!importText.trim()}
                  size="sm"
                  className="bg-[#8B5CF6] hover:bg-[#7c3aed] text-white h-7 text-xs"
                >
                  Import
                </Button>
              </div>
            </div>
          )}

          {/* Clear confirmation */}
          {showClearConfirm && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-medium text-red-300">Hapus semua {stats.total} kata?</p>
                <p className="text-[10px] text-red-400/70 mt-0.5">Tidak bisa dibatalkan. Personal dict akan dimulai dari nol.</p>
              </div>
              <div className="flex gap-1.5">
                <Button
                  onClick={() => setShowClearConfirm(false)}
                  variant="outline"
                  size="sm"
                  className="border-white/[0.08] text-zinc-300 hover:bg-white/[0.06] h-7 text-xs"
                >
                  Batal
                </Button>
                <Button
                  onClick={handleClearAll}
                  size="sm"
                  className="bg-red-600 hover:bg-red-700 text-white h-7 text-xs"
                >
                  Hapus
                </Button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {stats.total === 0 && (
            <div className="text-center py-8 rounded-xl border border-white/[0.06] bg-[#0c0c0e]">
              <BookOpen className="h-8 w-8 text-zinc-700 mx-auto mb-2" />
              <p className="text-sm text-zinc-500">Personal dict masih kosong</p>
              <p className="text-[10px] text-zinc-600 mt-1 max-w-sm mx-auto leading-relaxed">
                Saat kamu pakai STT, kata yang kamu ucap dengan confidence tinggi & muncul
                2+ kali akan otomatis masuk ke sini. Kamu juga bisa tambah manual di atas.
              </p>
            </div>
          )}

          {/* List */}
          {stats.total > 0 && (
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {/* Confirmed */}
              {confirmedEntries.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Check className="h-3 w-3 text-emerald-400" />
                    <p className="text-[11px] font-medium text-emerald-400">
                      Confirmed ({confirmedEntries.length})
                    </p>
                    <span className="text-[10px] text-zinc-600">— dikenali oleh isKnown()</span>
                  </div>
                  <div className="space-y-1">
                    {confirmedEntries.slice(0, 50).map(([word, entry]) => (
                      <PersonalDictRow
                        key={word}
                        word={word}
                        entry={entry}
                        onDelete={handleDelete}
                        onConfirm={handleConfirmCandidate}
                        isConfirmed
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Candidates */}
              {candidateEntries.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Sparkles className="h-3 w-3 text-amber-400" />
                    <p className="text-[11px] font-medium text-amber-400">
                      Candidates ({candidateEntries.length})
                    </p>
                    <span className="text-[10px] text-zinc-600">
                      — perlu {PERSONAL_DICT_CONSTANTS.PROMOTION_THRESHOLD}+ kemunculan untuk auto-confirm
                    </span>
                  </div>
                  <div className="space-y-1">
                    {candidateEntries.slice(0, 50).map(([word, entry]) => (
                      <PersonalDictRow
                        key={word}
                        word={word}
                        entry={entry}
                        onDelete={handleDelete}
                        onConfirm={handleConfirmCandidate}
                        isConfirmed={false}
                      />
                    ))}
                  </div>
                </div>
              )}

              {(confirmedEntries.length > 50 || candidateEntries.length > 50) && (
                <p className="text-center text-[11px] text-zinc-600 pt-2">
                  {filteredEntries.length > 100 ? 'Menampilkan 100 kata pertama. Pakai search untuk filter.' : `Menampilkan ${filteredEntries.length} kata`}
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PersonalDictRow({
  word, entry, onDelete, onConfirm, isConfirmed,
}: {
  word: string;
  entry: { count: number; firstHeard: number; lastHeard: number; confidence: number; confirmed: boolean };
  onDelete: (word: string) => void;
  onConfirm: (word: string) => void;
  isConfirmed: boolean;
}) {
  const lastHeard = new Date(entry.lastHeard).toLocaleDateString('id-ID', { dateStyle: 'short' });
  return (
    <div className={cn(
      'flex items-center gap-2 rounded-md border px-2.5 py-1.5 group',
      isConfirmed
        ? 'border-emerald-500/15 bg-emerald-500/[0.03]'
        : 'border-amber-500/15 bg-amber-500/[0.03]'
    )}>
      <span className={cn(
        'text-sm font-mono',
        isConfirmed ? 'text-emerald-300' : 'text-amber-300'
      )}>
        {word}
      </span>
      <div className="flex items-center gap-2 ml-auto">
        <span className="text-[10px] text-zinc-600" title="Jumlah kemunculan">
          ×{entry.count}
        </span>
        <span className="text-[10px] text-zinc-600" title="Confidence rata-rata">
          {(entry.confidence * 100).toFixed(0)}%
        </span>
        <span className="text-[10px] text-zinc-600">{lastHeard}</span>
        {!isConfirmed && (
          <button
            onClick={() => onConfirm(word)}
            title="Konfirmasi manual"
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-emerald-500/15 text-zinc-500 hover:text-emerald-400"
          >
            <Check className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={() => onDelete(word)}
          title="Hapus"
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/15 text-zinc-500 hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
