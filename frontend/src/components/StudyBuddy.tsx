/**
 * StudyBuddy.tsx  -  AI Study Buddy that discusses material with you
 *
 * AI acts as a fellow student. Instead of just answering questions,
 * it proactively asks questions, challenges understanding, and
 * discusses the material conversationally.
 *
 * Modes:
 * - "Diskusi"  -  free discussion about material
 * - "Challenge"  -  AI asks questions, user answers
 * - "Jelaskan"  -  user tries to explain, AI evaluates
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Bot,
  User,
  Send,
  Loader2,
  Swords,
  MessageCircle,
  GraduationCap,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Chapter } from '@/lib/stt-chapter-splitter';

interface StudyBuddyProps {
  chapter: Chapter;
  transcript: string;
  allChapters?: Chapter[];  // NEW: full materi context (gabung dari Tanya AI)
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type BuddyMode = 'diskusi' | 'challenge' | 'jelaskan';

const MODE_PROMPTS: Record<BuddyMode, string> = {
  diskusi: 'Kamu adalah teman belajar. Diskusikan materi dengan santai. Tanya pendapat user, kasih analogi, dan explore ide bersama. Jawab pertanyaan user berdasarkan materi di bawah.',
  challenge: 'Kamu adalah teman yang lagi nguji pemahaman. Ajukan 1 pertanyaan tentang materi, tunggu jawaban user, lalu beri feedback singkat. Jangan kasih jawaban sebelum user jawab.',
  jelaskan: 'Kamu adalah teman yang minta dijelasin. Minta user jelasin konsep dari materi dengan bahasa sendiri. Setelah user jelasin, beri feedback: apa yang benar, apa yang kurang, apa yang salah.',
};

// Build system prompt dengan FULL context (semua bab + transcript) per user spec
//  -  gabung fungsionalitas Tanya AI (full context) ke Study Buddy (modes).
function buildSystemPrompt(mode: BuddyMode, chapter: Chapter, transcript: string, allChapters?: Chapter[]): string {
  const modePrompt = MODE_PROMPTS[mode];

  // Bab aktif  -  full content (bukan 800 char truncated)
  const activeBabText = `MATERI BAB ${chapter.id} (SEDANG DIBACA):\n${chapter.title}\n${chapter.content}`;

  // Semua bab context (3K chars limit biar gak kebanyakan token)
  const allChaptersText = allChapters && allChapters.length > 0
    ? allChapters
        .filter(ch => ch.id !== chapter.id)  // exclude active bab (sudah di atas)
        .map(ch => `BAB ${ch.id}: ${ch.title}\n${ch.content.substring(0, 200)}`)
        .join('\n\n---\n\n')
        .substring(0, 3000)
    : '';

  // Transcript original (2K chars limit)
  const transcriptSnippet = transcript ? `\n\nTRANSCRIPT ASLI:\n${transcript.substring(0, 2000)}` : '';

  return `${modePrompt}

${activeBabText}

${allChaptersText ? `SEMUA BAB (${allChapters.length} total):\n${allChaptersText}\n` : ''}${transcriptSnippet}

PETUNJUK:
- Jawab berdasarkan materi di atas
- Kalau user tanya tentang bab lain, tetap jawab dari konteks yang ada
- Jelaskan dengan analogi sederhana kalau perlu
- Jawab dengan bahasa Indonesia${mode === 'diskusi' ? ' santai' : ''}`;
}

export function StudyBuddy({ chapter, transcript, allChapters }: StudyBuddyProps) {
  const [mode, setMode] = useState<BuddyMode>('diskusi');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const startMode = useCallback(async (newMode: BuddyMode) => {
    setMode(newMode);
    setLoading(true);

    const systemPrompt = `${buildSystemPrompt(newMode, chapter, transcript, allChapters)}

Mulai percakapan dengan 1 pesan pembuka yang sesuai dengan mode. Singkat (2-3 kalimat). Bahasa Indonesia${newMode === 'diskusi' ? ' santai' : ''}.`;

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'system', content: systemPrompt }],
          model: 'qwen/qwen3.8-27b',
          max_tokens: 300,
        }),
      });

      const data = await res.json();
      let reply = '';
      if (data.choices?.[0]?.message?.content) reply = data.choices[0].message.content;
      else if (data.content) reply = data.content;

      setMessages([{ role: 'assistant', content: reply }]);
    } catch {
      setMessages([{ role: 'assistant', content: 'Halo! Aku siap belajar bareng. Mulai ngobrol yuk!' }]);
    }
    setLoading(false);
  }, [chapter, transcript, allChapters]);

  // Auto-start diskusi mode
  useEffect(() => {
    if (messages.length === 0) {
      startMode('diskusi');
    }
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    const newMessages = [...messagesRef.current, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const systemPrompt = `${buildSystemPrompt(mode, chapter, transcript, allChapters)}

Instruksi: Lanjutkan percakapan sebagai teman belajar. Singkat (2-3 kalimat).${mode === 'diskusi' ? ' Santai.' : ''} Bahasa Indonesia.`;

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            ...newMessages.map(m => ({ role: m.role, content: m.content })),
          ],
          model: 'qwen/qwen3.8-27b',
          max_tokens: 300,
        }),
      });

      const data = await res.json();
      let reply = '';
      if (data.choices?.[0]?.message?.content) reply = data.choices[0].message.content;
      else if (data.content) reply = data.content;

      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Maaf, aku ga bisa jawab sekarang.' }]);
    }
    setLoading(false);
  }, [input, loading, mode, chapter, transcript, allChapters]);

  return (
    <div className="flex flex-col h-full">
      {/* Mode selector */}
      <div className="flex gap-1 p-2 border-b border-white/[0.06]">
        <button
          onClick={() => startMode('diskusi')}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors',
            mode === 'diskusi' ? 'bg-[var(--accent)] text-white' : 'text-stone-500 hover:text-stone-300'
          )}
        >
          <MessageCircle className="h-3 w-3" />
          Diskusi
        </button>
        <button
          onClick={() => startMode('challenge')}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors',
            mode === 'challenge' ? 'bg-stone-700 text-stone-100' : 'text-stone-500 hover:text-stone-300'
          )}
        >
          <Swords className="h-3 w-3" />
          Challenge
        </button>
        <button
          onClick={() => startMode('jelaskan')}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors',
            mode === 'jelaskan' ? 'bg-blue-600 text-white' : 'text-stone-500 hover:text-stone-300'
          )}
        >
          <GraduationCap className="h-3 w-3" />
          Jelaskan
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]">
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-stone-400/10 flex items-center justify-center shrink-0">
                <Bot className="h-3 w-3 text-[var(--accent-soft)]" />
              </div>
            )}
            <div className={cn(
              'rounded-lg px-3 py-2 max-w-[75%] text-sm',
              msg.role === 'user' ? 'bg-stone-700 text-stone-100' : 'bg-white/[0.04] text-stone-200'
            )}>
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
            {msg.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-white/[0.04] flex items-center justify-center shrink-0">
                <User className="h-3 w-3 text-stone-400" />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-stone-400/10 flex items-center justify-center shrink-0">
              <Bot className="h-3 w-3 text-[var(--accent-soft)]" />
            </div>
            <div className="rounded-lg px-3 py-2 bg-white/[0.04] text-stone-400 text-sm">
              <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
              {mode === 'challenge' ? 'Nyiapin pertanyaan...' : 'Ngetik...'}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-white/[0.06] flex gap-2">
        <Textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={mode === 'challenge' ? 'Jawab pertanyaan...' : mode === 'jelaskan' ? 'Jelasin pakai bahasa kamu sendiri...' : 'Ngobrol...'}
          className="flex-1 text-sm bg-white/[0.04] border-white/[0.08] min-h-[40px] max-h-[100px] resize-none"
          disabled={loading}
        />
        <Button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          size="sm"
          className="bg-[var(--accent)] hover:bg-[var(--accent)]"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* Mode description */}
      <div className="px-3 pb-2">
        <p className="text-[9px] text-stone-600">
          {mode === 'diskusi' && 'Diskusi bebas tentang materi'}
          {mode === 'challenge' && 'AI ngasih pertanyaan, kamu jawab'}
          {mode === 'jelaskan' && 'Kamu jelasin konsep, AI evaluasi'}
        </p>
      </div>
    </div>
  );
}
