import { useAppStore, MODEL_LIST, type QuizQuestion } from '@/lib/store';
import { getTierForXP, getXPProgress, getXPToNextTier, TIERS } from '@/lib/tiers';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Play, CheckCircle2, XCircle, ArrowRight, Trophy, Zap, Flame, Star,
  RotateCcw, Sparkles, Timer, Target, Crown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

const DIFFICULTY_COLORS = {
  easy: 'border-green-500/30 text-green-400 bg-green-500/10',
  medium: 'border-violet-500/30 text-violet-400 bg-violet-500/10',
  hard: 'border-red-500/30 text-red-400 bg-red-500/10',
};

const DIFFICULTY_XP = { easy: 10, medium: 20, hard: 30 };

export function GamePanel() {
  const {
    user, transcript, apiKeys, selectedModel,
    quizQuestions, setQuizQuestions, currentQuestionIdx, setCurrentQuestionIdx,
    selectedAnswers, setSelectedAnswer, gamePhase, setGamePhase,
    gameResult, setGameResult, isGeneratingQuiz, setIsGeneratingQuiz,
    quizTopic, setQuizTopic, userStats, setUserStats,
  } = useAppStore();

  const [startTime, setStartTime] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!user) return;
    fetch(`/api/progress/stats?userId=${user.id}`).then(r => r.json()).then(setUserStats);
  }, [user, setUserStats]);

  useEffect(() => {
    if (gamePhase !== 'playing') return;
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [gamePhase, startTime]);

  const startQuiz = useCallback(async () => {
    if (!transcript.trim()) { toast.error('Transkrip dulu di tab Speech to Text!'); return; }
    if (!user) return;
    setIsGeneratingQuiz(true);
    setGamePhase('playing');
    setSelectedAnswer([]); setCurrentQuestionIdx(0); setStartTime(Date.now()); setElapsed(0);
    try {
      const res = await fetch('/api/game/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, apiKey: apiKeys, model: selectedModel }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setQuizQuestions(data.questions); setQuizTopic(data.topic);
      toast.success(`${data.questions.length} soal dari: ${data.topic}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal generate quiz');
      setGamePhase('idle');
    } finally { setIsGeneratingQuiz(false); }
  }, [transcript, user, apiKeys, selectedModel, setIsGeneratingQuiz, setGamePhase, setSelectedAnswer, setCurrentQuestionIdx, setQuizQuestions, setQuizTopic]);

  const submitQuiz = useCallback(async () => {
    if (!user || quizQuestions.length === 0) return;
    const timeSpent = Math.floor((Date.now() - startTime) / 1000);
    try {
      const res = await fetch('/api/game/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, answers: selectedAnswers, questions: quizQuestions, topic: quizTopic, timeSpentSeconds: timeSpent }),
      });
      const data = await res.json(); if (data.error) throw new Error(data.error);
      setGameResult(data); setGamePhase('result');
      fetch(`/api/progress/stats?userId=${user.id}`).then(r => r.json()).then(setUserStats);
      if (data.tierUp) {
        toast.success(`${data.newTier.emoji} TIER UP! Sekarang ${data.newTier.emoji} ${data.newTier.name}!`);
      } else if (data.score === 100) {
        toast.success('PERFECT SCORE! +50 bonus XP!');
      } else if (data.score >= 80) {
        toast.success(`Hebat! Score: ${data.score}%`);
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Gagal submit'); }
  }, [user, quizQuestions, selectedAnswers, quizTopic, startTime, setGameResult, setGamePhase, setUserStats]);

  const resetGame = () => {
    setGamePhase('idle'); setQuizQuestions([]); setSelectedAnswers([]); setCurrentQuestionIdx(0); setGameResult(null);
  };

  const q = quizQuestions[currentQuestionIdx];
  const stats = userStats;
  const tier = getTierForXP(stats?.xp || 0);
  const nextTier = TIERS.find(t => t.level === tier.level + 1);
  const xpProgress = getXPProgress(stats?.xp || 0, tier);
  const xpToNext = getXPToNextTier(stats?.xp || 0, tier);
  const answeredCount = selectedAnswers.filter(a => a !== null && a !== undefined).length;

  return (
    <div className="space-y-4">
      {/* Player Stats Bar */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            {user?.image ? (
              <img src={user.image} className="h-9 w-9 rounded-full ring-2 ring-white/10" alt="" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#B794F6] text-white font-bold text-sm">{user?.name?.[0] || '?'}</div>
            )}
            <div>
              <p className="text-sm font-medium leading-tight text-zinc-200">{user?.name || 'Player'}</p>
              <p className="text-[10px] text-zinc-500">{tier.emoji} {tier.name} <span className="text-zinc-700">{tier.exclusivity}</span></p>
            </div>
          </div>
          <div className="flex flex-1 flex-wrap gap-2 ml-auto">
            <div className="flex items-center gap-1.5 rounded-lg bg-violet-500/10 px-2.5 py-1.5 border border-violet-500/10">
              <Zap className="h-3.5 w-3.5 text-violet-400" />
              <span className="text-xs font-bold text-violet-400">{(stats?.xp || 0).toLocaleString()} XP</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-[#B794F6]/10 px-2.5 py-1.5 border border-[#B794F6]/10">
              <Flame className="h-3.5 w-3.5 text-[#B794F6]" />
              <span className="text-xs font-bold text-[#B794F6]">{stats?.streak || 0} streak</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-violet-500/10 px-2.5 py-1.5 border border-violet-500/10">
              <Crown className="h-3.5 w-3.5 text-violet-400" />
              <span className="text-xs font-bold text-violet-400">S{stats?.currentSeason || 1}</span>
            </div>
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <div className="flex justify-between text-[10px] text-zinc-500">
            <span>{tier.emoji} {tier.name}</span>
            <span>{nextTier ? `${nextTier.emoji} ${nextTier.name} (${xpToNext.toLocaleString()} XP lagi)` : 'MAX TIER'}</span>
          </div>
          <Progress value={xpProgress} className="h-1.5" />
        </div>
      </div>

      {gamePhase === 'idle' && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] flex flex-col items-center py-12 text-center">
          <div className="rounded-full bg-[#B794F6]/10 p-4"><Play className="h-8 w-8 text-[#B794F6]" /></div>
          <h3 className="mt-4 text-lg font-semibold text-zinc-100">Game Kompetisi</h3>
          <p className="mt-1 max-w-sm text-sm text-zinc-500">
            {transcript ? `Transkrip siap! (${transcript.length} karakter). Mulai quiz dari materi kamu.` : 'Transkrip audio dulu di tab Speech to Text, lalu mainkan quiz dari materimu!'}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Badge variant="outline" className="gap-1 text-[11px] border-white/[0.08] text-zinc-500"><Zap className="h-3 w-3" />Easy +10 XP</Badge>
            <Badge variant="outline" className="gap-1 text-[11px] border-white/[0.08] text-zinc-500"><Star className="h-3 w-3" />Medium +20 XP</Badge>
            <Badge variant="outline" className="gap-1 text-[11px] border-white/[0.08] text-zinc-500"><Flame className="h-3 w-3" />Hard +30 XP</Badge>
          </div>
          <Button onClick={startQuiz} disabled={!transcript || isGeneratingQuiz} className="mt-6 gap-2 bg-[#B794F6] hover:bg-[#d14e1c] rounded-lg text-white font-medium" size="lg">
            {isGeneratingQuiz ? (<><RotateCcw className="h-4 w-4 animate-spin" /> Generating Quiz...</>) : (<><Play className="h-4 w-4" /> Mulai Quiz</>)}
          </Button>
        </div>
      )}

      {gamePhase === 'playing' && q && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/[0.06]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge className={cn('text-[11px] border', DIFFICULTY_COLORS[q.difficulty])}>{q.difficulty.toUpperCase()} +{DIFFICULTY_XP[q.difficulty]} XP</Badge>
                {quizTopic && <Badge variant="outline" className="text-[11px] border-white/[0.08] text-zinc-500">{quizTopic}</Badge>}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                <span className="flex items-center gap-1"><Timer className="h-3 w-3" />{elapsed}s</span>
                <span>{currentQuestionIdx + 1}/{quizQuestions.length}</span>
              </div>
            </div>
            <Progress value={((currentQuestionIdx + 1) / quizQuestions.length) * 100} className="mt-2.5 h-1" />
          </div>
          <div className="p-5 space-y-4">
            {/* Context: Code snippet or Case Study */}
            {q.context && q.contextType !== 'none' && (
              <div className={cn(
                "rounded-lg border p-4 text-[12px] leading-relaxed overflow-x-auto",
                q.contextType === 'code'
                  ? 'border-blue-500/20 bg-blue-500/[0.04] font-mono text-blue-200 whitespace-pre'
                  : 'border-violet-500/20 bg-violet-500/[0.04] text-zinc-300'
              )}>
                <div className="flex items-center gap-1.5 mb-2">
                  {q.contextType === 'code' ? (
                    <Badge className="text-[9px] border-blue-500/30 text-blue-400 bg-blue-500/10">KODE</Badge>
                  ) : (
                    <Badge className="text-[9px] border-violet-500/30 text-violet-400 bg-violet-500/10">STUDI KASUS</Badge>
                  )}
                </div>
                {q.context}
              </div>
            )}
            <h3 className="text-base font-medium leading-relaxed text-zinc-200">{q.question}</h3>
            <div className="grid gap-2">
              {q.options.map((opt, i) => {
                const selected = selectedAnswers[currentQuestionIdx];
                const isSelected = selected === i;
                return (
                  <button key={i} onClick={() => setSelectedAnswer(currentQuestionIdx, i)} className={cn(
                    'flex items-center gap-3 rounded-lg border p-3.5 text-left text-sm transition-all',
                    isSelected
                      ? 'border-[#B794F6]/50 bg-[#B794F6]/10'
                      : 'border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.03]'
                  )}>
                    <span className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 text-xs font-bold transition-colors',
                      isSelected ? 'border-[#B794F6] bg-[#B794F6] text-white' : 'border-white/[0.12] text-zinc-500'
                    )}>{String.fromCharCode(65 + i)}</span>
                    <span className="text-zinc-300">{opt}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between pt-2">
              <button variant="ghost" onClick={() => setCurrentQuestionIdx(Math.max(0, currentQuestionIdx - 1))} disabled={currentQuestionIdx === 0} className="gap-1 text-sm text-zinc-500 hover:text-zinc-300 disabled:opacity-30 transition-colors">
                Sebelumnya
              </button>
              {currentQuestionIdx < quizQuestions.length - 1 ? (
                <Button onClick={() => setCurrentQuestionIdx(currentQuestionIdx + 1)} disabled={selectedAnswers[currentQuestionIdx] === null || selectedAnswers[currentQuestionIdx] === undefined} className="gap-1 bg-[#B794F6] hover:bg-[#d14e1c] text-white rounded-lg text-sm">
                  Selanjutnya <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button onClick={submitQuiz} disabled={answeredCount < quizQuestions.length} className="gap-1 bg-[#B794F6] hover:bg-[#d14e1c] text-white rounded-lg text-sm">
                  <Trophy className="h-3.5 w-3.5" /> Submit ({answeredCount}/{quizQuestions.length})
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {gamePhase === 'result' && gameResult && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 space-y-5">
          {gameResult.tierUp && (
            <div className="text-center py-3 rounded-lg bg-violet-500/10 border border-violet-500/20">
              <p className="text-xs font-medium text-violet-400">TIER UP!</p>
              <p className="text-2xl font-bold mt-1 text-zinc-100">
                {gameResult.prevTier?.emoji} {gameResult.prevTier?.name}
                <ArrowRight className="inline h-5 w-5 mx-2 text-[#B794F6]" />
                {gameResult.newTier?.emoji} {gameResult.newTier?.name}
              </p>
              <p className="text-[11px] text-violet-400/70 mt-1">{gameResult.newTier?.exclusivity}</p>
            </div>
          )}

          <div className="flex flex-col items-center">
            <div className={cn(
              'flex h-24 w-24 items-center justify-center rounded-full text-2xl font-bold text-white',
              gameResult.score >= 80 ? 'bg-[#B794F6]' : gameResult.score >= 50 ? 'bg-violet-600' : 'bg-red-600'
            )}>
              {gameResult.score}%
            </div>
            <p className="mt-2 text-lg font-semibold text-zinc-100">{gameResult.score === 100 ? 'PERFECT!' : gameResult.score >= 80 ? 'Hebat!' : gameResult.score >= 50 ? 'Lumayan!' : 'Ayo coba lagi!'}</p>
            <p className="text-sm text-zinc-500">{gameResult.correctCount}/{gameResult.total} jawaban benar</p>
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-[#161616] p-4 space-y-2">
            <h4 className="text-sm font-medium text-zinc-200">XP Earned</h4>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-zinc-500">Base XP</span><span className="font-semibold text-zinc-200">+{gameResult.xpEarned - gameResult.perfectBonus - gameResult.streakBonus}</span></div>
              {gameResult.perfectBonus > 0 && <div className="flex justify-between text-sm"><span className="text-violet-400">Perfect Bonus</span><span className="font-semibold text-violet-400">+{gameResult.perfectBonus}</span></div>}
              {gameResult.streakBonus > 0 && <div className="flex justify-between text-sm"><span className="text-[#B794F6]">Streak Bonus ({gameResult.streak} days)</span><span className="font-semibold text-[#B794F6]">+{gameResult.streakBonus}</span></div>}
              <div className="border-t border-white/[0.06] pt-1.5 flex justify-between text-sm font-bold"><span className="text-zinc-200">Total</span><span className="text-[#B794F6]">+{gameResult.xpEarned} XP</span></div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border border-white/[0.06] p-3"><p className="text-lg font-bold text-zinc-100">{gameResult.totalXP.toLocaleString()}</p><p className="text-[10px] text-zinc-500">Total XP</p></div>
            <div className="rounded-lg border border-white/[0.06] p-3"><p className="text-lg font-bold text-zinc-100">{gameResult.newTier?.emoji}</p><p className="text-[10px] text-zinc-500">{gameResult.newTier?.name}</p></div>
            <div className="rounded-lg border border-white/[0.06] p-3"><p className="text-lg font-bold text-zinc-100">{gameResult.streak}</p><p className="text-[10px] text-zinc-500">Day Streak</p></div>
          </div>

          <details className="rounded-lg border border-white/[0.06] group">
            <summary className="cursor-pointer p-3 text-sm font-medium text-zinc-300 hover:bg-white/[0.03] transition-colors rounded-t-lg">Lihat Jawaban & Penjelasan</summary>
            <div className="border-t border-white/[0.06] p-3 space-y-3 max-h-64 overflow-y-auto">
              {quizQuestions.map((qq, i) => {
                const userAns = selectedAnswers[i]; const isCorrect = userAns === qq.correctIndex;
                return (<div key={i} className="space-y-1"><div className="flex items-start gap-2">{isCorrect ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-400" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />}<div><p className="text-xs font-medium text-zinc-300">Q{i + 1}: {qq.question}</p><p className="text-[11px] text-zinc-500">Jawabanmu: {userAns !== null && userAns !== undefined ? qq.options[userAns] : '-'}{!isCorrect && ` | Benar: ${qq.options[qq.correctIndex]}`}</p><p className="text-[11px] text-green-400/80 mt-0.5">{qq.explanation}</p></div></div></div>);
              })}
            </div>
          </details>

          <div className="flex gap-2">
            <Button onClick={resetGame} variant="outline" className="flex-1 gap-1 border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] rounded-lg"><RotateCcw className="h-3.5 w-3.5" /> Main Lagi</Button>
            <Button onClick={() => useAppStore.getState().setActiveTab('dashboard')} variant="outline" className="flex-1 gap-1 border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] rounded-lg"><Sparkles className="h-3.5 w-3.5" /> Dashboard</Button>
          </div>
        </div>
      )}
    </div>
  );
}