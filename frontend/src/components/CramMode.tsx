/**
 * CramMode.tsx  -  Mode SKS (Sistem Kebut Semalam) + Detektor Jebakan Soal
 *
 * Menyaring 30% inti materi paling krusial saat waktu belajar mepet (H-1 jam
 * ujian) dan memprediksi soal pengecoh ala UTBK/ujian kampus.
 *
 * Sumber materi: tempel manual / transkrip terakhir (store) / materi unggahan.
 * Server: POST /api/ai/cram (LLM, strict grounding ke materi).
 * Fallback offline (pola repo: jangan hard-fail): heuristic memilih paragraf
 * terpenting berdasarkan sinyal teks (definisi, angka, heading); bagian
 * deteksi jebakan hanya ada kalau server AI aktif.
 */

import { useCallback, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { CheckSquare, ChevronRight, Clock, FileText, ListChecks, Skull, Upload } from 'lucide-react';
import { useAppStore } from '@/lib/store';

interface IntiItem { poin: string; mengapa_krusial: string; prioritas: 'wajib' | 'penting' | string }
interface JebakanItem { soal: string; opsi: string[]; jawaban: string; jebakan: string; penjelasan: string }
interface CramResult {
  ringkasan: string;
  inti: IntiItem[];
  jebakan: JebakanItem[];
  kilat: string[];
  checklist: string[];
}

const TIPE = [
  { id: 'utbk', label: 'UTBK/SNBT' },
  { id: 'uas', label: 'UAS kampus' },
  { id: 'kuis', label: 'Kuis kilat' },
  { id: 'lisan', label: 'Ujian lisan' },
] as const;

type TipeId = (typeof TIPE)[number]['id'];

// ── fallback offline: saring paragraf terpenting (±30%) dari teks ──
function heuristikInti(text: string): string[] {
  const chunks = text
    .split(/\n{2,}|\.(?=\s+[A-Z0-9"])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
  if (chunks.length === 0) return text.length > 0 ? [text.slice(0, 400)] : [];

  const score = (s: string): number => {
    let n = 0;
    if (/\d/.test(s)) n += 2; // angka & data
    if (/(adalah|ialah|yaitu|merupakan|definisi|didefinisikan)/i.test(s)) n += 3; // definisi
    if (/(karena|sebab|sehingga|dapat|harus|penting|tujuan|fungsi|proses)/i.test(s)) n += 2;
    if (s.length < 80) n += 2; // mirip heading
    if (/^(bab|bagian|pasal|kesimpulan|introduction|metode|hasil|kesimpulan)/i.test(s)) n += 3;
    return n + Math.min(s.length / 200, 2);
  };
  const target = Math.max(3, Math.ceil(chunks.length * 0.3));
  return [...chunks]
    .sort((a, b) => score(b) - score(a))
    .slice(0, target)
    .sort((a, b) => a.localeCompare(b))
    .map((s) => (s.length > 280 ? s.slice(0, 280) + '...' : s));
}

export function CramMode({ open, onClose }: { open: boolean; onClose: () => void }) {
  const transcript = useAppStore((s) => s.transcript);
  const materials = useAppStore((s) => s.uploadedMaterials);

  const [sourceText, setSourceText] = useState('');
  const [tipe, setTipe] = useState<TipeId>('uas');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CramResult | null>(null);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [checkedSteps, setCheckedSteps] = useState<Record<number, boolean>>({});

  const hasTranscript = transcript.trim().length > 50;
  const hasMaterial = materials.length > 0;

  const chip = (active: boolean) =>
    'rounded-md border px-3 py-1.5 text-sm transition-colors ' +
    (active
      ? 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]'
      : 'border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]');

  const inputCls =
    'w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]';

  const generate = useCallback(async () => {
    if (sourceText.trim().length < 50) {
      toast.error('Materi masih kosong. Tempel teks, atau pakai transkrip/materi unggahan.');
      return;
    }
    setLoading(true);
    setPicked({});
    setCheckedSteps({});
    setOfflineNotice(null);
    try {
      const res = await fetch('/api/ai/cram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceText, tipe }),
        signal: AbortSignal.timeout(95_000),
      });
      if (!res.ok) throw new Error(`server ${res.status}`);
      const data = await res.json();
      const parsed = parseCram(data.content || '');
      if (!parsed) throw new Error('format tidak terbaca');
      setResult(parsed);
    } catch (e) {
      console.warn('[cram] server gagal, fallback offline:', e);
      const inti = heuristikInti(sourceText);
      setResult({
        ringkasan: 'Saringan offline: bagian materi terpenting (±30%) dipilih dari sinyal teks.',
        inti: inti.map((p) => ({ poin: p, mengapa_krusial: 'Dipilih offline: mengandung definisi/angka/kata kunci.', prioritas: 'penting' })),
        jebakan: [],
        kilat: [],
        checklist: [],
      });
      setOfflineNotice('Server AI tidak merespons. Inti materi disaring offline; deteksi soal pengecoh butuh server AI.');
      toast.error('Server AI tidak merespons; saringan offline dijalankan.');
    } finally {
      setLoading(false);
    }
  }, [sourceText, tipe]);

  const answerJebakan = (qIdx: number, opsiIdx: number) => {
    if (picked[qIdx] !== undefined) return;
    setPicked((prev) => ({ ...prev, [qIdx]: String.fromCharCode(65 + opsiIdx) }));
  };

  const stats = useMemo(() => {
    if (!result) return null;
    const jwb = Object.keys(picked).length;
    const benar = Object.entries(picked).filter(([q, p]) => result.jebakan[Number(q)]?.jawaban === p).length;
    return { jwb, benar, total: result.jebakan.length };
  }, [result, picked]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[94vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Mode SKS: saring materi H-1 jam ujian
          </DialogTitle>
          <p className="text-sm text-[var(--text-2)]">
            Masukkan materi sekali, dapat: 30% inti paling krusial, prediksi soal pengecoh, fakta kilat, dan checklist belajar. Jawaban soal terkunci hanya pada materimu.
          </p>
        </DialogHeader>

        {/* sumber materi */}
        <div className="space-y-3 mt-1">
          <div className="flex flex-wrap gap-2">
            {hasTranscript && (
              <Button variant="outline" size="sm" className="border-[var(--border)]" onClick={() => setSourceText(transcript)}>
                <FileText className="h-3.5 w-3.5 mr-1.5" />
                Pakai transkrip terakhir
              </Button>
            )}
            {hasMaterial && (
              <label className="inline-flex">
                <span className="sr-only">Pilih materi unggahan</span>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer">
                  <Upload className="h-3.5 w-3.5" />
                  Pakai materi unggahan
                  <select
                    className="bg-transparent text-xs outline-none max-w-[140px] text-[var(--text)]"
                    value=""
                    onChange={(e) => {
                      const m = materials.find((x) => x.id === e.target.value);
                      if (m?.text) { setSourceText(m.text.slice(0, 60_000)); toast.success(`Materi "${m.name}" dimuat`); }
                    }}
                  >
                    <option value="" disabled className="bg-[var(--surface-2)]">pilih...</option>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id} className="bg-[var(--surface-2)]">{m.name}</option>
                    ))}
                  </select>
                </span>
              </label>
            )}
          </div>

          <textarea
            rows={5}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="Tempel materi di sini: rangkuman, slide, catatan bab buku, hasil transkrip rekaman dosen..."
            className={inputCls + ' resize-none'}
            aria-label="Materi sumber"
          />

          <div className="flex flex-wrap gap-2">
            {TIPE.map((t) => (
              <button key={t.id} aria-pressed={tipe === t.id} onClick={() => setTipe(t.id)} className={chip(tipe === t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          <Button
            onClick={generate}
            disabled={loading}
            className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
          >
            {loading ? 'Menyaring materi...' : 'Saring materi (Mode SKS)'}
          </Button>
        </div>

        {/* hasil */}
        {result && (
          <div className="mt-5 space-y-4">
            <p className="text-sm text-[var(--text-2)]">{result.ringkasan}</p>
            {offlineNotice && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--text-2)]">
                {offlineNotice}
              </div>
            )}

            {/* inti 30% */}
            {result.inti.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-medium mb-3">Inti 30% materi ({result.inti.length} poin)</p>
                <ol className="space-y-3">
                  {result.inti.map((item, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-stone-700 text-[10px] text-stone-100">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm text-[var(--text)]">{item.poin}</p>
                        {item.mengapa_krusial && (
                          <p className="text-xs text-[var(--text-3)] mt-0.5">{item.mengapa_krusial}</p>
                        )}
                      </div>
                      {item.prioritas === 'wajib' && (
                        <span className="ml-auto shrink-0 self-start rounded-md bg-stone-700 px-2 py-0.5 text-[10px] text-stone-100">
                          wajib
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* soal pengecoh */}
            {result.jebakan.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-medium mb-1 flex items-center gap-1.5">
                  <Skull className="h-4 w-4" />
                  Prediksi soal pengecoh ({result.jebakan.length} soal)
                </p>
                {stats && stats.jwb > 0 && (
                  <p className="text-xs text-[var(--text-3)] mb-3">
                    Terjawab {stats.jwb}/{stats.total}, benar {stats.benar}
                  </p>
                )}
                <div className="space-y-4">
                  {result.jebakan.map((q, qi) => {
                    const pick = picked[qi];
                    const answered = pick !== undefined;
                    const correctLetter = q.jawaban?.trim().toUpperCase().charAt(0);
                    return (
                      <div key={qi}>
                        <p className="text-sm mb-2">{qi + 1}. {q.soal}</p>
                        <div className="space-y-1.5">
                          {q.opsi.map((opsi, oi) => {
                            const letter = String.fromCharCode(65 + oi);
                            const isPick = pick === letter;
                            const isCorrect = letter === correctLetter;
                            let cls = 'w-full text-left rounded-md border px-3 py-2 text-sm transition-colors ';
                            if (!answered) {
                              cls += 'border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]';
                            } else if (isCorrect) {
                              cls += 'border-green-500/40 text-green-400';
                            } else if (isPick) {
                              cls += 'border-red-500/40 text-red-400';
                            } else {
                              cls += 'border-[var(--border)] text-[var(--text-3)]';
                            }
                            return (
                              <button key={oi} onClick={() => answerJebakan(qi, oi)} disabled={answered} className={cls}>
                                {letter}. {opsi}
                              </button>
                            );
                          })}
                        </div>
                        {answered && (
                          <div className="mt-2 rounded-md bg-[var(--surface-2)] p-3 text-xs space-y-1.5">
                            <p className="text-[var(--text-2)]">
                              <span className="text-[var(--text)]">Jebakan:</span> {q.jebakan}
                            </p>
                            <p className="text-[var(--text-2)]">
                              <span className="text-[var(--text)]">Penjelasan:</span> {q.penjelasan}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* fakta kilat */}
            {result.kilat.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-medium mb-3">Fakta kilat untuk hafalan terakhir</p>
                <div className="flex flex-wrap gap-2">
                  {result.kilat.map((k, i) => (
                    <span key={i} className="rounded-md bg-[var(--surface-2)] border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-2)] max-w-full">
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* checklist H-1 */}
            {result.checklist.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-medium mb-3 flex items-center gap-1.5">
                  <ListChecks className="h-4 w-4" />
                  Checklist belajar H-1
                </p>
                <div className="space-y-2">
                  {result.checklist.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => setCheckedSteps((prev) => ({ ...prev, [i]: !prev[i] }))}
                      className="flex w-full items-start gap-2.5 text-left"
                      aria-pressed={!!checkedSteps[i]}
                    >
                      <CheckSquare className={'h-4 w-4 mt-0.5 shrink-0 transition-colors ' + (checkedSteps[i] ? 'text-green-400' : 'text-[var(--text-3)]')} />
                      <span className={'text-sm ' + (checkedSteps[i] ? 'text-[var(--text-3)] line-through' : 'text-[var(--text-2)]')}>
                        {c}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-[var(--text-3)] flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Semua hasil di atas disaring hanya dari materi yang kamu masukkan, bukan pengetahuan umum model.
            </p>
          </div>
        )}

        {!result && !loading && (
          <div className="mt-4 flex items-center gap-2 text-xs text-[var(--text-3)]">
            <ChevronRight className="h-3.5 w-3.5" />
            Mulai dari tempel materi, lalu tekan Saring materi.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function parseCram(content: string): CramResult | null {
  const cleaned = content.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    return {
      ringkasan: typeof obj.ringkasan === 'string' ? obj.ringkasan : '',
      inti: Array.isArray(obj.inti) ? obj.inti : [],
      jebakan: Array.isArray(obj.jebakan) ? obj.jebakan : [],
      kilat: Array.isArray(obj.kilat) ? obj.kilat : [],
      checklist: Array.isArray(obj.checklist) ? obj.checklist : [],
    };
  } catch {
    return null;
  }
}
