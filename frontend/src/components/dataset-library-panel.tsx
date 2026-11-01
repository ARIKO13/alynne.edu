'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Database, Trash2, RefreshCw, Search, Brain, Link2, Vote, BarChart3,
  ChevronRight, ArrowLeft, FileText, HardDrive, GitBranch, Activity, Network,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { MonitoringView } from '@/components/monitoring-view';
import { ArchitectureView } from '@/components/architecture-view';

type Section = 'stats' | 'words' | 'cooccurrence' | 'corrections' | 'summary' | 'word-detail' | 'storage' | 'schema' | 'monitoring' | 'architecture';
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
  const [storageInfo, setStorageInfo] = useState<any>(null);
  const [schemaInfo, setSchemaInfo] = useState<any>(null);
  const [monitoringInfo, setMonitoringInfo] = useState<any>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

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
      } else if (sec === 'storage') {
        setStorageInfo(data);
      } else if (sec === 'schema') {
        setSchemaInfo(data);
      } else if (sec === 'monitoring') {
        setMonitoringInfo(data);
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

  // Auto-refresh monitoring tab every 10s
  useEffect(() => {
    if (section !== 'monitoring' || !autoRefresh) return;
    const interval = setInterval(() => {
      fetchData('monitoring');
    }, 10000);
    return () => clearInterval(interval);
  }, [section, autoRefresh, fetchData]);

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
          <h3 className="text-sm font-semibold text-stone-200 flex items-center gap-2">
            <Database className="h-4 w-4 text-[var(--accent-soft)]" />
            Dataset Library (SQLite di SSD VPS)
          </h3>
          {dbFile && (
            <p className="text-[11px] text-stone-500 mt-0.5">
              {dbFile.path} · {dbFile.sizeMB} MB {dbFile.walSizeBytes > 0 && `· WAL ${(dbFile.walSizeBytes / 1024).toFixed(1)} KB`}
            </p>
          )}
        </div>
        <Button
          onClick={() => fetchData(section, search, selectedWord, sourceFilter)}
          disabled={loading}
          variant="outline"
          size="sm"
          className="border-white/[0.08] text-stone-400 hover:text-stone-200 hover:bg-white/[0.06] h-8 text-xs"
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
        <TabButton active={section === 'storage'} onClick={() => { setSection('storage'); setSearch(''); }}>
          <HardDrive className="h-3.5 w-3.5" /> Storage
        </TabButton>
        <TabButton active={section === 'schema'} onClick={() => { setSection('schema'); setSearch(''); }}>
          <GitBranch className="h-3.5 w-3.5" /> Schema
        </TabButton>
        <TabButton active={section === 'monitoring'} onClick={() => { setSection('monitoring'); setSearch(''); }}>
          <Activity className="h-3.5 w-3.5" /> Monitor
        </TabButton>
        <TabButton active={section === 'architecture'} onClick={() => { setSection('architecture'); setSearch(''); }}>
          <Network className="h-3.5 w-3.5" /> Architecture
        </TabButton>
      </div>

      {/* Search box (for words section) */}
      {section === 'words' && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-600" />
            <Input
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Cari kata... (min 2 huruf)"
              className="pl-8 border-white/[0.08] bg-[#161412] text-stone-200 text-xs placeholder:text-stone-600 h-8"
            />
          </div>
          {/* Source filter - pilih: All / KBBI / Slang / Auto-learned */}
          <div className="flex gap-1 flex-wrap">
            <SourcePill
              active={sourceFilter === ''}
              onClick={() => handleSourceFilterChange('')}
              icon=""
              label="All"
            />
            <SourcePill
              active={sourceFilter === 'kbbi'}
              onClick={() => handleSourceFilterChange('kbbi')}
              icon=""
              label="KBBI"
            />
            <SourcePill
              active={sourceFilter === 'slang'}
              onClick={() => handleSourceFilterChange('slang')}
              icon=""
              label="Slang"
            />
            <SourcePill
              active={sourceFilter === 'webspeech'}
              onClick={() => handleSourceFilterChange('webspeech')}
              icon=""
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
            className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-200"
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
            <StatCard label="Learned Words (Total)" value={stats.learnedWords.total} icon="" color="purple" />
            <StatCard label="Confirmed" value={stats.learnedWords.confirmed} icon="✓" color="emerald" />
            <StatCard label="Candidates" value={stats.learnedWords.candidates} icon="" color="amber" />
            <StatCard label="Rejected" value={stats.learnedWords.rejected} icon="✗" color="red" />
            <StatCard label="Co-occurrences (Total)" value={stats.cooccurrence.total} icon="" color="sky" />
            <StatCard label="Unique Words Tracked" value={stats.cooccurrence.uniqueWords} icon="" color="sky" />
            <StatCard label="User Votes" value={stats.userCorrections.total} icon="" color="violet" />
            <StatCard label="Pending Review" value={stats.userCorrections.pending} icon="" color="amber" />
          </div>

          {/* Source breakdown - tampilin distribusi KBBI/slang/auto-learned */}
          {sourceBreakdown.length > 0 && (
            <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
              <p className="text-[11px] text-stone-400 mb-2">Breakdown by Source</p>
              <div className="space-y-1.5">
                {sourceBreakdown.map((row, i) => {
                  const sourceLabels: Record<string, { label: string; icon: string; color: string }> = {
                    kbbi: { label: 'KBBI', color: 'text-stone-400' },
                    slang: { label: 'Slang', color: 'text-stone-400' },
                    webspeech: { label: 'Auto-learned', color: 'text-stone-400' },
                  };
                  const meta = sourceLabels[row.source] || { label: row.source, color: 'text-stone-400' };
                  return (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <span>{meta.icon}</span>
                      <span className={cn('font-medium', meta.color)}>{meta.label}</span>
                      <span className="text-stone-500">/</span>
                      <span className="text-stone-400">{row.status}</span>
                      <span className="text-stone-300 font-mono ml-auto">{row.c.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {dbFile && (
            <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
              <p className="text-[11px] text-stone-500 mb-1">DB File</p>
              <p className="text-xs text-stone-300 font-mono break-all">{dbFile.path}</p>
              <div className="flex items-center gap-4 mt-2 text-[10px] text-stone-500">
                <span>Main: <strong className="text-stone-300">{dbFile.sizeMB} MB</strong></span>
                {dbFile.walSizeBytes > 0 && (
                  <span>WAL: <strong className="text-stone-300">{(dbFile.walSizeBytes / 1024).toFixed(1)} KB</strong></span>
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
            <div className="text-center py-8 text-sm text-stone-500">Belum ada kata yang dipelajari</div>
          ) : (
            <>
              <p className="text-[11px] text-stone-500">{total} total · klik kata untuk lihat detail</p>
              {words.map((w) => (
                <div key={w.id} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5 group">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleWordClick(w.word)}
                      className="text-sm font-mono text-stone-200 hover:text-[var(--accent-soft)] transition-colors"
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
                    {/* Source badge - KBBI / Slang / Auto-learned */}
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[9px] px-1.5 py-0',
                        w.source === 'kbbi' ? 'border-stone-500/30 text-stone-400 bg-stone-500/10'
                          : w.source === 'slang' ? 'border-orange-700/30 text-[var(--accent-soft)] bg-orange-700/10'
                          : 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                      )}
                      title={`Source: ${w.source}`}
                    >
                      {w.source === 'kbbi' ? 'KBBI' : w.source === 'slang' ? 'Slang' : w.source === 'webspeech' ? 'Auto' : w.source}
                    </Badge>
                    {/* Dataset origin badge - Seeded (lama) vs User-learned (baru dari STT) */}
                    {w.dataset_origin && (
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[9px] px-1.5 py-0',
                          w.dataset_origin === 'seeded'
                            ? 'border-stone-500/30 text-stone-400 bg-stone-500/10'
                            : 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                        )}
                        title={`Origin: ${w.dataset_origin === 'seeded' ? 'Pre-existing dictionary (lama)' : 'Dipalajari dari STT user (baru)'}`}
                      >
                        {w.dataset_origin === 'seeded' ? 'Seeded' : 'Learned'}
                      </Badge>
                    )}
                    <div className="flex items-center gap-2 ml-auto">
                      <span className="text-[10px] text-stone-600" title="Occurrences">×{w.count}</span>
                      {w.vote_count > 0 && (
                        <span className="text-[10px] text-[var(--accent-soft)]" title="Unique user votes">{w.vote_count} vote</span>
                      )}
                      <span className="text-[10px] text-stone-600" title="Confidence">
                        {(w.confidence * 100).toFixed(0)}%
                      </span>
                      <span className="text-[10px] text-stone-600" title="Phonetic variations">
                        {w.phonetic_variations.length} var
                      </span>
                      <button
                        onClick={() => handleDeleteWord(w.id, w.word)}
                        title="Hapus"
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/15 text-stone-500 hover:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {w.phonetic_variations.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {w.phonetic_variations.slice(0, 8).map((v, i) => (
                        <span key={i} className="text-[9px] font-mono text-stone-500 bg-[#171513] border border-white/[0.06] rounded px-1.5 py-0.5">
                          {v}
                        </span>
                      ))}
                      {w.phonetic_variations.length > 8 && (
                        <span className="text-[9px] text-stone-600">+{w.phonetic_variations.length - 8} more</span>
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
            <div className="text-center py-8 text-sm text-stone-500">Belum ada co-occurrence data</div>
          ) : (
            <>
              <p className="text-[11px] text-stone-500">{total} total entries</p>
              {cooccurrences.map((c) => (
                <div key={c.id} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5 group flex items-center gap-2">
                  <span className="text-sm font-mono text-stone-200">{c.word}</span>
                  <ChevronRight className="h-3 w-3 text-stone-600" />
                  <span className="text-sm font-mono text-[var(--accent-soft)]">{c.context_word}</span>
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-orange-700/30 text-[var(--accent-soft)] bg-orange-700/10">
                    {c.position} · d{c.distance}
                  </Badge>
                  <span className="text-[10px] text-stone-600 ml-auto">×{c.count}</span>
                  <button
                    onClick={() => handleDeleteCooccurrence(c.id)}
                    title="Hapus"
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/15 text-stone-500 hover:text-red-400"
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
            <div className="text-center py-8 text-sm text-stone-500">Belum ada user votes</div>
          ) : (
            <>
              <p className="text-[11px] text-stone-500">{total} total votes</p>
              {corrections.map((c) => (
                <div key={c.id} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5 group">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono text-rose-300">{c.original_word}</span>
                    <ChevronRight className="h-3 w-3 text-stone-600" />
                    <span className="text-sm font-mono text-emerald-300">{c.corrected_word}</span>
                    <span className="text-[10px] text-stone-600 ml-auto">
                      weight: {c.user_weight.toFixed(1)} · {c.accepted ? '✓ accepted' : 'pending'}
                    </span>
                    <button
                      onClick={() => handleDeleteCorrection(c.id)}
                      title="Hapus vote"
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/15 text-stone-500 hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  {c.full_sentence && (
                    <p className="text-[11px] text-stone-500 mt-1 italic">"{c.full_sentence}"</p>
                  )}
                  {(c.context_before || c.context_after) && (
                    <p className="text-[10px] text-stone-600 mt-1">
                      {c.context_before && <>before: <span className="font-mono text-stone-400">{c.context_before}</span></>}
                      {c.context_before && c.context_after && ' · '}
                      {c.context_after && <>after: <span className="font-mono text-stone-400">{c.context_after}</span></>}
                    </p>
                  )}
                  <p className="text-[10px] text-stone-600 mt-1">
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
            <div className="text-center py-8 text-sm text-stone-500">Belum ada aggregated corrections</div>
          ) : (
            <>
              <p className="text-[11px] text-stone-500">{total} unique correction pairs</p>
              {summaries.map((s, i) => (
                <div key={i} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-rose-300">{s.original_word}</span>
                    <ChevronRight className="h-3 w-3 text-stone-600" />
                    <span className="text-sm font-mono text-emerald-300">{s.corrected_word}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-orange-700/30 text-[var(--accent-soft)] bg-orange-700/10">
                        {s.total_votes} votes
                      </Badge>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                        weight: {s.weighted_votes.toFixed(1)}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-[10px] text-stone-600 mt-1">
                    Last voted: {new Date(s.last_voted_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Storage section - disk usage, DB file size, table sizes */}
      {section === 'storage' && (
        <StorageView info={storageInfo} />
      )}

      {/* Schema section - ERD-style visualisasi arsitektur DB */}
      {section === 'schema' && (
        <SchemaView info={schemaInfo} />
      )}

      {/* Monitoring section - real-time VPS + PM2 + SQLite stats */}
      {section === 'monitoring' && (
        <MonitoringView info={monitoringInfo} autoRefresh={autoRefresh} onToggleAutoRefresh={() => setAutoRefresh(!autoRefresh)} onRefresh={() => fetchData('monitoring')} loading={loading} />
      )}

      {/* Architecture section - Mermaid diagrams: ERD + data flow */}
      {section === 'architecture' && (
        <ArchitectureView schemaInfo={schemaInfo} />
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
        'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
        active
          ? 'bg-[var(--accent)]/15 text-[var(--accent-soft)]'
          : 'text-stone-500 hover:text-stone-300'
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
        'flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-medium transition-colors',
        active
          ? 'border-[var(--accent)]/40 bg-[var(--accent)]/15 text-[var(--accent-soft)]'
          : 'border-white/[0.08] bg-white/[0.02] text-stone-500 hover:text-stone-300 hover:bg-white/[0.04]'
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
    purple: 'border-[var(--accent)]/15 bg-[var(--accent)]/[0.03]',
    emerald: 'border-emerald-500/15 bg-emerald-500/[0.03]',
    amber: 'border-amber-500/15 bg-amber-500/[0.03]',
    red: 'border-red-500/15 bg-red-500/[0.03]',
    sky: 'border-orange-700/15 bg-orange-700/[0.03]',
    violet: 'border-orange-700/15 bg-orange-700/[0.03]',
  };
  const textColor = {
    purple: 'text-[var(--accent-soft)]',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    sky: 'text-[var(--accent-soft)]',
    violet: 'text-stone-400',
  };
  return (
    <div className={cn('rounded-lg border p-3', colorClasses[color])}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs">{icon}</span>
        <p className="text-[11px] text-stone-500">{label}</p>
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
      <div className="rounded-lg border border-[var(--accent)]/15 bg-[var(--accent)]/[0.03] p-3">
        <div className="flex items-center gap-2 mb-2">
          <h4 className="text-base font-mono text-[var(--accent-soft)]">{w.word}</h4>
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
            <p className="text-stone-500">Count</p>
            <p className="text-stone-200 font-mono">{w.count}</p>
          </div>
          <div>
            <p className="text-stone-500">Vote Count (unique users)</p>
            <p className="text-stone-200 font-mono">{w.vote_count}</p>
          </div>
          <div>
            <p className="text-stone-500">Confidence</p>
            <p className="text-stone-200 font-mono">{(w.confidence * 100).toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-stone-500">Source</p>
            <p className="text-stone-200 font-mono">{w.source}</p>
          </div>
          <div>
            <p className="text-stone-500">Created</p>
            <p className="text-stone-200 text-[10px]">{new Date(w.created_at).toLocaleString('id-ID')}</p>
          </div>
          <div>
            <p className="text-stone-500">Last Used</p>
            <p className="text-stone-200 text-[10px]">{new Date(w.last_used_at).toLocaleString('id-ID')}</p>
          </div>
        </div>
      </div>

      {w.phonetic_variations?.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
          <p className="text-[11px] text-stone-400 mb-1.5">Phonetic Variations ({w.phonetic_variations.length})</p>
          <div className="flex flex-wrap gap-1">
            {w.phonetic_variations.map((v: string, i: number) => (
              <span key={i} className="text-[10px] font-mono text-stone-300 bg-[#171513] border border-white/[0.06] rounded px-1.5 py-0.5">
                {v}
              </span>
            ))}
          </div>
        </div>
      )}

      {detail.cooccurrence?.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
          <p className="text-[11px] text-stone-400 mb-1.5">Co-occurrence ({detail.cooccurrence.length} entries)</p>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {detail.cooccurrence.map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <Badge variant="outline" className={cn(
                  'text-[8px] px-1 py-0',
                  c.position === 'before' ? 'border-orange-700/30 text-[var(--accent-soft)] bg-orange-700/10'
                    : 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                )}>
                  {c.position} · d{c.distance}
                </Badge>
                <span className="font-mono text-stone-300">{c.context_word}</span>
                <span className="text-stone-600 ml-auto">×{c.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {detail.corrections?.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
          <p className="text-[11px] text-stone-400 mb-1.5">Related User Votes ({detail.corrections.length})</p>
          <div className="space-y-1">
            {detail.corrections.map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="font-mono text-rose-300">{c.original_word}</span>
                <ChevronRight className="h-2.5 w-2.5 text-stone-600" />
                <span className="font-mono text-emerald-300">{c.corrected_word}</span>
                <span className="text-stone-600 ml-auto">w:{c.user_weight.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── StorageView: disk usage + DB file + table sizes ──
function StorageView({ info }: { info: any }) {
  if (!info) {
    return (
      <div className="text-center py-8 text-sm text-stone-500">
        Loading storage info...
      </div>
    );
  }
  const dbFile = info.dbFile || { path: '', sizeBytes: 0, walSizeBytes: 0, shmSizeBytes: 0, totalBytes: 0, sizeMB: '0', walMB: '0' };
  const disk = info.disk || { total: 0, used: 0, free: 0, usedPct: '0', freeGB: '0', totalGB: '0' };
  const sqlite = info.sqlite || { pageCount: 0, pageSize: 4096, totalSize: 0, freePages: 0, fragmentationPct: '0', journalMode: 'unknown', synchronous: 1 };
  const tables = info.tables || [];
  const indexes = info.indexes || [];

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const diskUsedPct = parseFloat(disk.usedPct) || 0;

  return (
    <div className="space-y-3">
      {/* Disk usage overview */}
      <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
        <p className="text-[11px] text-stone-400 mb-2 flex items-center gap-1.5">
          <HardDrive className="h-3 w-3" /> VPS Disk Usage
        </p>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-stone-400">Used: <strong className="text-stone-200">{formatBytes(disk.used)}</strong> ({disk.usedPct}%)</span>
            <span className="text-stone-400">Free: <strong className="text-emerald-400">{formatBytes(disk.free)}</strong> ({disk.freeGB} GB)</span>
            <span className="text-stone-400">Total: <strong className="text-stone-200">{disk.totalGB} GB</strong></span>
          </div>
          {/* Disk usage bar */}
          <div className="h-3 bg-[#171513] rounded-full overflow-hidden border border-white/[0.04]">
            <div
              className={cn(
                'h-full rounded-full transition-colors',
                diskUsedPct > 90 ? 'bg-red-500'
                  : diskUsedPct > 75 ? 'bg-amber-500'
                  : 'bg-emerald-500'
              )}
              style={{ width: `${Math.min(diskUsedPct, 100)}%` }}
            />
          </div>
          {diskUsedPct > 75 && (
            <p className="text-[10px] text-amber-400 mt-1">
              Disk hampir penuh ({diskUsedPct}%). Backup file akan jadi besar kalau dataset tumbuh.
            </p>
          )}
        </div>
      </div>

      {/* DB File info */}
      <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
        <p className="text-[11px] text-stone-400 mb-2 flex items-center gap-1.5">
          <Database className="h-3 w-3" /> SQLite DB File
        </p>
        <p className="text-xs text-stone-300 font-mono break-all mb-2">{dbFile.path}</p>
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <div>
            <p className="text-stone-500">Main DB</p>
            <p className="text-stone-200 font-mono">{dbFile.sizeMB} MB</p>
          </div>
          <div>
            <p className="text-stone-500">WAL file</p>
            <p className="text-stone-200 font-mono">{dbFile.walMB} MB</p>
          </div>
          <div>
            <p className="text-stone-500">Total</p>
            <p className="text-stone-200 font-mono">{formatBytes(dbFile.totalBytes)}</p>
          </div>
        </div>
      </div>

      {/* SQLite internals */}
      <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
        <p className="text-[11px] text-stone-400 mb-2 flex items-center gap-1.5">
          <Database className="h-3 w-3" /> SQLite Internal Stats
        </p>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <p className="text-stone-500">Journal Mode</p>
            <p className="text-stone-200 font-mono">{sqlite.journalMode}</p>
          </div>
          <div>
            <p className="text-stone-500">Synchronous</p>
            <p className="text-stone-200 font-mono">{sqlite.synchronous === 1 ? 'NORMAL' : sqlite.synchronous === 2 ? 'FULL' : sqlite.synchronous}</p>
          </div>
          <div>
            <p className="text-stone-500">Page Count</p>
            <p className="text-stone-200 font-mono">{sqlite.pageCount.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-stone-500">Page Size</p>
            <p className="text-stone-200 font-mono">{formatBytes(sqlite.pageSize)}</p>
          </div>
          <div>
            <p className="text-stone-500">Total Size</p>
            <p className="text-stone-200 font-mono">{formatBytes(sqlite.totalSize)}</p>
          </div>
          <div>
            <p className="text-stone-500">Free Pages</p>
            <p className="text-stone-200 font-mono">{sqlite.freePages.toLocaleString()} ({sqlite.fragmentationPct}% frag)</p>
          </div>
        </div>
        {parseFloat(sqlite.fragmentationPct) > 20 && (
          <p className="text-[10px] text-amber-400 mt-2">
            Fragmentation {sqlite.fragmentationPct}% — jalankan VACUUM untuk reclaim space
          </p>
        )}
      </div>

      {/* Table sizes breakdown */}
      <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
        <p className="text-[11px] text-stone-400 mb-2 flex items-center gap-1.5">
          <FileText className="h-3 w-3" /> Tables ({tables.length})
        </p>
        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
          {tables.map((t: any, i: number) => {
            const maxRows = Math.max(...tables.map((x: any) => x.rows || 0));
            const rowPct = maxRows > 0 ? (t.rows / maxRows) * 100 : 0;
            return (
              <div key={i} className="rounded-md border border-white/[0.04] bg-[#171513] p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-mono text-[var(--accent-soft)]">{t.name}</span>
                  <span className="text-[10px] text-stone-500">{t.columns} cols</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-stone-400 w-20">{t.rows.toLocaleString()} rows</span>
                  <div className="flex-1 h-1.5 bg-[#161412] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--accent)]/60 rounded-full"
                      style={{ width: `${rowPct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-stone-400 w-16 text-right">{formatBytes(t.sizeBytes)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Indexes list */}
      <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
        <p className="text-[11px] text-stone-400 mb-2 flex items-center gap-1.5">
          <GitBranch className="h-3 w-3" /> Indexes ({indexes.length})
        </p>
        <div className="flex flex-wrap gap-1">
          {indexes.map((idx: any, i: number) => (
            <span key={i} className="text-[9px] font-mono text-stone-400 bg-[#171513] border border-white/[0.06] rounded px-1.5 py-0.5" title={`Table: ${idx.table}\nSQL: ${idx.sql}`}>
              {idx.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── SchemaView: ERD-style visualisasi arsitektur DB ──
function SchemaView({ info }: { info: any }) {
  if (!info) {
    return (
      <div className="text-center py-8 text-sm text-stone-500">
        Loading schema info...
      </div>
    );
  }
  const tables = info.tables || [];
  const indexes = info.indexes || [];
  const schemaVersion = info.schemaVersion || 'unknown';

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="rounded-lg border border-[var(--accent)]/15 bg-[var(--accent)]/[0.03] p-3">
        <p className="text-[11px] text-stone-400 mb-1 flex items-center gap-1.5">
          <GitBranch className="h-3 w-3" /> Database Schema (ERD)
        </p>
        <p className="text-[10px] text-stone-500">
          Schema version: <strong className="text-[var(--accent-soft)] font-mono">{schemaVersion}</strong>
          {' · '}
          {tables.length} tables · {indexes.length} indexes
        </p>
      </div>

      {/* ERD-style table cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {tables.map((t: any, i: number) => (
          <div key={i} className="rounded-lg border border-white/[0.06] bg-[#161412] overflow-hidden">
            {/* Table header */}
            <div className="px-3 py-2 bg-[var(--accent)]/10 border-b border-[var(--accent)]/20">
              <p className="text-xs font-mono font-semibold text-[var(--accent-soft)] flex items-center gap-1.5">
                <Database className="h-3 w-3" />
                {t.name}
                {t.foreignKeys.length > 0 && (
                  <Badge variant="outline" className="text-[8px] px-1 py-0 border-orange-700/30 text-[var(--accent-soft)] bg-orange-700/10 ml-1">
                    {t.foreignKeys.length} FK
                  </Badge>
                )}
              </p>
            </div>

            {/* Columns */}
            <div className="p-2 space-y-0.5">
              {t.columns.map((col: any, ci: number) => (
                <div key={ci} className="flex items-center gap-2 text-[11px] py-0.5">
                  {col.pk ? (
                    <span className="text-amber-400 shrink-0 text-[10px]" title="Primary Key">PK</span>
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  <span className={cn('font-mono', col.pk ? 'text-amber-300' : 'text-stone-300')}>
                    {col.name}
                  </span>
                  <span className="text-stone-500 text-[10px]">{col.type || '(no type)'}</span>
                  {col.notNull && (
                    <Badge variant="outline" className="text-[8px] px-1 py-0 border-red-500/30 text-red-400 bg-red-500/10">
                      NOT NULL
                    </Badge>
                  )}
                  {col.default && (
                    <span className="text-[9px] text-stone-600 font-mono">
                      = {col.default}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Foreign keys */}
            {t.foreignKeys.length > 0 && (
              <div className="px-2 py-1.5 border-t border-white/[0.04] bg-orange-700/[0.02]">
                <p className="text-[11px] text-[var(--accent-soft)]/70 mb-1">Foreign Keys</p>
                {t.foreignKeys.map((fk: any, fi: number) => (
                  <div key={fi} className="flex items-center gap-1.5 text-[10px] py-0.5">
                    <span className="font-mono text-[var(--accent-soft)]">{fk.from}</span>
                    <span className="text-stone-600">→</span>
                    <span className="font-mono text-emerald-300">{fk.table}.{fk.to}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Indexes on this table */}
            {t.indexes.length > 0 && (
              <div className="px-2 py-1.5 border-t border-white/[0.04]">
                <p className="text-[11px] text-stone-500 mb-1">Indexes ({t.indexes.length})</p>
                <div className="flex flex-wrap gap-1">
                  {t.indexes.map((idx: any, ii: number) => (
                    <span
                      key={ii}
                      className={cn(
                        'text-[9px] font-mono px-1.5 py-0.5 rounded border',
                        idx.unique
                          ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5'
                          : 'border-white/[0.08] text-stone-400 bg-[#171513]'
                      )}
                      title={`Columns: ${idx.columns.join(', ')}${idx.unique ? ' (UNIQUE)' : ''}`}
                    >
                      {idx.unique && 'unique '}{idx.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Relationships summary */}
      <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
        <p className="text-[11px] text-stone-400 mb-2 flex items-center gap-1.5">
          <Link2 className="h-3 w-3" /> Relationships (Foreign Keys)
        </p>
        {(() => {
          const allFks: Array<{ table: string; fk: any; key: string }> = [];
          for (const t of tables) {
            t.foreignKeys.forEach((fk: any, fi: number) => {
              allFks.push({ table: t.name, fk, key: `${t.name}-${fi}` });
            });
          }
          if (allFks.length === 0) {
            return (
              <p className="text-[10px] text-stone-500 italic">
                Tidak ada foreign key constraints di schema ini. Relasi di-handle di application layer (lihat learned-word.ts).
              </p>
            );
          }
          return (
            <div className="space-y-1">
              {allFks.map(({ table, fk, key }: { table: string; fk: any; key: string }) => (
                <div key={key} className="flex items-center gap-2 text-[11px] py-0.5">
                  <span className="font-mono text-stone-300">{table}.{fk.from}</span>
                  <ChevronRight className="h-2.5 w-2.5 text-stone-600" />
                  <span className="font-mono text-emerald-300">{fk.table}.{fk.to}</span>
                  <span className="text-[9px] text-stone-600 ml-auto">
                    ON UPDATE: {fk.onUpdate} · ON DELETE: {fk.onDelete}
                  </span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* All indexes summary */}
      <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
        <p className="text-[11px] text-stone-400 mb-2 flex items-center gap-1.5">
          <GitBranch className="h-3 w-3" /> All Indexes ({indexes.length})
        </p>
        <div className="space-y-1 max-h-[200px] overflow-y-auto">
          {indexes.map((idx: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[10px] py-0.5">
              <span className="font-mono text-[var(--accent-soft)]">{idx.tbl_name}</span>
              <span className="text-stone-600">·</span>
              <span className="font-mono text-stone-400">{idx.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── D1MonitoringView: Cloudflare D1 (user account DB) monitoring ──
function D1MonitoringView({ info, autoRefresh, onToggleAutoRefresh, onRefresh, loading }: {
  info: any;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  if (!info) {
    return (
      <div className="text-center py-8 text-sm text-stone-500">
        Loading D1 monitoring data...
      </div>
    );
  }

  const { d1, timestamp } = info;

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-stone-500 flex items-center gap-1.5">
          <Database className="h-3 w-3" />
          Cloudflare D1 - User Account Database
          {timestamp && (
            <span className="text-stone-600 ml-2">
              Updated: {new Date(timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleAutoRefresh}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors ${
              autoRefresh
                ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                : 'border-white/[0.08] text-stone-400 hover:bg-white/[0.06]'
            }`}
          >
            {autoRefresh ? 'Auto 10s' : 'Jeda'}
          </button>
          <button
            onClick={onRefresh}
            className="p-1 rounded border border-white/[0.08] text-stone-400 hover:bg-white/[0.06] text-[10px]"
          >
            <RefreshCw className={`h-2.5 w-2.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* D1 Info */}
      <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
        <p className="text-[11px] text-stone-400 mb-2 flex items-center gap-1.5">
          <Database className="h-3 w-3" /> D1 Connection Info
        </p>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <p className="text-stone-500">Account ID</p>
            <p className="text-stone-300 font-mono text-[10px]">{d1?.accountId?.slice(0, 16)}...</p>
          </div>
          <div>
            <p className="text-stone-500">Database ID</p>
            <p className="text-stone-300 font-mono text-[10px]">{d1?.databaseId?.slice(0, 16)}...</p>
          </div>
          <div>
            <p className="text-stone-500">Region</p>
            <p className="text-stone-300 font-mono">{d1?.region}</p>
          </div>
          <div>
            <p className="text-stone-500">Type</p>
            <p className="text-stone-300 font-mono">Cloudflare D1 (HTTP API)</p>
          </div>
        </div>
      </div>

      {/* Table counts */}
      <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
        <p className="text-[11px] text-stone-400 mb-2 flex items-center gap-1.5">
          <Database className="h-3 w-3" /> Tables ({d1?.tables?.length || 0})
        </p>
        <div className="space-y-1.5">
          {d1?.tables?.map((t: any, i: number) => {
            const maxCount = Math.max(...(d1?.tables || []).map((x: any) => x.count || 0));
            const pct = maxCount > 0 ? (t.count / maxCount) * 100 : 0;
            return (
              <div key={i} className="rounded-md border border-white/[0.04] bg-[#171513] p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-mono text-[var(--accent-soft)]">{t.name}</span>
                  <span className="text-[10px] text-stone-400 font-mono">{t.count.toLocaleString()}</span>
                </div>
                {t.error && (
                  <p className="text-[9px] text-red-400">Error: {t.error}</p>
                )}
                <div className="h-1.5 bg-[#161412] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)]/60 rounded-full"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent users */}
      {d1?.recentUsers?.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
          <p className="text-[11px] text-stone-400 mb-2">Recent Users (last 5)</p>
          <div className="space-y-1">
            {d1.recentUsers.map((u: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
                <span className="font-mono text-stone-300">{u.name || '-'}</span>
                <span className="text-stone-600">{u.email}</span>
                <span className="text-stone-600 ml-auto text-[10px]">
                  {new Date(u.createdAt).toLocaleDateString('id-ID', { dateStyle: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent STT failures */}
      {d1?.recentFailures?.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-[#161412] p-3">
          <p className="text-[11px] text-stone-400 mb-2">Recent STT Failures (last 5)</p>
          <div className="space-y-1">
            {d1.recentFailures.map((f: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/30 text-amber-400 bg-amber-500/10">
                  {f.source}
                </Badge>
                <span className="text-stone-600">{f.unknownCount} unknown</span>
                <span className="text-stone-600 ml-auto text-[10px]">
                  {new Date(f.createdAt).toLocaleDateString('id-ID', { dateStyle: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* D1 architecture note */}
      <div className="rounded-lg border border-orange-700/15 bg-orange-700/[0.03] p-3">
        <p className="text-[11px] text-[var(--accent-soft)] mb-1">D1 vs SQLite</p>
        <p className="text-[10px] text-stone-400 leading-relaxed">
          D1 (Cloudflare) menyimpan data user account: Users, Certificates, Subscriptions, DailyProgress,
          MindMaps, Bookmarks, STTFailure. Diakses via HTTP API (50-200ms per query).
          SQLite di VPS SSD menyimpan STT dictionary (learned_words, cooccurrence, corrections) -
          synchronous, {'<'}1ms per query.
        </p>
      </div>
    </div>
  );
}
