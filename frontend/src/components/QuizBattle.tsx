/**
 * QuizBattle.tsx  -  Gamified timed quiz with scoring
 *
 * Takes quiz questions (from STT chapters or custom), runs them as a battle:
 * - Timer per question (10 seconds default)
 * - Score: correct + time bonus
 * - Combo multiplier (consecutive correct)
 * - Final score + accuracy + rank
 */

import { useState, useCallback, useEffect } from 'react';
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
  Flame,
  Trophy,
  Zap,
  Check,
  X,
  RotateCcw,
  Award,
} from 'lucide-react';
import type { QuizQuestion } from '@/lib/stt-chapter-splitter';
import { recordQuizResult } from '@/lib/ai-memory';

interface QuizBattleProps {
  open: boolean;
  onClose: () => void;
  questions: QuizQuestion[];
  title?: string;
}

type BattleState = 'idle' | 'playing' | 'result';

const TIME_PER_QUESTION = 10; // seconds
const BASE_SCORE = 100;
const TIME_BONUS_MULTIPLIER = 10;

export function QuizBattle({ open, onClose, questions, title }: QuizBattleProps) {
  const [state, setState] = useState<BattleState>('idle');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIME_PER_QUESTION);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [answers, setAnswers] = useState<boolean[]>([]);

  const currentQuestion = questions[currentIdx];

  const startBattle = useCallback(() => {
    setState('playing');
    setCurrentIdx(0);
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setCorrectCount(0);
    setTimeLeft(TIME_PER_QUESTION);
    setSelectedAnswer(null);
    setShowResult(false);
    setAnswers([]);
  }, []);

  // Timer
  useEffect(() => {
    if (state !== 'playing' || showResult) return;

    if (timeLeft <= 0) {
      handleAnswer('');
      return;
    }

    const timer = setTimeout(() => {
      setTimeLeft((t) => t - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [state, timeLeft, showResult]);

  const handleAnswer = useCallback(
    (answer: string) => {
      if (showResult || !currentQuestion) return;

      setSelectedAnswer(answer);
      setShowResult(true);

      const isCorrect = answer === currentQuestion.correctAnswer;
      setAnswers((prev) => [...prev, isCorrect]);

      if (isCorrect) {
        const newCombo = combo + 1;
        const timeBonus = timeLeft * TIME_BONUS_MULTIPLIER;
        const comboMultiplier = 1 + (newCombo - 1) * 0.2; // +20% per combo
        const points = Math.round((BASE_SCORE + timeBonus) * comboMultiplier);

        setScore((s) => s + points);
        setCombo(newCombo);
        setMaxCombo((m) => Math.max(m, newCombo));
        setCorrectCount((c) => c + 1);
      } else {
        setCombo(0);
      }
    },
    [showResult, currentQuestion, combo, timeLeft]
  );

  const nextQuestion = useCallback(() => {
    if (currentIdx + 1 >= questions.length) {
      // Battle done
      setState('result');
      recordQuizResult(correctCount, questions.length);
    } else {
      setCurrentIdx((i) => i + 1);
      setTimeLeft(TIME_PER_QUESTION);
      setSelectedAnswer(null);
      setShowResult(false);
    }
  }, [currentIdx, questions.length, correctCount]);

  if (!open) return null;

  // ── Result screen ──
  if (state === 'result') {
    const accuracy = Math.round((correctCount / questions.length) * 100);
    const rank = getRank(score, accuracy);

    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-md  text-center">
          <Trophy className="h-16 w-16 mx-auto mb-4 text-amber-400" />
          <DialogTitle className="text-2xl mb-2">Battle Selesai!</DialogTitle>
          <p className="text-sm text-stone-400 mb-6">{title || 'Quiz Battle'}</p>

          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-4">
              <p className="text-3xl font-bold text-amber-400">{score}</p>
              <p className="text-[10px] text-stone-500 uppercase">Skor</p>
            </div>
            <div className="rounded-lg border border-green-500/20 bg-green-500/[0.05] p-4">
              <p className="text-3xl font-bold text-green-400">{accuracy}%</p>
              <p className="text-[10px] text-stone-500 uppercase">Akurasi</p>
            </div>
            <div className="rounded-lg border border-stone-400/20 bg-stone-400/[0.05] p-4">
              <p className="text-3xl font-bold text-[var(--accent-soft)]">{correctCount}/{questions.length}</p>
              <p className="text-[10px] text-stone-500 uppercase">Benar</p>
            </div>
            <div className="rounded-lg border border-stone-400/20 bg-stone-400/[0.05] p-4">
              <p className="text-3xl font-bold text-stone-400">x{maxCombo}</p>
              <p className="text-[10px] text-stone-500 uppercase">Max Combo</p>
            </div>
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 mb-6">
            <Award className="h-8 w-8 mx-auto mb-2" style={{ color: rank.color }} />
            <p className="text-lg font-semibold" style={{ color: rank.color }}>
              {rank.title}
            </p>
            <p className="text-xs text-stone-400">{rank.message}</p>
          </div>

          <div className="flex gap-2">
            <Button onClick={startBattle} className="flex-1 bg-[var(--accent)] hover:bg-[var(--accent)]">
              <RotateCcw className="h-4 w-4 mr-2" />
              Ulangi
            </Button>
            <Button onClick={onClose} variant="outline" className="flex-1 border-white/[0.08]">
              Tutup
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Playing screen ──
  if (state === 'playing' && currentQuestion) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-lg ">
          {/* Header: score + combo + question counter */}
          <div className="flex items-center justify-between mb-4">
            <Badge variant="outline" className="border-amber-500/30 text-amber-400">
              <Zap className="h-3 w-3 mr-1" />
              {score}
            </Badge>
            {combo > 1 && (
              <Badge variant="outline" className="border-stone-400/30 text-stone-400 animate-pulse">
                <Flame className="h-3 w-3 mr-1" />
                Combo x{combo}
              </Badge>
            )}
            <Badge variant="outline" className="text-stone-400">
              {currentIdx + 1}/{questions.length}
            </Badge>
          </div>

          {/* Timer */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-stone-500 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Waktu
              </span>
              <span className={`text-sm font-bold ${timeLeft <= 3 ? 'text-red-400' : 'text-stone-300'}`}>
                {timeLeft}s
              </span>
            </div>
            <Progress value={(timeLeft / TIME_PER_QUESTION) * 100} className="h-1.5" />
          </div>

          {/* Question */}
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 mb-4">
            <p className="text-sm text-stone-200">{currentQuestion.question}</p>
          </div>

          {/* Options */}
          <div className="grid grid-cols-1 gap-2">
            {currentQuestion.options?.map((opt) => {
              const isSelected = selectedAnswer === opt;
              const isCorrect = opt === currentQuestion.correctAnswer;
              const showCorrect = showResult && isCorrect;
              const showWrong = showResult && isSelected && !isCorrect;

              return (
                <button
                  key={opt}
                  disabled={showResult}
                  onClick={() => handleAnswer(opt)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors border ${
                    showCorrect
                      ? 'border-green-500/50 bg-green-500/10 text-green-400'
                      : showWrong
                      ? 'border-red-500/50 bg-red-500/10 text-red-400'
                      : isSelected
                      ? 'border-stone-400 bg-stone-400/10 text-[var(--accent-soft)]'
                      : 'border-white/[0.06] text-stone-300 hover:border-white/[0.15] hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="flex-1 text-left">{opt}</span>
                  {showCorrect && <Check className="h-4 w-4" />}
                  {showWrong && <X className="h-4 w-4" />}
                </button>
              );
            })}
          </div>

          {/* Result feedback + next button */}
          {showResult && (
            <div className="mt-4 space-y-3">
              <div
                className={`rounded-lg p-3 text-center ${
                  selectedAnswer === currentQuestion.correctAnswer
                    ? 'bg-green-500/10 text-green-400'
                    : 'bg-red-500/10 text-red-400'
                }`}
              >
                <p className="text-sm font-semibold">
                  {selectedAnswer === currentQuestion.correctAnswer
                    ? '✓ Benar!'
                    : selectedAnswer === ''
                    ? 'Waktu habis!'
                    : '✗ Salah!'}
                </p>
                {selectedAnswer !== currentQuestion.correctAnswer && (
                  <p className="text-xs mt-1">
                    Jawaban: {currentQuestion.correctAnswer}
                  </p>
                )}
                {currentQuestion.explanation && (
                  <p className="text-[11px] text-stone-400 mt-1">
                    {currentQuestion.explanation}
                  </p>
                )}
              </div>
              <Button onClick={nextQuestion} className="w-full bg-[var(--accent)] hover:bg-[var(--accent)]">
                {currentIdx + 1 >= questions.length ? 'Lihat Hasil' : 'Soal Berikutnya'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  // ── Idle/start screen ──
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md  text-center">
        <Flame className="h-16 w-16 mx-auto mb-4 text-stone-400" />
        <DialogTitle className="text-2xl mb-2">Quiz Battle</DialogTitle>
        <p className="text-sm text-stone-400 mb-6">{title || 'Test your knowledge'}</p>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="text-xl font-bold text-white">{questions.length}</p>
            <p className="text-[10px] text-stone-500 uppercase">Soal</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="text-xl font-bold text-white">{TIME_PER_QUESTION}s</p>
            <p className="text-[10px] text-stone-500 uppercase">Per Soal</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="text-xl font-bold text-white">x5</p>
            <p className="text-[10px] text-stone-500 uppercase">Max Combo</p>
          </div>
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 mb-6 text-left">
          <p className="text-xs text-stone-400 mb-2">Cara main:</p>
          <ul className="text-[11px] text-stone-500 space-y-1">
            <li>• 10 detik per soal</li>
            <li>• Jawaban benar: 100 + bonus waktu</li>
            <li>• Combo (berturut-turut): +20% per combo</li>
            <li>• Salah/waktu habis: combo reset</li>
          </ul>
        </div>

        <Button onClick={startBattle} className="w-full bg-[var(--accent)] hover:bg-[var(--accent)]" size="lg">
          <Zap className="h-5 w-5 mr-2" />
          Mulai Battle!
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function getRank(score: number, accuracy: number): { title: string; message: string; color: string } {
  if (accuracy === 100) {
    return { title: 'Perfect!', message: 'Semua benar! Luar biasa!', color: '#FBBF24' };
  }
  if (accuracy >= 80) {
    return { title: 'Master', message: 'Hampir sempurna!', color: '#F59E0B' };
  }
  if (accuracy >= 60) {
    return { title: 'Expert', message: 'Kerja bagus, lanjutkan!', color: '#94A3B8' };
  }
  if (accuracy >= 40) {
    return { title: 'Learner', message: 'Belajar lagi yuk!', color: '#A8A29E' };
  }
  return { title: 'Beginner', message: 'Jangan menyerah, coba lagi!', color: '#6B7280' };
}
