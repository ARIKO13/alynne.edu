// cache-buster: 20260926025318
import { useSpeechRecognition } from '@/hooks/use-speech-recognition';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AudioVisualizer } from '@/components/audio-visualizer';
import { PersonalDictPanel } from '@/components/personal-dict-panel';
import {
  Mic, MicOff, Wifi, WifiOff, RefreshCw, Trash2, CheckCircle2, Radio,
  FileText, Loader2, Rocket, Sparkles, Upload, Monitor, MonitorUp, Brain, Cpu, HardDrive, TrendingUp, Gift, FolderOpen, StickyNote, Zap, BookOpen,
} from 'lucide-react';
import { MaterialUpload } from '@/components/material-upload';
import { YouTubeTranscript } from '@/components/youtube-transcript';
import { BrandLogo } from '@/components/brand-logo';
import { cn } from '@/lib/utils';
import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { structureContent, generatePdf } from '@/lib/pdf-generator';
import { fetchLearnedWords } from '@/lib/personal-dict';
import { ModelSelector } from '@/components/ModelSelector';
import { StudyPipeline } from '@/components/StudyPipeline';
import { WeeklyAnalytics } from '@/components/WeeklyAnalytics';
import { ReferralPanel } from '@/components/ReferralPanel';
import { KnowledgeHub } from '@/components/KnowledgeHub';
import { Scratchpad } from '@/components/Scratchpad';
import { SmartContinuity } from '@/components/SmartContinuity';
import { QuizBattle } from '@/components/QuizBattle';
import { quickSaveSTT } from '@/lib/knowledge-hub';
import { MindmapGraph } from '@/components/MindmapGraph';
import { AmbientThemes } from '@/components/AmbientThemes';
import { generateMicroPDF, generateMasterPDF } from '@/lib/pdf-export';
import { recordActivity, recordQuizResult, generateGreeting } from '@/lib/ai-memory';
import { FileUploadChunked } from '@/components/FileUploadChunked';
import { useWhisperSTT } from '@/hooks/use-whisper-stt';
import { isModelLoaded as fgIsModelLoadedCheck } from '@/lib/whisper-fugood';

