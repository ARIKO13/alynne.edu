'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Database, Trash2, RefreshCw, Search, Brain, Link2, Vote, BarChart3,
  ChevronRight, ArrowLeft, FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type Section = 'stats' | 'words' | 'cooccurrence' | 'corrections' | 'summary' | 'word-detail';
type SourceFilter = '' | 'kbbi' | 'slang' | 'webspeech';

interface DbStats {
  learnedWords: { total: number; confirmed: number; candidates: number; rejected: number };
  cooccurrence: { total: number; uniqueWords: number };
  userCorrections: { total: number; pending: number };
}
interface DbFile {
  path: string;
  sizeBytes: number;
  walSizeBytes: number;
  sizeMB: string;
}
interface SourceBreakdown {
  source: string;
  status: string;
  c: number;
}

interface LearnedWord {
  id: number; word: string; phonetic_variations: string[];
  source: string; confidence: number; count: number; vote_count: number;
  status: 'candidate' | 'confirmed' | 'rejected';
  dataset_origin?: 'seeded' | 'user-learned';
  created_at: string; last_used_at: string;
}

interface Cooccurrence {
  id: number; word: string; context_word: string;
  position: string; distance: number; count: number; updated_at: string;
}

interface Correction {
  id: number; original_word: string; corrected_word: string;
  context_before: string | null; context_after: string | null;
  full_sentence: string | null; user_id: string | null;
  user_weight: number; accepted: number; created_at: string;
}

interface Summary {
  original_word: string; corrected_word: string;
  total_votes: number; weighted_votes: number; last_voted_at: string;
}

