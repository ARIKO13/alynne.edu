/**
 * DocumentUpload.tsx  -  Upload file APAPUN → server konversi → text → masuk transcript
 *
 * Server /api/stt/convert-file pakai:
 *   - pdftotext (PDF)
 *   - libreoffice (DOCX/DOC/ODT/RTF → txt; PPTX/PPT → pdf → pdftotext; XLSX/XLS → csv)
 *   - pandoc (HTML/EPUB → plain text)
 *   - tesseract OCR (gambar: JPG/PNG/TIFF/BMP/WEBP/GIF; juga PDF scanned)
 *
 * Setelah text didapat, langsung di-append ke transcript (sama seperti YouTubeTranscript),
 * lalu user bisa klik "Mode Belajar" → StudyPipeline akan preSummarize(text).
 *
 * Limit: 50MB. Ekstensi yang didukung lihat ACCEPTED_EXTS.
 */
import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, AlertCircle, CheckCircle2, Trash2, UploadCloud, FileImage, FileType } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface DocumentUploadProps {
  /** Dipanggil saat text berhasil diekstrak. Memiliki signature sama dengan YouTubeTranscript.onTranscript supaya bisa langsung ditukar. */
  onText: (text: string, meta: { fileName: string; method: string; pageCount?: number; charCount: number }) => void;
  disabled?: boolean;
}

const ACCEPTED_EXTS = [
  "pdf", "docx", "doc", "odt", "rtf",
  "pptx", "ppt", "odp",
  "xlsx", "xls", "ods", "csv",
  "txt", "md", "json", "xml", "yaml", "yml", "log",
  "html", "htm", "xhtml", "epub",
  "jpg", "jpeg", "png", "tif", "tiff", "bmp", "webp", "gif",
];

const MAX_SIZE = 50 * 1024 * 1024;  // 50 MB

const METHOD_LABEL: Record<string, string> = {
  "direct-read": "Baca langsung",
  "pdftotext": "PDF → teks (poppler)",
  "pdf-ocr": "PDF → OCR (tesseract)",
  "tesseract-ocr": "Gambar → OCR (tesseract)",
  "tesseract-ocr-eng-only": "Gambar → OCR (English)",
  "libreoffice-txt": "Office → teks (LibreOffice)",
  "libreoffice-csv": "Sheet → CSV (LibreOffice)",
  "libreoffice-pdf+pdftotext": "Slide → PDF → teks",
  "pandoc": "Pandoc",
};

interface Result {
  fileName: string;
  method: string;
  charCount: number;
  pageCount?: number;
  elapsedMs?: number;
}

