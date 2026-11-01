/**
 * StudyPipeline.tsx  -  Mode Belajar dengan sidebar layout
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
import { VisualisasiPanel } from '@/components/VisualisasiPanel';
import { preSummarize } from '@/lib/pre-summarize';
import { runJSPipeline } from '@/lib/js-pipeline';
import { ExamSimulator } from '@/components/ExamSimulator';
import {
  detectFace,
  isFaceMeshAvailable,
  resetFaceMesh,
  getDetectorSync,
  setRefineLandmarks,
} from '@/lib/face-mesh';
import { computeHeadPose, type HeadPose } from '@/lib/head-pose';
import { useAppStore } from '@/lib/store';
// v19 imports  -  enrichment rendering + visualisasi auto-select
import { buildCallouts, getBabEmoji } from '@/lib/v19/visualisasi-decision-tree';

interface StudyPipelineProps {
  open: boolean;
  onClose: () => void;
  transcript: string;
}

type PipelineStage = 'idle' | 'splitting' | 'mindmap' | 'chapters' | 'complete' | 'error';
type MainTab = 'materi' | 'kuis' | 'mindmap' | 'buddy' | 'voice' | 'session';

// cyrb53  -  small fast hash function for cache keys (no crypto needed).
// Returns 53-bit hash as string. Good enough for localStorage cache keys.
function cyrb53(str: string, seed: number = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

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
  // v-visualisasi: array visualisasi dari chunked-generate response. Di-filter per bab_id
  // saat dirender di tab Materi (VisualisasiPanel). 0 request tambahan  -  visualisasi
  // sudah digenerate Phase 2 GLM bersamaan dengan bab/kuis/mindmap.
  const [visualisasi, setVisualisasi] = useState<any[]>([]);
  // v17-jsfirst: 3 keluaran dari pipeline  -  materi_lengkap (filter), ringkasan_padat (summary),
  // ringkasan_sedang (Resoomer fallback, opsional). Dipakai di tab Ringkasan + Materi.
  const [materiLengkap, setMateriLengkap] = useState('');
  const [ringkasanPadat, setRingkasanPadat] = useState('');
  const [ringkasanSedang, setRingkasanSedang] = useState('');
  // v-stable: estimasi info untuk UI progress bar
  const [estimatedLabel, setEstimatedLabel] = useState('');
  const [estimatedLembar, setEstimatedLembar] = useState(0);
  const [phaseInfo, setPhaseInfo] = useState('');  // e.g., "3 DeepSeek + 4 GLM"
  // v9-fast: error state untuk friendly UI  -  tidak ada regex fallback lagi
  const [errorMessage, setErrorMessage] = useState('');
  const [quizBattleOpen, setQuizBattleOpen] = useState(false);
  const [slideExporterOpen, setSlideExporterOpen] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsPaused, setTtsPaused] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [readChapters, setReadChapters] = useState<Set<number>>(new Set());
  const [quickNote, setQuickNote] = useState('');
  const [examOpen, setExamOpen] = useState(false);

  // v25: Vision mode picker (3 presets). User picks BEFORE session starts.
  //   'ringan' = pixel path only, no ML (default, safe for low-end devices)
  //   'stabil' = FaceMesh without iris refinement (~30MB RAM, no gaze-down)
  //   'akurat' = FaceMesh + iris refinement (~50MB RAM, full v22+v23+v24)
  const { studyFocusVisionMode, setStudyFocusVisionMode } = useAppStore();

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
  // v20: UI debug overlay  -  show detection values directly in panel
  const [focusDebug, setFocusDebug] = useState<string>('');
  // v22: Calibration state  -  recorded once per session start. We sample
  // ambient brightness for the first 5s of a session so the pixel-based
  // fallback can normalize against the user's actual lighting instead of
  // using absolute thresholds that are biased toward well-lit rooms.
  const [calibrating, setCalibrating] = useState(false);
  const calibrationStartRef = useRef<number>(0);
  const calibrationBrightnessSamples = useRef<number[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animRef = useRef<number>(0);
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null);
  const stoppedRef = useRef(false);
  const isRunningRef = useRef(false);  // v6: ref untuk avoid stale closure
  const focusEnabledRef = useRef(true);  // v6: same
  const showWarningRef = useRef(false);  // v6: same
  const studyFocusVisionModeRef = useRef(studyFocusVisionMode);  // v25
  const distractedStartRef = useRef<number>(0);

  // Sync refs with state
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);
  useEffect(() => { focusEnabledRef.current = focusEnabled; }, [focusEnabled]);
  useEffect(() => { showWarningRef.current = showWarning; }, [showWarning]);
  // v25: on vision mode change:
  //   1. Update ref so detectFocus()'s check() loop sees the new mode
  //      on the next frame (skip ML when 'ringan', load ML otherwise).
  //   2. Set iris refinement preference BEFORE any model load happens.
  //      'akurat' = iris on (full gaze detection), 'stabil' = iris off
  //      (smaller model, no gaze detection but ML still active).
  //   3. resetFaceMesh() to dispose any loaded model  -  the new mode may
  //      have different refineLandmarks setting, so the old loaded model
  //      is invalid. Also frees ~30-50MB RAM when switching to 'ringan'.
  useEffect(() => {
    studyFocusVisionModeRef.current = studyFocusVisionMode;
    setRefineLandmarks(studyFocusVisionMode === 'akurat');
    resetFaceMesh();
  }, [studyFocusVisionMode]);

  // v18-stable: Track last processed transcript  -  detect when user uploads NEW content.
  // Kalau transcript beda → reset stage ke 'idle' → pipeline jalan ulang dengan transcript baru.
  // Tanpa ini, stage masih 'complete' dari run sebelumnya → runPipeline GAK jalan → hasil lama.
  const lastProcessedTranscript = useRef('');
  useEffect(() => {
    if (transcript && transcript !== lastProcessedTranscript.current) {
      lastProcessedTranscript.current = transcript;
      setStage('idle');
      setChapters([]);
      setQuizzes({});
      setErrorMessage('');
      setRingkasanPadat('');
      setMateriLengkap('');
      setRingkasanSedang('');
      setVisualisasi([]);
      setLLMMindmap(null);
      setActiveChapterId(null);
      console.log('[Pipeline] Transcript changed → resetting state, will re-run pipeline');
    }
  }, [transcript]);

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

    // v-stable: estimasi waktu berdasarkan chunk count + section count.
    // Phase 1: ceil(N/2) gelombang × 40s (pLimit 2, DeepSeek ~150 tok/s × 6K tok = 40s)
    // Phase 2: ceil(M/2) gelombang × 70s (GLM ~71 tok/s × 5K tok = 70s)
    // Beri user informasi progress real-time, gak stuck di 10%.
    const estimatedLembar = Math.ceil(transcript.length / 1400);
    const estPhase1Chunks = transcript.length > 30000 ? Math.ceil(transcript.length / 50000) : 0;
    const estPhase2Sections = estimatedLembar <= 21 ? 1 : 4;
    // v9-fast: pLimit 5 = mostly 1 gelombang, bukan ceil(N/2)
    const estimatedPhase1Ms = estPhase1Chunks > 0 ? Math.ceil(estPhase1Chunks / 5) * 40_000 : 0;
    const estimatedPhase2Ms = Math.ceil(estPhase2Sections / 5) * 33_000;
    const estimatedMs = estimatedPhase1Ms + estimatedPhase2Ms + 10_000;
    const estimatedLabel = estimatedMs >= 60_000
      ? `~${Math.ceil(estimatedMs / 60_000)} menit`
      : `~${Math.ceil(estimatedMs / 1000)} detik`;
    setEstimatedLabel(estimatedLabel);
    setEstimatedLembar(estimatedLembar);
    // v9-fast: hapus "pLimit 2" info  -  user gak mau lihat technical details
    setPhaseInfo('');
    console.log(`[Pipeline] estimated: ${estimatedLabel} (${estPhase1Chunks} DeepSeek + ${estPhase2Sections} GLM, pLimit 5)`);

    // v-stable: animasi progress 10% → 90% over estimatedMs, supaya progress bar
    // gak stuck di 10% selama request berlangsung. Kalau response lebih cepat dari
    // estimasi → langsung 100%. Kalau lebih lama → hold di 90% dengan label "masih diproses".
    const progressStartTime = Date.now();
    const progressIntervalMs = 1000;  // update tiap 1 detik
    const progressTimer = setInterval(() => {
      const elapsed = Date.now() - progressStartTime;
      if (elapsed < estimatedMs) {
        // Animate 10% → 90% over estimated time
        const pct = 10 + Math.min(80, (elapsed / estimatedMs) * 80);
        setProgress(Math.floor(pct));
      } else {
        // Exceeded estimate  -  hold at 90% (will jump to 100% when response arrives)
        setProgress(90);
      }
    }, progressIntervalMs);
    await sleep(300);

    // v-chunked: cache check (renamed from chunked-generate) localStorage untuk hasil chunked-generate (7 hari).
    // Cache key = hash of transcript (cyrb53). Kalau HIT, skip 1 LLM call
    // besar sama sekali → sidebar instant di Mode Belajar berikutnya.
    // v19.1: NO LOCAL CACHE  -  always fetch fresh from server.
    // LLM is free + fast (~1-3s), cache adds complexity + stale data risk.
    // User uploads same transcript twice → fresh LLM call each time (always up-to-date).
    let split: Chapter[] | null = null;
    let quizMap: Record<number, QuizQuestion[]> = {};
    let mindmapNode: LLMMindmapNode | null = null;
    let visualisasiArr: any[] = [];
    const usedCache = false;

    // v-mega: PANGGIL /api/stt/chunked-generate (1 request LLM, NO split, NO 55-chunk loop).
    // v15-arch: pre-summarize (Chatr/Resoomer/PDFSummarizer) di-REMOVE dari client. Kirim RAW
    // transcript langsung ke chunked-generate. chunked-generate sekarang handle SEMUA internal:
    //   Phase 1: DeepSeek FILTER (clean + ## Topik markers, preserve 70-85%)
    //   Phase 1.5: Chatr summary (gratis, 0.5% threshold) + Resoomer fallback (sedang)
    //   Phase 2: GLM STRUKTUR (modul + kuis + visualisasi + mindmap + glosarium JSON)
    // Sebelumnya: pre-summarize.ts kirim Resoomer output (15K) ke chunked-generate, yang
    // bikin Phase 1 filter di-SKIP (input < 30K threshold) → materi_lengkap = dirty Resoomer
    // output → GLM Phase 2 liat teks kotor ("Halo warga CPL", "Oke. Ah...") → gagal bikin
    // kuis + visualisasi → UI fallback ke paragraph-split "Bagian 1, Bagian 2".
    // Fix: hilangkan pre-summarize, biar chunked-generate yang filter + struktur dari awal.
    // Chunked-generate sudah balik: modul.bab + kuis + mindmap + visualisasi + glosarium
    // dalam 1 JSON. Default level: L3 (65K ringkas_lengkap, ~5-8 menit, stabil).
    //
    // SEBELUM (lama, bermasalah):
    //   fetch('/api/stt/split-chapters') → server-side potong 4K char × ~55 chunk
    //   → 55 LLM call paralel → sering timeout → fallback regex → kualitas bab buruk
    //
    // SESUDAH (baru, stabil):
    //   fetch('/api/stt/chunked-generate') → 1 LLM call dengan transcript utuh (700K char max)
    //   → LLM yang memecah jadi bab di dalam output JSON → tanpa split, tanpa regex fallback
    if (!split) {
      // v18.3 (2026-10-29): RESTORE LLM fetch (was disabled v18-stable due to NVIDIA 10s+ timeout).
      // Now using freellmpool proxy on localhost:8080 (4 keyless providers, ~1-3s response).
      // JS pipeline REMOVED per user request: "gausah make js pipeline dehh... ai aja yang menganukan".
      const transcriptForFetch = transcript.length > 50000 ? transcript.slice(0, 50000) : transcript;
      console.log(`[Pipeline] Fetching /api/stt/chunked-generate (transcript ${transcriptForFetch.length} chars)...`);

      const res = await fetch('/api/stt/chunked-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: transcriptForFetch, title: 'Materi Belajar', maxChapters: 15 }),
      });

      if (!res.ok) {
        console.error(`[Pipeline] chunked-generate HTTP ${res.status}`);
        const errText = await res.text().catch(() => '');
        setStage('error');
        setPhaseInfo(`AI gagal (${res.status}). ${errText.slice(0, 100)}`);
        clearInterval(progressTimer);
        return;
      }

      const mega = await res.json();
      console.log(`[Pipeline] chunked-generate OK: ${mega.modul?.bab?.length ?? 0} bab, kuis ${mega.kuis?.length ?? 0}, vis ${mega.visualisasi?.length ?? 0}, mindmap ${mega.mindmap?.root ? 'OK' : 'null'}`);

      // Parse response  -  v19 includes enrichment fields + adaptive bab count
      split = (mega.modul?.bab || []).map((b: any) => {
        const content = b.penjelasan || '';
        return {
          id: b.id,
          judul: b.judul,
          title: b.judul,
          tujuan: b.tujuan || '',
          konsep_kunci: b.konsep_kunci || [],
          penjelasan: content,
          content: content,
          contoh: b.contoh || '',
          wordCount: content.split(/\s+/).filter(Boolean).length,
          keyPoints: b.konsep_kunci?.map((k: string) => ({ istilah: k, penjelasan: '' })) || [],
          // v19 enrichment fields (8 fields per bab)
          analogy: b.analogy || '',
          whyItMatters: b.whyItMatters || '',
          commonMistake: b.commonMistake || '',
          eli5: b.eli5 || '',
          connectTo: b.connectTo || '',
          examTip: b.examTip || '',
          mnemonic: b.mnemonic || '',
          realWorldExample: b.realWorldExample || '',
          // v19 metadata
          emoji: getBabEmoji(b.judul || '', b.konsep_kunci || []),
        };
      });
      console.log(`[Pipeline] v19 enrichment: ${split.length} bab, content_type=${mega.content_type || '?'}, enrichment_version=${mega.enrichment_version || 0}`);

      if (mega.ringkasan_padat) setRingkasanPadat(mega.ringkasan_padat);
      if (mega.materi_lengkap) setMateriLengkap(mega.materi_lengkap);

      for (const k of (mega.kuis || [])) {
        if (!quizMap[k.bab_id]) quizMap[k.bab_id] = [];
        quizMap[k.bab_id].push({
          id: k.id,
          pertanyaan: k.pertanyaan,
          opsi: k.opsi,
          jawaban: k.jawaban,
          pembahasan: k.pembahasan || '',
        });
      }

      if (mega.mindmap?.root) {
        mindmapNode = {
          label: mega.mindmap.root,
          children: (mega.mindmap.cabang || []).map((c: any) => ({
            label: c.label,
            children: (c.children || []).map((sc: any) => ({ label: sc.label, children: [] })),
          })),
        };
      }

      visualisasiArr = mega.visualisasi || [];

      // v19.1: NO LOCAL CACHE  -  removed localStorage.setItem call
    }

    // Set state untuk SEMUA path (cache HIT, chunked-generate OK, atau regex fallback).
    // Bug fix: sebelumnya setChapters(split) hanya dipanggil di cache HIT branch,
    // sehingga path cache MISS + fetch OK nggak pernah update state chapters →
    // UI nampil "Bab: 0" walau data sebenarnya ada. Sekarang set di sini untuk
    // semua path supaya konsisten.
    setChapters(split);
    setQuizzes(quizMap);
    if (mindmapNode) setLLMMindmap(mindmapNode);
    setVisualisasi(visualisasiArr);  // v-visualisasi: set di semua path (kosong jika fallback)
    setProgress(25);

    // v-stable: clear progress timer (Phase 1 done, Phase 2 starting)
    // Progress akan di-set ke 100 di akhir.
    // Catatan: timer tetap jalan selama Phase 2 untuk animasi 10%→90%,
    // tapi akan di-clear saat setProgress(100) atau stage='complete'.

    setStage('mindmap');

    // Kalau chunked-generate nggak balik mindmap (jarang, tapi mungkin terjadi
    // kalau LLM skip field itu), generate via LLM call terpisah (1 request).
    // Ini fallback lembut, bukan 55-chunk loop.
    if (!mindmapNode && split.length > 0) {
      try {
        const mindmapData = await generateLLMMindmap(split);
        if (mindmapData) setLLMMindmap(mindmapData);
      } catch (err) {
        console.warn('[Mindmap] LLM failed:', err);
      }
    }

    setProgress(100);
    // v-stable: clear progress timer, request selesai
    clearInterval(progressTimer);
    setStage('complete');
    if (split.length > 0) setActiveChapterId(split[0].id);
    if (usedCache) {
      console.log(`[Pipeline] DONE  -  used cache for mega, total time saved ~5-10min`);
    }
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
        // work immediately after srcObject is set  -  video.videoWidth
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
    // v22: Reset calibration state when session stops.
    calibrationStartRef.current = 0;
    calibrationBrightnessSamples.current = [];
    setCalibrating(false);
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
    // v25: only trigger ML model load if vision mode is NOT 'ringan'.
    // When 'ringan', we skip isFaceMeshAvailable() entirely  -  no network
    // request, no model download, no RAM usage. The check() loop also
    // short-circuits getDetectorSync() to null.
    // 'stabil' and 'akurat' both load ML  -  difference is iris refinement,
    // which is set via setRefineLandmarks() in the useEffect above.
    if (studyFocusVisionModeRef.current !== 'ringan') {
      setFaceMeshLoading(true);
      isFaceMeshAvailable().then((available) => {
        setUsingFaceMesh(available);
        setFaceMeshLoading(false);
      });
    } else {
      setFaceMeshLoading(false);
      setUsingFaceMesh(false);
    }

    // Closure state for throttling + smoothing
    let lastLegacyFaceCheck = 0;
    let lastFaceMeshCheck = 0;  // v22: throttle FaceMesh calls to ~8fps
    let legacyFacePresent = false;
    let legacyFaceAttentive = false;
    // v22: HOISTED to outer scope. Original code declared these as `const`
    // inside the `if (now - lastLegacyFaceCheck > 500)` block but used them
    // in the posture branches below that block. On frames where the legacy
    // check didn't run, the reference would throw ReferenceError, swallowed
    // by the try-catch  -  leaving the focus score stuck at 0%. Declaring them
    // here as `let` makes them persist between legacy checks (cached value
    // is reused on intermediate frames), which is the intended behavior.
    let headBowedDown = false;
    let lookingDown = false;
    // v11: Relative face position tracking. Record baseline face Y position
    // when session starts. If face moves DOWN significantly -> nunduk.
    // Adapts to each user's face shape + camera position (no fixed threshold).
    let baselineFaceY: number | null = null;
    const baselineSamples: number[] = [];
    let lastScoreUpdate = 0;
    const scoreHistory: number[] = [];
    let eyesClosedSince = 0;

    const check = async () => {
      // v6: Use refs instead of stale closure values.
      // isRunningRef.current is always current (synced via useEffect).
      // OLD code used isRunning from closure -- was always false because
      // startCamera captured detectFocus when isRunning was false.
      if (stoppedRef.current || !isRunningRef.current || !focusEnabledRef.current) {
        return;
      }
      // v4: Wait for video to have ACTUAL FRAME DATA (not just metadata).
      // videoWidth is set at readyState 1 (HAVE_METADATA), but frame pixels
      // aren't available until readyState >= 2 (HAVE_CURRENT_DATA).
      // estimateFaces on readyState < 2 -> blank frame -> 0 faces -> score 0%.
      if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
        animRef.current = requestAnimationFrame(check);
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, 160, 120);
        const frame = ctx.getImageData(0, 0, 160, 120).data;

        // -- Motion detection (always computed -- used in both paths) --
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

        // -- Brightness check (camera covered = all black) --
        let brightnessSum = 0;
        let brightnessCount = 0;
        for (let i = 0; i < frame.length; i += 16) {
          brightnessSum += (frame[i] + frame[i + 1] + frame[i + 2]) / 3;
          brightnessCount++;
        }
        const avgBrightness = brightnessSum / brightnessCount;
        // v16/v22: Only truly black camera (avgBrightness < 5) is treated as
        // covered. Previous v16 also had a separate -15 penalty below 30
        // brightness -- that was the explicit lighting bias v21 removed.
        // v22 keeps the cameraCovered floor as-is because < 5 is genuinely
        // a covered lens, not dim room light.
        const cameraCovered = avgBrightness < 5;

        // -- v22: Calibration phase (first 5s of session) --
        // Sample ambient brightness on every frame for the first 5s. The
        // pixel-based fallback uses these samples to compute a relative
        // brightness baseline so sclera/skin thresholds normalize to the
        // user's actual lighting instead of absolute numbers. While
        // calibrating, we don't penalize the score (benefit of doubt) and
        // show a "Kalibrasi" indicator in the debug overlay.
        if (calibrationStartRef.current === 0) {
          calibrationStartRef.current = now;
          setCalibrating(true);
        }
        const calibrationElapsedSec = (now - calibrationStartRef.current) / 1000;
        const inCalibration = calibrationElapsedSec < 5;
        if (inCalibration) {
          calibrationBrightnessSamples.current.push(avgBrightness);
        } else if (calibrating) {
          // First frame after calibration ends -- flip UI flag.
          // React will bail out on subsequent frames since state is already false.
          setCalibrating(false);
        }

        let baseScore = 0;
        let currentPosture: 'attentive' | 'nunduk' | 'away' | 'ngantuk' = 'away';

        if (cameraCovered) {
          baseScore = 0;
          currentPosture = 'away';
        } else if (inCalibration) {
          // Don't penalize while baseline is being built -- could be a well-lit
          // room with a slowly-warming webcam, or a dim room. Either way, the
          // post-calibration pixel path will use the recorded baseline.
          baseScore = 50;
          currentPosture = 'attentive';
          setFocusDebug(
            `Kalibrasi ${calibrationElapsedSec.toFixed(1)}s/5s ` +
            `bright:${avgBrightness.toFixed(0)} ` +
            `(jangan tutup kamera)`
          );
        } else {
          // -- v22 PRIMARY PATH: FaceMesh + computeHeadPose --
          // MediaPipe FaceMesh landmarks are GEOMETRY (x,y positions on the
          // face), not raw pixel brightness. The model is trained across
          // lighting conditions so detection works in dim rooms, bright
          // rooms, side-lit, etc. -- no lighting bias.
          //
          // head-pose.ts derives nunduk from face ASPECT RATIO (height/width)
          // and ngantuk from Eye Aspect Ratio (EAR) -- both are normalized
          // measurements, invariant to overall brightness.
          // v25: short-circuit when vision mode is 'ringan' (pixel path only).
          // For 'stabil' and 'akurat', getDetectorSync() returns the loaded
          // model (or null while still loading). The iris refinement difference
          // was already baked into the model at load time via setRefineLandmarks().
          const fmDetector = studyFocusVisionModeRef.current !== 'ringan'
            ? getDetectorSync()
            : null;
          let faceMeshHandled = false;

          if (fmDetector && (now - lastFaceMeshCheck > 125)) {
            lastFaceMeshCheck = now;
            try {
              const fmResult = await detectFace(video);
              const headPose = fmResult.detected ? computeHeadPose(fmResult) : null;

              if (headPose) {
                // Face detected + pose computed -> use ML signal as source of truth.
                setUsingFaceMesh(true);
                faceMeshHandled = true;
                if (headPose.attentive) {
                  baseScore = 80;
                  currentPosture = 'attentive';
                } else if (headPose.eyesClosed) {
                  baseScore = 40;
                  currentPosture = 'ngantuk';
                } else if (headPose.lookingDown) {
                  baseScore = 35;
                  currentPosture = 'nunduk';
                } else if (headPose.gazeDown) {
                  // v23: head upright (aspect ratio > 1.0) BUT eyes look down
                  // at phone in lap. Closes the loophole where v22 classified
                  // "sit-upright-eyes-down" as attentive (score 80). Score 45
                  // = same as "face present but no sclera"  -  moderately
                  // distracted but still at desk.
                  baseScore = 45;
                  currentPosture = 'nunduk';
                } else {
                  // Face present but ambiguous -- slightly below attentive.
                  baseScore = 60;
                  currentPosture = 'attentive';
                }
                setFocusDebug(
                  `[FM] pitch:${headPose.pitch} ` +
                  `EAR L:${headPose.eyeOpenness.left.toFixed(2)} ` +
                  `R:${headPose.eyeOpenness.right.toFixed(2)} ` +
                  `gaze↓:${headPose.gazeDown ? 'Y' : 'n'} ` +
                  `bright:${avgBrightness.toFixed(0)} ` +
                  `m:${diff.toFixed(1)} ` +
                  `| ${currentPosture}`
                );
              } else if (fmResult.detected === false) {
                // Model loaded, but no face in frame. Trust this -- pixel
                // fallback could falsely detect warm-colored clothing as
                // skin and report "attentive" when user is actually away.
                setUsingFaceMesh(true);
                faceMeshHandled = true;
                baseScore = 0;
                currentPosture = 'away';
                setFocusDebug(
                  `[FM] no face -> away ` +
                  `bright:${avgBrightness.toFixed(0)} ` +
                  `m:${diff.toFixed(1)}`
                );
              }
              // If model not yet loaded (getDetectorSync() === null),
              // fmResult.detected is false with landmarks null -- fall
              // through to pixel-based path below.
            } catch (fmErr) {
              console.warn('[Focus] FaceMesh check error:', fmErr);
              // Fall through to pixel path on transient errors.
            }
          }

          // -- v22 FALLBACK: improved pixel-based detection --
          // Only runs when FaceMesh model isn't available (still loading,
          // failed to load, or marked tooSlow). The previous logic was
          // biased toward well-lit rooms because:
          //   1. Skin: `r > 80` -> fails in dim light (real skin can be R<80)
          //   2. Sclera: `r > 180 && g > 180 && b > 180` -> fails in dim light,
          //      over-saturates in direct sun (false-positive everywhere)
          //   3. Scope bug: headBowedDown/lookingDown declared inside the
          //      500ms-throttled block but used outside it -- ReferenceError
          //      was swallowed by the try-catch, leaving score stuck at 0%
          //      on frames where the legacy check didn't run.
          if (!faceMeshHandled) {
            setUsingFaceMesh(false);
            if (now - lastLegacyFaceCheck > 500) {
              lastLegacyFaceCheck = now;

              // Sample center 50% of frame, split into TOP-HALF and BOTTOM-HALF.
              // v19/v22: NO shirt-specific detection. Use topSkinRatio for head
              // bowed detection -- works for any shirt color.
              let skinCount = 0;
              let totalPixels = 0;
              let topSkin = 0, bottomSkin = 0;
              let topTotal = 0, bottomTotal = 0;
              // v22: collect brightnesses per region for percentile-based
              // sclera threshold (replaces absolute r > 180 which is biased
              // toward bright light).
              const topBrightnesses: number[] = [];
              const bottomBrightnesses: number[] = [];
              // Center area: x=40-120 (of 160), y=20-80 (of 120)
              // TOP-HALF: y=20-50 (forehead + upper eyes -- face skin)
              // BOTTOM-HALF: y=50-80 (lower eyes + nose + mouth + shirt collar)
              for (let y = 20; y < 80; y += 2) {
                for (let x = 40; x < 120; x += 2) {
                  const idx = (y * 160 + x) * 4;
                  const r = frame[idx], g = frame[idx + 1], b = frame[idx + 2];
                  totalPixels++;
                  const brightness = (r + g + b) / 3;

                  // v22: Normalized RGB skin detection.
                  // OLD: r > 80 && g > 40 && b > 20 && r > g && r > b && (r-g) > 15 && r < 250
                  //   -> biased toward bright light (r > 80 fails in dim) AND
                  //      biased against darker skin tones ((r-g) > 15 excludes
                  //      low-saturation faces).
                  // NEW: r/(r+g+b), g/(r+g+b), b/(r+g+b) -- these ratios are
                  //   invariant to overall brightness. Skin cluster in
                  //   normalized RGB: rn in [0.36, 0.52], gn in [0.28, 0.40],
                  //   bn <= 0.32, with rn > gn > bn.
                  const t = r + g + b + 1;
                  const rn = r / t;
                  const gn = g / t;
                  const bn = b / t;
                  const isSkin = rn >= 0.36 && rn <= 0.52
                    && gn >= 0.28 && gn <= 0.40
                    && bn <= 0.32
                    && rn > gn && rn > bn;
                  if (isSkin) skinCount++;

                  if (y < 50) {
                    topTotal++;
                    topBrightnesses.push(brightness);
                    if (isSkin) topSkin++;
                  } else {
                    bottomTotal++;
                    bottomBrightnesses.push(brightness);
                    if (isSkin) bottomSkin++;
                  }
                }
              }

              // v22: Percentile-based sclera detection.
              // Per region, take the top 5% brightest pixels as "white".
              // Replaces the absolute `r > 180 && g > 180 && b > 180` rule
              // which biased toward bright light. We still require a sanity
              // floor (top-5% brightness must exceed 80 absolute) so we don't
              // count noise as sclera in pitch-black frames.
              const computeWhiteCount = (arr: number[]): number => {
                if (arr.length === 0) return 0;
                const sorted = [...arr].sort((a, b) => a - b);
                const threshold = sorted[Math.floor(arr.length * 0.95)] || 0;
                const SCLERA_FLOOR = 80;
                if (threshold < SCLERA_FLOOR) return 0;
                return Math.ceil(arr.length * 0.05);
              };
              const topWhite = computeWhiteCount(topBrightnesses);
              const bottomWhite = computeWhiteCount(bottomBrightnesses);
              const whiteCount = topWhite + bottomWhite;
              const whiteRatio = whiteCount / totalPixels;
              const skinRatio = skinCount / totalPixels;
              const topSkinRatio = topSkin / topTotal;
              const bottomSkinRatio = bottomSkin / bottomTotal;

              headBowedDown = skinRatio > 0.05 && topSkinRatio < 0.02;
              const totalWhite = topWhite + bottomWhite;
              const gazeDownRatio = totalWhite > 3
                ? topWhite / totalWhite
                : 0.5;
              lookingDown = totalWhite > 3 && gazeDownRatio > 0.65;

              legacyFacePresent = skinRatio > 0.05;
              legacyFaceAttentive = legacyFacePresent
                && topSkinRatio > 0.05
                && whiteRatio > 0.02
                && !lookingDown
                && !headBowedDown;

              const debugStr = `[PX] bright:${avgBrightness.toFixed(0)} ` +
                `white:${whiteRatio.toFixed(3)} ` +
                `topW:${topWhite} botW:${bottomWhite} ` +
                `topSkin:${topSkinRatio.toFixed(3)} ` +
                `botSkin:${bottomSkinRatio.toFixed(3)} ` +
                `gaze:${gazeDownRatio.toFixed(2)} ` +
                `skin:${skinRatio.toFixed(3)} ` +
                `m:${diff.toFixed(1)} ` +
                `| ${headBowedDown ? 'BOWED' : (lookingDown ? 'GAZE-DOWN' : (legacyFaceAttentive ? 'ATTENTIVE' : '?'))}`;
              setFocusDebug(debugStr);
            }

            // v22: posture branches -- now safe because headBowedDown/
            // lookingDown are declared at outer scope and persist between
            // legacy checks (which only run every 500ms).
            if (legacyFacePresent && legacyFaceAttentive) {
              baseScore = 75;  // v16: was 60 -- boost true fokus
              currentPosture = 'attentive';
            } else if (legacyFacePresent && headBowedDown) {
              baseScore = 30;  // v18: significant penalty for head bowed
              currentPosture = 'nunduk';
            } else if (legacyFacePresent && lookingDown) {
              baseScore = 35;  // v17: specific penalty for gaze down
              currentPosture = 'nunduk';
            } else if (legacyFacePresent) {
              // Face present but no sclera = eyes closed or looking away
              baseScore = 45;
              currentPosture = 'nunduk';
            } else {
              // v21: NO skin detected = user NOT visible (kabur/away).
              // Old v16 logic gave 50-55% here as "benefit of the doubt" ->
              // false 'Kurang Fokus' when user was actually away.
              // User explicitly requested: 'user ga ada = 0%'.
              baseScore = 0;
              currentPosture = 'away';
            }
          }
        }

        // Motion bonus -- v16: more forgiving (don't zero out score for motion)
        let motionBonus = 15;
        if (diff > 1 && diff < 15) {
          motionBonus = 20;  // active (typing/reading)
        } else if (diff > 30) {
          motionBonus = -5;  // big motion = distracted (but don't zero out)
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

          // v22: don't trigger distracted warning during calibration
          if (avgScore < 50 && !inCalibration) {
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
      } catch (e) {
        // v16: log errors instead of silently swallowing
        console.error('[Focus] check error:', e);
      }
      animRef.current = requestAnimationFrame(check);
    };
    check();
  }, []);  // v6: no deps  -  uses refs, not stale closure values

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
            <Sparkles className="h-4 w-4 text-[#7C3AED]" />
            <span className="text-sm font-semibold text-white">Mode Belajar</span>
          </div>
          <Button onClick={onClose} size="sm" variant="ghost" className="h-7 text-zinc-500">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Error state  -  v9-fast: friendly error, NO stack trace */}
        {stage === 'error' && (
          <div className="p-6 text-center space-y-3">
            <div className="text-4xl">⚠️</div>
            <p className="text-sm text-zinc-300">{errorMessage}</p>
            <Button
              onClick={() => { setStage('idle'); setErrorMessage(''); }}
              className="bg-[#7C3AED] hover:bg-[#7C3AED] text-white text-xs px-4 py-2 rounded"
            >
              Coba lagi
            </Button>
          </div>
        )}

        {/* Progress (during pipeline) */}
        {stage !== 'complete' && stage !== 'idle' && stage !== 'error' && (
          <div className="p-3 border-b border-white/[0.04]">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[#7C3AED] flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {stage === 'splitting' && 'Menyusun ringkasan...'}
                {stage === 'mindmap' && 'Menyusun modul...'}
                {stage === 'chapters' && 'Menyusun kuis...'}
              </span>
              <span className="text-zinc-500">{progress}%</span>
            </div>
            <Progress value={progress} className="h-1" />
            {estimatedLabel && (
              <div className="text-[10px] text-zinc-500 mt-1">
                Estimasi: <span className="text-zinc-300 font-medium">{estimatedLabel}</span>
              </div>
            )}
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
              <p className="text-base font-bold text-[#7C3AED]">{totalQuestions}</p>
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
                    ? 'bg-[#7C3AED]/10 text-[#7C3AED]'
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
              className="w-full bg-[#7C3AED] hover:bg-[#7C3AED] text-xs"
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
          <div className="sticky top-0 z-20 bg-zinc-950/80  border-b border-white/[0.04] px-6 py-2 flex gap-2">
            <button
              onClick={() => setMainTab('materi')}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                mainTab === 'materi' ? 'bg-[#7C3AED] text-white' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <BookOpen className="h-3 w-3 inline mr-1" />
              Materi
            </button>
            <button
              onClick={() => setMainTab('kuis')}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                mainTab === 'kuis' ? 'bg-[#7C3AED] text-white' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <Calculator className="h-3 w-3 inline mr-1" />
              Kuis
            </button>
            <button
              onClick={() => setMainTab('mindmap')}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                mainTab === 'mindmap' ? 'bg-[#7C3AED] text-white' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <Brain className="h-3 w-3 inline mr-1" />
              Mindmap
            </button>
            {/* v11-combine: Tanya AI + Study Buddy digabung jadi 1 tab.
                StudyBuddy component sekarang punya full context (semua bab + transcript)
                + 3 mode (diskusi/challenge/jelaskan). Tanya AI inline dihapus. */}
            <button
              onClick={() => setMainTab('buddy')}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                mainTab === 'buddy' ? 'bg-[#7C3AED] text-white' : 'text-zinc-500 hover:text-zinc-300'
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
            {/* v11-combine: tab "Study Buddy" dihapus (duplikat dengan "Tanya AI" di atas).
                Tab "Tanya AI" (mainTab === 'buddy') sekarang handle semua  -  pakai
                StudyBuddy component dengan 3 mode (diskusi/challenge/jelaskan). */}
            <button
              onClick={() => setMainTab('session')}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                mainTab === 'session' ? 'bg-[#7C3AED] text-white' : 'text-zinc-500 hover:text-zinc-300'
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
              <Loader2 className="h-8 w-8 animate-spin text-[#7C3AED] mx-auto mb-4" />
              <p className="text-sm text-zinc-400">
                {stage === 'splitting' && 'Menyusun ringkasan...'}
                {stage === 'mindmap' && 'Menyusun modul...'}
                {stage === 'chapters' && 'Menyusun kuis...'}
              </p>
            </div>
          </div>
        )}

        {/* MINDMAP TAB: visual SVG graph */}
        {mainTab === 'mindmap' && stage === 'complete' && (
          <div className="p-6">
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-6">
              <h2 className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
                <Brain className="h-4 w-4 text-[#7C3AED]" />
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
            {/* Chapter title  -  v19: include emoji */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#7C3AED]/10 flex items-center justify-center text-base font-bold text-[#7C3AED]">
                {activeChapter.id}
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-white">
                  {activeChapter.title}
                </h2>
                <p className="text-[10px] text-zinc-500">{activeChapter.wordCount} kata</p>
              </div>
              <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30">
                <BookOpen className="h-3 w-3 mr-1" />
                Materi
              </Badge>
            </div>

            {/* Tujuan */}
            {activeChapter.tujuan && (
              <div className="rounded-lg border border-purple-500/10 bg-purple-500/[0.02] p-3">
                <p className="text-[11px] text-zinc-500 mb-1">Tujuan</p>
                <p className="text-xs text-zinc-400 leading-relaxed">{activeChapter.tujuan}</p>
              </div>
            )}

            {/* Content */}
            <div className="rounded-lg border border-blue-500/10 bg-blue-500/[0.02] p-5">
              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{activeChapter.content}</p>
            </div>

            {/* v19 Callouts  -  Insight, Misconception, Key Takeaway */}
            {(activeChapter.analogy || activeChapter.commonMistake || activeChapter.examTip) && (() => {
              const callouts = buildCallouts({
                analogy: activeChapter.analogy,
                realWorldExample: activeChapter.realWorldExample,
                commonMistake: activeChapter.commonMistake,
                examTip: activeChapter.examTip,
                mnemonic: activeChapter.mnemonic,
              });
              return callouts.length > 0 ? (
                <div className="space-y-2">
                  {callouts.map((c, i) => (
                    <div
                      key={i}
                      className="rounded-lg p-3 border-l-2"
                      style={{
                        borderLeftColor: c.color,
                        background: `${c.color}10`,
                      }}
                    >
                      <p className="text-[11px] font-medium mb-1" style={{ color: c.color }}>
                        {c.title}
                      </p>
                      <p className="text-xs text-zinc-300 leading-relaxed">{c.content}</p>
                    </div>
                  ))}
                </div>
              ) : null;
            })()}

            {/* v19 ELI5  -  Explain Like I'm 5 */}
            {activeChapter.eli5 && !activeChapter.eli5.startsWith('Konsep ini menjelaskan') && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-4">
                <p className="text-[11px] text-zinc-500 mb-1">
                  Penjelasan untuk anak (ELI5)
                </p>
                <p className="text-xs text-zinc-300 leading-relaxed">{activeChapter.eli5}</p>
              </div>
            )}

            {/* v19 Connect To  -  relation to other bab */}
            {activeChapter.connectTo && !activeChapter.connectTo.startsWith('Bab ini terhubung') && (
              <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/[0.05] p-3">
                <p className="text-[11px] text-zinc-500 mb-1">
                  Koneksi ke bab lain
                </p>
                <p className="text-xs text-zinc-300 leading-relaxed">{activeChapter.connectTo}</p>
              </div>
            )}

            {/* v19 Contoh */}
            {activeChapter.contoh && (
              <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/[0.02] p-4">
                <p className="text-[11px] text-zinc-500 mb-1">Contoh</p>
                <p className="text-xs text-zinc-300 leading-relaxed">{activeChapter.contoh}</p>
              </div>
            )}

            {/* Konsep Kunci */}
            {activeChapter.konsep_kunci && activeChapter.konsep_kunci.length > 0 && (
              <div className="rounded-lg border border-pink-500/10 bg-pink-500/[0.02] p-4">
                <p className="text-[11px] text-zinc-500 mb-2">Konsep Kunci</p>
                <div className="flex flex-wrap gap-1.5">
                  {activeChapter.konsep_kunci.map((k, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded text-[10px] bg-pink-500/10 text-pink-300 border border-pink-500/20"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* v-visualisasi: render visualisasi untuk bab yang sedang aktif.
                GLM generate JSON data (~150-200 tok per item), frontend render pakai
                Recharts/Mermaid/HTML table  -  0 request API tambahan. */}
            <VisualisasiPanel items={visualisasi.filter(v => Number(v.bab_id) === Number(activeChapter.id))} />

            {/* Actions: TTS + Focus + PDF */}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleToggleTTS}
                size="sm"
                className={cn(
                  ttsPlaying && !ttsPaused ? 'bg-green-600 hover:bg-green-700' : 'bg-[#7C3AED] hover:bg-[#7C3AED]'
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
                                  ? 'border-[#7C3AED]/50 bg-[#7C3AED]/10 text-[#7C3AED]'
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

        {/* TANYA AI TAB (v11-combine)  -  sekarang handle semua chat.
            StudyBuddy component punya 3 mode (diskusi/challenge/jelaskan)
            + full context (semua bab + transcript). Inline TanyaAI dihapus. */}
        {mainTab === 'buddy' && stage === 'complete' && activeChapter && (
          <StudyBuddy
            chapter={activeChapter}
            transcript={transcript}
            allChapters={chapters}
          />
        )}

        {/* VOICE TUTOR TAB */}
        {mainTab === 'voice' && stage === 'complete' && activeChapter && (
          <VoiceTutor chapter={activeChapter} transcript={transcript} />
        )}

        {/* SESSION TAB: Pomodoro + Focus + Ambient */}
        {mainTab === 'session' && stage === 'complete' && (
          <div className="p-6 max-w-2xl mx-auto space-y-6">
            {/* Timer */}
            <div className="text-center">
              <div className={cn(
                'inline-flex items-center justify-center w-48 h-48 rounded-full border-4 transition-all',
                isRunning
                  ? 'border-[#7C3AED] bg-[#7C3AED]/[0.05]'
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
                className="bg-[#7C3AED] hover:bg-[#7C3AED]"
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
                  {/* Camera preview  -  mirrored selfie view, no opacity dimming */}
                  {faceMeshLoading && (
                    <div className="text-center text-[10px] text-zinc-500 py-2">
                      Loading focus model... (~3s first time)
                    </div>
                  )}
                  {/* v22: Calibration banner  -  shown for first 5s of session */}
                  {calibrating && (
                    <div className="rounded-md bg-blue-500/10 border border-blue-500/30 px-2 py-1.5 text-center text-[10px] text-blue-300 animate-pulse">
                      Kalibrasi cahaya… jangan tutup kamera
                    </div>
                  )}
                  {/* v25: Vision mode picker  -  3 presets, choose BEFORE start.
                      Default 'ringan' (pixel path only, no ML download).
                      'stabil' = ML without iris. 'akurat' = ML + iris (gaze). */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-medium text-zinc-400">Mode Vision</p>
                    <div className="grid grid-cols-3 gap-1">
                      <button
                        type="button"
                        onClick={() => setStudyFocusVisionMode('ringan')}
                        className={cn(
                          'rounded-md border px-1.5 py-1.5 text-center transition-colors',
                          studyFocusVisionMode === 'ringan'
                            ? 'border-green-400/60 bg-green-500/10'
                            : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]'
                        )}
                      >
                        <div className={cn(
                          'text-[10px] font-semibold',
                          studyFocusVisionMode === 'ringan' ? 'text-green-300' : 'text-zinc-300'
                        )}>
                          Ringan
                        </div>
                        <div className="text-[8px] text-zinc-500 mt-0.5">5MB</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setStudyFocusVisionMode('stabil')}
                        className={cn(
                          'rounded-md border px-1.5 py-1.5 text-center transition-colors',
                          studyFocusVisionMode === 'stabil'
                            ? 'border-blue-400/60 bg-blue-500/10'
                            : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]'
                        )}
                      >
                        <div className={cn(
                          'text-[10px] font-semibold',
                          studyFocusVisionMode === 'stabil' ? 'text-blue-300' : 'text-zinc-300'
                        )}>
                          Stabil
                        </div>
                        <div className="text-[8px] text-zinc-500 mt-0.5">30MB</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setStudyFocusVisionMode('akurat')}
                        className={cn(
                          'rounded-md border px-1.5 py-1.5 text-center transition-colors',
                          studyFocusVisionMode === 'akurat'
                            ? 'border-purple-400/60 bg-purple-500/10'
                            : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]'
                        )}
                      >
                        <div className={cn(
                          'text-[10px] font-semibold',
                          studyFocusVisionMode === 'akurat' ? 'text-purple-300' : 'text-zinc-300'
                        )}>
                          Akurat
                        </div>
                        <div className="text-[8px] text-zinc-500 mt-0.5">50MB</div>
                      </button>
                    </div>
                    <p className="text-[9px] text-zinc-500 leading-tight mt-1">
                      {studyFocusVisionMode === 'ringan' && 'Pixel path. No download, no ML. Deteksi kulit + sclera yang sudah dinormalisasi anti-bias cahaya. Cocok device kentang.'}
                      {studyFocusVisionMode === 'stabil' && 'FaceMesh tanpa iris. Deteksi kepala + mata tertutup. Tidak deteksi gaze (mata ke HP). Download ~5MB sekali.'}
                      {studyFocusVisionMode === 'akurat' && 'FaceMesh + iris refinement. Deteksi kepala + gaze + mata ke HP (v23). Paling akurat, paling berat. Download ~8MB sekali.'}
                    </p>
                  </div>
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
                        focusScore >= 70 ? 'text-green-400' : focusScore >= 40 ? 'text-amber-400' : focusScore >= 15 ? 'text-orange-400' : 'text-red-400'
                      )}>
                        {focusScore}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
                      <div
                        className={cn(
                          'h-full transition-all',
                          focusScore >= 70 ? 'bg-green-500' : focusScore >= 40 ? 'bg-amber-500' : focusScore >= 15 ? 'bg-orange-500' : 'bg-red-500'
                        )}
                        style={{ width: `${focusScore}%` }}
                      />
                    </div>
                    {/* v15: Postur label DITURUNKAN dari focusScore (%),
                        BUKAN dari posture state categorical. Jadi label
                        SELALU match sama angka yang user lihat. */}
                    <div className="flex items-center justify-between mt-1.5 text-[10px]">
                      <span className="text-zinc-600">Postur:</span>
                      <span className={cn(
                        'font-medium',
                        focusScore >= 70 ? 'text-green-400'
                          : focusScore >= 40 ? 'text-amber-400'
                          : focusScore >= 15 ? 'text-orange-400'
                          : 'text-zinc-500'
                      )}>
                        {focusScore >= 70 ? 'Fokus ✓'
                          : focusScore >= 40 ? 'Kurang Fokus'
                          : focusScore >= 15 ? 'Lengah ↓'
                          : 'Pergi'}
                      </span>
                    </div>
                    {/* Engine indicator  -  shows if using MediaPipe or fallback */}
                    <div className="flex items-center justify-between mt-0.5 text-[9px] text-zinc-600">
                      <span>Engine:</span>
                      <span>
                        {faceMeshLoading ? 'Loading...'
                          : usingFaceMesh ? 'MediaPipe Face Mesh ✓'
                          : 'Sclera + Skin Tone (fallback)'}
                      </span>
                    </div>
                    {/* v20: UI DEBUG OVERLAY  -  live detection values
                        visible directly in panel (no console needed).
                        If you see this box with values updating → bundle v20+ is loaded. */}
                    {focusDebug && (
                      <div className="mt-1.5 p-1.5 rounded bg-zinc-900/80 border border-zinc-700/50 font-mono text-[8px] text-zinc-400 leading-tight break-all">
                        <span className="text-zinc-500">[v20 debug] </span>
                        {focusDebug}
                      </div>
                    )}
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
                  className="mt-3 bg-[#7C3AED] hover:bg-[#7C3AED]"
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
    'text-[#7C3AED] font-bold text-base',
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
          <Badge variant="outline" className="ml-2 text-[8px] border-[#7C3AED]/30 text-[#7C3AED]">
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