export function DatasetLibraryPanel() {
  const [section, setSection] = useState<Section>('stats');
  const [stats, setStats] = useState<DbStats | null>(null);
  const [dbFile, setDbFile] = useState<DbFile | null>(null);
  const [sourceBreakdown, setSourceBreakdown] = useState<SourceBreakdown[]>([]);
  const [words, setWords] = useState<LearnedWord[]>([]);
  const [cooccurrences, setCooccurrences] = useState<Cooccurrence[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('');
  const [loading, setLoading] = useState(false);
  const [selectedWord, setSelectedWord] = useState<string>('');
  const [wordDetail, setWordDetail] = useState<any>(null);

  const fetchData = useCallback(async (sec: Section, searchQuery: string = '', word: string = '', source: SourceFilter = '') => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ section: sec, limit: '200' });
      if (searchQuery) params.set('search', searchQuery);
      if (word) params.set('word', word);
      if (source) params.set('source', source);

      const res = await fetch(`/api/admin/dataset-library?${params}`);
      if (res.status === 403) {
        toast.error('Akses ditolak. Admin only.');
        return;
      }
      const data = await res.json();

      if (sec === 'stats') {
        setStats(data.stats);
        setDbFile(data.dbFile);
        setSourceBreakdown(data.sourceBreakdown || []);
      } else if (sec === 'words') {
        setWords(data.words || []);
        setTotal(data.total || 0);
      } else if (sec === 'cooccurrence') {
        setCooccurrences(data.cooccurrences || []);
        setTotal(data.total || 0);
      } else if (sec === 'corrections') {
        setCorrections(data.corrections || []);
        setTotal(data.total || 0);
      } else if (sec === 'summary') {
        setSummaries(data.summaries || []);
        setTotal(data.total || 0);
      } else if (sec === 'word-detail') {
        setWordDetail(data);
      }
    } catch (e) {
      console.error('Dataset library fetch error:', e);
      toast.error('Gagal load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(section, search, selectedWord, sourceFilter);
  }, [section, fetchData, selectedWord, sourceFilter]);

  const handleSearch = (val: string) => {
    setSearch(val);
    if (section === 'words' && val.length >= 2) {
      fetchData('words', val, '', sourceFilter);
    } else if (section === 'words' && val.length === 0) {
      fetchData('words', '', '', sourceFilter);
    }
  };

  const handleSourceFilterChange = (val: SourceFilter) => {
    setSourceFilter(val);
    if (section === 'words') {
      fetchData('words', search, '', val);
    }
  };

  const handleDeleteWord = async (id: number, word: string) => {
    if (!confirm(`Hapus "${word}" dari dataset? Tindakan ini juga bersihkan phonetic-map.json.`)) return;
    try {
      const res = await fetch(`/api/admin/dataset-library?id=${id}&section=words`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(`"${word}" dihapus`);
        fetchData(section, search, '', sourceFilter);
      } else {
        toast.error('Gagal hapus');
      }
    } catch (e) {
      toast.error('Error: ' + (e instanceof Error ? e.message : 'unknown'));
    }
  };

  const handleDeleteCooccurrence = async (id: number) => {
    if (!confirm('Hapus entry co-occurrence ini?')) return;
    try {
      const res = await fetch(`/api/admin/dataset-library?id=${id}&section=cooccurrence`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Entry dihapus');
        fetchData('cooccurrence');
      }
    } catch (e) {
      toast.error('Error');
    }
  };

  const handleDeleteCorrection = async (id: number) => {
    if (!confirm('Hapus vote koreksi ini?')) return;
    try {
      const res = await fetch(`/api/admin/dataset-library?id=${id}&section=corrections`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Vote dihapus');
        fetchData('corrections');
      }
    } catch (e) {
      toast.error('Error');
    }
  };

  const handleWordClick = (word: string) => {
    setSelectedWord(word);
    setSection('word-detail');
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <Database className="h-4 w-4 text-[#8B5CF6]" />
            Dataset Library (SQLite di SSD VPS)
          </h3>
          {dbFile && (
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {dbFile.path} · {dbFile.sizeMB} MB {dbFile.walSizeBytes > 0 && `· WAL ${(dbFile.walSizeBytes / 1024).toFixed(1)} KB`}
            </p>
          )}
        </div>
        <Button
          onClick={() => fetchData(section, search, selectedWord, sourceFilter)}
          disabled={loading}
          variant="outline"
          size="sm"
          className="border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] h-8 text-xs"
        >
          {loading ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
          Refresh
        </Button>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1 overflow-x-auto">
        <TabButton active={section === 'stats'} onClick={() => { setSection('stats'); setSearch(''); }}>
          <BarChart3 className="h-3.5 w-3.5" /> Stats
        </TabButton>
        <TabButton active={section === 'words'} onClick={() => { setSection('words'); setSearch(''); }}>
          <Brain className="h-3.5 w-3.5" /> Learned Words
        </TabButton>
        <TabButton active={section === 'cooccurrence'} onClick={() => { setSection('cooccurrence'); setSearch(''); }}>
          <Link2 className="h-3.5 w-3.5" /> Co-occurrence
        </TabButton>
        <TabButton active={section === 'corrections'} onClick={() => { setSection('corrections'); setSearch(''); }}>
          <Vote className="h-3.5 w-3.5" /> User Votes
        </TabButton>
        <TabButton active={section === 'summary'} onClick={() => { setSection('summary'); setSearch(''); }}>
          <FileText className="h-3.5 w-3.5" /> Summary
        </TabButton>
      </div>

      {/* Search box (for words section) */}
      {section === 'words' && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" />
            <Input
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Cari kata... (min 2 huruf)"
              className="pl-8 border-white/[0.08] bg-[#0c0c0e] text-zinc-200 text-xs placeholder:text-zinc-600 h-8"
            />
          </div>
          {/* Source filter — pilih: All / KBBI / Slang / Auto-learned */}
          <div className="flex gap-1 flex-wrap">
            <SourcePill
              active={sourceFilter === ''}
              onClick={() => handleSourceFilterChange('')}
              icon="📚"
              label="All"
            />
            <SourcePill
              active={sourceFilter === 'kbbi'}
              onClick={() => handleSourceFilterChange('kbbi')}
              icon="📖"
              label="KBBI"
            />
            <SourcePill
              active={sourceFilter === 'slang'}
              onClick={() => handleSourceFilterChange('slang')}
              icon="💬"
              label="Slang"
            />
            <SourcePill
              active={sourceFilter === 'webspeech'}
              onClick={() => handleSourceFilterChange('webspeech')}
              icon="🎙️"
              label="Auto-learned"
            />
          </div>
        </div>
      )}

      {/* Word detail view (with back button) */}
      {section === 'word-detail' && wordDetail && (
        <div className="space-y-3">
          <button
            onClick={() => { setSection('words'); setSelectedWord(''); }}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            <ArrowLeft className="h-3 w-3" /> Back to words
          </button>
          <WordDetailView detail={wordDetail} />
        </div>
      )}

      {/* Stats section */}
      {section === 'stats' && stats && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <StatCard label="Learned Words (Total)" value={stats.learnedWords.total} icon="📚" color="purple" />
            <StatCard label="Confirmed" value={stats.learnedWords.confirmed} icon="✓" color="emerald" />
            <StatCard label="Candidates" value={stats.learnedWords.candidates} icon="⏳" color="amber" />
            <StatCard label="Rejected" value={stats.learnedWords.rejected} icon="✗" color="red" />
            <StatCard label="Co-occurrences (Total)" value={stats.cooccurrence.total} icon="🔗" color="sky" />
            <StatCard label="Unique Words Tracked" value={stats.cooccurrence.uniqueWords} icon="🔤" color="sky" />
            <StatCard label="User Votes" value={stats.userCorrections.total} icon="🗳️" color="violet" />
            <StatCard label="Pending Review" value={stats.userCorrections.pending} icon="⏸️" color="amber" />
          </div>

          {/* Source breakdown — tampilin distribusi KBBI/slang/auto-learned */}
          {sourceBreakdown.length > 0 && (
            <div className="rounded-lg border border-white/[0.06] bg-[#0c0c0e] p-3">
              <p className="text-[11px] text-zinc-400 mb-2">📊 Breakdown by Source</p>
              <div className="space-y-1.5">
                {sourceBreakdown.map((row, i) => {
                  const sourceLabels: Record<string, { label: string; icon: string; color: string }> = {
                    kbbi: { label: 'KBBI', icon: '📖', color: 'text-purple-400' },
                    slang: { label: 'Slang', icon: '💬', color: 'text-sky-400' },
                    webspeech: { label: 'Auto-learned', icon: '🎙️', color: 'text-emerald-400' },
                  };
                  const meta = sourceLabels[row.source] || { label: row.source, icon: '❓', color: 'text-zinc-400' };
                  return (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <span>{meta.icon}</span>
                      <span className={cn('font-medium', meta.color)}>{meta.label}</span>
                      <span className="text-zinc-500">/</span>
                      <span className="text-zinc-400">{row.status}</span>
                      <span className="text-zinc-300 font-mono ml-auto">{row.c.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {dbFile && (
            <div className="rounded-lg border border-white/[0.06] bg-[#0c0c0e] p-3">
              <p className="text-[11px] text-zinc-500 mb-1">DB File</p>
              <p className="text-xs text-zinc-300 font-mono break-all">{dbFile.path}</p>
              <div className="flex items-center gap-4 mt-2 text-[10px] text-zinc-500">
                <span>Main: <strong className="text-zinc-300">{dbFile.sizeMB} MB</strong></span>
                {dbFile.walSizeBytes > 0 && (
                  <span>WAL: <strong className="text-zinc-300">{(dbFile.walSizeBytes / 1024).toFixed(1)} KB</strong></span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Words list */}
      {section === 'words' && (
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {words.length === 0 ? (
            <div className="text-center py-8 text-sm text-zinc-500">Belum ada kata yang dipelajari</div>
          ) : (
            <>
              <p className="text-[11px] text-zinc-500">{total} total · klik kata untuk lihat detail</p>
              {words.map((w) => (
                <div key={w.id} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5 group">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleWordClick(w.word)}
                      className="text-sm font-mono text-zinc-200 hover:text-[#8B5CF6] transition-colors"
                    >
                      {w.word}
                    </button>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[9px] px-1.5 py-0',
                        w.status === 'confirmed' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                          : w.status === 'candidate' ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                          : 'border-red-500/30 text-red-400 bg-red-500/10'
                      )}
                    >
                      {w.status}
                    </Badge>
                    {/* Source badge — KBBI / Slang / Auto-learned */}
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[9px] px-1.5 py-0',
                        w.source === 'kbbi' ? 'border-purple-500/30 text-purple-400 bg-purple-500/10'
                          : w.source === 'slang' ? 'border-sky-500/30 text-sky-400 bg-sky-500/10'
                          : 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                      )}
                      title={`Source: ${w.source}`}
                    >
                      {w.source === 'kbbi' ? '📖 KBBI' : w.source === 'slang' ? '💬 Slang' : w.source === 'webspeech' ? '🎙️ Auto' : w.source}
                    </Badge>
                    {/* Dataset origin badge — Seeded (lama) vs User-learned (baru dari STT) */}
                    {w.dataset_origin && (
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[9px] px-1.5 py-0',
                          w.dataset_origin === 'seeded'
                            ? 'border-zinc-500/30 text-zinc-400 bg-zinc-500/10'
                            : 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                        )}
                        title={`Origin: ${w.dataset_origin === 'seeded' ? 'Pre-existing dictionary (lama)' : 'Dipalajari dari STT user (baru)'}`}
                      >
                        {w.dataset_origin === 'seeded' ? '📦 Seeded' : '✨ Learned'}
                      </Badge>
                    )}
                    <div className="flex items-center gap-2 ml-auto">
                      <span className="text-[10px] text-zinc-600" title="Occurrences">×{w.count}</span>
                      {w.vote_count > 0 && (
                        <span className="text-[10px] text-sky-500" title="Unique user votes">👥{w.vote_count}</span>
                      )}
                      <span className="text-[10px] text-zinc-600" title="Confidence">
                        {(w.confidence * 100).toFixed(0)}%
                      </span>
                      <span className="text-[10px] text-zinc-600" title="Phonetic variations">
                        {w.phonetic_variations.length} var
                      </span>
                      <button
                        onClick={() => handleDeleteWord(w.id, w.word)}
                        title="Hapus"
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/15 text-zinc-500 hover:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {w.phonetic_variations.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {w.phonetic_variations.slice(0, 8).map((v, i) => (
                        <span key={i} className="text-[9px] font-mono text-zinc-500 bg-[#18181b] border border-white/[0.06] rounded px-1.5 py-0.5">
                          {v}
                        </span>
                      ))}
                      {w.phonetic_variations.length > 8 && (
                        <span className="text-[9px] text-zinc-600">+{w.phonetic_variations.length - 8} more</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Co-occurrence list */}
      {section === 'cooccurrence' && (
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {cooccurrences.length === 0 ? (
            <div className="text-center py-8 text-sm text-zinc-500">Belum ada co-occurrence data</div>
          ) : (
            <>
              <p className="text-[11px] text-zinc-500">{total} total entries</p>
              {cooccurrences.map((c) => (
                <div key={c.id} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5 group flex items-center gap-2">
                  <span className="text-sm font-mono text-zinc-200">{c.word}</span>
                  <ChevronRight className="h-3 w-3 text-zinc-600" />
                  <span className="text-sm font-mono text-[#8B5CF6]">{c.context_word}</span>
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-sky-500/30 text-sky-400 bg-sky-500/10">
                    {c.position} · d{c.distance}
                  </Badge>
                  <span className="text-[10px] text-zinc-600 ml-auto">×{c.count}</span>
                  <button
                    onClick={() => handleDeleteCooccurrence(c.id)}
                    title="Hapus"
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/15 text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Corrections list */}
      {section === 'corrections' && (
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {corrections.length === 0 ? (
            <div className="text-center py-8 text-sm text-zinc-500">Belum ada user votes</div>
          ) : (
            <>
              <p className="text-[11px] text-zinc-500">{total} total votes</p>
              {corrections.map((c) => (
                <div key={c.id} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5 group">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono text-rose-300">{c.original_word}</span>
                    <ChevronRight className="h-3 w-3 text-zinc-600" />
                    <span className="text-sm font-mono text-emerald-300">{c.corrected_word}</span>
                    <span className="text-[10px] text-zinc-600 ml-auto">
                      weight: {c.user_weight.toFixed(1)} · {c.accepted ? '✓ accepted' : '⏳ pending'}
                    </span>
                    <button
                      onClick={() => handleDeleteCorrection(c.id)}
                      title="Hapus vote"
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/15 text-zinc-500 hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  {c.full_sentence && (
                    <p className="text-[11px] text-zinc-500 mt-1 italic">"{c.full_sentence}"</p>
                  )}
                  {(c.context_before || c.context_after) && (
                    <p className="text-[10px] text-zinc-600 mt-1">
                      {c.context_before && <>before: <span className="font-mono text-zinc-400">{c.context_before}</span></>}
                      {c.context_before && c.context_after && ' · '}
                      {c.context_after && <>after: <span className="font-mono text-zinc-400">{c.context_after}</span></>}
                    </p>
                  )}
                  <p className="text-[10px] text-zinc-600 mt-1">
                    {c.user_id ? `user: ${c.user_id.slice(0, 8)}...` : 'anonymous'} · {new Date(c.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Summary list (aggregated correction votes) */}
      {section === 'summary' && (
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {summaries.length === 0 ? (
            <div className="text-center py-8 text-sm text-zinc-500">Belum ada aggregated corrections</div>
          ) : (
            <>
              <p className="text-[11px] text-zinc-500">{total} unique correction pairs</p>
              {summaries.map((s, i) => (
                <div key={i} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-rose-300">{s.original_word}</span>
                    <ChevronRight className="h-3 w-3 text-zinc-600" />
                    <span className="text-sm font-mono text-emerald-300">{s.corrected_word}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-sky-500/30 text-sky-400 bg-sky-500/10">
                        {s.total_votes} votes
                      </Badge>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                        weight: {s.weighted_votes.toFixed(1)}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-1">
                    Last voted: {new Date(s.last_voted_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helper components ──

function TabButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap',
        active
          ? 'bg-[#8B5CF6]/15 text-[#8B5CF6]'
          : 'text-zinc-500 hover:text-zinc-300'
      )}
    >
      {children}
    </button>
  );
}

function SourcePill({ active, onClick, icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-medium transition-all',
        active
          ? 'border-[#8B5CF6]/40 bg-[#8B5CF6]/15 text-[#8B5CF6]'
          : 'border-white/[0.08] bg-white/[0.02] text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]'
      )}
    >
      <span>{icon}</span>
      {label}
    </button>
  );
}

function StatCard({ label, value, icon, color }: {
  label: string;
  value: number;
  icon: string;
  color: 'purple' | 'emerald' | 'amber' | 'red' | 'sky' | 'violet';
}) {
  const colorClasses = {
    purple: 'border-[#8B5CF6]/15 bg-[#8B5CF6]/[0.03]',
    emerald: 'border-emerald-500/15 bg-emerald-500/[0.03]',
    amber: 'border-amber-500/15 bg-amber-500/[0.03]',
    red: 'border-red-500/15 bg-red-500/[0.03]',
    sky: 'border-sky-500/15 bg-sky-500/[0.03]',
    violet: 'border-violet-500/15 bg-violet-500/[0.03]',
  };
  const textColor = {
    purple: 'text-[#8B5CF6]',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    sky: 'text-sky-400',
    violet: 'text-violet-400',
  };
  return (
    <div className={cn('rounded-lg border p-3', colorClasses[color])}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs">{icon}</span>
        <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</p>
      </div>
      <p className={cn('text-xl font-semibold', textColor[color])}>{value}</p>
    </div>
  );
}

function WordDetailView({ detail }: { detail: any }) {
  if (!detail.word) return null;
  const w = detail.word;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[#8B5CF6]/15 bg-[#8B5CF6]/[0.03] p-3">
        <div className="flex items-center gap-2 mb-2">
          <h4 className="text-base font-mono text-[#8B5CF6]">{w.word}</h4>
          <Badge variant="outline" className={cn(
            'text-[9px] px-1.5 py-0',
            w.status === 'confirmed' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
              : w.status === 'candidate' ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
              : 'border-red-500/30 text-red-400 bg-red-500/10'
          )}>
            {w.status}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-zinc-500">Count</p>
            <p className="text-zinc-200 font-mono">{w.count}</p>
          </div>
          <div>
            <p className="text-zinc-500">Vote Count (unique users)</p>
            <p className="text-zinc-200 font-mono">{w.vote_count}</p>
          </div>
          <div>
            <p className="text-zinc-500">Confidence</p>
            <p className="text-zinc-200 font-mono">{(w.confidence * 100).toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-zinc-500">Source</p>
            <p className="text-zinc-200 font-mono">{w.source}</p>
          </div>
          <div>
            <p className="text-zinc-500">Created</p>
            <p className="text-zinc-200 text-[10px]">{new Date(w.created_at).toLocaleString('id-ID')}</p>
          </div>
          <div>
            <p className="text-zinc-500">Last Used</p>
            <p className="text-zinc-200 text-[10px]">{new Date(w.last_used_at).toLocaleString('id-ID')}</p>
          </div>
        </div>
      </div>

      {w.phonetic_variations?.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[#0c0c0e] p-3">
          <p className="text-[11px] text-zinc-400 mb-1.5">Phonetic Variations ({w.phonetic_variations.length})</p>
          <div className="flex flex-wrap gap-1">
            {w.phonetic_variations.map((v: string, i: number) => (
              <span key={i} className="text-[10px] font-mono text-zinc-300 bg-[#18181b] border border-white/[0.06] rounded px-1.5 py-0.5">
                {v}
              </span>
            ))}
          </div>
        </div>
      )}

      {detail.cooccurrence?.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[#0c0c0e] p-3">
          <p className="text-[11px] text-zinc-400 mb-1.5">Co-occurrence ({detail.cooccurrence.length} entries)</p>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {detail.cooccurrence.map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <Badge variant="outline" className={cn(
                  'text-[8px] px-1 py-0',
                  c.position === 'before' ? 'border-sky-500/30 text-sky-400 bg-sky-500/10'
                    : 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                )}>
                  {c.position} · d{c.distance}
                </Badge>
                <span className="font-mono text-zinc-300">{c.context_word}</span>
                <span className="text-zinc-600 ml-auto">×{c.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {detail.corrections?.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[#0c0c0e] p-3">
          <p className="text-[11px] text-zinc-400 mb-1.5">Related User Votes ({detail.corrections.length})</p>
          <div className="space-y-1">
            {detail.corrections.map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="font-mono text-rose-300">{c.original_word}</span>
                <ChevronRight className="h-2.5 w-2.5 text-zinc-600" />
                <span className="font-mono text-emerald-300">{c.corrected_word}</span>
                <span className="text-zinc-600 ml-auto">w:{c.user_weight.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