export function DocumentUpload({ onText, disabled }: DocumentUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((selected: File) => {
    setError(null);
    setResult(null);

    const ext = (selected.name.split(".").pop() || "").toLowerCase();
    if (!ACCEPTED_EXTS.includes(ext)) {
      const e = `Format .${ext} belum didukung. Coba: ${ACCEPTED_EXTS.slice(0, 10).map(e => "." + e).join(", ")}…`;
      setError(e);
      toast.error(e);
      return;
    }
    if (selected.size > MAX_SIZE) {
      const e = `File terlalu besar (${(selected.size / 1024 / 1024).toFixed(1)} MB). Maks 50 MB.`;
      setError(e);
      toast.error(e);
      return;
    }
    setFile(selected);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled || loading) return;
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, [disabled, loading, handleFile]);

  const convert = async () => {
    if (!file || disabled || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/stt/convert-file", {
        method: "POST",
        body: fd,
        signal: AbortSignal.timeout(120_000),  // server timeout 90s + buffer
      });

      const data = await res.json();

      if (!res.ok || !data.text) {
        const errMsg = data.error || `HTTP ${res.status}`;
        setError(errMsg);
        toast.error(`Konversi gagal: ${errMsg.slice(0, 100)}`);
        return;
      }

      const meta = {
        fileName: file.name,
        method: data.method || "unknown",
        charCount: data.charCount || data.text.length,
        pageCount: data.pageCount,
      };
      onText(data.text, meta);
      setResult({
        fileName: file.name,
        method: meta.method,
        charCount: meta.charCount,
        pageCount: meta.pageCount,
        elapsedMs: data.elapsedMs,
      });
      const label = METHOD_LABEL[meta.method] || meta.method;
      toast.success(`${meta.charCount.toLocaleString()} karakter • ${label}`);
    } catch (e: any) {
      console.error("[DocumentUpload] error:", e);
      const msg = e?.name === "TimeoutError"
        ? "Konversi timeout (>120s). File mungkin terlalu besar."
        : (e?.message || "Gagal konversi");
      setError(msg);
      toast.error(msg.slice(0, 100));
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setFile(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const ext = file ? (file.name.split(".").pop() || "").toLowerCase() : "";
  const icon = ext === "pdf" || ["docx", "doc", "odt", "rtf"].includes(ext)
    ? <FileType className="h-5 w-5 text-red-400" />
    : ["jpg", "jpeg", "png", "tif", "tiff", "bmp", "webp", "gif"].includes(ext)
    ? <FileImage className="h-5 w-5 text-emerald-400" />
    : <FileText className="h-5 w-5 text-[var(--accent-soft)]" />;

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-[var(--accent-soft)]" />
        <p className="text-sm font-medium text-stone-200">Upload Dokumen</p>
        <span className="text-[10px] text-stone-600 ml-auto">PDF • Office • Gambar • EPUB</span>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !disabled && !loading && inputRef.current?.click()}
        className={cn(
          "rounded-lg border border-dashed p-4 cursor-pointer transition-colors",
          dragOver
            ? "border-teal-400/50 bg-teal-500/[0.06]"
            : "border-white/[0.08] bg-white/[0.02] hover:border-teal-400/30 hover:bg-teal-500/[0.03]",
          (disabled || loading) && "opacity-50 cursor-not-allowed"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTS.map(e => "." + e).join(",")}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          disabled={disabled || loading}
          className="hidden"
        />
        {file ? (
          <div className="flex items-center gap-2.5">
            {icon}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-stone-200 truncate">{file.name}</p>
              <p className="text-[10px] text-stone-500">
                {(file.size / 1024).toFixed(0)} KB • .{ext}
              </p>
            </div>
            {!loading && !result && (
              <button
                onClick={(e) => { e.stopPropagation(); clear(); }}
                className="text-stone-600 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-1">
            <UploadCloud className="h-4 w-4 text-stone-500" />
            <p className="text-xs text-stone-400">
              Drag & drop atau <span className="text-[var(--accent-soft)]">klik untuk pilih file</span>
            </p>
          </div>
        )}
      </div>

      {/* Convert button */}
      {file && !result && (
        <Button
          onClick={convert}
          size="sm"
          disabled={disabled || loading || !!error}
          className="w-full bg-teal-500/15 text-[var(--accent-soft)] hover:bg-teal-500/25 border-teal-500/20"
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              Mengkonversi...
            </>
          ) : (
            <>
              <FileText className="h-3.5 w-3.5 mr-1" />
              Konversi ke Teks
            </>
          )}
        </Button>
      )}

      {/* Result */}
      {result && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.03] p-2.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-emerald-300/80">
              {result.charCount.toLocaleString()} karakter
              {result.pageCount ? ` • ${result.pageCount} halaman` : ""}
              {result.elapsedMs ? ` • ${(result.elapsedMs / 1000).toFixed(1)}s` : ""}
            </p>
            <p className="text-[10px] text-emerald-400/60">
              {METHOD_LABEL[result.method] || result.method}
            </p>
          </div>
          <button onClick={clear} className="text-stone-600 hover:text-red-400">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/15 bg-red-500/[0.03] p-2.5">
          <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-red-300/80 leading-relaxed">{error}</p>
        </div>
      )}

      <p className="text-[9px] text-stone-600 leading-relaxed">
        PDF/DOCX/PPTX/XLSX langsung diekstrak. Gambar & PDF scan via OCR (tesseract).
        Maks 50 MB. Hasil teks masuk transkrip  -  klik <strong className="text-stone-400">Mode Belajar</strong> untuk generate modul.
      </p>
    </div>
  );
}
