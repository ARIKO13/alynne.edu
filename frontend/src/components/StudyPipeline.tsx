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
  MessageCircle,
  Send,
  Bot,
  User,
  Swords,
  Presentation,
  Volume2,
  VolumeX,
  Pause,
  Play as PlayIcon,
  Maximize2,
  Minimize2,
  CheckCircle2 as CheckIcon,
  GraduationCap,
  Mic,
} from 'lucide-react';
import {
  splitTranscriptIntoChapters,
  generateQuizFromChapter,
  type Chapter,
  type QuizQuestion,
} from '@/lib/stt-chapter-splitter';
import { SlideExporter } from '@/components/SlideExporter';
import { QuizBattle } from '@/components/QuizBattle';
import { MindmapGraph } from '@/components/MindmapGraph';
import { generateMicroPDF, generateMasterPDF } from '@/lib/pdf-export';
import { recordQuizResult, updateStreak } from '@/lib/ai-memory';
import { AmbientThemes } from '@/components/AmbientThemes';
import { LofiBackground } from '@/components/LofiBackground';
import { cn } from '@/lib/utils';
import { speak, stop as ttsStop, isSpeaking, pause as ttsPause, resume as ttsResume } from '@/lib/text-to-speech';
import { VoiceTutor } from '@/components/VoiceTutor';
import { StudyBuddy } from '@/components/StudyBuddy';
import { ExamSimulator } from '@/components/ExamSimulator';
import { detectFace, isFaceMeshAvailable, resetFaceMesh } from '@/lib/face-mesh';
import { computeHeadPose, type HeadPose } from '@/lib/head-pose';

interface StudyPipelineProps {
  open: boolean;
  onClose: () => void;
  transcript: string;
}

type PipelineStage = 'idle' | 'splitting' | 'mindmap' | 'chapters' | 'complete';
type MainTab = 'materi' | 'kuis' | 'mindmap' | 'tanya' | 'voice' | 'buddy' | 'session';

