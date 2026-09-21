import { useSpeechRecognition } from '@/hooks/use-speech-recognition';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AudioVisualizer } from '@/components/audio-visualizer';
import { PersonalDictPanel } from '@/components/personal-dict-panel';
import {
  Mic, MicOff, Wifi, WifiOff, RefreshCw, Trash2, AlertCircle, Radio,
  FileText, Loader2, Rocket, Sparkles, Upload, Monitor, MonitorUp, Brain,
} from 'lucide-react';
import { MaterialUpload } from '@/components/material-upload';
import { YouTubeTranscript } from '@/components/youtube-transcript';
import { cn } from '@/lib/utils';
import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { structureContent, generatePdf } from '@/lib/pdf-generator';
import { fetchLearnedWords } from '@/lib/personal-dict';
import { ModelSelector } from '@/components/ModelSelector';
import { FileUploadChunked } from '@/components/FileUploadChunked';
import { useWhisperSTT } from '@/hooks/use-whisper-stt';

function ModeSelector({ disabled }: { disabled: boolean }) {
  const { sttAudioMode, setSttAudioMode } = useAppStore();

  // Mobile detection: no screen share + limited Web Speech API
  // On mobile, we hide mic/screen modes entirely — only upload + YouTube shown
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
      label: 'Entire Screen',
      desc: 'Zoom + Mic (hybrid)',
      icon: MonitorUp,
    }] : []),
  ];

  // Mobile: hide mode selector entirely
  if (isMobile) {
    return (
      <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.03] p-3">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
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
              'flex-1 flex items-center gap-2.5 rounded-lg border p-3 text-left transition-all duration-200',
              disabled && 'opacity-50 cursor-not-allowed',
              isActive
                ? 'border-[#8B5CF6]/40 bg-[#8B5CF6]/10'
                : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'
            )}
          >
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                isActive ? 'bg-[#8B5CF6]/20' : 'bg-white/[0.05]'
              )}
            >
              <Icon
                className={cn('h-4 w-4 transition-colors', isActive ? 'text-[#8B5CF6]' : 'text-zinc-500')}
              />
            </div>
            <div className="min-w-0">
              <p className={cn('text-xs font-medium transition-colors', isActive ? 'text-white' : 'text-zinc-400')}>
                {mode.label}
              </p>
              <p className={cn('text-[10px] transition-colors', isActive ? 'text-[#8B5CF6]/70' : 'text-zinc-600')}>
                {mode.desc}
              </p>
            </div>
            {isActive && (
              <div className="ml-auto h-2 w-2 rounded-full bg-[#8B5CF6] shrink-0" />
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
  const { transcriptEntries, sttAudioMode } = useAppStore();
  const [pdfLoading, setPdfLoading] = useState(false);
  const { setActiveTab } = useAppStore();
  const [personalDictOpen, setPersonalDictOpen] = useState(false);
  const [personalDictCount, setPersonalDictCount] = useState(0);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [whisperModelReady, setWhisperModelReady] = useState(false);
  const isRecording = sttStatus === 'recording';
  const isProcessing = sttStatus === 'processing';
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
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
        <h3 className="text-sm font-medium text-zinc-200">Speech to Text</h3>
        <div className="flex items-center gap-2">
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
            const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim());
            useAppStore.getState().appendTranscriptBatch(sentences);
            toast.success(`Transkrip YouTube: ${text.length} karakter (${meta.duration} detik)`);
          }}
        />

        {/* Screen mode hint */}
        {isScreenMode && !isRecording && (
          <div className="flex items-start gap-2.5 rounded-lg border border-sky-500/15 bg-sky-500/[0.03] p-3">
            <MonitorUp className="h-4 w-4 text-sky-400 mt-0.5 shrink-0" />
            <div className="text-xs text-sky-300/80 leading-relaxed">
              <p className="font-medium text-sky-300 mb-0.5">Mode Entire Screen</p>
              <p>Pilih <strong>"Entire Screen"</strong> di browser picker, lalu <strong>centang "Share system audio"</strong>. Suara dari YouTube, Zoom, Meet, dsb akan ditranskrip otomatis.</p>
            </div>
          </div>
        )}

        {!webspeechSupported && !isScreenMode && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Browser ini tidak mendukung Web Speech API. Groq API akan digunakan sebagai fallback.</span>
          </div>
        )}
        {sttError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{sttError}</span>
          </div>
        )}
        {sttWarning && !sttError && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{sttWarning}</span>
          </div>
        )}

        {/* Audio Visualizer */}
        {isRecording && <AudioVisualizer audioLevels={audioLevels} isListening={sttSource === 'webspeech'} />}

        {/* Combined Methods Indicator — shown when Entire Screen capture is active */}
        {isCombinedActive && (
          <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.04] p-3">
            <div className="flex items-center gap-2 mb-2">
              <MonitorUp className="h-3.5 w-3.5 text-sky-400" />
              <p className="text-xs font-medium text-sky-300">Combined Methods aktif</p>
              <span className="text-[10px] text-zinc-600 ml-auto">Entire Screen mode</span>
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
              <p className="mt-2 text-[10px] text-rose-400">⚠ {screenCv.error}</p>
            )}
          </div>
        )}

        {/* Transcript Area — Timestamped */}
        <div className="relative rounded-lg border border-white/[0.06] bg-[#0c0c0e] overflow-hidden">
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
                  ? isWhisperProcessing ? 'Memperbaiki teks dengan faster-whisper...' : isGroqProcessing ? 'Mentranskripsi...' : sttSource === 'webspeech' ? 'Web Speech API — coba bicara...' : sttSource === 'screen-capture' ? 'Merekam layar + audio...' : 'Mendengarkan...'
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
                <span className="flex items-center gap-1 text-[10px] text-violet-400">
                  <Sparkles className="h-3 w-3 animate-pulse" />
                  AI memperbaiki
                </span>
              )}
              {isWhisperProcessing && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  faster-whisper presisi...
                </span>
              )}
              {isRecording && <span className="text-xs font-medium text-red-400">REC</span>}
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
                  <span className="text-[#8B5CF6] shrink-0 pt-0.5 select-none">●</span>
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
            {/* Interim preview DISABLED — user request: "tampilin apa adanya aja"
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
            onClick={toggleRecording}
            disabled={isProcessing}
            size="lg"
            className={cn(
              'flex-1 gap-2 transition-all rounded-lg font-medium',
              isRecording
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : isScreenMode
                ? 'bg-sky-600 hover:bg-sky-700 text-white'
                : 'bg-[#8B5CF6] hover:bg-[#d14e1c] text-white'
            )}
          >
            {isProcessing ? <RefreshCw className="h-5 w-5 animate-spin" /> : isRecording ? <MicOff className="h-5 w-5" /> : isScreenMode ? <MonitorUp className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            {isProcessing ? 'Memproses...' : isRecording ? 'Stop Recording' : isScreenMode ? 'Start Screen Capture' : 'Start Recording'}
          </Button>
          {transcript && (
            <Button onClick={clearTranscript} disabled={isRecording || isProcessing} variant="outline" size="lg" className="gap-2 rounded-lg border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]">
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Clear</span>
            </Button>
          )}
        </div>

        {/* Material Upload — always visible */}
        <div className="rounded-xl border border-sky-500/10 bg-sky-500/[0.02] overflow-hidden">
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
          <div className="space-y-3 rounded-xl border border-[#8B5CF6]/20 bg-[#8B5CF6]/[0.03] p-4">
            <div className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-[#8B5CF6]" />
              <span className="text-sm font-medium text-zinc-200">Apa yang mau kamu lakukan?</span>
              <Badge variant="outline" className="text-[10px] ml-auto border-white/[0.08] text-zinc-500">{transcript.length} karakter</Badge>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {/* Card: Modul PDF */}
              <button
                onClick={generatePDFCombined}
                disabled={pdfLoading}
                className="flex items-center gap-3 rounded-lg border border-violet-500/20 bg-violet-500/[0.06] p-3.5 text-left transition-all hover:border-violet-500/40 hover:bg-violet-500/10 disabled:opacity-50"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15">
                  {pdfLoading ? <Loader2 className="h-4.5 w-4.5 text-violet-400 animate-spin" /> : <FileText className="h-4.5 w-4.5 text-violet-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-violet-300">Buat Modul PDF</p>
                  <p className="text-[10px] text-violet-400/60">Generate modul belajar dari transkrip</p>
                </div>
              </button>

              {/* Card: Langsung ke Modul */}
              <button
                onClick={generatePDFCombined}
                disabled={pdfLoading}
                className="flex items-center gap-3 rounded-lg border border-[#8B5CF6]/20 bg-[#8B5CF6]/[0.06] p-3.5 text-left transition-all hover:border-[#8B5CF6]/40 hover:bg-[#8B5CF6]/10 disabled:opacity-50"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#8B5CF6]/15">
                  {pdfLoading ? <Loader2 className="h-4.5 w-4.5 text-[#8B5CF6] animate-spin" /> : <Rocket className="h-4.5 w-4.5 text-[#8B5CF6]" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[#8B5CF6]">Generate Langsung</p>
                  <p className="text-[10px] text-[#8B5CF6]/60">STT + PDF sekaligus</p>
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
            {/* Personal Dict button — auto-learned words */}
            <button
              onClick={() => setPersonalDictOpen(true)}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#8B5CF6]/15 bg-[#8B5CF6]/[0.03] hover:bg-[#8B5CF6]/10 text-zinc-400 hover:text-[#8B5CF6] transition-colors text-[11px]"
              title="Personal Dictionary — kata yang dipelajari otomatis dari STT"
            >
              <Brain className="h-3 w-3" />
              <span>Personal Dict</span>
              {personalDictCount > 0 && (
                <Badge className="bg-[#8B5CF6]/20 text-[#8B5CF6] border-[#8B5CF6]/30 text-[9px] px-1 py-0">
                  {personalDictCount}
                </Badge>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Personal Dict Panel — auto-learned words management */}
      <PersonalDictPanel open={personalDictOpen} onOpenChange={setPersonalDictOpen} />

        {/* ModelSelector Popup */}
        <ModelSelector
          open={m[modelSelectorOpen}
          onClose={() => setM[modelSelectorOpen(false)}
          onModelReady={(modelId) => {
            setWhisperModelReady(true);
            console.log('[STT] Whisper model ready:', modelId);
          }}
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
      ? 'border-[#8B5CF6]/30 text-[#8B5CF6] bg-[#8B5CF6]/10'
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
        active ? (color === 'green' ? 'bg-emerald-400' : color === 'violet' ? 'bg-[#8B5CF6]' : 'bg-amber-400') : 'bg-zinc-700',
        (active || loading) && 'animate-pulse'
      )} />
      <span>{label}</span>
      {detail && <span className="text-zinc-600">· {detail}</span>}
    </span>
  );
}
