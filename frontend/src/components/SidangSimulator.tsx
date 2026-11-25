/**
 * SidangSimulator.tsx  -  Simulator Sidang Skripsi & Ujian Lisan
 *
 * AI berperan sebagai dosen penguji (suara real-time) untuk menguji argumen
 * dan kesiapan mental sebelum sidang:
 * - Setup: judul/topik, bidang, jumlah pertanyaan (5/7/10), gaya penguji
 *   (skeptis / netral / membantu), mode suara (TTS membacakan pertanyaan)
 *   dan mode jawaban via mic (Web Speech API, one-shot per giliran)
 * - Alur pertanyaan berjenjang: urgensi -> teori -> metodologi -> analisis
 *   -> pertahanan; penguji meminta klarifikasi kalau jawaban kabur
 * - Evaluasi akhir: skor rubrik 4 aspek (1-10), catatan per bagian,
 *   kekuatan, yang harus diperbaiki, ringkasan
 *
 * Anti-halusinasi: prompt mengunci penilaian HANYA pada judul/topik dan
 * jawaban yang diberikan user; penguji dilarang mengarang data/kutipan.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { GraduationCap, Mic, MicOff, Send, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import { speak, stop as ttsStop } from '@/lib/text-to-speech';

type SimState = 'setup' | 'active' | 'result';
type Persona = 'skeptis' | 'netral' | 'membantu';

interface SimMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface Evaluation {
  skor: {
    penguasaan_materi: number;
    ketajaman_argumen: number;
    kejelasan_penyampaian: number;
    ketahanan_menghadapi_tekanan: number;
  };
  catatan_per_pertanyaan: string[];
  kekuatan: string[];
  yang_harus_diperbaiki: string[];
  ringkasan: string;
}

const PERSONA_DESC: Record<Persona, string> = {
  skeptis: 'Mencari celah, meminta justifikasi angka dan sumber',
  netral: 'Adil, teknis, sesuai standar sidang kampus',
  membantu: 'Memandu dengan petunjuk kalau jawaban tersasar',
};

const RUBRIC_LABEL: { key: keyof Evaluation['skor']; label: string }[] = [
  { key: 'penguasaan_materi', label: 'Penguasaan materi' },
  { key: 'ketajaman_argumen', label: 'Ketajaman argumen' },
  { key: 'kejelasan_penyampaian', label: 'Kejelasan penyampaian' },
  { key: 'ketahanan_menghadapi_tekanan', label: 'Ketahanan menghadapi tekanan' },
];

function buildSystemPrompt(opts: {
  judul: string;
  bidang: string;
  persona: Persona;
  jumlah: number;
}): string {
  return [
    'Kamu adalah dosen penguji di universitas Indonesia yang sedang menguji mahasiswa dalam sesi sidang / ujian lisan.',
    `Sesi: sidang dengan judul/topik "${opts.judul}" (bidang: ${opts.bidang || 'umum'}). Jumlah pertanyaan: ${opts.jumlah}.`,
    `Gaya penguji: ${opts.persona} (${PERSONA_DESC[opts.persona]}).`,
    '',
    'ATURAN WAJIB:',
    '1. Satu giliran = SATU pertanyaan saja. Pertanyaan maksimal 3 kalimat, tanpa daftar poin.',
    '2. Bahasa Indonesia formal akademik seperti dosen penguji: hormat tapi tegas. Tanpa emoji.',
    '3. Urutan pertanyaan berjenjang: latar belakang & urgensi, landasan teori, metodologi, hasil/analisis, lalu implikasi & pertahanan.',
    '4. Kalau jawaban mahasiswa kabur atau umum, minta klarifikasi spesifik (angka, istilah, atau contoh) di giliran berikutnya.',
    '5. DILARANG mengarang data, statistik, kutipan, atau nama peneliti yang tidak disebutkan mahasiswa. Penilaian hanya dari judul/topik dan jawaban yang diberikan.',
    '6. Mulai sekarang: sapa singkat (satu kalimat, maksimal 20 kata) lalu ajukan pertanyaan pertama.',
  ].join('\n');
}

const EVAL_INSTRUCTION =
  'INSTRUKSI INTERNAL (jangan tampilkan sebagai pertanyaan): sesi selesai. Berikan evaluasi akhir HANYA sebagai JSON valid tanpa teks lain, format: {"skor": {"penguasaan_materi": 1-10, "ketajaman_argumen": 1-10, "kejelasan_penyampaian": 1-10, "ketahanan_menghadapi_tekanan": 1-10}, "catatan_per_pertanyaan": ["..."], "kekuatan": ["..."], "yang_harus_diperbaiki": ["..."], "ringkasan": "2-3 kalimat"}';

function parseJsonLoose(text: string): Evaluation | null {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Evaluation;
  } catch {
    return null;
  }
}

export function SidangSimulator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, setState] = useState<SimState>('setup');
  const [judul, setJudul] = useState('');
  const [bidang, setBidang] = useState('');
  const [jumlah, setJumlah] = useState(5);
  const [persona, setPersona] = useState<Persona>('netral');
  const [suaraOn, setSuaraOn] = useState(false);
  const [micMode, setMicMode] = useState(false);

  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const answeredRef = useRef(0);
  const sessionRef = useRef<SimMessage[]>([]);

  useEffect(() => {
    if (!open) {
      ttsStop();
      try { recognitionRef.current?.stop?.(); } catch { /* abaikan */ }
    }
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, thinking]);

  // ── panggil LLM ──
  const callLLM = useCallback(async (msgs: SimMessage[], maxTokens: number, task: string) => {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: msgs, max_tokens: maxTokens, task, temperature: 0.75 }),
      signal: AbortSignal.timeout(70_000),
    });
    if (!res.ok) throw new Error(`server ${res.status}`);
    const data = await res.json();
    // dual-shape read (gaya repo): choices[0].message.content || content
    return (data.choices?.[0]?.message?.content || data.content || '') as string;
  }, []);

  // ── mulai sesi ──
  const startSession = useCallback(async () => {
    if (!judul.trim()) {
      toast.error('Isi judul atau topik dulu');
      return;
    }
    ttsStop();
    const sys: SimMessage = {
      role: 'system',
      content: buildSystemPrompt({ judul: judul.trim(), bidang: bidang.trim(), persona, jumlah }),
    };
    const msgs = [sys];
    setMessages([]);
    sessionRef.current = msgs;
    answeredRef.current = 0;
    setAnswered(0);
    setEvaluation(null);
    setState('active');
    setThinking(true);
    try {
      const opening = await callLLM(msgs, 220, 'conversation');
      const next = [...msgs, { role: 'assistant' as const, content: opening }];
      sessionRef.current = next;
      setMessages(next.filter((m) => m.role !== 'system'));
      if (suaraOn) {
        setIsSpeaking(true);
        speak(opening, { onEnd: () => setIsSpeaking(false) });
      }
    } catch (e) {
      toast.error('Gagal menghubungi dosen penguji. Periksa koneksi lalu coba lagi.');
      console.error('[sidang] start gagal:', e);
      setState('setup');
    } finally {
      setThinking(false);
    }
  }, [judul, bidang, persona, jumlah, suaraOn, callLLM]);

  // ── kirim jawaban / minta evaluasi ──
  const submitAnswer = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    ttsStop();

    const current = answeredRef.current + 1;
    answeredRef.current = current;
    setAnswered(current);

    const withAnswer: SimMessage[] = [...sessionRef.current, { role: 'user', content: trimmed }];
    const isLast = current >= jumlah;
    if (isLast) withAnswer.push({ role: 'user', content: EVAL_INSTRUCTION });

    sessionRef.current = withAnswer;
    setMessages(withAnswer.filter((m) => m.role !== 'system' && !m.content.startsWith('INSTRUKSI INTERNAL')));
    setInput('');
    setThinking(true);

    try {
      const reply = await callLLM(
        withAnswer,
        isLast ? 1000 : 220,
        isLast ? 'structured-json' : 'conversation'
      );
      if (isLast) {
        const evalResult = parseJsonLoose(reply);
        if (evalResult) {
          setEvaluation(evalResult);
          setState('result');
        } else {
          // fallback: tampilkan teks evaluasi mentah sebagai ringkasan
          setEvaluation({
            skor: { penguasaan_materi: 0, ketajaman_argumen: 0, kejelasan_penyampaian: 0, ketahanan_menghadapi_tekanan: 0 },
            catatan_per_pertanyaan: [],
            kekuatan: [],
            yang_harus_diperbaiki: [],
            ringkasan: reply.slice(0, 1200) || 'Evaluasi tidak terbaca. Coba ulangi sesi.',
          });
          setState('result');
        }
      } else {
        const next: SimMessage[] = [...withAnswer, { role: 'assistant', content: reply }];
        sessionRef.current = next;
        setMessages(next.filter((m) => m.role !== 'system'));
        if (suaraOn) {
          setIsSpeaking(true);
          speak(reply, { onEnd: () => { setIsSpeaking(false); } });
        }
      }
    } catch (e) {
      toast.error('Gagal mengirim jawaban. Jawabanmu masih ada di kolom, coba kirim ulang.');
      console.error('[sidang] submit gagal:', e);
      answeredRef.current = current - 1;
      setAnswered(current - 1);
      setInput(trimmed);
    } finally {
      setThinking(false);
    }
  }, [jumlah, thinking, suaraOn, callLLM]);

  // ── mic: Web Speech API one-shot (pola VoiceTutor) ──
  const getRecognition = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return null;
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'id-ID';
    return recognition;
  }, []);

  const startListening = useCallback(() => {
    const recognition = getRecognition();
    if (!recognition) {
      toast.error('Browser tidak mendukung voice recognition. Gunakan Chrome, atau jawab dengan teks.');
      return;
    }
    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      setIsListening(false);
      setInput((prev) => (prev ? prev + ' ' : '') + text);
    };
    recognition.onerror = (event: any) => {
      setIsListening(false);
      if (event.error !== 'no-speech') toast.error('Error mikrofon: ' + event.error);
    };
    recognition.onend = () => setIsListening(false);
    try {
      recognition.start();
      setIsListening(true);
      recognitionRef.current = recognition;
    } catch {
      setIsListening(false);
    }
  }, [getRecognition]);

  const resetAll = () => {
    ttsStop();
    sessionRef.current = [];
    setMessages([]);
    setEvaluation(null);
    setAnswered(0);
    answeredRef.current = 0;
    setInput('');
    setState('setup');
  };

  const chip = (active: boolean) =>
    'rounded-md border px-3 py-1.5 text-sm transition-colors ' +
    (active
      ? 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]'
      : 'border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]');

  const inputCls =
    'w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]';

  if (!open) return null;

  // ── layar hasil ──
  if (state === 'result' && evaluation) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[94vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <GraduationCap className="h-5 w-5" />
              Evaluasi Akhir Simulasi Sidang
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {RUBRIC_LABEL.map((r) => {
              const skor = evaluation.skor[r.key] || 0;
              return (
                <div key={r.key} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                  <p className={'text-2xl font-bold ' + (skor >= 7 ? 'text-green-400' : skor >= 5 ? 'text-[var(--accent-soft)]' : 'text-[var(--err)]')}>
                    {skor}
                  </p>
                  <p className="text-[11px] text-[var(--text-2)] mt-1">{r.label}</p>
                  <p className="text-[10px] text-[var(--text-3)]">skala 1-10</p>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-4">
            <p className="text-sm font-medium mb-1.5">Ringkasan penguji</p>
            <p className="text-sm text-[var(--text-2)]">{evaluation.ringkasan}</p>
          </div>

          {evaluation.catatan_per_pertanyaan.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-4">
              <p className="text-sm font-medium mb-2">Catatan per pertanyaan</p>
              <ol className="list-decimal list-inside space-y-1.5 text-sm text-[var(--text-2)]">
                {evaluation.catatan_per_pertanyaan.map((c, i) => <li key={i}>{c}</li>)}
              </ol>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            {evaluation.kekuatan.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-medium mb-2">Kekuatan</p>
                <ul className="space-y-1.5 text-sm text-[var(--text-2)]">
                  {evaluation.kekuatan.map((k, i) => <li key={i}>+ {k}</li>)}
                </ul>
              </div>
            )}
            {evaluation.yang_harus_diperbaiki.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-medium mb-2">Yang harus diperbaiki</p>
                <ul className="space-y-1.5 text-sm text-[var(--text-2)]">
                  {evaluation.yang_harus_diperbaiki.map((k, i) => <li key={i}>- {k}</li>)}
                </ul>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button onClick={startSession} className="flex-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)]">
              <RotateCcw className="h-4 w-4 mr-2" />
              Ulangi simulasi
            </Button>
            <Button onClick={resetAll} variant="outline" className="flex-1 border-[var(--border)]">
              Kembali ke pengaturan
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── layar setup ──
  if (state === 'setup') {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[94vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <GraduationCap className="h-5 w-5" />
              Simulasi Sidang Skripsi & Ujian Lisan
            </DialogTitle>
            <p className="text-sm text-[var(--text-2)]">
              AI berperan sebagai dosen penguji. Jawab dengan suara atau teks; di akhir kamu dapat nilai rubrik dan catatan perbaikan.
            </p>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div>
              <label htmlFor="sidang-judul" className="block text-sm mb-1.5">Judul skripsi / topik ujian</label>
              <textarea
                id="sidang-judul"
                rows={2}
                value={judul}
                onChange={(e) => setJudul(e.target.value)}
                placeholder="Contoh: Analisis Pengaruh Harga Bahan Pokok terhadap Inflasi Daerah di Kota Palu 2024"
                className={inputCls + ' resize-none'}
              />
            </div>
            <div>
              <label htmlFor="sidang-bidang" className="block text-sm mb-1.5">Bidang (opsional)</label>
              <input
                id="sidang-bidang"
                value={bidang}
                onChange={(e) => setBidang(e.target.value)}
                placeholder="Contoh: Ekonomi Pembangunan"
                className={inputCls}
              />
            </div>

            <div>
              <p className="text-sm mb-1.5">Jumlah pertanyaan</p>
              <div className="flex gap-2">
                {[5, 7, 10].map((n) => (
                  <button key={n} aria-pressed={jumlah === n} onClick={() => setJumlah(n)} className={chip(jumlah === n)}>
                    {n} pertanyaan
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm mb-1.5">Gaya penguji</p>
              <div className="flex flex-wrap gap-2">
                {(['skeptis', 'netral', 'membantu'] as Persona[]).map((p) => (
                  <button key={p} aria-pressed={persona === p} onClick={() => setPersona(p)} className={chip(persona === p)}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[var(--text-3)] mt-1.5">{PERSONA_DESC[persona]}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button aria-pressed={suaraOn} onClick={() => { setSuaraOn((v) => !v); ttsStop(); }} className={chip(suaraOn)}>
                {suaraOn ? <Volume2 className="inline h-3.5 w-3.5 mr-1.5" /> : <VolumeX className="inline h-3.5 w-3.5 mr-1.5" />}
                {suaraOn ? 'Suara penguji aktif' : 'Suara penguji mati'}
              </button>
              <button aria-pressed={micMode} onClick={() => setMicMode((v) => !v)} className={chip(micMode)}>
                {micMode ? <Mic className="inline h-3.5 w-3.5 mr-1.5" /> : <MicOff className="inline h-3.5 w-3.5 mr-1.5" />}
                {micMode ? 'Jawab via mikrofon' : 'Jawab via teks'}
              </button>
            </div>
            <p className="text-xs text-[var(--text-3)]">
              Suara penguji memakai text-to-speech browser; mikrofon memakai speech-to-text browser (Chrome/Edge, bahasa Indonesia).
            </p>

            <Button
              onClick={startSession}
              className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
            >
              Mulai simulasi
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── layar sesi aktif ──
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[94vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-base flex items-center justify-between">
            <span>Sesi sidang: {judul.slice(0, 48)}{judul.length > 48 ? '...' : ''}</span>
            <span className="text-xs font-normal text-[var(--text-2)]">{answered}/{jumlah} dijawab</span>
          </DialogTitle>
        </DialogHeader>

        <div ref={scrollRef} className="flex-1 min-h-[240px] max-h-[52vh] overflow-y-auto space-y-3 pr-1">
          {messages.map((m, i) => (
            m.role === 'user' && !m.content.startsWith('INSTRUKSI INTERNAL') ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-xl bg-stone-700 text-stone-100 px-3.5 py-2 text-sm">
                  <p className="text-[10px] text-stone-300 mb-0.5">Kamu</p>
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className="max-w-[85%] rounded-xl bg-[var(--surface-2)] border border-[var(--border)] px-3.5 py-2 text-sm text-[var(--text)]">
                  <p className="text-[10px] text-[var(--text-2)] mb-0.5">Dosen penguji</p>
                  {m.content}
                </div>
              </div>
            )
          ))}
          {thinking && (
            <p className="text-xs text-[var(--text-3)]">Penguji sedang menyusun pertanyaan...</p>
          )}
        </div>

        <div className="shrink-0 pt-3 space-y-2">
          {micMode && (
            <Button
              onClick={startListening}
              variant="outline"
              className="w-full border-[var(--border)]"
              disabled={thinking || isListening}
            >
              <Mic className="h-4 w-4 mr-2" />
              {isListening ? 'Mendengarkan... bicara sekarang' : 'Tekan lalu jawab lewat mikrofon'}
            </Button>
          )}
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAnswer(input); } }}
              placeholder={answered >= jumlah ? 'Semua pertanyaan terjawab; menunggu evaluasi...' : 'Tulis jawabanmu...'}
              disabled={thinking || answered >= jumlah}
              className={inputCls + ' flex-1'}
              aria-label="Jawaban untuk penguji"
            />
            <Button
              onClick={() => submitAnswer(input)}
              disabled={thinking || !input.trim() || answered >= jumlah}
              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
              aria-label="Kirim jawaban"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          {(isSpeaking || answered >= jumlah) && (
            <p className="text-xs text-[var(--text-3)]">
              {answered >= jumlah
                ? 'Evaluasi akhir sedang disusun berdasarkan seluruh jawabanmu...'
                : 'Penguji sedang membacakan pertanyaan...'}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
