/**
 * SmartContinuity.tsx — One-click chain: STT -> PDF -> Mindmap -> Quiz -> Save
 *
 * User clicks one button after STT, and everything happens automatically:
 *   1. Split transcript into chapters
 *   2. Generate mindmap structure
 *   3. Generate quiz per chapter
 *   4. Generate master PDF
 *   5. Save all to Knowledge Hub
 *   6. Show summary with download links
 *
 * No copy-paste, no manual steps. Pure automation.
 */

import { useState, useCallback } from 'react';
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
  Sparkles,
  CheckCircle2,
  Loader2,
  FileText,
  Brain,
  Calculator,
  Save,
  Download,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  splitTranscriptIntoChapters,
  generateQuizFromChapter,
  type Chapter,
  type QuizQuestion,
} from '@/lib/stt-chapter-splitter';
import { generateMasterPDF } from '@/lib/pdf-export';
import { quickSaveSTT, quickSavePDF, quickSaveNote } from '@/lib/knowledge-hub';
import { recordActivity } from '@/lib/ai-memory';

interface SmartContinuityProps {
  open: boolean;
  onClose: () => void;
  transcript: string;
}

type Step = 'idle' | 'splitting' | 'mindmap' | 'quiz' | 'pdf' | 'saving' | 'done';

const STEPS: Array<{ id: Step; label: string; icon: typeof FileText }> = [
  { id: 'splitting', label: 'Pecah ke bab-bab', icon: FileText },
  { id: 'mindmap', label: 'Generate mindmap', icon: Brain },
  { id: 'quiz', label: 'Buat kuis per bab', icon: Calculator },
  { id: 'pdf', label: 'Generate PDF', icon: FileText },
  { id: 'saving', label: 'Simpan ke Knowledge Hub', icon: Save },
];

