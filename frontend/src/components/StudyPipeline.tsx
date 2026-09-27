/**
 * StudyPipeline.tsx — Mode Belajar dengan sidebar layout
 *
 * Full-screen overlay (bukan dialog popup):
 *   Left sidebar: Mindmap + Chapter list + Start Session button
 *   Main area: Tab switch antara "Materi" (content+quiz) dan "Sesi Belajar" (pomodoro+focus)
 *
 * Flow:
 *   1. User klik "Mode Belajar" setelah STT
 *   2. Auto-split transcript ke chapters (animated)
 *   3. Sidebar: mindmap SVG + list bab
 *   4. Main: klik bab → lihat isi + jawab kuis
 *   5. Klik "Mulai Sesi Belajar" → tab switch ke study session
 *      (Pomodoro + Focus Detector + Ambient + Lo-Fi background)
 *   6. Selesai → download PDF
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  Calculator,
  Sun,
} from 'lucide-react';
import {
  splitTranscriptIntoChapters,
  generateQuizFromChapter,
  type Chapter,
  type QuizQuestion,
} from '@/lib/stt-chapter-splitter';
import { generateMicroPDF, generateMasterPDF } from '@/lib/pdf-export';
import { recordQuizResult, updateStreak } from '@/lib/ai-memory';
import { AmbientThemes } from '@/components/AmbientThemes';
import { LofiBackground } from '@/components/LofiBackground';
import { cn } from '@/lib/utils';

interface StudyPipelineProps {
  open: boolean;
  onClose: () => void;
  transcript: string;
}

type PipelineStage = 'idle' | 'splitting' | 'mindmap' | 'chapters' | 'complete';
type MainTab = 'materi' | 'session';

export function StudyPipeline({ open, onClose, transcript }: StudyPipelineProps) {
  const [stage, setStage] = useState<PipelineStage>('idle');
  const [progress, setProgress] = useState(0);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<number | null>(null);
  const [quizzes, setQuizzes] = useState<Record<number, QuizQuestion[]>>({});
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['root']));
  const [mainTab, setMainTab] = useState<MainTab>('materi');

  // ── Pomodoro + Focus state (inline, not separate component) ──
  const [timerTotal, setTimerTotal] = useState(25 * 60);
  const [timerLeft, setTimerLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [focusEnabled, setFocusEnabled] = useState(true);
  const [focusScore, setFocusScore] = useState(100);
  const [distracted, setDistracted] = useState(false);
  const [distractedCount, setDistractedCount] = useState(0);
  const [showWarning, setShowWarning] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animRef = useRef<number>(0);
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null);
  const distractedStartRef = useRef<number>(0);

  // Auto-start pipeline when opened
  useEffect(() => {
    if (open && transcript && stage === 'idle') {
      runPipeline();
    }
    if (!open) {
      // Cleanup on close
      setIsRunning(false);
      stopCamera();
    }
  }, [open, transcript, stage]);

  const runPipeline = useCallback(async () => {
    setStage('splitting');
    setProgress(10);
    await sleep(400);
    const split = splitTranscriptIntoChapters(transcript);
    setChapters(split);
    setProgress(40);

    setStage('mindmap');
    await sleep(500);
    setProgress(70);

    setStage('chapters');
    const quizMap: Record<number, QuizQuestion[]> = {};
    for (const ch of split) {
      quizMap[ch.id] = generateQuizFromChapter(ch, 3);
      await sleep(80);
    }
    setQuizzes(quizMap);
    setProgress(100);
    setStage('complete');
    if (split.length > 0) setActiveChapterId(split[0].id);
  }, [transcript]);

  // ── Focus Detector (inline) ──
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 240, height: 180, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      detectFocus();
    } catch (err) {
      console.warn('[Focus] Camera not available:', err);
      setFocusEnabled(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
  }, []);

  const detectFocus = useCallback(() => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;

    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const check = () => {
      if (!isRunning || !focusEnabled) {
        animRef.current = requestAnimationFrame(check);
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, 80, 60);
        const frame = ctx.getImageData(0, 0, 80, 60).data;

        // Frame difference (motion detection)
        let diff = 0;
        if (prevFrameRef.current) {
          for (let i = 0; i < frame.length; i += 4) {
            diff += Math.abs(frame[i] - prevFrameRef.current[i]);
          }
          diff = diff / (80 * 60);
        }
        prevFrameRef.current = frame;

        // If too much motion = distracted (moving around)
        // If very little motion for long = might be away
        const motionScore = Math.min(100, 100 - diff * 2);
        const newScore = Math.round(motionScore);
        setFocusScore(newScore);

        if (newScore < 50) {
          if (distractedStartRef.current === 0) {
            distractedStartRef.current = Date.now();
          }
          const elapsed = (Date.now() - distractedStartRef.current) / 1000;
          if (elapsed > 5 && !showWarning) {
            setShowWarning(true);
            setDistractedCount((c) => c + 1);
          }
        } else {
          distractedStartRef.current = 0;
          setShowWarning(false);
        }
      } catch {}
      animRef.current = requestAnimationFrame(check);
    };
    check();
  }, [isRunning, focusEnabled, showWarning]);

  // Timer countdown
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setTimerLeft((prev) => {
        if (prev <= 1) {
          setIsRunning(false);
          updateStreak();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Start camera when session tab + running
  useEffect(() => {
    if (mainTab === 'session' && isRunning && focusEnabled) {
      startCamera();
    }
    return () => {
      if (mainTab !== 'session' || !isRunning) {
        stopCamera();
      }
    };
  }, [mainTab, isRunning, focusEnabled, startCamera, stopCamera]);

  const handleQuizAnswer = (questionKey: string, answer: string) => {
    setQuizAnswers((prev) => ({ ...prev, [questionKey]: answer }));
  };

  const handleStartSession = () => {
    setMainTab('session');
    setIsRunning(true);
    setTimerLeft(timerTotal);
  };

  const handleDownloadMicro = (ch: Chapter) => {
    generateMicroPDF(ch, quizzes[ch.id] || []);
  };

  const handleDownloadMaster = () => {
    generateMasterPDF(chapters, quizzes);
  };

  const activeChapter = chapters.find((c) => c.id === activeChapterId);
  const totalQuestions = Object.values(quizzes).reduce((s, qs) => s + qs.length, 0);
  const answeredQuestions = Object.keys(quizAnswers).length;
  const correctAnswers = Object.entries(quizAnswers).filter(([key, answer]) => {
    const [chId, qId] = key.split('-').map(Number);
    const q = quizzes[chId]?.find((qq) => qq.id === qId);
    return q?.correctAnswer === answer;
  }).length;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex">
      {/* Lo-Fi Background (only in session mode) */}
      {mainTab === 'session' && isRunning && (
        <div className="absolute inset-0 pointer-events-none">
          <LofiBackground theme="sunset" intensity={0.3} />
        </div>
      )}

      {/* ── LEFT SIDEBAR ── */}
      <div className="w-80 border-r border-white/[0.06] bg-zinc-950/95 flex flex-col z-10">
        {/* Header */}
        <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#8B5CF6]" />
            <span className="text-sm font-semibold text-white">Mode Belajar</span>
          </div>
          <Button onClick={onClose} size="sm" variant="ghost" className="h-7 text-zinc-500">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Progress (during pipeline) */}
        {stage !== 'complete' && stage !== 'idle' && (
          <div className="p-3 border-b border-white/[0.04]">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[#8B5CF6] flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {stage === 'splitting' && 'Memecah bab...'}
                {stage === 'mindmap' && 'Mindmap...'}
                {stage === 'chapters' && 'Buat kuis...'}
              </span>
              <span className="text-zinc-500">{progress}%</span>
            </div>
            <Progress value={progress} className="h-1" />
          </div>
        )}

        {/* Stats */}
        {stage === 'complete' && (
          <div className="p-3 border-b border-white/[0.04] grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-base font-bold text-blue-400">{chapters.length}</p>
              <p className="text-[9px] text-zinc-600 uppercase">Bab</p>
            </div>
            <div>
              <p className="text-base font-bold text-[#8B5CF6]">{totalQuestions}</p>
              <p className="text-[9px] text-zinc-600 uppercase">Kuis</p>
            </div>
            <div>
              <p className="text-base font-bold text-green-400">{correctAnswers}/{answeredQuestions}</p>
              <p className="text-[9px] text-zinc-600 uppercase">Benar</p>
            </div>
          </div>
        )}

        {/* Mindmap (compact) */}
        {stage === 'complete' && chapters.length > 0 && (
          <div className="p-3 border-b border-white/[0.04]">
            <p className="text-[10px] text-zinc-500 uppercase mb-2 flex items-center gap-1">
              <Brain className="h-3 w-3" /> Mindmap
            </p>
            <div className="text-xs space-y-1">
              <div className="text-[#8B5CF6] font-medium">
                📚 {chapters[0]?.title.split(' ').slice(0, 4).join(' ')}...
              </div>
              {chapters.map((ch) => (
                <div
                  key={ch.id}
                  className={cn(
                    'pl-3 cursor-pointer transition-colors',
                    activeChapterId === ch.id ? 'text-[#8B5CF6]' : 'text-zinc-500 hover:text-zinc-300'
                  )}
                  onClick={() => {
                    setActiveChapterId(ch.id);
                    setMainTab('materi');
                  }}
                >
                  ├ Bab {ch.id}: {ch.title.substring(0, 25)}...
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chapter list */}
        {stage === 'complete' && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {chapters.map((ch) => (
              <button
                key={ch.id}
                onClick={() => {
                  setActiveChapterId(ch.id);
                  setMainTab('materi');
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors text-left',
                  activeChapterId === ch.id
                    ? 'bg-[#8B5CF6]/10 text-[#8B5CF6]'
                    : 'text-zinc-400 hover:bg-white/[0.04]'
                )}
              >
                <span className="w-5 h-5 rounded-full bg-white/[0.04] flex items-center justify-center text-[9px] font-bold shrink-0">
                  {ch.id}
                </span>
                <span className="truncate">{ch.title}</span>
              </button>
            ))}
          </div>
        )}

        {/* Actions */}
        {stage === 'complete' && (
          <div className="p-3 border-t border-white/[0.06] space-y-2">
            <Button
              onClick={handleStartSession}
              className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] text-xs"
              size="sm"
            >
              <Play className="h-3 w-3 mr-1" />
              {mainTab === 'session' ? 'Lanjut Sesi' : 'Mulai Sesi Belajar'}
            </Button>
            <div className="flex gap-1">
              <Button
                onClick={handleDownloadMaster}
                variant="outline"
                size="sm"
                className="flex-1 text-[10px] border-white/[0.08]"
              >
                <Download className="h-3 w-3 mr-1" />
                PDF Master
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── MAIN AREA ── */}
      <div className="flex-1 overflow-y-auto relative z-10">
        {/* Tab switcher */}
        {stage === 'complete' && (
          <div className="sticky top-0 z-20 bg-zinc-950/80 backdrop-blur border-b border-white/[0.04] px-6 py-2 flex gap-2">
            <button
              onClick={() => setMainTab('materi')}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                mainTab === 'materi' ? 'bg-[#8B5CF6] text-white' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <BookOpen className="h-3 w-3 inline mr-1" />
              Materi & Kuis
            </button>
            <button
              onClick={() => setMainTab('session')}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                mainTab === 'session' ? 'bg-[#8B5CF6] text-white' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <Clock className="h-3 w-3 inline mr-1" />
              Sesi Belajar
            </button>
          </div>
        )}

        {/* Loading state */}
        {stage !== 'complete' && stage !== 'idle' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#8B5CF6] mx-auto mb-4" />
              <p className="text-sm text-zinc-400">
                {stage === 'splitting' && 'Memecah transkrip jadi bab...'}
                {stage === 'mindmap' && 'Membuat mindmap...'}
                {stage === 'chapters' && 'Membuat kuis per bab...'}
              </p>
            </div>
          </div>
        )}

        {/* MATERI TAB: chapter content + quiz */}
        {mainTab === 'materi' && stage === 'complete' && activeChapter && (
          <div className="p-6 max-w-3xl mx-auto space-y-6">
            {/* Chapter header */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-[#8B5CF6]/10 flex items-center justify-center text-sm font-bold text-[#8B5CF6]">
                  {activeChapter.id}
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {activeChapter.wordCount} kata
                </Badge>
              </div>
              <h2 className="text-xl font-semibold text-white mb-3">{activeChapter.title}</h2>
            </div>

            {/* Content */}
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-sm text-zinc-300 leading-relaxed">{activeChapter.content}</p>
            </div>

            {/* Quiz */}
            {quizzes[activeChapter.id]?.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-amber-400" />
                  <h3 className="text-sm font-medium text-zinc-200">
                    Kuis Bab {activeChapter.id} ({quizzes[activeChapter.id].length} soal)
                  </h3>
                </div>
                {quizzes[activeChapter.id].map((q, i) => {
                  const key = `${activeChapter.id}-${q.id}`;
                  const userAnswer = quizAnswers[key];
                  const isCorrect = userAnswer === q.correctAnswer;
                  const answered = !!userAnswer;

                  return (
                    <div key={q.id} className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
                      <p className="text-sm text-zinc-200 mb-2">{i + 1}. {q.question}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {q.options?.map((opt) => {
                          const isSelected = userAnswer === opt;
                          const showCorrect = answered && opt === q.correctAnswer;
                          const showWrong = isSelected && !isCorrect;
                          return (
                            <button
                              key={opt}
                              disabled={answered}
                              onClick={() => handleQuizAnswer(key, opt)}
                              className={cn(
                                'text-left px-3 py-2 rounded text-xs transition-colors border',
                                showCorrect
                                  ? 'border-green-500/50 bg-green-500/10 text-green-400'
                                  : showWrong
                                  ? 'border-red-500/50 bg-red-500/10 text-red-400'
                                  : isSelected
                                  ? 'border-[#8B5CF6]/50 bg-[#8B5CF6]/10 text-[#8B5CF6]'
                                  : 'border-white/[0.06] text-zinc-400 hover:border-white/[0.15]'
                              )}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                      {answered && (
                        <p className={cn('text-[11px] mt-2', isCorrect ? 'text-green-400' : 'text-red-400')}>
                          {isCorrect ? '✓ Benar!' : `✗ Jawaban: ${q.correctAnswer}`}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Download micro PDF */}
            <Button
              onClick={() => handleDownloadMicro(activeChapter)}
              variant="outline"
              size="sm"
              className="border-white/[0.08] text-zinc-400"
            >
              <Download className="h-3 w-3 mr-1" />
              Download PDF Bab Ini
            </Button>
          </div>
        )}

        {/* SESSION TAB: Pomodoro + Focus + Ambient */}
        {mainTab === 'session' && stage === 'complete' && (
          <div className="p-6 max-w-2xl mx-auto space-y-6">
            {/* Timer */}
            <div className="text-center">
              <div className={cn(
                'inline-flex items-center justify-center w-48 h-48 rounded-full border-4 transition-all',
                isRunning
                  ? 'border-[#8B5CF6] bg-[#8B5CF6]/[0.05]'
                  : 'border-white/[0.06] bg-white/[0.02]'
              )}>
                <div>
                  <p className="text-4xl font-bold text-white font-mono">{formatTime(timerLeft)}</p>
                  <p className="text-[10px] text-zinc-500 mt-1">
                    {isRunning ? 'BELAJAR...' : timerLeft === 0 ? 'SELESAI' : 'SIAP'}
                  </p>
                </div>
              </div>
            </div>

            {/* Timer controls */}
            <div className="flex items-center justify-center gap-2">
              <Button
                onClick={() => {
                  if (!isRunning) {
                    setTimerLeft(timerTotal);
                  }
                  setIsRunning(!isRunning);
                }}
                className="bg-[#8B5CF6] hover:bg-[#7C3AED]"
              >
                {isRunning ? 'Pause' : 'Start'}
              </Button>
              <Button
                onClick={() => {
                  setIsRunning(false);
                  setTimerLeft(25 * 60);
                  setTimerTotal(25 * 60);
                }}
                variant="outline"
                className="border-white/[0.08]"
              >
                Reset
              </Button>
              <select
                value={timerTotal}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setTimerTotal(v);
                  setTimerLeft(v);
                  setIsRunning(false);
                }}
                className="bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1 text-xs text-zinc-300"
              >
                <option value={15 * 60}>15 menit</option>
                <option value={25 * 60}>25 menit</option>
                <option value={45 * 60}>45 menit</option>
                <option value={60 * 60}>60 menit</option>
              </select>
            </div>

            {/* Focus Detector */}
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sun className="h-4 w-4 text-amber-400" />
                  <span className="text-sm font-medium text-zinc-200">Focus Detector</span>
                </div>
                <Button
                  onClick={() => setFocusEnabled(!focusEnabled)}
                  size="sm"
                  variant="ghost"
                  className="text-[10px]"
                >
                  {focusEnabled ? 'ON' : 'OFF'}
                </Button>
              </div>

              {focusEnabled ? (
                <>
                  {/* Hidden video for face detection */}
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-24 h-18 rounded mx-auto opacity-30"
                    style={{ display: isRunning ? 'block' : 'none' }}
                  />

                  {/* Focus score */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-zinc-500">Focus Score</span>
                      <span className={cn(
                        'font-bold',
                        focusScore > 70 ? 'text-green-400' : focusScore > 40 ? 'text-amber-400' : 'text-red-400'
                      )}>
                        {focusScore}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
                      <div
                        className={cn(
                          'h-full transition-all',
                          focusScore > 70 ? 'bg-green-500' : focusScore > 40 ? 'bg-amber-500' : 'bg-red-500'
                        )}
                        style={{ width: `${focusScore}%` }}
                      />
                    </div>
                  </div>

                  <p className="text-[10px] text-zinc-500">
                    Distraksi terdeteksi: {distractedCount}x
                  </p>

                  {/* Warning popup */}
                  {showWarning && (
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-center animate-pulse">
                      <p className="text-sm text-amber-400">⚠️ Yuk fokus lagi!</p>
                      <p className="text-[10px] text-amber-400/60 mt-1">
                        Kamu keliatan ga fokus. Tarik napas, lanjut belajar!
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-zinc-500 text-center py-4">
                  Focus detector dimatikan
                </p>
              )}
            </div>

            {/* Ambient Sounds */}
            <AmbientThemes />

            {/* Session stats */}
            {timerLeft === 0 && (
              <div className="rounded-lg border border-green-500/20 bg-green-500/[0.05] p-4 text-center">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-400" />
                <p className="text-sm font-medium text-green-400">Sesi selesai!</p>
                <p className="text-[11px] text-zinc-400 mt-1">
                  Kamu belajar {Math.round(timerTotal / 60)} menit dengan {distractedCount}x distraksi.
                </p>
                <Button
                  onClick={handleDownloadMaster}
                  className="mt-3 bg-[#8B5CF6] hover:bg-[#7C3AED]"
                  size="sm"
                >
                  <Download className="h-3 w-3 mr-1" />
                  Download Modul PDF
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