export function StudyPipeline({ open, onClose, transcript }: StudyPipelineProps) {
  const [stage, setStage] = useState<PipelineStage>('idle');
  const [progress, setProgress] = useState(0);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<number | null>(null);
  const [quizzes, setQuizzes] = useState<Record<number, QuizQuestion[]>>({});
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['root']));
  const [mainTab, setMainTab] = useState<MainTab>('materi');
  const [llmMindmap, setLLMMindmap] = useState<LLMMindmapNode | null>(null);
  const [quizBattleOpen, setQuizBattleOpen] = useState(false);
  const [slideExporterOpen, setSlideExporterOpen] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsPaused, setTtsPaused] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [readChapters, setReadChapters] = useState<Set<number>>(new Set());
  const [quickNote, setQuickNote] = useState('');
  const [examOpen, setExamOpen] = useState(false);

  // ── Pomodoro + Focus state (inline, not separate component) ──
  const [timerTotal, setTimerTotal] = useState(25 * 60);
  const [timerLeft, setTimerLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [focusEnabled, setFocusEnabled] = useState(true);
  const [focusScore, setFocusScore] = useState(0);  // v2: start at 0, not 100
  const [distracted, setDistracted] = useState(false);
  const [distractedCount, setDistractedCount] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const [faceMeshLoading, setFaceMeshLoading] = useState(false);
  const [posture, setPosture] = useState<'attentive' | 'nunduk' | 'away' | 'ngantuk'>('away');
  const [usingFaceMesh, setUsingFaceMesh] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animRef = useRef<number>(0);
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null);
  const stoppedRef = useRef(false);
  const isRunningRef = useRef(false);  // v6: ref untuk avoid stale closure
  const focusEnabledRef = useRef(true);  // v6: same
  const showWarningRef = useRef(false);  // v6: same
  const distractedStartRef = useRef<number>(0);

  // Sync refs with state
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);
  useEffect(() => { focusEnabledRef.current = focusEnabled; }, [focusEnabled]);
  useEffect(() => { showWarningRef.current = showWarning; }, [showWarning]);

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
    await sleep(300);
    const split = splitTranscriptIntoChapters(transcript);
    setChapters(split);
    setProgress(25);

    // Generate LLM-powered structured mindmap
    setStage('mindmap');
    try {
      const mindmapData = await generateLLMMindmap(split);
      setLLMMindmap(mindmapData);
    } catch (err) {
      console.warn('[Mindmap] LLM failed, using fallback:', err);
    }
    setProgress(50);

    // Generate LLM-powered quizzes (sequential with delay to avoid rate limit)
    setStage('chapters');
    const quizMap: Record<number, QuizQuestion[]> = {};
    for (let i = 0; i < split.length; i++) {
      const ch = split[i];
      try {
        quizMap[ch.id] = await generateLLMQuiz(ch);
      } catch {
        quizMap[ch.id] = generateQuizFromChapter(ch, 3);
      }
      setProgress(50 + Math.round((i + 1) / split.length * 40));
      // Delay between requests to avoid Groq rate limit
      if (i < split.length - 1) await sleep(1000);
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
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: 'user',
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // v3: Explicitly start playing. autoPlay attribute might not
        // work immediately after srcObject is set — video.videoWidth
        // stays 0 until play() resolves → detection fails.
        await videoRef.current.play().catch(() => {});
      }
      detectFocus();
    } catch (err) {
      console.warn('[Focus] Camera not available:', err);
      setFocusEnabled(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    stoppedRef.current = true;  // v2: signal check loop to stop
    cancelAnimationFrame(animRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
    setFocusScore(0);
  }, []);

  const detectFocus = useCallback(() => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;

    stoppedRef.current = false;  // v2: reset for this session

    // Canvas for motion detection (lower-res = faster, used for frame diff)
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Old-method FaceDetector API (used as fallback if Face Mesh unavailable)
    const hasFaceAPI = typeof (window as any).FaceDetector === 'function';
    let legacyFaceDetector: any = null;
    if (hasFaceAPI) {
      try {
        legacyFaceDetector = new (window as any).FaceDetector({
          fastMode: true,
          maxDetectedFaces: 1,
        });
      } catch {}
    }

    // Trigger async load of Face Mesh (lazy)
    setFaceMeshLoading(true);
    isFaceMeshAvailable().then((available) => {
      setUsingFaceMesh(available);
      setFaceMeshLoading(false);
    });

    // Closure state for throttling + smoothing
    let lastLegacyFaceCheck = 0;
    let legacyFacePresent = false;
    let legacyFaceAttentive = false;
    let wasAttentive = false;  // v8: hysteresis state
    const aspectRatioHistory: number[] = [];  // v8: smoothing
    let lastScoreUpdate = 0;
    const scoreHistory: number[] = [];
    let eyesClosedSince = 0;

    const check = async () => {
      // v6: Use refs instead of stale closure values.
      // isRunningRef.current is always current (synced via useEffect).
      // OLD code used isRunning from closure — was always false because
      // startCamera captured detectFocus when isRunning was false.
      if (stoppedRef.current || !isRunningRef.current || !focusEnabledRef.current) {
        return;
      }
      // v4: Wait for video to have ACTUAL FRAME DATA (not just metadata).
      // videoWidth is set at readyState 1 (HAVE_METADATA), but frame pixels
      // aren't available until readyState >= 2 (HAVE_CURRENT_DATA).
      // estimateFaces on readyState < 2 → blank frame → 0 faces → score 0%.
      if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
        animRef.current = requestAnimationFrame(check);
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, 160, 120);
        const frame = ctx.getImageData(0, 0, 160, 120).data;

        // ── Motion detection (always computed — used in both paths) ──
        let diff = 0;
        let count = 0;
        if (prevFrameRef.current) {
          for (let i = 0; i < frame.length; i += 16) {
            diff += Math.abs(frame[i] - prevFrameRef.current[i]);
            count++;
          }
          diff = diff / count;
        }
        prevFrameRef.current = new Uint8ClampedArray(frame);

        const now = Date.now();

        // ── Brightness check (camera covered = all black) ──
        let brightnessSum = 0;
        let brightnessCount = 0;
        for (let i = 0; i < frame.length; i += 16) {
          brightnessSum += (frame[i] + frame[i + 1] + frame[i + 2]) / 3;
          brightnessCount++;
        }
        const avgBrightness = brightnessSum / brightnessCount;
        const cameraCovered = avgBrightness < 15;

        let baseScore = 0;
        let currentPosture: 'attentive' | 'nunduk' | 'away' | 'ngantuk' = 'away';

        if (cameraCovered) {
          // Camera covered / very dark → no face → 0%
          baseScore = 0;
          currentPosture = 'away';
        } else {
          // ── Face detection (throttled to ~1/sec) ──
          if (now - lastLegacyFaceCheck > 500) {  // v8: 500ms (was 1000ms)
            lastLegacyFaceCheck = now;
            if (legacyFaceDetector) {
              try {
                const faces = await legacyFaceDetector.detect(video);
                console.log('[Focus] FaceDetector faces:', faces.length,
                  faces.length > 0 ? 'box:' + JSON.stringify(faces[0].boundingBox) : '');
                if (faces.length > 0) {
                  // v10: REMOVE aspect ratio check entirely.
                  // 9 iterations of threshold tuning couldn't fix false
                  // 'nunduk' across different face shapes + camera angles.
                  // New approach: face detected = at desk = attentive. Simple.
                  legacyFacePresent = true;
                  legacyFaceAttentive = true;
                  console.log('[Focus] Face detected → attentive');
                } else {
                  legacyFacePresent = false;
                  legacyFaceAttentive = false;
                }
              } catch (e) {
                console.warn('[Focus] FaceDetector error:', e);
                legacyFacePresent = false;
                legacyFaceAttentive = false;
              }
            } else {
              // Skin tone fallback (Firefox/Safari)
              const topSkin = (() => {
                let s = 0, t = 0;
                for (let y = 5; y < 40; y += 2) {
                  for (let x = 50; x < 110; x += 2) {
                    const idx = (y * 160 + x) * 4;
                    const r = frame[idx], g = frame[idx + 1], b = frame[idx + 2];
                    t++;
                    if (r > 80 && g > 40 && b > 20 && r > g && r > b && (r - g) > 15 && r < 250) s++;
                  }
                }
                return t > 0 ? s / t : 0;
              })();
              const bottomSkin = (() => {
                let s = 0, t = 0;
                for (let y = 80; y < 115; y += 2) {
                  for (let x = 50; x < 110; x += 2) {
                    const idx = (y * 160 + x) * 4;
                    const r = frame[idx], g = frame[idx + 1], b = frame[idx + 2];
                    t++;
                    if (r > 80 && g > 40 && b > 20 && r > g && r > b && (r - g) > 15 && r < 250) s++;
                  }
                }
                return t > 0 ? s / t : 0;
              })();
              const totalSkin = topSkin + bottomSkin;
              console.log('[Focus] skin tone: top:', topSkin.toFixed(3), 'bottom:', bottomSkin.toFixed(3));
              if (totalSkin < 0.03) {
                legacyFacePresent = false;
                legacyFaceAttentive = false;
              } else {
                // v10: Same as FaceDetector path — face detected = attentive
                legacyFacePresent = true;
                legacyFaceAttentive = true;
              }
            }
          }

          if (legacyFacePresent && legacyFaceAttentive) {
            baseScore = 60;
            currentPosture = 'attentive';
          } else if (legacyFacePresent) {
            baseScore = 25;
            currentPosture = 'nunduk';
          } else if (avgBrightness > 15 && diff > 0.5) {
            // No face detected BUT camera is on + there's motion
            // → probably at desk, FaceDetector just failed. Give moderate score.
            baseScore = 35;
            currentPosture = 'attentive';
          } else if (avgBrightness > 15) {
            // Camera on but no motion — passive (reading?)
            baseScore = 20;
            currentPosture = 'attentive';
          } else {
            baseScore = 0;
            currentPosture = 'away';
          }
        }

        // Motion bonus
        let motionBonus = 10;
        if (diff > 1 && diff < 15) {
          motionBonus = 25;
        } else if (diff > 30) {
          motionBonus = 0;
        }

        const score = Math.min(100, baseScore + motionBonus);
        scoreHistory.push(score);
        if (scoreHistory.length > 8) scoreHistory.shift();
        const avgScore = Math.round(
          scoreHistory.reduce((a, b) => a + b, 0) / scoreHistory.length
        );

        // Throttle UI updates to ~4/sec
        if (now - lastScoreUpdate > 250) {
          lastScoreUpdate = now;
          setFocusScore(avgScore);
          setPosture(currentPosture);

          if (avgScore < 50) {
            if (distractedStartRef.current === 0) {
              distractedStartRef.current = Date.now();
            }
            const elapsed = (Date.now() - distractedStartRef.current) / 1000;
            if (elapsed > 5 && !showWarningRef.current) {
              setShowWarning(true);
              setDistractedCount((c) => c + 1);
            }
          } else {
            distractedStartRef.current = 0;
            setShowWarning(false);
          }
        }
      } catch {}
      animRef.current = requestAnimationFrame(check);
    };
    check();
  }, []);  // v6: no deps — uses refs, not stale closure values

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

  // TTS toggle
  const handleToggleTTS = () => {
    if (!activeChapter) return;
    if (ttsPlaying && !ttsPaused) {
      ttsPause();
      setTtsPaused(true);
    } else if (ttsPlaying && ttsPaused) {
      ttsResume();
      setTtsPaused(false);
    } else {
      speak(activeChapter.content, {
        rate: 1.0,
        onEnd: () => {
          setTtsPlaying(false);
          setTtsPaused(false);
        },
      });
      setTtsPlaying(true);
      setTtsPaused(false);
    }
  };

  const handleStopTTS = () => {
    ttsStop();
    setTtsPlaying(false);
    setTtsPaused(false);
  };

  // Mark chapter as read when selected
  const handleSelectChapter = (id: number) => {
    setActiveChapterId(id);
    setMainTab('materi');
    setReadChapters((prev) => new Set(prev).add(id));
  };

  // Focus mode toggle
  const handleToggleFocus = () => {
    setFocusMode(!focusMode);
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
    <div className="fixed inset-0 z-50 bg-zinc-950 flex h-screen">
      {/* Lo-Fi Background (only in session mode) */}
      {mainTab === 'session' && isRunning && (
        <div className="absolute inset-0 pointer-events-none">
          <LofiBackground theme="sunset" intensity={0.3} />
        </div>
      )}

      {/* ── LEFT SIDEBAR ── */}
      <div className="w-80 h-full border-r border-white/[0.06] bg-zinc-950/95 flex flex-col z-10 min-h-0">
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



        {/* Chapter list with progress */}
        {stage === 'complete' && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
            {/* Progress bar */}
            <div className="px-2 py-1 mb-1">
              <div className="flex items-center justify-between text-[9px] text-zinc-600 mb-0.5">
                <span>Progress Baca</span>
                <span>{readChapters.size}/{chapters.length}</span>
              </div>
              <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${chapters.length > 0 ? (readChapters.size / chapters.length) * 100 : 0}%` }}
                />
              </div>
            </div>
            {chapters.map((ch) => (
              <button
                key={ch.id}
                onClick={() => handleSelectChapter(ch.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors text-left',
                  activeChapterId === ch.id
                    ? 'bg-[#8B5CF6]/10 text-[#8B5CF6]'
                    : 'text-zinc-400 hover:bg-white/[0.04]'
                )}
              >
                <span className={cn(
                  'w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0',
                  readChapters.has(ch.id) ? 'bg-green-500/20 text-green-400' : 'bg-white/[0.04]'
                )}>
                  {readChapters.has(ch.id) ? <CheckIcon className="h-2.5 w-2.5" /> : ch.id}
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
            <div className="grid grid-cols-2 gap-1">
              <Button
                onClick={handleDownloadMaster}
                variant="outline"
                size="sm"
                className="text-[10px] border-white/[0.08]"
              >
                <Download className="h-3 w-3 mr-1" />
                PDF
              </Button>
              <Button
                onClick={() => setSlideExporterOpen(true)}
                variant="outline"
                size="sm"
                className="text-[10px] border-amber-500/20 text-amber-400 hover:bg-amber-500/10"
              >
                <Presentation className="h-3 w-3 mr-1" />
                Slide
              </Button>
            </div>
            <Button
              onClick={() => {
                const allQuiz = Object.values(quizzes).flat();
                if (allQuiz.length > 0) setQuizBattleOpen(true);
              }}
              variant="outline"
              size="sm"
              className="w-full text-[10px] border-orange-500/20 text-orange-400 hover:bg-orange-500/10"
              disabled={Object.values(quizzes).flat().length === 0}
            >
              <Swords className="h-3 w-3 mr-1" />
              Quiz Battle ({Object.values(quizzes).flat().length} soal)
            </Button>
            <Button
              onClick={() => setExamOpen(true)}
              variant="outline"
              size="sm"
              className="w-full text-[10px] border-red-500/20 text-red-400 hover:bg-red-500/10"
            >
              <GraduationCap className="h-3 w-3 mr-1" />
              Exam Simulator
            </Button>
          </div>
        )}

        {/* Slide Exporter */}
        <SlideExporter
          open={slideExporterOpen}
          onClose={() => setSlideExporterOpen(false)}
          chapters={chapters}
          quizzes={quizzes}
        />

        {/* Quiz Battle */}
        <QuizBattle
          open={quizBattleOpen}
          onClose={() => setQuizBattleOpen(false)}
          questions={Object.values(quizzes).flat()}
          title={`Quiz Battle - ${chapters.length} Bab`}
        />

        {/* Exam Simulator */}
        <ExamSimulator
          open={examOpen}
          onClose={() => setExamOpen(false)}
          chapters={chapters}
        />
      </div>

      {/* ── MAIN AREA ── */}
      <div className="flex-1 overflow-y-auto relative z-10 h-full min-h-0">
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
              Materi
            </button>
            <button
              onClick={() => setMainTab('kuis')}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                mainTab === 'kuis' ? 'bg-[#8B5CF6] text-white' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <Calculator className="h-3 w-3 inline mr-1" />
              Kuis
            </button>
            <button
              onClick={() => setMainTab('mindmap')}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                mainTab === 'mindmap' ? 'bg-[#8B5CF6] text-white' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <Brain className="h-3 w-3 inline mr-1" />
              Mindmap
            </button>
            <button
              onClick={() => setMainTab('tanya')}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                mainTab === 'tanya' ? 'bg-[#8B5CF6] text-white' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <MessageCircle className="h-3 w-3 inline mr-1" />
              Tanya AI
            </button>
            <button
              onClick={() => setMainTab('voice')}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                mainTab === 'voice' ? 'bg-green-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <Mic className="h-3 w-3 inline mr-1" />
              Voice Tutor
            </button>
            <button
              onClick={() => setMainTab('buddy')}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                mainTab === 'buddy' ? 'bg-orange-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <Sparkles className="h-3 w-3 inline mr-1" />
              Study Buddy
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

        {/* MINDMAP TAB: visual SVG graph */}
        {mainTab === 'mindmap' && stage === 'complete' && (
          <div className="p-6">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
              <h2 className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
                <Brain className="h-4 w-4 text-[#8B5CF6]" />
                Mindmap
              </h2>
              {llmMindmap ? (
                <LLMMindmapView node={llmMindmap} />
              ) : (
                <MindmapGraph
                  chapters={chapters}
                  activeChapterId={activeChapterId}
                  onSelectChapter={(id) => {
                    setActiveChapterId(id);
                    setMainTab('materi');
                  }}
                />
              )}
              <p className="text-[11px] text-zinc-500 mt-4 text-center">
                {llmMindmap ? 'Mindmap dibuat oleh AI (terstruktur)' : 'Klik node bab untuk lihat isi materinya'}
              </p>
            </div>
          </div>
        )}

        {/* MATERI TAB: chapter content only */}
        {mainTab === 'materi' && stage === 'complete' && activeChapter && (
          <div className="p-6 max-w-3xl mx-auto space-y-4">
            {/* Chapter title */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#8B5CF6]/10 flex items-center justify-center text-base font-bold text-[#8B5CF6]">
                {activeChapter.id}
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-white">{activeChapter.title}</h2>
                <p className="text-[10px] text-zinc-500">{activeChapter.wordCount} kata</p>
              </div>
              <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30">
                <BookOpen className="h-3 w-3 mr-1" />
                Materi
              </Badge>
            </div>

            {/* Content */}
            <div className="rounded-lg border border-blue-500/10 bg-blue-500/[0.02] p-5">
              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{activeChapter.content}</p>
            </div>

            {/* Actions: TTS + Focus + PDF */}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleToggleTTS}
                size="sm"
                className={cn(
                  ttsPlaying && !ttsPaused ? 'bg-green-600 hover:bg-green-700' : 'bg-[#8B5CF6] hover:bg-[#7C3AED]'
                )}
              >
                {ttsPlaying && !ttsPaused ? (
                  <>
                    <Pause className="h-3 w-3 mr-1" />
                    Pause Baca
                  </>
                ) : ttsPaused ? (
                  <>
                    <PlayIcon className="h-3 w-3 mr-1" />
                    Lanjut Baca
                  </>
                ) : (
                  <>
                    <Volume2 className="h-3 w-3 mr-1" />
                    Bacakan
                  </>
                )}
              </Button>
              {ttsPlaying && (
                <Button
                  onClick={handleStopTTS}
                  variant="outline"
                  size="sm"
                  className="border-red-500/20 text-red-400"
                >
                  <VolumeX className="h-3 w-3 mr-1" />
                  Stop
                </Button>
              )}
              <Button
                onClick={handleToggleFocus}
                variant="outline"
                size="sm"
                className="border-amber-500/20 text-amber-400 hover:bg-amber-500/10"
              >
                {focusMode ? <Minimize2 className="h-3 w-3 mr-1" /> : <Maximize2 className="h-3 w-3 mr-1" />}
                {focusMode ? 'Exit Focus' : 'Focus Mode'}
              </Button>
              <Button
                onClick={() => handleDownloadMicro(activeChapter)}
                variant="outline"
                size="sm"
                className="border-blue-500/20 text-blue-400 hover:bg-blue-500/10"
              >
                <Download className="h-3 w-3 mr-1" />
                PDF
              </Button>
            </div>

            {/* Quick Note (floating textarea) */}
            {focusMode && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-3">
                <p className="text-[10px] text-amber-400 uppercase mb-2">Quick Note</p>
                <textarea
                  value={quickNote}
                  onChange={(e) => setQuickNote(e.target.value)}
                  placeholder="Catat sesuatu sambil baca..."
                  className="w-full h-20 px-3 py-2 rounded bg-white/[0.04] border border-white/[0.08] text-xs text-zinc-300 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-amber-500/50"
                />
              </div>
            )}
          </div>
        )}

        {/* KUIS TAB: quiz only */}
        {mainTab === 'kuis' && stage === 'complete' && activeChapter && (
          <div className="p-6 max-w-3xl mx-auto space-y-4">
            {/* Quiz header */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Calculator className="h-5 w-5 text-amber-400" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-white">Kuis Bab {activeChapter.id}</h2>
                <p className="text-[10px] text-zinc-500">
                  {quizzes[activeChapter.id]?.length || 0} soal
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
                <Calculator className="h-3 w-3 mr-1" />
                Kuis
              </Badge>
            </div>

            {/* Quiz questions */}
            {quizzes[activeChapter.id]?.length > 0 ? (
              <div className="space-y-3">
                {quizzes[activeChapter.id].map((q, i) => {
                  const key = `${activeChapter.id}-${q.id}`;
                  const userAnswer = quizAnswers[key];
                  const isCorrect = userAnswer === q.correctAnswer;
                  const answered = !!userAnswer;

                  return (
                    <div key={q.id} className="rounded-lg border border-amber-500/10 bg-amber-500/[0.02] p-4">
                      <p className="text-sm text-zinc-200 mb-3">
                        <span className="text-amber-400 font-bold mr-1">{i + 1}.</span>
                        {q.question}
                      </p>
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
                                  : 'border-white/[0.06] text-zinc-400 hover:border-white/[0.15] hover:bg-white/[0.04]'
                              )}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                      {answered && (
                        <p className={cn('text-[11px] mt-2 font-medium', isCorrect ? 'text-green-400' : 'text-red-400')}>
                          {isCorrect ? '✓ Benar!' : `✗ Jawaban yang benar: ${q.correctAnswer}`}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <Calculator className="h-8 w-8 mx-auto mb-2 text-zinc-700" />
                <p className="text-sm text-zinc-500">Belum ada kuis untuk bab ini</p>
              </div>
            )}
          </div>
        )}

        {/* TANYA AI TAB: chat with AI about current chapter */}
        {mainTab === 'tanya' && stage === 'complete' && activeChapter && (
          <TanyaAI
            chapter={activeChapter}
            transcript={transcript}
            allChapters={chapters}
            quizzes={quizzes}
          />
        )}

        {/* VOICE TUTOR TAB */}
        {mainTab === 'voice' && stage === 'complete' && activeChapter && (
          <VoiceTutor chapter={activeChapter} transcript={transcript} />
        )}

        {/* STUDY BUDDY TAB */}
        {mainTab === 'buddy' && stage === 'complete' && activeChapter && (
          <StudyBuddy chapter={activeChapter} transcript={transcript} />
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
                  {/* Camera preview — mirrored selfie view, no opacity dimming */}
                  {faceMeshLoading && (
                    <div className="text-center text-[10px] text-zinc-500 py-2">
                      Loading focus model... (~3s first time)
                    </div>
                  )}
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-32 h-24 rounded-lg mx-auto object-cover"
                    style={{
                      display: isRunning ? 'block' : 'none',
                      transform: 'scaleX(-1)', // mirror like selfie
                    }}
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
                    {/* Posture indicator — shows what the model detected */}
                    <div className="flex items-center justify-between mt-1.5 text-[10px]">
                      <span className="text-zinc-600">Postur:</span>
                      <span className={cn(
                        'font-medium',
                        posture === 'attentive' ? 'text-green-400'
                          : posture === 'nunduk' ? 'text-amber-400'
                          : posture === 'ngantuk' ? 'text-red-400'
                          : 'text-zinc-500'
                      )}>
                        {posture === 'attentive' ? 'Fokus ✓'
                          : posture === 'nunduk' ? 'Nunduk ↓'
                          : posture === 'ngantuk' ? 'Ngantuk 😴'
                          : 'Pergi'}
                      </span>
                    </div>
                    {/* Engine indicator — shows if using MediaPipe or fallback */}
                    <div className="flex items-center justify-between mt-0.5 text-[9px] text-zinc-600">
                      <span>Engine:</span>
                      <span>
                        {faceMeshLoading ? 'Loading...'
                          : usingFaceMesh ? 'MediaPipe Face Mesh ✓'
                          : 'Legacy (fallback)'}
                      </span>
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

// ── LLM Types ──

interface LLMMindmapNode {
  label: string;
  children?: LLMMindmapNode[];
}

// ── LLM Mindmap Generator ──

async function generateLLMMindmap(chapters: Chapter[]): Promise<LLMMindmapNode> {
  const chaptersText = chapters
    .map((ch) => `BAB ${ch.id}: ${ch.title}\n${ch.content.substring(0, 200)}`)
    .join('\n');

  const prompt = `Buat mindmap terstruktur dari materi berikut. Format WAJIB JSON saja.

MATERI:
${chaptersText}

Output JSON (tanpa markdown):
{"label":"Judul","children":[{"label":"Bab 1","children":[{"label":"Poin 1"},{"label":"Poin 2"}]}]}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          model: 'qwen/qwen3.8-27b',
          max_tokens: 1500,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Handle both Groq format (choices[0].message.content) and custom format (content)
      let content = '';
      if (data.choices?.[0]?.message?.content) {
        content = data.choices[0].message.content;
      } else if (data.content) {
        content = data.content;
      } else if (data.error) {
        throw new Error(data.error);
      } else {
        throw new Error('No content in response');
      }
      if (!content) throw new Error('Empty response');

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON');
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      if (attempt === 1) throw err;
      await sleep(2000);
    }
  }
  throw new Error('Failed after retries');
}

