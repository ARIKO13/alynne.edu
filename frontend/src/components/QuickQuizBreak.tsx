/**
 * QuickQuizBreak.tsx  -  "Pomodoro Pintar": 3 soal kilat sebelum istirahat
 *
 * Dipanggil StudyPipeline saat timer pomodoro habis. Sebelum waktu istirahat
 * dimulai, user menjawab maksimal 3 soal pilihan ganda yang diacak dari soal
 * bab yang sudah digenerate. Tujuannya menahan materi di memori jangka
 * panjang lewat recall aktif, bukan sekadar menutup sesi.
 *
 * Soal fill-blank (tanpa opsi) dilewati; kalau soal MC kurang dari 1,
 * komponen tidak muncul (istirahat langsung, seperti pomodoro biasa).
 */

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Coffee } from 'lucide-react';
import type { QuizQuestion } from '@/lib/stt-chapter-splitter';

interface QuickQuizBreakProps {
  open: boolean;
  onClose: () => void;
  questions: QuizQuestion[];
}

const COUNT = 3;

export function QuickQuizBreak({ open, onClose, questions }: QuickQuizBreakProps) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [correct, setCorrect] = useState(0);
  const [done, setDone] = useState(false);
  // snapshot soal saat dialog dibuka; tidak ikut deps questions supaya
  // re-render parent (array flat() baru tiap render) tidak mengacak soal di tengah kuis
  const [pickedQuestions, setPickedQuestions] = useState<QuizQuestion[]>([]);

  useEffect(() => {
    if (open) {
      const mc = questions.filter((q) => q.type === 'multiple-choice' && Array.isArray(q.options) && q.options.length >= 2);
      setPickedQuestions([...mc].sort(() => Math.random() - 0.5).slice(0, COUNT));
      setIdx(0);
      setPicked(null);
      setCorrect(0);
      setDone(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  // tidak ada soal MC yang layak -> istirahat langsung
  if (pickedQuestions.length === 0) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-sm text-center">
          <Coffee className="h-10 w-10 mx-auto mb-3 text-[var(--accent-soft)]" />
          <DialogTitle className="text-lg mb-1">Waktunya istirahat</DialogTitle>
          <p className="text-sm text-[var(--text-2)] mb-4">
            Sesi belajar selesai. Generate soal dulu di tab Materi kalau mau istirahat diawali soal kilat.
          </p>
          <Button onClick={onClose} className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)]">
            Mulai istirahat
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  const q = pickedQuestions[idx];

  const answer = (opt: string) => {
    if (picked) return;
    setPicked(opt);
    if (opt === q.correctAnswer) setCorrect((c) => c + 1);
  };

  const next = () => {
    if (idx + 1 >= pickedQuestions.length) {
      setDone(true);
    } else {
      setIdx((i) => i + 1);
      setPicked(null);
    }
  };

  // ── layar selesai ──
  if (done) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-sm text-center">
          <Coffee className="h-10 w-10 mx-auto mb-3 text-[var(--accent-soft)]" />
          <DialogTitle className="text-lg mb-1">Berhasil! Sekarang istirahat.</DialogTitle>
          <p className="text-sm text-[var(--text-2)] mb-4">
            Skor soal kilat: <span className="text-[var(--text)] font-medium">{correct}/{pickedQuestions.length}</span> benar.
            Recall aktif sebelum istirahat bikin materi lebih nempel daripada langsung berhenti.
          </p>
          <Button onClick={onClose} className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)]">
            Mulai istirahat
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  // ── layar soal ──
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Sebelum istirahat: soal kilat</DialogTitle>
          <p className="text-xs text-[var(--text-3)]">
            {idx + 1}/{pickedQuestions.length} soal singkat untuk menahan materi di kepala
          </p>
        </DialogHeader>

        <p className="text-sm mb-3">{q.question}</p>

        <div className="space-y-2">
          {(q.options || []).map((opt, i) => {
            let cls = 'w-full text-left rounded-md border px-3 py-2 text-sm transition-colors ';
            if (!picked) cls += 'border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]';
            else if (opt === q.correctAnswer) cls += 'border-green-500/40 text-green-400';
            else if (opt === picked) cls += 'border-red-500/40 text-red-400';
            else cls += 'border-[var(--border)] text-[var(--text-3)]';
            return (
              <button key={i} onClick={() => answer(opt)} disabled={!!picked} className={cls}>
                {opt}
              </button>
            );
          })}
        </div>

        {picked && (
          <div className="mt-3">
            {q.explanation && (
              <p className="text-xs text-[var(--text-2)] mb-3">{q.explanation}</p>
            )}
            <Button onClick={next} className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)]">
              {idx + 1 >= pickedQuestions.length ? 'Lihat hasil' : 'Lanjut'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
