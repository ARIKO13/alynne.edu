/**
 * SmartOcrSolver.tsx — OCR + Math Solver from images
 *
 * Upload/foto soal → OCR (tesseract.js) → extract math → solve
 *
 * Pipeline:
 *   1. User upload foto atau capture dari webcam
 *   2. Tesseract.js OCR (Indonesian + English)
 *   3. Extract math expressions from text
 *   4. Solve each expression (arithmetic, equation, quadratic)
 *   5. Display results with steps
 */

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Upload,
  Camera,
  Loader2,
  ScanText,
  Calculator,
  FileText,
  Copy,
  Check,
  X,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { extractMathExpressions, solveExpression, type MathSolution } from '@/lib/math-solver';

interface SmartOcrSolverProps {
  // If image provided externally, use it
  initialImage?: string | null;
}

export function SmartOcrSolver({ initialImage }: SmartOcrSolverProps) {
  const [image, setImage] = useState<string | null>(initialImage || null);
  const [ocrText, setOcrText] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [solutions, setSolutions] = useState<MathSolution[]>([]);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);

  const handleFileUpload = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('File harus gambar');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setImage(e.target?.result as string);
      setOcrText('');
      setSolutions([]);
    };
    reader.readAsDataURL(file);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch (err) {
      toast.error('Tidak bisa akses kamera: ' + (err as Error).message);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    setImage(dataUrl);
    setOcrText('');
    setSolutions([]);
    stopCamera();
  }, [stopCamera]);

  const runOCR = useCallback(async () => {
    if (!image) return;
    setOcrLoading(true);
    setOcrText('');
    setSolutions([]);

    try {
      // Dynamic import tesseract.js
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker(['ind', 'eng']);

      const result = await worker.recognize(image);
      const text = result.data.text || '';
      setOcrText(text);

      await worker.terminate();

      // Extract and solve math expressions
      const expressions = extractMathExpressions(text);
      const solved: MathSolution[] = [];

      for (const expr of expressions) {
        const sol = solveExpression(expr);
        if (sol) solved.push(sol);
      }

      setSolutions(solved);

      if (solved.length > 0) {
        toast.success(`Ditemukan ${solved.length} solusi matematika!`);
      } else if (expressions.length > 0) {
        toast.info(`${expressions.length} ekspresi terdeteksi tapi tidak bisa dipecahkan`);
      } else {
        toast.info('OCR selesai, tidak ada ekspresi matematika terdeteksi');
      }
    } catch (err) {
      console.error('[OCR] Error:', err);
      toast.error('OCR gagal: ' + (err as Error).message);
    } finally {
      setOcrLoading(false);
    }
  }, [image]);

  const handleCopyText = () => {
    navigator.clipboard.writeText(ocrText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Teks disalin!');
  };

  return (
    <div className="space-y-4">
      {/* Upload + Camera buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => fileInputRef.current?.click()}
          variant="outline"
          size="sm"
          className="border-white/[0.08] text-zinc-300"
        >
          <Upload className="h-4 w-4 mr-2" />
          Upload Foto
        </Button>
        {!cameraActive ? (
          <Button onClick={startCamera} variant="outline" size="sm" className="border-white/[0.08] text-zinc-300">
            <Camera className="h-4 w-4 mr-2" />
            Buka Kamera
          </Button>
        ) : (
          <>
            <Button onClick={capturePhoto} size="sm" className="bg-[#8B5CF6] hover:bg-[#7C3AED]">
              <Camera className="h-4 w-4 mr-2" />
              Foto
            </Button>
            <Button onClick={stopCamera} variant="outline" size="sm" className="border-red-500/30 text-red-400">
              <X className="h-4 w-4 mr-2" />
              Tutup
            </Button>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file);
          }}
        />
      </div>

      {/* Camera preview */}
      {cameraActive && (
        <div className="rounded-lg overflow-hidden border border-white/[0.08]">
          <video ref={videoRef} autoPlay playsInline className="w-full max-h-64 object-contain bg-black" />
        </div>
      )}

      {/* Image preview */}
      {image && !cameraActive && (
        <div className="rounded-lg overflow-hidden border border-white/[0.08] relative">
          <img src={image} alt="Uploaded" className="w-full max-h-64 object-contain bg-black" />
          <Button
            onClick={() => {
              setImage(null);
              setOcrText('');
              setSolutions([]);
            }}
            size="sm"
            variant="outline"
            className="absolute top-2 right-2 border-red-500/30 text-red-400 bg-zinc-900/80"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Run OCR button */}
      {image && !cameraActive && (
        <Button
          onClick={runOCR}
          disabled={ocrLoading}
          className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED]"
        >
          {ocrLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              OCR berjalan...
            </>
          ) : (
            <>
              <ScanText className="h-4 w-4 mr-2" />
              Jalankan OCR + Math Solver
            </>
          )}
        </Button>
      )}

      {/* OCR Result */}
      {ocrText && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-zinc-400" />
              <span className="text-sm font-medium text-zinc-300">Hasil OCR ({ocrText.length} karakter)</span>
            </div>
            <Button onClick={handleCopyText} size="sm" variant="ghost" className="text-zinc-400">
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 max-h-40 overflow-y-auto">
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono">{ocrText}</pre>
          </div>
        </div>
      )}

      {/* Math Solutions */}
      {solutions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-[#8B5CF6]" />
            <span className="text-sm font-medium text-zinc-300">
              Solusi Matematika ({solutions.length})
            </span>
            <Badge variant="outline" className="text-[10px] border-[#8B5CF6]/30 text-[#8B5CF6] ml-auto">
              <Sparkles className="h-3 w-3 mr-1" />
              AI Solved
            </Badge>
          </div>
          {solutions.map((sol, i) => (
            <div
              key={i}
              className="rounded-lg border border-[#8B5CF6]/20 bg-[#8B5CF6]/[0.05] p-4 space-y-2"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-xs text-zinc-500 mb-1">Soal #{i + 1}</p>
                  <p className="text-sm font-mono text-zinc-300">{sol.expression}</p>
                </div>
                <Badge
                  variant="outline"
                  className={`text-[10px] ml-2 ${
                    sol.type === 'quadratic'
                      ? 'border-amber-500/30 text-amber-400'
                      : sol.type === 'equation'
                      ? 'border-blue-500/30 text-blue-400'
                      : 'border-green-500/30 text-green-400'
                  }`}
                >
                  {sol.type}
                </Badge>
              </div>
              <div className="rounded-md bg-zinc-900/50 p-2">
                <p className="text-[10px] text-zinc-500 mb-1">Jawaban:</p>
                <p className="text-lg font-bold text-[#8B5CF6] font-mono">{sol.result}</p>
              </div>
              {sol.steps.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] text-zinc-500 uppercase">Langkah:</p>
                  {sol.steps.map((step, j) => (
                    <p key={j} className="text-[11px] text-zinc-400 font-mono pl-2">
                      {j + 1}. {step}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
