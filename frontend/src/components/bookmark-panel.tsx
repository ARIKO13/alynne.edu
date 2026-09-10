import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  BookmarkPlus, Search, Download, Trash2, Edit3, X, Save, Tag,
  Plus, Palette, FileText, StickyNote, ChevronDown, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const COLORS = [
  { name: 'Violet', value: '#B794F6' },
  { name: 'Magenta', value: '#F687B3' },
  { name: 'Sky', value: '#60A5FA' },
  { name: 'Emerald', value: '#34D399' },
  { name: 'Amber', value: '#FBBF24' },
  { name: 'Rose', value: '#FB7185' },
];

interface Bookmark {
  id: string;
  userId: string;
  materialName: string;
  text: string;
  note: string;
  color: string;
  createdAt: string;
}

export function BookmarkPanel() {
  const { user, transcript } = useAppStore();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formText, setFormText] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formMaterial, setFormMaterial] = useState('');
  const [formColor, setFormColor] = useState('#B794F6');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchBookmarks = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetch('/api/bookmarks');
      const data = await res.json();
      if (data.bookmarks) setBookmarks(data.bookmarks);
    } catch (err) {
      console.error('Fetch bookmarks error:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchBookmarks(); }, [fetchBookmarks]);

  const handleSave = async () => {
    if (!formText.trim()) {
      toast.error('Teks highlight tidak boleh kosong');
      return;
    }
    setSaving(true);
    try {
      const body = {
        text: formText.trim(),
        note: formNote.trim(),
        materialName: formMaterial.trim() || 'Umum',
        color: formColor,
      };
      if (editingId) {
        const res = await fetch(`/api/bookmarks/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) toast.success('Bookmark diperbarui');
      } else {
        const res = await fetch('/api/bookmarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) toast.success('Bookmark disimpan');
      }
      resetForm();
      fetchBookmarks();
    } catch (err) {
      toast.error('Gagal menyimpan bookmark');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/bookmarks/${id}`, { method: 'DELETE' });
      toast.success('Bookmark dihapus');
      fetchBookmarks();
    } catch {
      toast.error('Gagal menghapus');
    }
  };

  const handleEdit = (b: Bookmark) => {
    setEditingId(b.id);
    setFormText(b.text);
    setFormNote(b.note);
    setFormMaterial(b.materialName);
    setFormColor(b.color);
    setShowForm(true);
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormText('');
    setFormNote('');
    setFormMaterial('');
    setFormColor('#B794F6');
  };

  const handlePasteFromTranscript = () => {
    if (transcript.trim()) {
      setFormText(transcript.trim());
      toast.success('Transcript ditempelkan');
    } else {
      toast.error('Tidak ada transcript tersedia');
    }
  };

  const handleExport = () => {
    const filtered = bookmarks.filter(b =>
      !searchQuery ||
      b.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.note.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.materialName.toLowerCase().includes(searchQuery.toLowerCase())
    );
    if (filtered.length === 0) {
      toast.error('Tidak ada bookmark untuk diexport');
      return;
    }
    let text = '=== CATATAN & HIGHLIGHT ALYNNE.EDU ===\n';
    text += `Diekspor: ${new Date().toLocaleString('id-ID')}\n\n`;
    filtered.forEach((b, i) => {
      text += `--- Catatan ${i + 1} ---\n`;
      text += `Modul: ${b.materialName}\n`;
      text += `Highlight: ${b.text}\n`;
      if (b.note) text += `Catatan: ${b.note}\n`;
      text += `Tanggal: ${new Date(b.createdAt).toLocaleString('id-ID')}\n\n`;
    });
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `catatan-alynne-${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Catatan diekspor');
  };

  const filteredBookmarks = bookmarks.filter(b =>
    !searchQuery ||
    b.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.note.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.materialName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Bookmark & Catatan</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Tandai bagian penting dan tambah catatan personal</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleExport}
            variant="outline"
            size="sm"
            className="border-white/[0.08] text-zinc-400 hover:text-white hover:bg-white/[0.04] gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
          <Button
            onClick={() => { resetForm(); setShowForm(true); }}
            size="sm"
            className="bg-gradient-to-r from-[#B794F6] to-[#F687B3] text-white hover:opacity-90 gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Tambah
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
        <input
          type="text"
          placeholder="Cari bookmark atau catatan..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-[#B794F6]/30 focus:ring-1 focus:ring-[#B794F6]/20 transition-all"
        />
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="glass-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              {editingId ? 'Edit Bookmark' : 'Bookmark Baru'}
            </h3>
            <button onClick={resetForm} className="text-zinc-500 hover:text-white transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[11px] text-zinc-500 mb-1.5 block">Nama Modul / Topik</label>
              <input
                type="text"
                placeholder="cth: Biologi Bab 3"
                value={formMaterial}
                onChange={(e) => setFormMaterial(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-[#B794F6]/30 transition-all"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] text-zinc-500">Teks Highlight</label>
                <button
                  onClick={handlePasteFromTranscript}
                  className="text-[10px] text-[#B794F6] hover:text-[#B794F6]/80 transition-colors"
                >
                  Tempel dari Transcript
                </button>
              </div>
              <textarea
                placeholder="Teks yang ingin ditandai..."
                value={formText}
                onChange={(e) => setFormText(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-[#B794F6]/30 transition-all resize-none"
              />
            </div>

            <div>
              <label className="text-[11px] text-zinc-500 mb-1.5 block">Catatan Personal (opsional)</label>
              <textarea
                placeholder="Tambahkan catatan..."
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-[#B794F6]/30 transition-all resize-none"
              />
            </div>

            <div>
              <label className="text-[11px] text-zinc-500 mb-1.5 flex items-center gap-1.5">
                <Palette className="h-3 w-3" /> Warna
              </label>
              <div className="flex gap-2">
                {COLORS.map(c => (
                  <button
                    key={c.value}
                    onClick={() => setFormColor(c.value)}
                    className={cn(
                      'h-7 w-7 rounded-full border-2 transition-all',
                      formColor === c.value
                        ? 'border-white scale-110'
                        : 'border-transparent hover:scale-105'
                    )}
                    style={{ backgroundColor: c.value }}
                    title={c.name}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={resetForm} variant="outline" size="sm"
              className="flex-1 border-white/[0.08] text-zinc-400 hover:text-white">
              Batal
            </Button>
            <Button onClick={handleSave} disabled={saving} size="sm"
              className="flex-1 bg-gradient-to-r from-[#B794F6] to-[#F687B3] text-white hover:opacity-90">
              {saving ? 'Menyimpan...' : editingId ? 'Perbarui' : 'Simpan'}
            </Button>
          </div>
        </div>
      )}

      {/* Bookmark List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-[#B794F6] border-t-transparent rounded-full" />
        </div>
      ) : filteredBookmarks.length === 0 ? (
        <div className="text-center py-16">
          <StickyNote className="h-12 w-12 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">
            {searchQuery ? 'Tidak ditemukan' : 'Belum ada bookmark'}
          </p>
          <p className="text-xs text-zinc-600 mt-1">
            {searchQuery ? 'Coba kata kunci lain' : 'Tambahkan bookmark pertamamu'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredBookmarks.map((b) => (
            <div
              key={b.id}
              className="glass-card-sm p-4 group hover:border-white/[0.1] transition-all"
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-1 self-stretch rounded-full shrink-0"
                  style={{ backgroundColor: b.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Tag className="h-3 w-3 text-zinc-600" />
                    <span className="text-[11px] text-zinc-500 font-medium truncate">
                      {b.materialName}
                    </span>
                    <span className="text-[10px] text-zinc-700 ml-auto shrink-0">
                      {new Date(b.createdAt).toLocaleDateString('id-ID')}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300 leading-relaxed line-clamp-2">
                    {b.text}
                  </p>
                  {b.note && (
                    <button
                      onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}
                      className="flex items-center gap-1 mt-2 text-[11px] text-[#B794F6]/70 hover:text-[#B794F6] transition-colors"
                    >
                      {expandedId === b.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      Catatan
                    </button>
                  )}
                  {expandedId === b.id && b.note && (
                    <div className="mt-2 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <p className="text-xs text-zinc-400 leading-relaxed">{b.note}</p>
                    </div>
                  )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => handleEdit(b)}
                    className="p-1.5 rounded-lg hover:bg-white/[0.06] text-zinc-500 hover:text-white transition-all"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(b.id)}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-all"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {bookmarks.length > 0 && (
        <div className="text-center pt-2">
          <span className="text-[11px] text-zinc-700">
            {filteredBookmarks.length} bookmark {searchQuery && `dari ${bookmarks.length}`}
          </span>
        </div>
      )}
    </div>
  );
}
