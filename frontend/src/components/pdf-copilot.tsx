import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  X, Send, Sparkles, Table, Lightbulb, BookOpen,
  Loader2, ChevronRight, MessageSquare,
} from 'lucide-react';

interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface PdfCopilotProps {
  pdfContent: string;
  pdfTitle?: string;
  onClose: () => void;
}

const QUICK_ACTIONS = [
  { id: 'analogy', label: 'Jelaskan dengan analogi', icon: Lightbulb, prompt: 'Jelaskan teks yang saya highlight dengan analogi sederhana yang mudah dipahami. Gunakan contoh sehari-hari.', color: 'text-amber-400 bg-amber-400/10 border-amber-400/20 hover:bg-amber-400/20' },
  { id: 'table', label: 'Ubah ke tabel perbandingan', icon: Table, prompt: 'Ubah teks yang saya highlight menjadi tabel perbandingan yang rapi. Gunakan format markdown table.', color: 'text-sky-400 bg-sky-400/10 border-sky-400/20 hover:bg-sky-400/20' },
  { id: 'simplify', label: 'Sederhanakan', icon: BookOpen, prompt: 'Sederhanakan teks yang saya highlight menjadi poin-poin yang mudah dipahami. Gunakan bahasa sehari-hari.', color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20 hover:bg-emerald-400/20' },
  { id: 'quiz', label: 'Buat kuis', icon: Sparkles, prompt: 'Buat 3 pertanyaan kuis dari teks yang saya highlight. Sertakan jawaban singkat di akhir.', color: 'text-sky-400 bg-sky-400/10 border-sky-400/20 hover:bg-sky-400/20' },
];

export function PdfCopilot({ pdfContent, pdfTitle, onClose }: PdfCopilotProps) {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [input, setInput] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Listen for text selection on the page
  useEffect(() => {
    const handleSelection = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() || '';
      if (text.length > 5) setSelectedText(text);
      else setSelectedText('');
    };
    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('touchend', handleSelection);
    return () => {
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('touchend', handleSelection);
    };
  }, []);

  const sendMessage = useCallback(async (userMsg: string) => {
    if (!userMsg.trim() || isLoading) return;
    const userMessage: CopilotMessage = { id: crypto.randomUUID(), role: 'user', content: userMsg };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    try {
      const apiMessages = [
        { role: 'system' as const, content: `Kamu adalah AI Co-Pilot untuk pembelajaran. Kamu membantu mahasiswa memahami materi dari modul PDF. Konteks PDF: "${pdfTitle || 'Modul Pembelajaran'}"\n\nKonten PDF:\n${pdfContent.slice(0, 3000)}. Gunakan bahasa Indonesia yang jelas dan mudah dipahami.` },
        ...newMessages.map(m => ({ role: m.role, content: m.content })),
      ];
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, model: 'vy/gemini-3.1-pro' }),
      });
      if (!res.ok) throw new Error('Gagal menghubungi AI');
      const data = await res.json();
      const assistantMsg: CopilotMessage = { id: crypto.randomUUID(), role: 'assistant', content: data.content || data.message || 'Tidak ada respons.' };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal');
      setMessages(prev => prev.slice(0, -1)); // Remove user message on failure
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, pdfContent, pdfTitle]);

  const handleQuickAction = (prompt: string) => {
    if (!selectedText) {
      toast.error('Highlight teks di PDF terlebih dahulu, lalu klik aksi ini.');
      return;
    }
    const fullMsg = `Teks yang saya highlight:\n"""\n${selectedText}\n"""\n\n${prompt}`;
    sendMessage(fullMsg);
  };

  const handleSend = () => {
    if (selectedText && input.trim()) {
      sendMessage(`Teks yang saya highlight:\n"""\n${selectedText}\n"""\n\nPertanyaan: ${input}`);
    } else if (selectedText) {
      sendMessage(`Jelaskan teks ini:\n"""\n${selectedText}\n"""`);
    } else if (input.trim()) {
      sendMessage(input);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/80  flex items-center justify-center p-4">
      <div className="w-full max-w-5xl h-[85vh] bg-[#111] rounded-lg border border-white/[0.08] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] bg-[#161616]">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-[var(--accent-soft)]" />
            <span className="text-sm font-medium text-white">PDF AI Co-Pilot</span>
            <span className="text-[10px] text-zinc-600 ml-1">{pdfTitle || 'Modul'}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors">
            <X className="h-4 w-4 text-zinc-400" />
          </button>
        </div>

        {/* Selected text indicator */}
        {selectedText && (
          <div className="px-5 py-2 bg-[#38BDF8]/5 border-b border-[#38BDF8]/10 flex items-center gap-2">
            <span className="text-[10px] text-[var(--accent-soft)] font-medium">Highlighted:</span>
            <span className="text-[11px] text-zinc-300 truncate flex-1">{selectedText.slice(0, 100)}{selectedText.length > 100 ? '...' : ''}</span>
            <button onClick={() => setSelectedText('')} className="text-[10px] text-zinc-500 hover:text-zinc-300">clear</button>
          </div>
        )}

        {/* Quick Actions */}
        {selectedText && messages.length === 0 && (
          <div className="px-5 py-3 border-b border-white/[0.04] flex flex-wrap gap-2">
            {QUICK_ACTIONS.map(action => {
              const Icon = action.icon;
              return (
                <button key={action.id} onClick={() => handleQuickAction(action.prompt)}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-medium transition-colors', action.color)}>
                  <Icon className="h-3 w-3" />
                  {action.label}
                </button>
              );
            })}
            <span className="flex items-center text-[10px] text-zinc-600 ml-1">
              <ChevronRight className="h-3 w-3 mr-0.5" /> Highlight teks, lalu pilih aksi
            </span>
          </div>
        )}

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="rounded-full bg-[#38BDF8]/10 p-4 mb-4">
                <Sparkles className="h-8 w-8 text-[var(--accent-soft)]" />
              </div>
              <h3 className="text-sm font-medium text-zinc-300 mb-2">PDF AI Co-Pilot</h3>
              <p className="text-xs text-zinc-600 max-w-sm mb-4 leading-relaxed">
                Highlight teks di modul PDF, lalu tanyakan apa saja. AI akan menjelaskan dengan analogi sederhana atau mengubah ke tabel perbandingan.
              </p>
              <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
                {QUICK_ACTIONS.map(action => {
                  const Icon = action.icon;
                  return (
                    <button key={action.id} disabled
                      className={cn('flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[11px] opacity-40', action.color)}>
                      <Icon className="h-3 w-3" />
                      {action.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : '')}>
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full bg-[#38BDF8]/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles className="h-3 w-3 text-[var(--accent-soft)]" />
                </div>
              )}
              <div className={cn('max-w-[80%] rounded-lg px-4 py-3 text-sm leading-relaxed',
                msg.role === 'user' ? 'bg-[#38BDF8]/15 text-zinc-200 rounded-br-sm' : 'bg-white/[0.04] text-zinc-300 rounded-bl-sm'
              )}>
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-[#38BDF8]/20 flex items-center justify-center shrink-0">
                <Sparkles className="h-3 w-3 text-[var(--accent-soft)]" />
              </div>
              <div className="bg-white/[0.04] rounded-lg rounded-bl-sm px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Loader2 className="h-3 w-3 animate-spin" /> AI sedang berpikir...
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="px-5 py-3 border-t border-white/[0.06] bg-[#161616]">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={selectedText ? 'Tambah pertanyaan (opsional)...' : 'Tanya tentang materi PDF...'}
                rows={1}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-[#38BDF8]/40 focus:ring-1 focus:ring-[#38BDF8]/20 transition-colors max-h-24"
              />
            </div>
            <Button onClick={handleSend} disabled={isLoading || (!input.trim() && !selectedText)}
              size="sm" className="h-10 w-10 p-0 rounded-lg bg-[#38BDF8] hover:bg-[#38BDF8]/80 text-white shrink-0">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          {selectedText && (
            <p className="text-[10px] text-[var(--accent-soft)]/60 mt-1.5">Tekan Enter untuk tanya tentang highlighted text</p>
          )}
        </div>
      </div>
    </div>
  );
}
