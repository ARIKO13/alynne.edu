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
  BookOpen, Trash2, Plus, Loader2, Check, Search, Download,
  AlertCircle, Sparkles, Brain, Globe,
} from 'lucide-react';
import {
  fetchLearnedWords,
  deleteLearnedWord,
  LEARNED_WORD_CONSTANTS,
  type LearnedWordEntry,
  type LearnedWordsStats,
} from '@/lib/personal-dict';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface PersonalDictPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PersonalDictPanel({ open, onOpenChange }: PersonalDictPanelProps) {
  const [words, setWords] = useState<LearnedWordEntry[]>([]);
  const [stats, setStats] = useState<LearnedWordsStats>({ total: 0, confirmed: 0, candidates: 0 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await fetchLearnedWords();
    setWords(data.words);
    setStats(data.stats);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleDelete = async (id: number, word: string) => {
    const ok = await deleteLearnedWord(id);
    if (ok) {
      setWords(prev => prev.filter(w => w.id !== id));
      setStats(prev => ({
        ...prev,
        total: Math.max(0, prev.total - 1),
        confirmed: Math.max(0, prev.confirmed - 1),
      }));
      toast.success(`"${word}" dihapus dari global dict`);
    } else {
      toast.error('Gagal menghapus kata');
    }
  };

  const handleExport = () => {
    const data = JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      words,
      stats,
    }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alynne-learned-words-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Learned words di-export');
  };

  // Filter by search
  const filteredWords = words.filter(w =>
    w.word.toLowerCase().includes(search.toLowerCase())
  );
  const confirmedWords = filteredWords.filter(w => w.count >= LEARNED_WORD_CONSTANTS.PROMOTION_THRESHOLD);
  const candidateWords = filteredWords.filter(w => w.count < LEARNED_WORD_CONSTANTS.PROMOTION_THRESHOLD);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-white/[0.06] bg-[#161618] p-0 overflow-hidden">
        <div className="px-6 pt-6 pb-2">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-[#7C3AED]" />
              <DialogTitle className="text-zinc-100">Learned Words (Global)</DialogTitle>
              <Globe className="h-3.5 w-3.5 text-emerald-400 ml-1" aria-label="Shared across all users" />
            </div>
            <DialogDescription className="text-zinc-500">
              Kata yang dipelajari otomatis dari STT - dipake semua user. Setiap kata
              di-expand ke variasi fonetik (misal "goceh" → "go ceh", "goseh", "gokeh") supaya
              phoneticMatch bisa kenalan.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pb-4 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-white/[0.06] bg-[#111113] p-3 text-center">
              <p className="text-[11px] text-zinc-500">Total</p>
              <p className="text-xl font-semibold text-zinc-200 mt-0.5">{stats.total}</p>
            </div>
            <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.03] p-3 text-center">
              <p className="text-[11px] text-emerald-400/70">Confirmed</p>
              <p className="text-xl font-semibold text-emerald-400 mt-0.5">{stats.confirmed}</p>
            </div>
            <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.03] p-3 text-center">
              <p className="text-[11px] text-amber-400/70">Candidates</p>
              <p className="text-xl font-semibold text-amber-400 mt-0.5">{stats.candidates}</p>
            </div>
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
                className="pl-8 border-white/[0.08] bg-[#111113] text-zinc-200 text-xs placeholder:text-zinc-600 h-8"
              />
            </div>
            <Button
              onClick={refresh}
              disabled={loading}
              variant="outline"
              size="sm"
              className="border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] h-8 text-xs gap-1.5"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Refresh
            </Button>
            {stats.total > 0 && (
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
            )}
          </div>

          {/* Empty state */}
          {!loading && stats.total === 0 && (
            <div className="text-center py-8 rounded-lg border border-white/[0.06] bg-[#111113]">
              <BookOpen className="h-8 w-8 text-zinc-700 mx-auto mb-2" />
              <p className="text-sm text-zinc-500">Belum ada kata yang dipelajari</p>
              <p className="text-[10px] text-zinc-600 mt-1 max-w-sm mx-auto leading-relaxed">
                Saat user pakai STT, kata yang diucapkan dengan confidence tinggi &amp; muncul
                2+ kali akan otomatis masuk ke sini. Server juga generate variasi fonetik
                supaya kata mirip bisa dikenali.
              </p>
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div className="text-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-[#7C3AED] mx-auto" />
              <p className="text-xs text-zinc-500 mt-2">Memuat learned words...</p>
            </div>
          )}

          {/* List */}
          {!loading && stats.total > 0 && (
            <div className="space-y-3 max-h-[450px] overflow-y-auto">
              {/* Confirmed */}
              {confirmedWords.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Check className="h-3 w-3 text-emerald-400" />
                    <p className="text-[11px] font-medium text-emerald-400">
                      Confirmed ({confirmedWords.length})
                    </p>
                    <span className="text-[10px] text-zinc-600">
                      - muncul {LEARNED_WORD_CONSTANTS.PROMOTION_THRESHOLD}+ kali
                    </span>
                  </div>
                  <div className="space-y-1">
                    {confirmedWords.slice(0, 100).map((entry) => (
                      <LearnedWordRow
                        key={entry.id}
                        entry={entry}
                        onDelete={() => handleDelete(entry.id, entry.word)}
                        isConfirmed
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Candidates */}
              {candidateWords.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Sparkles className="h-3 w-3 text-amber-400" />
                    <p className="text-[11px] font-medium text-amber-400">
                      Candidates ({candidateWords.length})
                    </p>
                    <span className="text-[10px] text-zinc-600">
                      - perlu {LEARNED_WORD_CONSTANTS.PROMOTION_THRESHOLD}+ kemunculan untuk confirm
                    </span>
                  </div>
                  <div className="space-y-1">
                    {candidateWords.slice(0, 50).map((entry) => (
                      <LearnedWordRow
                        key={entry.id}
                        entry={entry}
                        onDelete={() => handleDelete(entry.id, entry.word)}
                        isConfirmed={false}
                      />
                    ))}
                  </div>
                </div>
              )}

              {(filteredWords.length > 100) && (
                <p className="text-center text-[11px] text-zinc-600 pt-2">
                  {filteredWords.length > 150 ? 'Menampilkan 150 kata pertama. Pakai search untuk filter.' : `Menampilkan ${filteredWords.length} kata`}
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LearnedWordRow({
  entry, onDelete, isConfirmed,
}: {
  entry: LearnedWordEntry;
  onDelete: () => void;
  isConfirmed: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const lastUsed = new Date(entry.last_used_at).toLocaleDateString('id-ID', { dateStyle: 'short' });

  return (
    <div className={cn(
      'rounded-md border px-2.5 py-1.5 group',
      isConfirmed
        ? 'border-emerald-500/15 bg-emerald-500/[0.03]'
        : 'border-amber-500/15 bg-amber-500/[0.03]'
    )}>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-sm font-mono flex-1 text-left"
          title="Klik untuk lihat variasi fonetik"
        >
          <span className={isConfirmed ? 'text-emerald-300' : 'text-amber-300'}>
            {entry.word}
          </span>
          {entry.phonetic_variations.length > 0 && (
            <span className="text-[10px] text-zinc-600 ml-2">
              ({entry.phonetic_variations.length} variasi)
            </span>
          )}
        </button>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-600" title="Jumlah kemunculan">
            ×{entry.count}
          </span>
          {entry.vote_count > 0 && (
            <span className="text-[10px] text-sky-500" title="Jumlah user berbeda yang submit">
              {entry.vote_count} vote
            </span>
          )}
          <span className="text-[10px] text-zinc-600" title="Confidence rata-rata">
            {(entry.confidence * 100).toFixed(0)}%
          </span>
          <span className="text-[10px] text-zinc-600" title="Source">
            {entry.source}
          </span>
          <span className="text-[10px] text-zinc-600" title={`Status: ${entry.status}`}>
            {entry.status === 'confirmed' ? '✓' : entry.status === 'candidate' ? 'kandidat' : '✗'}
          </span>
          <span className="text-[10px] text-zinc-600">{lastUsed}</span>
          <button
            onClick={onDelete}
            title="Hapus dari global dict"
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/15 text-zinc-500 hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      {expanded && entry.phonetic_variations.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-white/[0.04]">
          <p className="text-[10px] text-zinc-500 mb-1">Variasi fonetik (auto-generated):</p>
          <div className="flex flex-wrap gap-1">
            {entry.phonetic_variations.map((v, i) => (
              <span
                key={i}
                className="text-[10px] font-mono text-zinc-400 bg-[#161618] border border-white/[0.06] rounded px-1.5 py-0.5"
              >
                {v}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
