/**
 * MediaUpload v3 — Chunked Upload + SSE Streaming Transcribe
 * - All files use chunked upload (25MB chunks, even small files = 1 chunk)
 * - SSE streaming: text appears incrementally per 1-min audio chunk
 * - File list with delete button
 * - Transcript saved to store (persists across page navigation)
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, FileAudio, FileVideo, Loader2, AlertCircle, CheckCircle2, Trash2, Clock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const ACCEPTED_FORMATS = {
  audio: [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus", ".webm"],
  video: [".mp4", ".mkv", ".avi", ".mov", ".flv", ".wmv", ".webm", ".mpg", ".mpeg", ".ts", ".m4v", ".3gp"],
};

const CHUNK_SIZE = 25 * 1024 * 1024; // 25MB per upload chunk

interface MediaUploadProps {
  onTranscript: (text: string, meta: { duration: number; processingTime: number; chunks: number; model: string }) => void;
  disabled?: boolean;
}

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "processing" | "done" | "error";
  progress: number;
  errorMsg?: string;
  currentChunk?: number;
  totalChunks?: number;
  uploadedAt: number;
}

const isVideo = (filename: string) => {
  const ext = "." + filename.split(".").pop()?.toLowerCase();
  return ACCEPTED_FORMATS.video.includes(ext);
};

const formatSize = (bytes: number) => {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
};

export function MediaUpload({ onTranscript, disabled }: MediaUploadProps) {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (disabled) return;

    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    const isAudio = ACCEPTED_FORMATS.audio.includes(ext);
    const isVid = ACCEPTED_FORMATS.video.includes(ext);
    if (!isAudio && !isVid) {
      toast.error(`Format tidak didukung: ${ext}`);
      return;
    }

    // === ALWAYS SHOW WARNING before upload ===
    const fileSizeMB = (file.size / 1024 / 1024).toFixed(1);
    const confirm = window.confirm(
      `Anda akan mengupload: ${file.name} (${fileSizeMB} MB)\n\n` +
      `Proses transkripsi di server membutuhkan waktu sekitar 1 menit per 1 menit durasi audio.\n` +
      `File yang lebih besar akan memakan waktu lebih lama.\n\n` +
      `Untuk video YouTube, gunakan fitur YouTube Transkrip (instant, tanpa proses).\n\n` +
      `Lanjut upload?`
    );
    if (!confirm) {
      return;
    }

    const fileId = crypto.randomUUID();
    setUploadedFiles(prev => [...prev, {
      id: fileId, name: file.name, size: file.size,
      status: "uploading", progress: 0, uploadedAt: Date.now(),
    }]);

    console.log(`[MediaUpload] File ${(file.size/1024/1024).toFixed(1)}MB → chunked upload + SSE transcribe`);

    const uploadJobId = crypto.randomUUID();
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    console.log(`[MediaUpload] Upload: ${totalChunks} chunk(s) of max 25MB`);

    // Phase 1: Upload all 25MB chunks (transport only)
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);
      const chunkNum = i + 1;

      setUploadedFiles(prev => prev.map(f =>
        f.id === fileId ? { ...f, status: "uploading", progress: (chunkNum / totalChunks) * 30, currentChunk: chunkNum, totalChunks } : f
      ));

      const formData = new FormData();
      formData.append("file", chunk, `chunk_${i}`);
      formData.append("language", "id");
      formData.append("chunk_index", String(i));
      formData.append("total_chunks", String(totalChunks));
      formData.append("upload_job_id", uploadJobId);

      try {
        const res = await fetch("/api/whisper/transcribe-chunk-stream", { method: "POST", body: formData });
        if (!res.ok) throw new Error(`Upload chunk ${chunkNum} failed: ${res.status}`);
        console.log(`[MediaUpload] Upload chunk ${chunkNum}/${totalChunks} done`);
      } catch (e) {
        setUploadedFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: "error", errorMsg: `Upload chunk ${chunkNum} failed` } : f));
        toast.error(`Upload chunk ${chunkNum} gagal.`);
        return;
      }
    }

    // Phase 2: Trigger transcribe (assemble + process in background)
    console.log(`[MediaUpload] All chunks uploaded. Triggering transcribe...`);
    setUploadedFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: "processing", progress: 30 } : f));
    toast.success("Upload selesai, transkripsi dimulai...");

    try {
      const triggerRes = await fetch(`/api/whisper/transcribe-chunked/${uploadJobId}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: "id" }),
      });
      if (!triggerRes.ok) throw new Error(`Trigger failed: ${triggerRes.status}`);
      const triggerData = await triggerRes.json();
      if (triggerData.status === "rejected") {
        setUploadedFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: "error", errorMsg: triggerData.error } : f));
        toast.error(triggerData.error); return;
      }

      const transcribeJobId = triggerData.job_id;
      let lastPartialLen = 0;

      // Phase 3: Poll for progress + partial text
      const pollInterval = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/whisper/jobs/${transcribeJobId}`);
          if (!pollRes.ok) return;
          const job = await pollRes.json();

          // Get latest progress message
          const progressMsgs = job.progress || [];
          const lastMsg = progressMsgs[progressMsgs.length - 1]?.msg || "";

          // Update progress based on message
          const m = lastMsg.match(/(?:chunk|sub) (\d+)\/(\d+)/i);
          if (m) {
            const current = parseInt(m[1]);
            const total = parseInt(m[2]);
            setUploadedFiles(prev => prev.map(f =>
              f.id === fileId ? { ...f, progress: 30 + (current / total) * 65, currentChunk: current, totalChunks: total, errorMsg: lastMsg } : f
            ));
          } else if (lastMsg) {
            // Show non-chunk progress messages (Assembling, Converting, etc.)
            setUploadedFiles(prev => prev.map(f =>
              f.id === fileId ? { ...f, errorMsg: lastMsg } : f
            ));
          }

          // Show new partial text
          const partial = job.partial_text || "";
          if (partial.length > lastPartialLen) {
            const newText = partial.slice(lastPartialLen).trim();
            if (newText) {
              onTranscript(newText, { duration: 0, processingTime: 0, chunks: 0, model: "large-v3-turbo" });
              lastPartialLen = partial.length;
              console.log(`[MediaUpload] New text: ${newText.length} chars (total: ${partial.length})`);
            }
          }

          if (job.status === "completed") {
            clearInterval(pollInterval);
            const finalText = job.result?.text || partial;
            if (finalText.length > lastPartialLen) {
              const remaining = finalText.slice(lastPartialLen).trim();
              if (remaining) onTranscript(remaining, { duration: 0, processingTime: 0, chunks: 0, model: "large-v3-turbo" });
            }
            setUploadedFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: "done", progress: 100, currentChunk: undefined, totalChunks: undefined, errorMsg: undefined } : f));
            toast.success(`Transkripsi selesai: ${finalText.length} karakter`);
          } else if (job.status === "failed") {
            clearInterval(pollInterval);
            setUploadedFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: "error", errorMsg: job.error } : f));
            toast.error(`Gagal: ${job.error}`);
          }
        } catch (e) { console.warn("[MediaUpload] Poll error:", e); }
      }, 3000);
    } catch (e) {
      setUploadedFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: "error", errorMsg: e instanceof Error ? e.message : "Failed" } : f));
      toast.error("Gagal memulai transkripsi.");
    }
  }, [disabled, onTranscript]);

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [disabled, handleFile]);

  const deleteFile = useCallback((fileId: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
  }, []);

  if (disabled && uploadedFiles.length === 0) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 opacity-50">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Upload className="h-4 w-4" />
          <span>Upload media (disabled while recording)</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "rounded-lg border-2 border-dashed p-4 cursor-pointer transition-all",
          isDragging ? "border-[#8B5CF6] bg-[#8B5CF6]/10" : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.04]"
        )}
      >
        <input ref={fileInputRef} type="file" accept={[...ACCEPTED_FORMATS.audio, ...ACCEPTED_FORMATS.video].join(",")} onChange={onFileInputChange} className="hidden" />
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#8B5CF6]/15">
            <Upload className="h-5 w-5 text-[#8B5CF6]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-zinc-200">Upload Audio / Video</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">Drag & drop atau klik • MP3, WAV, MP4, MKV, MOV, dll • Unlimited size</p>
          </div>
        </div>
      </div>

      {uploadedFiles.map((file) => {
        const videoIcon = isVideo(file.name);
        const isProcessing = file.status === "processing";
        const isUploading = file.status === "uploading";
        return (
          <div key={file.id} className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 space-y-2">
            <div className="flex items-center gap-3">
              <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg shrink-0", videoIcon ? "bg-sky-500/15" : "bg-emerald-500/15")}>
                {videoIcon ? <FileVideo className="h-4 w-4 text-sky-400" /> : <FileAudio className="h-4 w-4 text-emerald-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-zinc-200 truncate">{file.name}</p>
                <p className="text-[10px] text-zinc-500">
                  {formatSize(file.size)}
                  {isUploading && file.currentChunk && ` • Upload ${file.currentChunk}/${file.totalChunks}`}
                  {isProcessing && file.currentChunk && file.totalChunks && ` • Transcribe ${file.currentChunk}/${file.totalChunks}`}
                  {isProcessing && !file.currentChunk && file.errorMsg && ` • ${file.errorMsg}`}
                  {isProcessing && !file.currentChunk && !file.errorMsg && " • Menyiapkan..."}
                  {file.status === "done" && " • Selesai ✓"}
                  {file.status === "error" && ` • ${file.errorMsg}`}
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-1">
                {(isUploading || isProcessing) && <Clock className="h-3.5 w-3.5 text-amber-400" />}
                {file.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                {file.status === "error" && <AlertCircle className="h-4 w-4 text-red-400" />}
                <Button size="sm" variant="ghost" onClick={() => deleteFile(file.id)} className="h-7 w-7 p-0 text-zinc-500 hover:text-red-400 hover:bg-red-500/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {(isUploading || isProcessing) && (
              <div className="space-y-1">
                <Progress value={file.progress} className="h-1" />
                <div className="flex items-center justify-between text-[9px] text-zinc-500">
                  <span>{isUploading ? "Uploading..." : "Transcribing..."}</span>
                  <span>{Math.round(file.progress)}%</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