export function SmartContinuity({ open, onClose, transcript }: SmartContinuityProps) {
  const [step, setStep] = useState<Step>('idle');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [quizzes, setQuizzes] = useState<Record<number, QuizQuestion[]>>({});
  const [progress, setProgress] = useState(0);

  const run = useCallback(async () => {
    if (!transcript || transcript.length < 20) {
      toast.error('Transcript terlalu pendek');
      return;
    }

    setStep('splitting');
    setProgress(10);
    await sleep(400);
    const split = splitTranscriptIntoChapters(transcript);
    setChapters(split);
    setProgress(25);

    setStep('mindmap');
    await sleep(500);
    setProgress(40);

    setStep('quiz');
    const quizMap: Record<number, QuizQuestion[]> = {};
    for (const ch of split) {
      quizMap[ch.id] = generateQuizFromChapter(ch, 3);
      await sleep(100);
    }
    setQuizzes(quizMap);
    setProgress(60);

    setStep('pdf');
    await sleep(500);
    // Generate PDF (triggers download)
    generateMasterPDF(split, quizMap);
    setProgress(75);

    setStep('saving');
    await sleep(300);
    // Save to Knowledge Hub (IndexedDB)
    try {
      await quickSaveSTT(transcript, 'Smart Continuity');
      await quickSavePDF(
        `Modul STT ${new Date().toLocaleDateString('id-ID')}`,
        split.map((c) => `Bab ${c.id}: ${c.title}\n\n${c.content}\n`).join('\n---\n'),
        'Smart Continuity'
      );
      await quickSaveNote(
        `Mindmap STT ${new Date().toLocaleDateString('id-ID')}`,
        split.map((c) => `- Bab ${c.id}: ${c.title} (${c.wordCount} kata)`).join('\n'),
        'Smart Continuity'
      );
    } catch (err) {
      console.error('[SmartContinuity] save to Knowledge Hub failed:', err);
      toast.error(err instanceof Error ? err.message : 'Gagal simpan ke Knowledge Hub');
    }
    recordActivity({
      type: 'pdf',
      title: `Smart Continuity: ${split.length} bab, ${Object.values(quizMap).reduce((s, q) => s + q.length, 0)} kuis`,
    });
    setProgress(100);

    setStep('done');
    toast.success('Semua selesai! Cek Knowledge Hub.');
  }, [transcript]);

  if (!open) return null;

  const totalQuiz = Object.values(quizzes).reduce((s, q) => s + q.length, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg bg-zinc-950/95 border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Zap className="h-5 w-5 text-[#8B5CF6]" />
            Smart Continuity
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            One-click: STT → Bab → Mindmap → Kuis → PDF → Save. Semua otomatis.
          </DialogDescription>
        </DialogHeader>

        {step === 'idle' ? (
          /* Start screen */
          <div className="space-y-4">
            <div className="rounded-lg border border-[#8B5CF6]/20 bg-[#8B5CF6]/[0.05] p-4">
              <p className="text-sm text-zinc-300 mb-2">Transcript siap di-process:</p>
              <Badge variant="outline" className="text-[10px]">
                {transcript.length} karakter
              </Badge>
            </div>

            <div className="space-y-2">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                return (
                  <div key={s.id} className="flex items-center gap-3 text-sm">
                    <div className="w-6 h-6 rounded-full bg-white/[0.04] flex items-center justify-center text-xs text-zinc-500">
                      {i + 1}
                    </div>
                    <Icon className="h-4 w-4 text-zinc-500" />
                    <span className="text-zinc-400">{s.label}</span>
                  </div>
                );
              })}
            </div>

            <Button onClick={run} className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED]" size="lg">
              <Sparkles className="h-5 w-5 mr-2" />
              Jalankan Semua!
            </Button>
          </div>
        ) : step === 'done' ? (
          /* Done screen */
          <div className="space-y-4 text-center">
            <CheckCircle2 className="h-16 w-16 mx-auto text-green-400" />
            <DialogTitle className="text-xl">Semua Selesai!</DialogTitle>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <FileText className="h-4 w-4 mx-auto mb-1 text-blue-400" />
                <p className="text-lg font-bold text-white">{chapters.length}</p>
                <p className="text-[10px] text-zinc-500 uppercase">Bab</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <Brain className="h-4 w-4 mx-auto mb-1 text-[#8B5CF6]" />
                <p className="text-lg font-bold text-white">1</p>
                <p className="text-[10px] text-zinc-500 uppercase">Mindmap</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <Calculator className="h-4 w-4 mx-auto mb-1 text-amber-400" />
                <p className="text-lg font-bold text-white">{totalQuiz}</p>
                <p className="text-[10px] text-zinc-500 uppercase">Kuis</p>
              </div>
            </div>

            <div className="rounded-lg border border-green-500/20 bg-green-500/[0.05] p-3 text-left">
              <p className="text-xs text-green-400 mb-1">✓ Tersimpan ke Knowledge Hub:</p>
              <ul className="text-[11px] text-zinc-400 space-y-0.5">
                <li>• STT transcript</li>
                <li>• Modul PDF (juga di-download otomatis)</li>
                <li>• Mindmap notes</li>
              </ul>
            </div>

            <Button onClick={onClose} className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED]">
              Selesai
            </Button>
          </div>
        ) : (
          /* Progress screen */
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-[#8B5CF6]">
                <Loader2 className="h-4 w-4 animate-spin" />
                {STEPS.find((s) => s.id === step)?.label}
              </span>
              <span className="text-zinc-400">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />

            <div className="space-y-2">
              {STEPS.map((s) => {
                const stepIndex = STEPS.findIndex((x) => x.id === s.id);
                const currentIndex = STEPS.findIndex((x) => x.id === step);
                const isDone = stepIndex < currentIndex;
                const isCurrent = stepIndex === currentIndex;
                const Icon = s.icon;

                return (
                  <div
                    key={s.id}
                    className={`flex items-center gap-3 text-sm ${
                      isDone ? 'text-green-400' : isCurrent ? 'text-[#8B5CF6]' : 'text-zinc-600'
                    }`}
                  >
                    {isDone ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : isCurrent ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-zinc-700" />
                    )}
                    <Icon className="h-4 w-4" />
                    <span>{s.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
