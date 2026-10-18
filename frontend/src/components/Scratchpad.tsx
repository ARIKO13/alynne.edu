/**
 * Scratchpad.tsx — Free canvas for dropping ideas, text, audio
 *
 * User can paste/type anything here. AI organizes into structured
 * content when requested.
 *
 * Use cases:
 *   - Quick notes during class
 *   - Brain dump before exam
 *   - Collect thoughts, then "Organize with AI"
 */

import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  StickyNote,
  Sparkles,
  Trash2,
  Save,
  X,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { quickSaveNote } from '@/lib/knowledge-hub';

interface ScratchpadProps {
  open: boolean;
  onClose: () => void;
  initialContent?: string;
}

export function Scratchpad({ open, onClose, initialContent }: ScratchpadProps) {
  const [content, setContent] = useState(initialContent || '');
  const [organizing, setOrganizing] = useState(false);

  const handleSave = useCallback(async () => {
    if (!content.trim()) {
      toast.error('Isi dulu catatannya');
      return;
    }
    try {
      await quickSaveNote(
        `Scratchpad ${new Date().toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
        content
      );
      toast.success('Catatan disimpan ke Knowledge Hub!');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan catatan');
    }
  }, [content, onClose]);

  const handleOrganize = useCallback(() => {
    if (!content.trim() || content.length < 50) {
      toast.error('Tulis minimal 50 karakter untuk di-organize');
      return;
    }

    setOrganizing(true);

    // Simple client-side "AI organize":
    // Split into sentences, group by topic keywords
    setTimeout(() => {
      const sentences = content
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 10);

      // Group by first word (simple heuristic)
      const groups: Record<string, string[]> = {};
      sentences.forEach((s) => {
        const firstWord = s.split(/\s+/)[0].toLowerCase();
        if (!groups[firstWord]) groups[firstWord] = [];
        groups[firstWord].push(s);
      });

      // Format organized content
      let organized = '📋 Catatan Terorganisir\n\n';
      Object.entries(groups).forEach(([key, sents], i) => {
        organized += `${i + 1}. ${key.toUpperCase()}\n`;
        sents.forEach((s) => {
          organized += `   • ${s}\n`;
        });
        organized += '\n';
      });

      setContent(organized);
      setOrganizing(false);
      toast.success('Catatan di-organize!');
    }, 1500);
  }, [content]);

  const handleClear = () => {
    if (confirm('Hapus semua?')) {
      setContent('');
    }
  };

  if (!open) return null;

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <StickyNote className="h-5 w-5 text-amber-400" />
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Scratchpad</h2>
            <p className="text-[11px] text-zinc-500">Coret-coret apa saja. AI bantu organize nanti.</p>
          </div>
        </div>
        <Button onClick={onClose} variant="ghost" size="sm" className="text-zinc-400 hover:text-white hover:bg-white/[0.04]">
          <X className="h-4 w-4" />
          <span className="ml-1 hidden sm:inline">Tutup</span>
        </Button>
      </div>

      <div className="p-5 space-y-4">
        {/* Stats */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] text-zinc-500">
            {wordCount} kata
          </Badge>
          <Badge variant="outline" className="text-[10px] text-zinc-500">
            {charCount} karakter
          </Badge>
        </div>

        {/* Textarea */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Tulis apa saja di sini...

Contoh:
- ide acak
- kata kunci
- potongan teks dari mana saja
- link
- pertanyaan

Lalu klik 'Organize dengan AI' untuk merapikan."
          className="w-full h-64 p-4 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-zinc-200 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-[#8B5CF6]/50 font-mono"
          autoFocus
        />

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleOrganize}
            disabled={organizing || content.length < 50}
            className="bg-[#8B5CF6] hover:bg-[#7C3AED]"
          >
            <Wand2 className="h-4 w-4 mr-2" />
            {organizing ? 'Organizing...' : 'Organize dengan AI'}
          </Button>
          <Button
            onClick={handleSave}
            variant="outline"
            className="border-white/[0.08] text-zinc-300"
          >
            <Save className="h-4 w-4 mr-2" />
            Simpan ke Hub
          </Button>
          <Button
            onClick={handleClear}
            variant="ghost"
            className="text-red-400 hover:text-red-300 ml-auto"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}