// ── LLM Quiz Generator ──

async function generateLLMQuiz(chapter: Chapter): Promise<QuizQuestion[]> {
  const prompt = `Buat 3 soal kuis pilihan ganda dari materi berikut. Format JSON array saja.

BAB ${chapter.id}: ${chapter.title}
${chapter.content.substring(0, 800)}

JSON (tanpa markdown):
[{"id":1,"type":"multiple-choice","question":"Soal?","options":["A","B","C","D"],"correctAnswer":"A","explanation":"Karena..."}]`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          model: 'qwen/qwen3.8-27b',
          max_tokens: 1000,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      let content = '';
      if (data.choices?.[0]?.message?.content) {
        content = data.choices[0].message.content;
      } else if (data.content) {
        content = data.content;
      } else if (data.error) {
        throw new Error(data.error);
      } else {
        throw new Error('No content in response');
      }
      if (!content) throw new Error('Empty response');

      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON');
      const quizzes = JSON.parse(jsonMatch[0]) as QuizQuestion[];
      return quizzes.map((q, i) => ({ ...q, id: i + 1 }));
    } catch (err) {
      if (attempt === 1) throw err;
      await sleep(2000);
    }
  }
  throw new Error('Failed after retries');
}

// ── TanyaAI: Chat dengan AI tentang bab yang sedang dibaca ──

