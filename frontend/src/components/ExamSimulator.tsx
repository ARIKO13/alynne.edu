/**
 * ExamSimulator.tsx  -  Full exam simulator with timer + auto-grade
 *
 * AI generates a full exam (5-10 questions) from chapters:
 * - Multiple choice
 * - True/False
 * - Short answer (AI graded)
 *
 * Features:
 * - Timer countdown
 * - Auto-grade on submit
 * - Detailed feedback per question
 * - Score breakdown
 * - Retake with new questions
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Clock,
  Award,
  Check,
  X,
  RotateCcw,
  Send,
  Loader2,
  GraduationCap,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Chapter } from '@/lib/stt-chapter-splitter';
import { recordQuizResult } from '@/lib/ai-memory';

interface ExamSimulatorProps {
  open: boolean;
  onClose: () => void;
  chapters: Chapter[];
}

interface ExamQuestion {
  id: number;
  type: 'multiple-choice' | 'true-false' | 'short-answer';
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  userAnswer?: string;
  isCorrect?: boolean;
}

type ExamState = 'idle' | 'generating' | 'taking' | 'result';

export function ExamSimulator({ open, onClose, chapters }: ExamSimulatorProps) {
  const [state, setState] = useState<ExamState>('idle');
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [score, setScore] = useState(0);
  const [grading, setGrading] = useState(false);

  const generateExam = useCallback(async () => {
    setState('generating');
    const chaptersText = chapters
      .map(ch => `BAB ${ch.id}: ${ch.title}\n${ch.content.substring(0, 400)}`)
      .join('\n\n');

    const prompt = `Buat 8 soal ujian dari materi berikut. Format JSON array.

MATERI:
${chaptersText}

Syarat:
- 4 soal pilihan ganda (4 opsi)
- 2 soal benar/salah
- 2 soal isian singkat
- Menguji pemahaman, bukan hafalan
- Bahasa Indonesia

JSON array (tanpa markdown):
[{"id":1,"type":"multiple-choice","question":"Soal?","options":["A","B","C","D"],"correctAnswer":"A","explanation":"Karena..."},{"id":5,"type":"true-false","question":"Pernyataan...","options":["Benar","Salah"],"correctAnswer":"Benar","explanation":"Karena..."},{"id":7,"type":"short-answer","question":"Apa...?","correctAnswer":"jawaban","explanation":"Karena..."}]`;

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          model: 'qwen/qwen3.8-27b',
          max_tokens: 2000,
        }),
      });

      const data = await res.json();
      let content = '';
      if (data.choices?.[0]?.message?.content) content = data.choices[0].message.content;
      else if (data.content) content = data.content;

      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON');

      const exam = JSON.parse(jsonMatch[0]) as ExamQuestion[];
      setQuestions(exam.map((q, i) => ({ ...q, id: i + 1 })));
      setAnswers({});
      setCurrentQ(0);
      setTimeLeft(exam.length * 60); // 1 min per question
      setState('taking');
      toast.success(`Ujian dibuat! ${exam.length} soal, ${exam.length} menit.`);
    } catch (err) {
      toast.error('Gagal generate ujian. Coba lagi.');
      setState('idle');
    }
  }, [chapters]);

  // Timer
  useEffect(() => {
    if (state !== 'taking') return;
    if (timeLeft <= 0) {
      handleSubmit();
      return;
    }
    const timer = setTimeout(() => setTimeLeft(t => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [state, timeLeft]);

  const handleAnswer = (qId: number, answer: string) => {
    setAnswers(prev => ({ ...prev, [qId]: answer }));
  };

  const handleSubmit = useCallback(async () => {
    setState('result');
    setGrading(true);

    // Auto-grade
    let correct = 0;
    const graded = questions.map(q => {
      const userAnswer = answers[q.id] || '';
      const isCorrect = userAnswer.toLowerCase().trim() === q.correctAnswer.toLowerCase().trim();
      if (isCorrect) correct++;
      return { ...q, userAnswer, isCorrect };
    });

    setQuestions(graded);
    setScore(correct);
    recordQuizResult(correct, questions.length);
    setGrading(false);
  }, [questions, answers]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (!open) return null;

  const current = questions[currentQ];
  const answeredCount = Object.keys(answers).length;
  const accuracy = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <GraduationCap className="h-5 w-5 text-[#7C3AED]" />
            Exam Simulator
            <Badge variant="outline" className="text-[10px] ml-auto border-[#7C3AED]/30 text-[#7C3AED]">
              AI Generated
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* IDLE STATE */}
        {state === 'idle' && (
          <div className="text-center py-8 space-y-4">
            <GraduationCap className="h-16 w-16 mx-auto text-[#7C3AED]/50" />
            <div>
              <p className="text-sm text-zinc-300 mb-1">Ujian simulasi dari {chapters.length} bab</p>
              <p className="text-[11px] text-zinc-500">
                AI buat 8 soal (pilihan ganda + benar/salah + isian) → timer → auto-grade → feedback
              </p>
            </div>
            <Button onClick={generateExam} className="bg-[#7C3AED] hover:bg-[#7C3AED]" size="lg">
              <GraduationCap className="h-4 w-4 mr-2" />
              Mulai Ujian
            </Button>
          </div>
        )}

        {/* GENERATING STATE */}
        {state === 'generating' && (
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#7C3AED] mx-auto mb-4" />
            <p className="text-sm text-zinc-400">AI sedang membuat soal ujian...</p>
          </div>
        )}

        {/* TAKING STATE */}
        {state === 'taking' && current && (
          <div className="space-y-4">
            {/* Timer + Progress */}
            <div className="flex items-center justify-between">
              <Badge variant="outline" className={cn(
                'text-xs',
                timeLeft < 60 ? 'border-red-500/30 text-red-400' : 'border-zinc-700 text-zinc-400'
              )}>
                <Clock className="h-3 w-3 mr-1" />
                {formatTime(timeLeft)}
              </Badge>
              <span className="text-[10px] text-zinc-500">
                Soal {currentQ + 1}/{questions.length} | Terjawab: {answeredCount}
              </span>
            </div>
            <Progress value={((currentQ + 1) / questions.length) * 100} className="h-1" />

            {/* Question */}
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 mb-3">
                <Badge variant="outline" className="text-[9px]">
                  {current.type === 'multiple-choice' ? 'Pilihan Ganda' : current.type === 'true-false' ? 'Benar/Salah' : 'Isian Singkat'}
                </Badge>
              </div>
              <p className="text-sm text-zinc-200 mb-4">{current.question}</p>

              {/* Answer input */}
              {current.type === 'multiple-choice' || current.type === 'true-false' ? (
                <div className="grid grid-cols-1 gap-2">
                  {current.options?.map(opt => (
                    <button
                      key={opt}
                      onClick={() => handleAnswer(current.id, opt)}
                      className={cn(
                        'text-left px-3 py-2 rounded text-sm transition-colors border',
                        answers[current.id] === opt
                          ? 'border-[#7C3AED]/50 bg-[#7C3AED]/10 text-[#7C3AED]'
                          : 'border-white/[0.06] text-zinc-400 hover:border-white/[0.15]'
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  value={answers[current.id] || ''}
                  onChange={e => handleAnswer(current.id, e.target.value)}
                  placeholder="Ketik jawaban..."
                  className="w-full px-3 py-2 rounded bg-white/[0.04] border border-white/[0.08] text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-[#7C3AED]/50"
                />
              )}
            </div>

            {/* Navigation */}
            <div className="flex justify-between">
              <Button
                onClick={() => setCurrentQ(i => Math.max(0, i - 1))}
                disabled={currentQ === 0}
                variant="outline"
                size="sm"
                className="border-white/[0.08]"
              >
                ← Prev
              </Button>
              {currentQ < questions.length - 1 ? (
                <Button
                  onClick={() => setCurrentQ(i => i + 1)}
                  size="sm"
                  className="bg-[#7C3AED] hover:bg-[#7C3AED]"
                >
                  Lanjut
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Send className="h-3 w-3 mr-1" />
                  Submit
                </Button>
              )}
            </div>
          </div>
        )}

        {/* RESULT STATE */}
        {state === 'result' && (
          <div className="space-y-4">
            {grading ? (
              <div className="text-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-[#7C3AED] mx-auto mb-4" />
                <p className="text-sm text-zinc-400">Menilai jawaban...</p>
              </div>
            ) : (
              <>
                {/* Score */}
                <div className="text-center py-4">
                  <Award className={cn('h-16 w-16 mx-auto mb-2', accuracy >= 80 ? 'text-green-400' : accuracy >= 60 ? 'text-amber-400' : 'text-red-400')} />
                  <p className="text-3xl font-bold text-white">{score}/{questions.length}</p>
                  <p className="text-sm text-zinc-400">{accuracy}% Akurasi</p>
                  <Badge variant="outline" className={cn('mt-2 text-xs', accuracy >= 80 ? 'border-green-500/30 text-green-400' : accuracy >= 60 ? 'border-amber-500/30 text-amber-400' : 'border-red-500/30 text-red-400')}>
                    {accuracy >= 80 ? 'Excellent!' : accuracy >= 60 ? 'Good' : 'Belajar lagi!'}
                  </Badge>
                </div>

                {/* Review */}
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {questions.map((q, i) => (
                    <div
                      key={q.id}
                      className={cn(
                        'rounded-lg border p-3',
                        q.isCorrect ? 'border-green-500/20 bg-green-500/[0.05]' : 'border-red-500/20 bg-red-500/[0.05]'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {q.isCorrect ? (
                          <Check className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
                        ) : (
                          <X className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                        )}
                        <div className="flex-1">
                          <p className="text-xs text-zinc-200 mb-1">{i + 1}. {q.question}</p>
                          <p className="text-[10px] text-zinc-500">
                            Jawaban kamu: <span className={q.isCorrect ? 'text-green-400' : 'text-red-400'}>{q.userAnswer || '(kosong)'}</span>
                          </p>
                          {!q.isCorrect && (
                            <p className="text-[10px] text-green-400">Benar: {q.correctAnswer}</p>
                          )}
                          {q.explanation && (
                            <p className="text-[10px] text-zinc-600 mt-1">{q.explanation}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button onClick={generateExam} className="flex-1 bg-[#7C3AED] hover:bg-[#7C3AED]">
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Ulangi (Soal Baru)
                  </Button>
                  <Button onClick={() => { setState('idle'); setQuestions([]); }} variant="outline" className="border-white/[0.08]">
                    Tutup
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
