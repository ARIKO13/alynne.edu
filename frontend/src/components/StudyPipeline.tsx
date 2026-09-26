/**
 * StudyPipeline.tsx — Mode Belajar pipeline from STT result
 *
 * Flow:
 *   1. User clicks "Mode Belajar" after STT completes
 *   2. Pipeline auto-splits transcript into chapters (animated)
 *   3. Shows mindmap structure (animated)
 *   4. For each chapter:
 *      - Show content
 *      - Generate quiz
 *      - User answers quiz
 *   5. Option to start "Study Session" (Pomodoro + focus detector)
 *   6. Option to download Master PDF (all chapters combined)
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  X,
  BookOpen,
  Brain,
  FileText,
  Play,
  CheckCircle2,
  Loader2,
  Sparkles,
  Download,
  Clock,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import {
  splitTranscriptIntoChapters,
  generateQuizFromChapter,
  generateMindMapFromChapters,
  type Chapter,
  type QuizQuestion,
  type MindMapNode,
} from '@/lib/stt-chapter-splitter';

interface StudyPipelineProps {
  open: boolean;
  onClose: () => void;
  transcript: string;
  onStartStudySession?: (chapters: Chapter[]) => void;
}

type PipelineStage = 'idle' | 'splitting' | 'mindmap' | 'chapters' | 'complete';

export function StudyPipeline({ open, onClose, transcript, onStartStudySession }: StudyPipelineProps) {
  const [stage, setStage] = useState<PipelineStage>('idle');
  const [progress, setProgress] = useState(0);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<number | null>(null);
  const [quizzes, setQuizzes] = useState<Record<number, QuizQuestion[]>>({});
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['root']));

  // Auto-start pipeline when opened
  useEffect(() => {
    if (open && transcript && stage === 'idle') {
      runPipeline();
    }
  }, [open, transcript, stage]);

  const runPipeline = useCallback(async () => {
    setStage('splitting');
    setProgress(10);

    // Step 1: Split into chapters (animated delay for UX)
    await sleep(400);
    const split = splitTranscriptIntoChapters(transcript);
    setChapters(split);
    setProgress(40);

    // Step 2: Generate mindmap
    setStage('mindmap');
    await sleep(600);
    setProgress(70);

    // Step 3: Generate quizzes for each chapter
    setStage('chapters');
    const quizMap: Record<number, QuizQuestion[]> = {};
    for (const ch of split) {
      quizMap[ch.id] = generateQuizFromChapter(ch, 3);
      await sleep(100);
    }
    setQuizzes(quizMap);
    setProgress(100);

    setStage('complete');
  }, [transcript]);

  const mindmap = useMemo(() => generateMindMapFromChapters(chapters), [chapters]);

  const handleQuizAnswer = (questionKey: string, answer: string) => {
    setQuizAnswers((prev) => ({ ...prev, [questionKey]: answer }));
  };

  const handleDownloadMasterPDF = () => {
    // Generate a simple text file as "PDF" (proper PDF generation is heavy)
    const lines: string[] = [];
    lines.push('ALYNNE.EDU - Modul Belajar dari STT');
    lines.push('Dibuat: ' + new Date().toLocaleString('id-ID'));
    lines.push('');
    lines.push('='.repeat(60));
    lines.push('');

    chapters.forEach((ch) => {
      lines.push(`BAB ${ch.id}: ${ch.title}`);
      lines.push('-'.repeat(40));
      lines.push(ch.content);
      lines.push('');
      lines.push('');

      if (quizzes[ch.id]?.length) {
        lines.push(`Kuis Bab ${ch.id}:`);
        quizzes[ch.id].forEach((q, i) => {
          lines.push(`  ${i + 1}. ${q.question}`);
          q.options?.forEach((opt) => {
            const mark = opt === q.correctAnswer ? ' [JAWABAN]' : '';
            lines.push(`     - ${opt}${mark}`);
          });
          lines.push('');
        });
        lines.push('');
      }

      lines.push('='.repeat(60));
      lines.push('');
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alynne-modul-stt-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalQuestions = Object.values(quizzes).reduce((sum, qs) => sum + qs.length, 0);
  const answeredQuestions = Object.keys(quizAnswers).length;
  const correctAnswers = Object.entries(quizAnswers).filter(([key, answer]) => {
    const [chId, qId] = key.split('-').map(Number);
    const q = quizzes[chId]?.find((qq) => qq.id === qId);
    return q?.correctAnswer === answer;
  }).length;

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl bg-zinc-950/95 border-white/10 text-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-[#8B5CF6]" />
            Mode Belajar - Pipeline dari STT
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Transkrip otomatis dipecah jadi bab-bab, mindmap, dan kuis interaktif.
          </DialogDescription>
        </DialogHeader>

        {/* Progress bar */}
        {stage !== 'complete' && (
          <div className="rounded-lg border border-[#8B5CF6]/30 bg-[#8B5CF6]/[0.05] p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-[#8B5CF6]">
                <Loader2 className="h-4 w-4 animate-spin" />
                {stage === 'splitting' && 'Memecah transkrip jadi bab...'}
                {stage === 'mindmap' && 'Membuat mindmap...'}
                {stage === 'chapters' && 'Membuat kuis per bab...'}
              </span>
              <span className="text-zinc-400">{progress.toFixed(0)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {/* Stage: Splitting result */}
        {stage === 'complete' || stage === 'mindmap' || stage === 'chapters' ? (
          <div className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3">
              <StatCard icon={BookOpen} label="Bab" value={chapters.length} color="text-blue-400" />
              <StatCard icon={FileText} label="Kata" value={chapters.reduce((s, c) => s + c.wordCount, 0)} color="text-green-400" />
              <StatCard icon={Brain} label="Kuis" value={totalQuestions} color="text-[#8B5CF6]" />
              <StatCard icon={CheckCircle2} label="Benar" value={`${correctAnswers}/${answeredQuestions}`} color="text-amber-400" />
            </div>

            {/* Mindmap */}
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
                <Brain className="h-4 w-4 text-[#8B5CF6]" />
                Mindmap Materi
              </h3>
              <MindMapView node={mindmap} expanded={expandedNodes} onToggle={setExpandedNodes} />
            </div>

            {/* Chapters list */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-blue-400" />
                Bab-bab Materi ({chapters.length})
              </h3>
              {chapters.map((ch) => (
                <ChapterCard
                  key={ch.id}
                  chapter={ch}
                  quiz={quizzes[ch.id] || []}
                  answers={quizAnswers}
                  onAnswer={handleQuizAnswer}
                  isActive={activeChapterId === ch.id}
                  onToggle={() =>
                    setActiveChapterId(activeChapterId === ch.id ? null : ch.id)
                  }
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* Footer actions */}
        {stage === 'complete' && (
          <div className="flex flex-wrap gap-2 pt-4 border-t border-white/[0.06]">
            <Button
              onClick={() => onStartStudySession?.(chapters)}
              className="bg-[#8B5CF6] hover:bg-[#7C3AED]"
              disabled={chapters.length === 0}
            >
              <Play className="h-4 w-4 mr-2" />
              Mulai Sesi Belajar (Pomodoro + Focus)
            </Button>
            <Button
              onClick={handleDownloadMasterPDF}
              variant="outline"
              className="border-white/[0.08] text-zinc-300"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Modul (TXT)
            </Button>
            <Button variant="ghost" onClick={onClose} className="ml-auto text-zinc-400">
              <X className="h-4 w-4 mr-2" />
              Tutup
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-components ──

function StatCard({ icon: Icon, label, value, color }: {
  icon: typeof BookOpen;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-center">
      <Icon className={`h-4 w-4 mx-auto mb-1 ${color}`} />
      <p className="text-lg font-semibold text-white">{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase">{label}</p>
    </div>
  );
}

function MindMapView({
  node,
  expanded,
  onToggle,
  level = 0,
  path = 'root',
}: {
  node: MindMapNode;
  expanded: Set<string>;
  onToggle: (s: Set<string>) => void;
  level?: number;
  path?: string;
}) {
  const isExpanded = expanded.has(path);
  const hasChildren = node.children && node.children.length > 0;

  const toggle = () => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onToggle(next);
  };

  return (
    <div style={{ paddingLeft: level > 0 ? 16 : 0 }}>
      <div
        className={`flex items-center gap-2 py-1 ${level === 0 ? 'font-semibold text-[#8B5CF6]' : 'text-zinc-300'}`}
        onClick={hasChildren ? toggle : undefined}
        role={hasChildren ? 'button' : undefined}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown className="h-3 w-3 text-zinc-500" />
          ) : (
            <ChevronRight className="h-3 w-3 text-zinc-500" />
          )
        ) : (
          <span className="w-3" />
        )}
        <span className="text-sm">{node.label}</span>
      </div>
      {isExpanded && hasChildren && (
        <div className="border-l border-white/[0.06] ml-2">
          {node.children!.map((child, i) => (
            <MindMapView
              key={i}
              node={child}
              expanded={expanded}
              onToggle={onToggle}
              level={level + 1}
              path={`${path}-${i}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChapterCard({
  chapter,
  quiz,
  answers,
  onAnswer,
  isActive,
  onToggle,
}: {
  chapter: Chapter;
  quiz: QuizQuestion[];
  answers: Record<string, string>;
  onAnswer: (key: string, answer: string) => void;
  isActive: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/[0.04] transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#8B5CF6]/10 flex items-center justify-center text-xs font-bold text-[#8B5CF6]">
            {chapter.id}
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-200">{chapter.title}</p>
            <p className="text-[10px] text-zinc-500">{chapter.wordCount} kata</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {quiz.length > 0 && (
            <Badge variant="outline" className="text-[10px] border-[#8B5CF6]/30 text-[#8B5CF6]">
              {quiz.length} soal
            </Badge>
          )}
          {isActive ? (
            <ChevronDown className="h-4 w-4 text-zinc-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-500" />
          )}
        </div>
      </div>

      {isActive && (
        <div className="border-t border-white/[0.06] p-4 space-y-3">
          {/* Chapter content */}
          <div>
            <p className="text-[11px] text-zinc-500 uppercase mb-1">Isi Bab</p>
            <p className="text-sm text-zinc-300 leading-relaxed">{chapter.content}</p>
          </div>

          {/* Quiz */}
          {quiz.length > 0 && (
            <div className="space-y-3 pt-2">
              <p className="text-[11px] text-zinc-500 uppercase">Kuis</p>
              {quiz.map((q) => {
                const key = `${chapter.id}-${q.id}`;
                const userAnswer = answers[key];
                const isCorrect = userAnswer === q.correctAnswer;
                const answered = !!userAnswer;

                return (
                  <div key={q.id} className="rounded-md bg-white/[0.02] p-3">
                    <p className="text-sm text-zinc-200 mb-2">{q.question}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {q.options?.map((opt) => {
                        const isSelected = userAnswer === opt;
                        const showCorrect = answered && opt === q.correctAnswer;
                        const showWrong = isSelected && !isCorrect;

                        return (
                          <button
                            key={opt}
                            disabled={answered}
                            onClick={() => onAnswer(key, opt)}
                            className={`text-left px-3 py-2 rounded-md text-xs transition-colors border ${
                              showCorrect
                                ? 'border-green-500/50 bg-green-500/10 text-green-400'
                                : showWrong
                                ? 'border-red-500/50 bg-red-500/10 text-red-400'
                                : isSelected
                                ? 'border-[#8B5CF6]/50 bg-[#8B5CF6]/10 text-[#8B5CF6]'
                                : 'border-white/[0.06] text-zinc-400 hover:border-white/[0.15] hover:bg-white/[0.04]'
                            }`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                    {answered && (
                      <p className={`text-[11px] mt-2 ${isCorrect ? 'text-green-400' : 'text-red-400'}`}>
                        {isCorrect ? '✓ Benar!' : `✗ Jawaban: ${q.correctAnswer}`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