interface TanyaAIProps {
  chapter: Chapter;
  transcript: string;
  allChapters: Chapter[];
  quizzes: Record<number, QuizQuestion[]>;
}

function TanyaAI({ chapter, transcript, allChapters, quizzes }: TanyaAIProps) {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    {
      role: 'assistant',
      content: `Halo! Saya AI Assistant. Kamu lagi baca Bab ${chapter.id}: "${chapter.title}".\n\nTanya apa saja tentang materi ini, saya bantu jawab!`,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg = { role: 'user' as const, content: input.trim() };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Build full context: all chapters + quizzes + current bab highlight
      const allChaptersText = allChapters
        .map((ch) => `BAB ${ch.id}: ${ch.title}\n${ch.content}`)
        .join('\n\n---\n\n');

      const allQuizText = Object.entries(quizzes)
        .map(([chId, qs]) => {
          const quizStr = qs.map((q, i) => `${i + 1}. ${q.question} (Jawaban: ${q.correctAnswer})`).join('\n');
          return `KUIS BAB ${chId}:\n${quizStr}`;
        })
        .join('\n\n');

      const systemPrompt = `Kamu adalah asisten AI ALYNNE.EDU. User sedang belajar dari materi STT. User saat ini membaca Bab ${chapter.id}. Jawab pertanyaan user berdasarkan konteks materi di bawah. Jelaskan dengan bahasa Indonesia yang jelas dan mudah dipahami.

MATERI BAB ${chapter.id} (SEDANG DIBACA):
${chapter.title}
${chapter.content}

SEMUA BAB (${allChapters.length} total):
${allChaptersText.substring(0, 3000)}

KUIS:
${allQuizText.substring(0, 1000)}

TRANSCRIPT ASLI:
${transcript.substring(0, 2000)}

PETUNJUK:
- Jawab berdasarkan materi di atas
- Kalau user tanya tentang bab lain, tetap jawab dari konteks yang ada
- Jelaskan dengan analogi sederhana kalau perlu
- Jawab dengan bahasa Indonesia`;

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg.content },
          ],
          model: 'qwen/qwen3.8-27b',
        }),
      });

      const data = await res.json();
      let reply = '';
      if (data.choices?.[0]?.message?.content) {
        reply = data.choices[0].message.content;
      } else if (data.content) {
        reply = data.content;
      } else if (data.error) {
        reply = 'Maaf: ' + data.error;
      } else {
        reply = 'Maaf, tidak ada respon dari AI.';
      }

      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: 'Maaf, gagal terhubung ke server. Coba lagi.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-[#8B5CF6]/10 flex items-center justify-center">
          <Bot className="h-5 w-5 text-[#8B5CF6]" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-white">Tanya AI</h2>
          <p className="text-[10px] text-zinc-500">
            Tanya apa saja tentang Bab {chapter.id}: {chapter.title.substring(0, 40)}...
          </p>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-3 mb-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 min-h-[300px]"
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn('flex gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-[#8B5CF6]/10 flex items-center justify-center shrink-0">
                <Bot className="h-3 w-3 text-[#8B5CF6]" />
              </div>
            )}
            <div
              className={cn(
                'rounded-lg px-3 py-2 max-w-[80%] text-sm',
                msg.role === 'user'
                  ? 'bg-[#8B5CF6] text-white'
                  : 'bg-white/[0.04] text-zinc-200'
              )}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
            {msg.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-white/[0.04] flex items-center justify-center shrink-0">
                <User className="h-3 w-3 text-zinc-400" />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-[#8B5CF6]/10 flex items-center justify-center shrink-0">
              <Bot className="h-3 w-3 text-[#8B5CF6]" />
            </div>
            <div className="rounded-lg px-3 py-2 bg-white/[0.04] text-zinc-400 text-sm">
              <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
              Mengetik...
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Tanya tentang materi ini..."
          className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-[#8B5CF6]/50"
          disabled={loading}
        />
        <Button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="bg-[#8B5CF6] hover:bg-[#7C3AED]"
          size="sm"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* Quick questions */}
      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {[
            'Jelaskan singkat materi ini',
            'Apa poin utama dari bab ini?',
            'Beri contoh dari materi ini',
            'Buat rangkuman 3 poin',
          ].map((q) => (
            <button
              key={q}
              onClick={() => {
                setInput(q);
              }}
              className="px-2 py-1 rounded text-[10px] border border-white/[0.06] text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── LLMMindmapView: Visual tree dari LLM-generated mindmap ──

function LLMMindmapView({ node }: { node: LLMMindmapNode }) {
  return (
    <div className="space-y-1 font-mono">
      <MindmapTreeNode node={node} level={0} isLast={true} />
    </div>
  );
}

function MindmapTreeNode({
  node,
  level,
  isLast,
  prefix = '',
}: {
  node: LLMMindmapNode;
  level: number;
  isLast: boolean;
  prefix?: string;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const connector = level === 0 ? '' : isLast ? '└─ ' : '├─ ';
  const childPrefix = level === 0 ? '' : prefix + (isLast ? '   ' : '│  ');

  const colors = [
    'text-[#8B5CF6] font-bold text-base',
    'text-blue-400 font-medium text-sm',
    'text-zinc-300 text-sm',
    'text-zinc-500 text-xs',
  ];
  const colorClass = colors[Math.min(level, colors.length - 1)];

  return (
    <div>
      <div className="flex items-start gap-1 hover:bg-white/[0.03] rounded px-1 py-0.5 transition-colors">
        {level > 0 && (
          <span className="text-zinc-700 font-mono text-xs whitespace-pre select-none">
            {prefix}{connector}
          </span>
        )}
        <span className={colorClass}>{node.label}</span>
        {level === 0 && (
          <Badge variant="outline" className="ml-2 text-[8px] border-[#8B5CF6]/30 text-[#8B5CF6]">
            AI Generated
          </Badge>
        )}
      </div>
      {hasChildren && (
        <div>
          {node.children!.map((child, i) => (
            <MindmapTreeNode
              key={i}
              node={child}
              level={level + 1}
              isLast={i === node.children!.length - 1}
              prefix={childPrefix}
            />
          ))}
        </div>
      )}
    </div>
  );
}
