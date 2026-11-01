import { useAppStore, MODEL_LIST, MODEL_GROUPS, type AIModel } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Send, Trash2, Loader2, Bot, User, Sparkles, Globe, Timer, AlertTriangle, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { indexTranscript, getRAGContext } from '@/lib/rag';

const PROVIDER_COLORS: Record<string, string> = {
  claude: 'border-zinc-500/30 text-zinc-400',
  gemini: 'border-sky-500/30 text-sky-400',
  deepseek: 'border-[#7C3AED]/30 text-[#7C3AED]',
  nvidia: 'border-emerald-500/30 text-emerald-400',
  minimax: 'border-pink-500/30 text-pink-400',
  openai: 'border-green-500/30 text-green-400',
  xai: 'border-orange-500/30 text-orange-300',
  zhipu: 'border-cyan-500/30 text-cyan-400',
  other: 'border-zinc-500/30 text-zinc-400',
};

export function AIAssistant() {
  const {
    aiMessages,
    addAiMessage,
    clearAiMessages,
    selectedModel,
    setSelectedModel,
    isAiLoading,
    setIsAiLoading,
    transcript,
  } = useAppStore();

  const [input, setInput] = useState('');
  const [messageSources, setMessageSources] = useState<Record<string, {title: string; url: string}[]>>({});
  const [messageHasScrape, setMessageHasScrape] = useState<Record<string, boolean>>({});
  const [loadingElapsed, setLoadingElapsed] = useState(0);
  const [loadingPhase, setLoadingPhase] = useState<'scraping' | 'thinking' | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [quotaInfo, setQuotaInfo] = useState<{dayRemaining: number; dayLimit: number; dayReset: number} | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Index transcript for RAG whenever it changes
  useEffect(() => {
    if (transcript && transcript.length > 20) {
      indexTranscript(transcript);
    }
  }, [transcript]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSendTime = useRef(0);
  const loadingStartRef = useRef(0);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [aiMessages]);

  // Loading elapsed timer
  useEffect(() => {
    if (!isAiLoading) { setLoadingElapsed(0); setLoadingPhase(null); return; }
    loadingStartRef.current = Date.now();
    const interval = setInterval(() => {
      setLoadingElapsed(Math.floor((Date.now() - loadingStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isAiLoading]);

  /** Safe JSON parse */
  const safeJson = async (res: Response): Promise<Record<string, unknown>> => {
    const text = await res.text();
    if (!text.trim()) {
      throw new Error(`Response kosong (HTTP ${res.status}). Coba lagi atau ganti model.`);
    }
    try {
      return JSON.parse(text);
    } catch {
      const preview = text.slice(0, 100).replace(/<[^>]*>/g, '').trim();
      throw new Error(`Response tidak valid (HTTP ${res.status}). ${preview ? `Isi: "${preview}..."` : 'Coba ganti model.'}`);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isAiLoading) return;

    // Cooldown check
    const now = Date.now();
    if (now < cooldownUntil) {
      const sec = Math.ceil((cooldownUntil - now) / 1000);
      toast.info(`Tunggu ${sec} detik... (rate limit cooldown)`);
      return;
    }

    // Client-side throttle: min 3s between sends
    const elapsed = now - lastSendTime.current;
    if (elapsed < 3000) {
      toast.info('Tunggu sebentar...');
      return;
    }
    lastSendTime.current = now;

    const userMsg = input.trim();
    setInput('');
    addAiMessage({ role: 'user', content: userMsg });
    setIsAiLoading(true);

    const msgId = crypto.randomUUID();

    try {
      // ── PHASE 1: Scrape web (selalu, silent, no user API cost) ──
      setLoadingPhase('scraping');
      let scrapedContext = '';
      let scrapedSources: {title: string; url: string}[] = [];
      let hasScrapeResults = false;

      try {
        const scrapeRes = await fetch('/api/scrape-only?XTransformPort=3030', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: userMsg }),
          signal: AbortSignal.timeout(15_000), // 15s timeout for scrape
        });
        if (scrapeRes.ok) {
          const scrapeData = await scrapeRes.json();
          scrapedContext = (scrapeData.context as string) || '';
          scrapedSources = (scrapeData.sources as {title: string; url: string}[]) || [];
          hasScrapeResults = scrapeData.hasResults === true;
        }
      } catch {
        // Scrape gagal? Lanjut ke AI saja, no problem
      }

      // ── PHASE 2: Kirim ke AI gateway (dengan atau tanpa konten web) ──
      setLoadingPhase('thinking');

      const messages = [
        ...aiMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: userMsg },
      ];

      // Jika ada hasil scrape, sisipkan sebagai konteks di system prompt
      let systemPrompt: string | undefined;
      if (hasScrapeResults && scrapedContext) {
        systemPrompt = `Kamu adalah asisten AI LINA.LEARNING. Berikut konten web yang relevan dengan pertanyaan user:\n\n${scrapedContext}\n\n---\n\nPETUNJUK:\n- Jawab berdasarkan konten web di atas UTAMANYA\n- Jelaskan dengan bahasa Indonesia yang jelas, terstruktur, dan mudah dipahami\n- Kalau konten web kurang lengkap, kamu boleh tambahkan pengetahuan umum\n- Sertakan sumber jika memungkinkan`;
      }

      // RAG: Add transcript/material context if available
      const ragContext = getRAGContext(input);
      if (ragContext) {
        systemPrompt = (systemPrompt ? systemPrompt + '\n\n' : '') +
          `Kamu adalah asisten AI ALYNNE.EDU. Berikut konteks dari transkrip/materi user yang relevan dengan pertanyaan:\n\n${ragContext}\n\n---\n\nPETUNJUK:\n- Jawab berdasarkan konteks di atas UTAMANYA\n- Kalau konteks tidak cukup, gunakan pengetahuan umum\n- Jelaskan dengan bahasa Indonesia yang jelas`;
      }

      // === CLIENT-SIDE AI (WebLLM) - browser-first, fallback to server ===
      // WebLLM runs in browser via WebGPU (no server cost, unlimited scale)
      // Falls back to /api/ai/chat (Groq → Qwen local) if WebGPU not available
      const fullMessages = [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        ...messages,
      ];

      let content: string;
      let modelLabel: string;
      let provider: string;

      try {
        // Try WebLLM first (browser-based, free, unlimited)
        const { smartChat } = await import('@/lib/webllm');
        const result = await smartChat(fullMessages, {
          temperature: 0.7,
          maxTokens: 2048,
          onProgress: (s) => console.log('[AI]', s),
        });
        content = result.text || '(kosong)';
        provider = result.provider;

        if (provider === 'webllm') {
          modelLabel = 'WebLLM (browser, free)';
        } else {
          // Server fallback was used - fetch the actual content
          const res = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages, model: selectedModel, systemPrompt }),
          });
          const data = await safeJson(res);
          if (data.rateLimit) {
            const rl = data.rateLimit as {dayRemaining?: number; dayLimit?: number; dayReset?: number};
            setQuotaInfo({ dayRemaining: rl.dayRemaining ?? 100, dayLimit: rl.dayLimit ?? 100, dayReset: rl.dayReset ?? 0 });
          }
          if (data.error) throw new Error(data.error as string);
          content = (data.content as string) || '(kosong)';
          modelLabel = hasScrapeResults
            ? `${MODEL_LIST.find((m) => m.id === selectedModel)?.name || selectedModel} + Web`
            : selectedModel;
        }
      } catch (e) {
        // Final fallback: direct server call
        console.warn('[AI] WebLLM failed, direct server call:', e);
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, model: selectedModel, systemPrompt }),
        });
        const data = await safeJson(res);
        if (data.rateLimit) {
          const rl = data.rateLimit as {dayRemaining?: number; dayLimit?: number; dayReset?: number};
          setQuotaInfo({ dayRemaining: rl.dayRemaining ?? 100, dayLimit: rl.dayLimit ?? 100, dayReset: rl.dayReset ?? 0 });
        }
        if (data.error) throw new Error(data.error as string);
        content = (data.content as string) || '(kosong)';
        modelLabel = hasScrapeResults
          ? `${MODEL_LIST.find((m) => m.id === selectedModel)?.name || selectedModel} + Web`
          : selectedModel;
      }

      addAiMessage({ role: 'assistant', content, model: modelLabel });

      // Simpan sources per message (pakai ID message terakhir dari aiMessages setelah add)
      if (hasScrapeResults && scrapedSources.length > 0) {
        // ambil ID message assistant terbaru
        const latestMsg = useAppStore.getState().aiMessages[useAppStore.getState().aiMessages.length - 1];
        if (latestMsg) {
          setMessageSources(prev => ({ ...prev, [latestMsg.id]: scrapedSources }));
          setMessageHasScrape(prev => ({ ...prev, [latestMsg.id]: true }));
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Gagal mendapatkan respons';
      toast.error(msg);
      addAiMessage({ role: 'assistant', content: `Error: ${msg}` });

      // Smart cooldown
      if (msg.includes('Kuota harian') || msg.includes('/100') || msg.includes('/50')) {
        setCooldownUntil(Date.now() + 300_000);
      } else if (msg.includes('429') || msg.includes('Rate limit') || msg.includes('rate limit') || msg.includes('Sisa kuota')) {
        setCooldownUntil(Date.now() + 60_000);
      }
    } finally {
      setIsAiLoading(false);
    }
  };

  const formatDayReset = (ts: number): string => {
    if (!ts || ts <= 0) return '';
    return new Date(ts * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleUseTranscript = () => {
    if (transcript) {
      setInput(transcript);
      textareaRef.current?.focus();
    }
  };

  return (
    <div className="flex h-full flex-col rounded-lg border border-white/[0.06] bg-white/[0.03] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-white/[0.06] space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-[#7C3AED]" />
            <span className="text-sm font-medium text-zinc-200">AI Assistant</span>
            <span className="flex items-center gap-1 text-[10px] text-zinc-500 bg-white/[0.04] px-1.5 py-0.5 rounded">
              <Search className="h-2.5 w-2.5" /> Auto-Scrape
            </span>
          </div>
          <div className="flex items-center gap-2">
            {transcript && (
              <button onClick={handleUseTranscript} className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">
                <Sparkles className="h-3 w-3" />
                Gunakan Transkrip
              </button>
            )}
            <button onClick={clearAiMessages} disabled={aiMessages.length === 0} className="p-1.5 rounded-md hover:bg-white/[0.06] text-zinc-600 hover:text-zinc-300 transition-colors disabled:opacity-30">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v as AIModel)}>
            <SelectTrigger className="h-7 w-[220px] text-[11px] border-white/[0.08] bg-transparent text-zinc-300">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-white/[0.08] bg-[#161618] max-h-[400px]">
              {MODEL_GROUPS.map((group) => {
                const groupModels = MODEL_LIST.filter((m) => m.group === group);
                return (
                  <SelectGroup key={group}>
                    <SelectLabel className="text-[11px] font-medium text-zinc-500">{group}</SelectLabel>
                    {groupModels.map((model) => (
                      <SelectItem key={model.id} value={model.id} className="text-xs text-zinc-300 focus:bg-white/[0.06] focus:text-white py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate">{model.name}</span>
                          {model.tier === 'pro' && (
                            <span className="text-[8px] text-amber-400/70 font-medium shrink-0">PRO</span>
                          )}
                          {model.tier === 'free' && (
                            <span className="text-[8px] text-emerald-400/70 font-medium shrink-0">FREE</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* Quota indicator */}
        {quotaInfo && (
          <div className={cn(
            'flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-md',
            quotaInfo.dayRemaining === 0
              ? 'bg-red-500/10 text-red-400'
              : quotaInfo.dayRemaining <= 10
                ? 'bg-amber-500/10 text-amber-400'
                : 'bg-emerald-500/10 text-emerald-400'
          )}>
            {quotaInfo.dayRemaining === 0 ? (
              <AlertTriangle className="h-3 w-3" />
            ) : null}
            <span>
              Kuota hari ini: {quotaInfo.dayRemaining}/{quotaInfo.dayLimit}
              {quotaInfo.dayRemaining === 0 && quotaInfo.dayReset > 0 && (
                <> - reset jam {formatDayReset(quotaInfo.dayReset)} WIB</>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {aiMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center">
            <Bot className="mb-2 h-10 w-10 text-zinc-800" />
            <p className="text-sm font-medium text-zinc-600">AI Assistant siap membantu</p>
            <p className="mt-1 text-xs text-zinc-700">Setiap pertanyaan otomatis mencari referensi web terlebih dahulu, lalu AI menjelaskannya.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {aiMessages.map((msg) => (
              <div key={msg.id} className={cn('flex gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                {msg.role === 'assistant' && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#7C3AED]/10">
                    <Bot className="h-3.5 w-3.5 text-[#7C3AED]" />
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-[80%] rounded-lg px-3.5 py-2.5 text-sm',
                    msg.role === 'user'
                      ? 'bg-[#7C3AED] text-white'
                      : 'bg-white/[0.06] text-zinc-200 border border-white/[0.06]'
                  )}
                >
                  <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  {msg.model && (
                    <div className="mt-1.5 text-[10px] opacity-50">
                      {msg.model.includes('+ Web') ? (
                        <span className="text-[#7C3AED]">{msg.model}</span>
                      ) : (
                        MODEL_LIST.find((m) => m.id === msg.model)?.name || msg.model
                      )}
                    </div>
                  )}
                  {/* Sources - per message */}
                  {messageHasScrape[msg.id] && messageSources[msg.id] && (
                    <div className="mt-2 border-t border-white/[0.06] pt-2">
                      <p className="text-[10px] font-medium text-zinc-500 mb-1">Sumber web:</p>
                      {messageSources[msg.id].map((s, i) => (
                        <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                          className="block text-[10px] text-[#7C3AED] hover:underline truncate"
                        >
                          {s.title || s.url}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10">
                    <User className="h-3.5 w-3.5 text-zinc-300" />
                  </div>
                )}
              </div>
            ))}
            {isAiLoading && (
              <div className="flex gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#7C3AED]/10">
                  <Bot className="h-3.5 w-3.5 text-[#7C3AED]" />
                </div>
                <div className="rounded-lg bg-white/[0.06] border border-white/[0.06] px-3.5 py-2.5">
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    {loadingPhase === 'scraping' ? (
                      <>
                        <Globe className="h-3.5 w-3.5" />
                        <span>Mencari referensi web...</span>
                      </>
                    ) : (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Menjelaskan{loadingElapsed > 3 ? '...' : '.'}{loadingElapsed > 8 ? '.' : ''}</span>
                      </>
                    )}
                    {loadingElapsed > 5 && (
                      <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                        <Timer className="h-3 w-3" />{loadingElapsed}s
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-white/[0.06]">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tanyakan apa saja... (otomatis cari referensi web + AI jelaskan)"
            className="min-h-[44px] max-h-[120px] resize-none border-white/[0.08] bg-[#111113] text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-white/[0.08]"
            rows={1}
            disabled={isAiLoading}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isAiLoading}
            size="icon"
            className="h-[44px] w-[44px] shrink-0 rounded-lg bg-[#7C3AED] hover:bg-[#d14e1c] text-white"
          >
            {isAiLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