function ModeSelector({ disabled }: { disabled: boolean }) {
  const { sttAudioMode, setSttAudioMode } = useAppStore();

  // Mobile detection: no screen share + limited Web Speech API
  // On mobile, we hide mic/screen modes entirely - only upload + YouTube shown
  const isMobile = typeof navigator !== 'undefined' &&
    (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
     (navigator.maxTouchPoints > 1 && window.innerWidth < 1024));

  const isScreenSupported = !isMobile && typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function';

  const modes = [
    {
      id: 'mic' as const,
      label: 'Mikrofon',
      desc: 'Langsung dari mic',
      icon: Mic,
    },
    ...(isScreenSupported ? [{
      id: 'screen' as const,
      label: 'Seluruh Layar',
      desc: 'Zoom + Mic (gabungan)',
      icon: MonitorUp,
    }] : []),
  ];

  // Mobile: hide mode selector entirely
  if (isMobile) {
    return (
      <div className="rounded-lg border border-amber-500/15 bg-emerald-500/[0.03] p-3">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-300/80 leading-relaxed">
            <p className="font-medium text-amber-300 mb-0.5">Mode Mobile</p>
            <p>Untuk transkripsi di HP/tablet, gunakan <strong>Upload File</strong> atau <strong>YouTube Transkrip</strong> di bawah.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      {modes.map((mode) => {
        const Icon = mode.icon;
        const isActive = sttAudioMode === mode.id;
        return (
          <button
            key={mode.id}
            onClick={() => !disabled && setSttAudioMode(mode.id)}
            disabled={disabled}
            className={cn(
              'flex-1 flex items-center gap-2.5 rounded-lg border p-3 text-left transition-colors duration-200',
              disabled && 'opacity-50 cursor-not-allowed',
              isActive
                ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10'
                : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'
            )}
          >
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                isActive ? 'bg-[var(--accent)]/20' : 'bg-white/[0.05]'
              )}
            >
              <Icon
                className={cn('h-4 w-4 transition-colors', isActive ? 'text-[var(--accent-soft)]' : 'text-zinc-500')}
              />
            </div>
            <div className="min-w-0">
              <p className={cn('text-xs font-medium transition-colors', isActive ? 'text-white' : 'text-zinc-400')}>
                {mode.label}
              </p>
              <p className={cn('text-[10px] transition-colors', isActive ? 'text-[var(--accent-soft)]/70' : 'text-zinc-600')}>
                {mode.desc}
              </p>
            </div>
            {isActive && (
              <div className="ml-auto h-2 w-2 rounded-full bg-[var(--accent)] shrink-0" />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function STTPanel() {
  const {
    sttStatus, sttSource, transcript, interimTranscript, sttError,
    isReconnecting, webspeechSupported,
    toggleRecording, clearTranscript, audioLevels,
    sttWarning, isGroqProcessing, isEnhancing, isWhisperProcessing,
    screenCv,
  } = useSpeechRecognition();
  
const { transcriptEntries, sttAudioMode, setInterimTranscript } = useAppStore();

  // Whisper STT hook - client-side, jalan di browser via Web Worker
  const whisperSTT = useWhisperSTT({
    onModelRequired: () => setModelSelectorOpen(true),
    onTranscript: (text, isFinal) => { if (isFinal && text) { useAppStore.getState().appendTranscript(text); } },
    onInterim: (text) => setInterimTranscript(text),
    onError: (err) => toast.error(`STT error: ${err}`),
  });
  const [pdfLoading, setPdfLoading] = useState(false);
  const { setActiveTab } = useAppStore();
  const [personalDictOpen, setPersonalDictOpen] = useState(false);
  const [personalDictCount, setPersonalDictCount] = useState(0);
  const [hybridProcessing, setHybridProcessing] = useState(false);
  const hybridRecorderRef = useRef<MediaRecorder | null>(null);
  const hybridChunksRef = useRef<Blob[]>([]);
  const hybridStreamRef = useRef<MediaStream | null>(null);

  // HYBRID: Start parallel MediaRecorder saat Web Speech API start
  // Audio di-capture untuk Whisper, Web Speech API handle real-time text
  useEffect(() => {
    if (sttStatus === 'recording' && !hybridRecorderRef.current) {
      // Start MediaRecorder in parallel
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
        .then(stream => {
          hybridStreamRef.current = stream;
          const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
          const recorder = new MediaRecorder(stream, { mimeType });
          hybridRecorderRef.current = recorder;
          hybridChunksRef.current = [];
          recorder.ondataavailable = (e) => { if (e.data.size > 0) hybridChunksRef.current.push(e.data); };
          recorder.onstop = async () => {
            console.log('[Hybrid] MediaRecorder stopped, sending to Whisper...');
            if (hybridChunksRef.current.length === 0) return;
            const blob = new Blob(hybridChunksRef.current, { type: mimeType });
            console.log('[Hybrid] Audio:', blob.size, 'bytes');
            setHybridProcessing(true);
            try {
              // Decode + resample
              const arrayBuffer = await blob.arrayBuffer();
              const ctx = new AudioContext({ sampleRate: 16000 });
              const decoded = await ctx.decodeAudioData(arrayBuffer);
              ctx.close();
              let audioData: Float32Array;
              if (decoded.numberOfChannels > 1) {
                audioData = new Float32Array(decoded.length);
                for (let i = 0; i < decoded.length; i++) {
                  let s = 0; for (let ch = 0; ch < decoded.numberOfChannels; ch++) s += decoded.getChannelData(ch)[i];
                  audioData[i] = s / decoded.numberOfChannels;
                }
              } else { audioData = decoded.getChannelData(0); }
              if (decoded.sampleRate !== 16000) {
                const ratio = decoded.sampleRate / 16000;
                const newLen = Math.floor(audioData.length / ratio);
                const resampled = new Float32Array(newLen);
                for (let i = 0; i < newLen; i++) {
                  const si = i * ratio, f = Math.floor(si), cl = Math.min(f+1, audioData.length-1), fr = si-f;
                  resampled[i] = audioData[f]*(1-fr) + audioData[cl]*fr;
                }
                audioData = resampled;
              }
              for (let i = 0; i < audioData.length; i++) {
                if (!isFinite(audioData[i])) audioData[i] = 0;
                if (audioData[i] > 1) audioData[i] = 1;
                if (audioData[i] < -1) audioData[i] = -1;
              }
              console.log('[Hybrid] Sending to Whisper:', audioData.length, 'samples');
              // Load model if needed + transcribe
              const { loadModel: fgLoadModel, transcribe: fgTranscribe } = await import('@/lib/whisper-fugood');
              if (!fgIsModelLoadedCheck()) {
                console.log('[Hybrid] Loading Whisper model...');
                await fgLoadModel('tiny');
              }
              const result = await fgTranscribe(audioData, 'id');
              console.log('[Hybrid] Whisper result:', result.text);
              if (result.text) {
                // Replace transcript dengan Whisper result (lebih akurat)
                useAppStore.getState().setTranscript(result.text);
                toast.success('Transkrip diperbaiki dengan Whisper');
              }
            } catch (err) {
              console.error('[Hybrid] Whisper error:', err);
              toast.error('Whisper gagal, tetap pakai Web Speech API result');
            } finally {
              setHybridProcessing(false);
              if (hybridStreamRef.current) {
                hybridStreamRef.current.getTracks().forEach(t => t.stop());
                hybridStreamRef.current = null;
              }
              hybridRecorderRef.current = null;
            }
          };
          recorder.start(1000);
          console.log('[Hybrid] MediaRecorder started (parallel with Web Speech API)');
        }).catch(err => console.error('[Hybrid] MediaRecorder failed:', err));
    }
  }, [sttStatus]);

  // Stop MediaRecorder saat Web Speech API stop
  useEffect(() => {
    if (sttStatus !== 'recording' && hybridRecorderRef.current && hybridRecorderRef.current.state !== 'inactive') {
      console.log('[Hybrid] Stopping MediaRecorder...');
      hybridRecorderRef.current.requestData();
      setTimeout(() => {
        if (hybridRecorderRef.current && hybridRecorderRef.current.state !== 'inactive') {
          hybridRecorderRef.current.stop();
        }
      }, 200);
    }
  }, [sttStatus]);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [whisperModelReady, setWhisperModelReady] = useState(false);
  const [studyPipelineOpen, setStudyPipelineOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [knowledgeHubOpen, setKnowledgeHubOpen] = useState(false);
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [continuityOpen, setContinuityOpen] = useState(false);
  const [quizBattleOpen, setQuizBattleOpen] = useState(false);
  const isRecording = sttStatus === 'recording' || whisperSTT.status === 'recording';
  const isProcessing = whisperSTT.status === 'processing' || sttStatus === 'processing' || hybridProcessing;
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const isScreenMode = sttAudioMode === 'screen';
  const isCombinedActive = isScreenMode && isRecording;

  // Refresh learned words count when panel closes or recording stops
  useEffect(() => {
    if (!personalDictOpen) {
      fetchLearnedWords().then(({ total }) => setPersonalDictCount(total));
    }
  }, [personalDictOpen, sttStatus]);

  // Initial load
  useEffect(() => {
    fetchLearnedWords().then(({ total }) => setPersonalDictCount(total));
  }, []);

  // Auto-scroll to bottom when new transcript entries arrive or interim text changes
  useEffect(() => {
    const el = transcriptScrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [transcriptEntries, interimTranscript]);

  // Generate learning module PDF (LLM-structured, falls back to local)
  const generatePDFCombined = async () => {
    if (!transcript.trim()) {
      toast.error('Transkrip kosong! Rekam dulu.');
      return;
    }
    setPdfLoading(true);
    try {
      const materials = useAppStore.getState().uploadedMaterials.map(m => m.text);
      const data = await structureContent(transcript, materials);
      await generatePdf(data);
      toast.success('PDF modul berhasil di-generate!');
    } catch (e) {
      console.error('[PDF] Generation error:', e);
      toast.error(`Gagal generate PDF: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] overflow-hidden">
      {/* Info Banner - Whisper required for accurate STT */}
      <div className="px-5 py-2 bg-emerald-500/[0.03] border-b border-emerald-500/10">
        <div className="flex items-center gap-2 text-[11px] text-emerald-400/80">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>STT siap pakai</strong> — audio direkam di browser, lalu
            ditranskrip otomatis oleh Whisper di server.
          </span>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
        <h3 className="text-sm font-medium text-zinc-200">Speech to Text</h3>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setModelSelectorOpen(true)}
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-[11px] font-medium bg-[var(--accent)] hover:bg-[var(--accent)] text-white border-[var(--accent)]/30"
            title="Pilih model Whisper untuk STT"
          >
            <Cpu className="h-3.5 w-3.5" />
            {whisperSTT.isModelLoaded ? 'Model Siap' : 'Pilih Model'}
          </Button>
          <Button
            onClick={() => window.location.href = '/settings'}
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-zinc-400 hover:text-white hover:bg-white/5"
            title="Pengaturan penyimpanan"
          >
            <HardDrive className="h-3.5 w-3.5" />
          </Button>
          <Badge
            variant="outline"
            className={cn(
              'gap-1.5 text-[11px] border-white/[0.08]',
              sttSource === 'webspeech'
                ? 'text-green-400 bg-green-500/10 border-green-500/20'
                : sttSource === 'screen-capture'
                ? 'text-sky-400 bg-sky-500/10 border-sky-500/20'
                : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
            )}
          >
            {sttSource === 'webspeech' ? (
              <><Wifi className="h-3 w-3" /> Web Speech API</>
            ) : sttSource === 'screen-capture' ? (
              <><Monitor className="h-3 w-3" /> System Audio</>
            ) : (
              <><Radio className="h-3 w-3" /> Groq Fallback</>
            )}
          </Badge>
          {isReconnecting && (
            <Badge variant="outline" className="gap-1 text-[11px] animate-pulse border-white/[0.08] text-zinc-400">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Reconnecting...
            </Badge>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4">
        {/* Mode Selector */}
        <ModeSelector disabled={isRecording || isProcessing} />
        <YouTubeTranscript
          disabled={isRecording || isProcessing}
          onTranscript={(text, meta) => {
            console.log('[YouTubeTranscript] transcript:', text.length, 'chars', meta);
            console.log('[YouTubeTranscript] first 80 chars:', text.slice(0, 80));
            // v18.3 (2026-10-29): setTranscriptBatch = REPLACE both transcript AND transcriptEntries.
            // Before (setTranscript) only set transcript string but cleared transcriptEntries,
            // so UI display (which reads transcriptEntries) showed empty.
            const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim());
            useAppStore.getState().setTranscriptBatch(sentences);
            toast.success(`Transkrip YouTube: ${text.length} karakter (${meta.duration} detik)`);
          }}
        />

        {/* Screen mode hint */}
        {isScreenMode && !isRecording && (
          <div className="flex items-start gap-2.5 rounded-lg border border-sky-500/15 bg-sky-500/[0.03] p-3">
            <MonitorUp className="h-4 w-4 text-sky-400 mt-0.5 shrink-0" />
            <div className="text-xs text-sky-300/80 leading-relaxed">
              <p className="font-medium text-sky-300 mb-0.5">Mode Seluruh Layar</p>
              <p>Pilih <strong>"Entire Screen"</strong> di pemilih layar browser, lalu <strong>centang "Share system audio"</strong>. Suara dari YouTube, Zoom, Meet, dsb akan ditranskrip otomatis.</p>
            </div>
          </div>
        )}

        {!webspeechSupported && !isScreenMode && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Browser ini tidak mendukung Web Speech API. Groq API akan digunakan sebagai fallback.</span>
          </div>
        )}
        {sttError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{sttError}</span>
          </div>
        )}
        {sttWarning && !sttError && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{sttWarning}</span>
          </div>
        )}

        {/* Audio Visualizer */}
        {isRecording && <AudioVisualizer audioLevels={audioLevels} isListening={true} />}

        {/* Combined Methods Indicator - shown when Entire Screen capture is active */}
        {isCombinedActive && (
          <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.04] p-3">
            <div className="flex items-center gap-2 mb-2">
              <MonitorUp className="h-3.5 w-3.5 text-sky-400" />
              <p className="text-xs font-medium text-sky-300">Mode gabungan aktif</p>
              <span className="text-[10px] text-zinc-600 ml-auto">mode seluruh layar</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <MethodBadge
                label="Web Speech API"
                active={webspeechSupported}
                loading={false}
                color="green"
                detail={webspeechSupported ? 'mic live' : 'unsupported'}
              />
              <MethodBadge
                label="Web Audio API"
                active={isRecording}
                loading={false}
                color="green"
                detail="mix + visualize"
              />
              <MethodBadge
                label="OCR (tesseract.js)"
                active={!screenCv.isModelLoading && isRecording}
                loading={screenCv.isModelLoading}
                color="violet"
                detail={
                  screenCv.isModelLoading
                    ? `loading ${Math.round(screenCv.modelProgress * 100)}%`
                    : screenCv.isOcrProcessing
                    ? 'recognizing…'
                    : `${screenCv.ocrChunkCount} chunks`
                }
              />
              <MethodBadge
                label="CV Frame Diff"
                active={isRecording}
                loading={false}
                color="amber"
                detail={`${screenCv.slideChangeCount} slide changes`}
              />
            </div>
            {screenCv.error && (
              <p className="mt-2 text-[10px] text-rose-400">{screenCv.error}</p>
            )}
          </div>
        )}

        {/* Transcript Area - Timestamped */}
        <div className="relative rounded-lg border border-white/[0.06] bg-[#111113] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.04] bg-white/[0.02]">
            <div className="flex items-center gap-2">
              {isRecording && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                </span>
              )}
              <span className="text-[11px] font-medium text-zinc-400">
                {isRecording
                  ? isWhisperProcessing ? 'Memperbaiki teks dengan faster-whisper...' : isGroqProcessing ? 'Mentranskripsi...' : sttSource === 'webspeech' ? 'Web Speech API: coba bicara...' : sttSource === 'screen-capture' ? 'Merekam layar + audio...' : 'Mendengarkan...'
                  : transcriptEntries.length > 0 ? `${transcriptEntries.length} entri` : 'Transkrip'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {isGroqProcessing && (
                <span className="flex items-center gap-1 text-[10px] text-sky-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Groq memproses
                </span>
              )}

              {isEnhancing && (
                <span className="flex items-center gap-1 text-[10px] text-[var(--accent-soft)]">
                  <Sparkles className="h-3 w-3" />
                  AI memperbaiki
                </span>
              )}
              {isWhisperProcessing && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  faster-whisper presisi...
                </span>
              )}
              {isRecording && <span className="text-xs font-medium text-red-400 animate-pulse">● REC</span>}
              {sttSource === 'webspeech' && isRecording && !isEnhancing && (
                <span className="text-[10px] text-zinc-600">AI auto-correct aktif</span>
              )}
            </div>
          </div>

          <div ref={transcriptScrollRef} className="min-h-[220px] max-h-[340px] overflow-y-auto p-4 space-y-2.5 scroll-smooth">
            {transcriptEntries.length > 0 ? (
              transcriptEntries.map((entry, i) => (
                <div key={i} className="flex items-start gap-3 group">
                  <span className="text-[11px] font-mono text-zinc-500 shrink-0 pt-0.5 select-none w-16 text-right">{entry.time}</span>
                  <span className="text-[var(--accent-soft)] shrink-0 pt-0.5 select-none">●</span>
                  <p className="text-sm leading-relaxed text-zinc-200">{entry.text}</p>
                </div>
              ))
            ) : (
              <div className="flex items-center justify-center h-[180px]">
                <p className="text-sm text-zinc-600 italic">
                  {!isRecording ? 'Klik tombol untuk mulai merekam' : 'Menunggu teks dari pembicara...'}
                </p>
              </div>
            )}
            {/* Interim preview DISABLED - user request: "tampilin apa adanya aja"
                Interim text berubah-ubah saat Web Speech API update, bikin user
                bingung ("kalimat 1 dh ada di preview tapi ilang, muncul kalimat 2").
                Final text tetap masuk transcriptEntries (di atas), tidak hilang.
                Cuma tampilan preview interim yang di-hide. */}
            {isRecording && !interimTranscript && transcriptEntries.length === 0 && (
              <div className="flex items-center justify-center h-[60px]">
                <p className="text-sm text-zinc-600 italic animate-pulse">
                  Mendengarkan... bicara sekarang
                </p>
              </div>
            )}
            {isRecording && interimTranscript && (
              <div className="flex items-center justify-center h-[40px]">
                <p className="text-[11px] text-zinc-600 animate-pulse">
                  · · · memproses ucapan · · ·
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <Button
            onClick={() => {
              // Whisper STT: AudioWorklet rekam → Whisper transkrip (akurat)
              // HYBRID: Web Speech API (real-time) + Whisper (akurasi)
              toggleRecording();
            }}
            disabled={isProcessing}
            size="lg"
            className={cn(
              'flex-1 gap-2 transition-colors rounded-lg font-medium',
              isRecording
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : isScreenMode
                ? 'bg-sky-600 hover:bg-sky-700 text-white'
                : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white'
            )}
          >
            {whisperSTT.status === 'loading-model' ? <Loader2 className="h-5 w-5 animate-spin" /> : isProcessing ? <RefreshCw className="h-5 w-5 animate-spin" /> : isRecording ? <MicOff className="h-5 w-5 text-red-400" /> : <BrandLogo size={20} color="#ffffff" />}
            {hybridProcessing ? 'Whisper memproses...' : whisperSTT.status === 'loading-model' ? 'Memuat Model...' : isProcessing ? 'Memproses...' : isRecording ? 'Berhenti Merekam' : 'Mulai Merekam'}
          </Button>
          {transcript && (
                <Button onClick={clearTranscript} disabled={isRecording || isProcessing} variant="outline" size="lg" className="gap-2 rounded-lg border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]">
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Clear</span>
            </Button>
          )}
        </div>

        {/* Material Upload - always visible */}
        <div className="rounded-lg border border-sky-500/10 bg-sky-500/[0.02] overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.04]">
            <Upload className="h-4 w-4 text-sky-400" />
            <h3 className="text-sm font-medium text-zinc-200">Materi Pendukung</h3>
            <span className="text-[10px] text-zinc-600 ml-auto">PDF, DOCX, PPTX, TXT</span>
          </div>
          <div className="p-4">
            <MaterialUpload />
          </div>
        </div>

        {/* Post-Recording: Next Steps */}
        {transcript && !isRecording && !isProcessing && (
          <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-zinc-500" />
              <span className="text-sm font-medium text-zinc-200">Apa yang mau kamu lakukan?</span>
              <Badge variant="outline" className="text-[10px] ml-auto border-white/[0.08] text-zinc-500">{transcript.length} karakter</Badge>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {/* Kartu aksi sejajar: satu gaya, ikon inline netral, tanpa tile
                  berwarna (DESIGN.md §9 — struktur dari ruang, bukan kotak).
                  Warna hanya di aksi primer. */}
              <button
                onClick={generatePDFCombined}
                disabled={pdfLoading}
                className="flex items-center gap-3 rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/[0.08] p-3.5 text-left transition-colors hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/[0.14] disabled:opacity-50"
              >
                {pdfLoading ? <Loader2 className="h-4 w-4 shrink-0 text-[var(--accent-soft)] animate-spin" /> : <FileText className="h-4 w-4 shrink-0 text-[var(--accent-soft)]" />}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-zinc-100">Buat Modul PDF</p>
                  <p className="text-[10px] text-zinc-500">Generate modul belajar dari transkrip</p>
                </div>
              </button>

              <button
                onClick={() => setStudyPipelineOpen(true)}
                className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3.5 text-left transition-colors hover:bg-[var(--surface-2)] disabled:opacity-50"
              >
                <BookOpen className="h-4 w-4 shrink-0 text-zinc-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-zinc-100">Mode Belajar</p>
                  <p className="text-[10px] text-zinc-500">Bab + Kuis + Focus Timer</p>
                </div>
              </button>

              <button
                onClick={() => setContinuityOpen(true)}
                className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3.5 text-left transition-colors hover:bg-[var(--surface-2)] disabled:opacity-50"
              >
                <Zap className="h-4 w-4 shrink-0 text-zinc-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-zinc-100">Smart Continuity</p>
                  <p className="text-[10px] text-zinc-500">STT + PDF + Mindmap + Kuis auto</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Status Bar */}
        <div className="flex items-center justify-between text-xs text-zinc-600">
          <div className="flex items-center gap-1.5">
            {sttSource === 'webspeech' ? <Wifi className="h-3 w-3 text-green-500" /> : sttSource === 'screen-capture' ? <Monitor className="h-3 w-3 text-sky-500" /> : <WifiOff className="h-3 w-3 text-amber-500" />}
            <span>
              {isRecording
                ? sttSource === 'webspeech' ? 'Terhubung ke Web Speech API' : sttSource === 'screen-capture' ? 'Merekam system audio (screen)' : 'Menggunakan Groq Whisper API'
                : transcript ? `${transcript.length} karakter` : 'Siap merekam'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {sttSource === 'groq' && isRecording && !isReconnecting && (
              <span className="text-amber-500">Auto-reconnect aktif</span>
            )}

          </div>
        </div>
      </div>
      {/* Personal Dict Panel - auto-learned words management */}
      <PersonalDictPanel open={personalDictOpen} onOpenChange={setPersonalDictOpen} />

        {/* ModelSelector Popup */}
        <ModelSelector
          open={modelSelectorOpen}
          onClose={() => setModelSelectorOpen(false)}
          onModelReady={(modelId) => {
            setWhisperModelReady(true);
            toast.success('Model siap! Klik Mulai Merekam untuk mulai');
          }}
        />

        {/* Mode Belajar Pipeline */}
        <StudyPipeline
          open={studyPipelineOpen}
          onClose={() => setStudyPipelineOpen(false)}
          transcript={transcript}
        />

        {/* Analytics */}
        <WeeklyAnalytics
          open={analyticsOpen}
          onClose={() => setAnalyticsOpen(false)}
        />

        {/* Referral */}
        <ReferralPanel
          open={referralOpen}
          onClose={() => setReferralOpen(false)}
        />

        {/* Knowledge Hub */}
        <KnowledgeHub
          open={knowledgeHubOpen}
          onClose={() => setKnowledgeHubOpen(false)}
        />

        {/* Scratchpad */}
        <Scratchpad
          open={scratchpadOpen}
          onClose={() => setScratchpadOpen(false)}
        />

        {/* Smart Continuity */}
        <SmartContinuity
          open={continuityOpen}
          onClose={() => setContinuityOpen(false)}
          transcript={transcript}
        />

        {/* Quiz Battle */}
        <QuizBattle
          open={quizBattleOpen}
          onClose={() => setQuizBattleOpen(false)}
          questions={[]}
        />

    </div>
  );
}

function MethodBadge({
  label,
  active,
  loading,
  color,
  detail,
}: {
  label: string;
  active: boolean;
  loading: boolean;
  color: 'green' | 'violet' | 'amber';
  detail?: string;
}) {
  const colorClasses = {
    green: active
      ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
      : 'border-white/[0.06] text-zinc-600 bg-white/[0.02]',
    violet: active
      ? 'border-[var(--accent)]/30 text-[var(--accent-soft)] bg-[var(--accent)]/10'
      : loading
      ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
      : 'border-white/[0.06] text-zinc-600 bg-white/[0.02]',
    amber: active
      ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
      : 'border-white/[0.06] text-zinc-600 bg-white/[0.02]',
  }[color];

  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors',
      colorClasses
    )}>
      <span className={cn(
        'h-1.5 w-1.5 rounded-full',
        active ? (color === 'green' ? 'bg-emerald-400' : color === 'violet' ? 'bg-[var(--accent)]' : 'bg-amber-400') : 'bg-zinc-700',
        (active || loading) && 'animate-pulse'
      )} />
      <span>{label}</span>
      {detail && <span className="text-zinc-600">· {detail}</span>}
    </span>
  );
}
