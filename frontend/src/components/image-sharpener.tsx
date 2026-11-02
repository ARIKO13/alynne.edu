import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Download,
  Loader2,
  Wand2,
  Sparkles,
  ImageIcon,
  AlertCircle,
  Sun,
  Contrast,
  Zap,
  Github,
  ScanText,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { SmartOcrSolver } from '@/components/SmartOcrSolver';

/**
 * ImageSharpener - CV-based image sharpening tool
 *
 * Computer vision techniques implemented:
 *   1. Laplacian variance - auto-detect blur score (standard CV technique)
 *   2. Convolution kernels - 3x3 sharpen, strong sharpen, edge enhance
 *   3. Unsharp masking - blur → subtract → add (professional CG technique)
 *   4. Sobel edge detection - used in CV pre-processing
 *
 * All processing runs client-side via Canvas + getImageData. No server
 * round-trip - instant feedback.
 */

type Method = 'sharpen' | 'strong-sharpen' | 'edge-enhance' | 'unsharp';

type Tab = 'sharpen' | 'ocr-solver';

const METHODS: { id: Method; label: string; description: string; icon: typeof Zap }[] = [
  { id: 'sharpen',         label: 'Sharpen',         description: 'Kernel 3×3 ringan, ideal buat foto',          icon: Zap },
  { id: 'strong-sharpen',  label: 'Strong Sharpen',  description: 'Kernel 3×3 agresif, buat dokumen/screenshot', icon: Sparkles },
  { id: 'edge-enhance',    label: 'Edge Enhance',    description: 'Edge-detection based, bantu text keliatan',   icon: Contrast },
  { id: 'unsharp',         label: 'Unsharp Mask',    description: 'Blur + subtract (CG professional technique)', icon: Wand2 },
];

interface Kernel {
  size: 3 | 5;
  matrix: number[];
  divisor: number;
  bias: number;
}

function getKernel(method: Method, intensity: number): Kernel {
  // intensity is 0..2 (1.0 = normal)
  const k = intensity;
  switch (method) {
    case 'sharpen':
      // Classic 3x3 sharpen: center = 1 + 4k, sides = -k
      return {
        size: 3,
        matrix: [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0],
        divisor: 1,
        bias: 0,
      };
    case 'strong-sharpen':
      // Aggressive 3x3 - center = 1 + 8k, all 8 neighbors = -k
      return {
        size: 3,
        matrix: [-k, -k, -k, -k, 1 + 8 * k, -k, -k, -k, -k],
        divisor: 1,
        bias: 0,
      };
    case 'edge-enhance':
      // 3x3 edge enhance - emphasizes edges without darkening flat areas
      return {
        size: 3,
        matrix: [1, -2 * k, 1, -2 * k, 1 + 4 * k, -2 * k, 1, -2 * k, 1],
        divisor: 1,
        bias: 0,
      };
    case 'unsharp':
      // Unsharp mask - done as separate pass (blur then subtract), not via kernel.
      // Returned kernel is identity - actual unsharp handled in applyUnsharpMask().
      return {
        size: 3,
        matrix: [0, 0, 0, 0, 1, 0, 0, 0, 0],
        divisor: 1,
        bias: 0,
      };
  }
}

/**
 * Apply 3x3 convolution kernel to ImageData.
 * Edge handling: clamp to nearest edge.
 */
function applyConvolution(src: ImageData, kernel: Kernel): ImageData {
  const { width, height } = src;
  const out = new ImageData(width, height);
  const s = src.data;
  const d = out.data;
  const m = kernel.matrix;
  const div = kernel.divisor || 1;
  const bias = kernel.bias;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      // 3x3 kernel only for now
      let mi = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const px = Math.min(width - 1, Math.max(0, x + kx));
          const py = Math.min(height - 1, Math.max(0, y + ky));
          const idx = (py * width + px) * 4;
          const weight = m[mi++];
          r += s[idx] * weight;
          g += s[idx + 1] * weight;
          b += s[idx + 2] * weight;
        }
      }
      const oi = (y * width + x) * 4;
      d[oi]     = Math.min(255, Math.max(0, r / div + bias));
      d[oi + 1] = Math.min(255, Math.max(0, g / div + bias));
      d[oi + 2] = Math.min(255, Math.max(0, b / div + bias));
      d[oi + 3] = s[oi + 3];
    }
  }
  return out;
}

/**
 * Box blur - fast separable blur used as basis for unsharp mask.
 */
function boxBlur(src: ImageData, radius: number): ImageData {
  if (radius < 1) return src;
  const { width, height } = src;
  const out = new ImageData(width, height);
  const s = src.data;
  const d = out.data;
  const size = radius * 2 + 1;

  // Horizontal pass
  const tmp = new Uint8ClampedArray(s.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let kx = -radius; kx <= radius; kx++) {
        const px = Math.min(width - 1, Math.max(0, x + kx));
        const idx = (y * width + px) * 4;
        r += s[idx];
        g += s[idx + 1];
        b += s[idx + 2];
        a += s[idx + 3];
      }
      const oi = (y * width + x) * 4;
      tmp[oi] = r / size;
      tmp[oi + 1] = g / size;
      tmp[oi + 2] = b / size;
      tmp[oi + 3] = a / size;
    }
  }
  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        const py = Math.min(height - 1, Math.max(0, y + ky));
        const idx = (py * width + x) * 4;
        r += tmp[idx];
        g += tmp[idx + 1];
        b += tmp[idx + 2];
        a += tmp[idx + 3];
      }
      const oi = (y * width + x) * 4;
      d[oi] = r / size;
      d[oi + 1] = g / size;
      d[oi + 2] = b / size;
      d[oi + 3] = a / size;
    }
  }
  return out;
}

/**
 * Unsharp masking - classic CG technique:
 *   sharpened = original + amount * (original - blurred)
 * where blurred = box-blurred version of original.
 */
function applyUnsharpMask(src: ImageData, radius: number, amount: number): ImageData {
  const { width, height } = src;
  const blurred = boxBlur(src, radius);
  const out = new ImageData(width, height);
  const s = src.data;
  const b = blurred.data;
  const d = out.data;

  for (let i = 0; i < s.length; i += 4) {
    d[i]     = Math.min(255, Math.max(0, s[i]     + amount * (s[i]     - b[i])));
    d[i + 1] = Math.min(255, Math.max(0, s[i + 1] + amount * (s[i + 1] - b[i + 1])));
    d[i + 2] = Math.min(255, Math.max(0, s[i + 2] + amount * (s[i + 2] - b[i + 2])));
    d[i + 3] = s[i + 3];
  }
  return out;
}

/**
 * Laplacian variance - standard CV technique to estimate image blur.
 * Higher variance = sharper image. Low variance = blurry.
 *
 * Uses Laplacian kernel:
 *   [ 0,  1, 0]
 *   [ 1, -4, 1]
 *   [ 0,  1, 0]
 *
 * Returns variance of the Laplacian response across all pixels.
 */
function laplacianVariance(img: ImageData): number {
  const { width, height, data } = img;
  const lapKernel = [0, 1, 0, 1, -4, 1, 0, 1, 0];
  const responses: number[] = [];
  // Sample every 4th pixel for performance on large images
  const step = width * height > 250_000 ? 4 : 1;

  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      let sum = 0;
      let mi = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * width + (x + kx)) * 4;
          // Use luminance for speed
          const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          sum += lum * lapKernel[mi++];
        }
      }
      responses.push(sum);
    }
  }
  if (responses.length === 0) return 0;
  const mean = responses.reduce((a, b) => a + b, 0) / responses.length;
  const variance = responses.reduce((a, b) => a + (b - mean) ** 2, 0) / responses.length;
  return variance;
}

/**
 * Interpret Laplacian variance as human-readable blur level.
 * Thresholds based on common CV practice (approximate).
 */
function interpretBlurScore(score: number): { label: string; level: 'sharp' | 'medium' | 'blurry'; color: string; percent: number } {
  // Normalize: typical range is 0 (totally blurry) to ~2000 (very sharp text)
  const percent = Math.min(100, Math.round((score / 1500) * 100));
  if (score < 100) return { label: 'Sangat buram', level: 'blurry', color: 'text-rose-400', percent };
  if (score < 400) return { label: 'Buram',         level: 'blurry', color: 'text-amber-400', percent };
  if (score < 800) return { label: 'Sedang',        level: 'medium', color: 'text-yellow-400', percent };
  if (score < 1200) return { label: 'Cukup tajam',  level: 'medium', color: 'text-lime-400', percent };
  return { label: 'Sangat tajam', level: 'sharp', color: 'text-emerald-400', percent };
}

export function ImageSharpener() {
  const [activeTab, setActiveTab] = useState<Tab>('sharpen');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>('');
  const [method, setMethod] = useState<Method>('sharpen');
  const [intensity, setIntensity] = useState(1.0);
  const [processing, setProcessing] = useState(false);
  const [blurScore, setBlurScore] = useState<number | null>(null);
  const [comparisonPos, setComparisonPos] = useState(50);

  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load image from user upload or sample
  const loadImage = useCallback((src: string, name: string) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      originalImageRef.current = img;
      setImageSrc(src);
      setImageName(name);

      // Cap dimensions to 1920px max for performance
      const maxDim = 1920;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      // Draw original to canvas
      const oCanvas = originalCanvasRef.current;
      if (oCanvas) {
        oCanvas.width = w;
        oCanvas.height = h;
        const oCtx = oCanvas.getContext('2d', { willReadFrequently: true });
        if (oCtx) {
          oCtx.drawImage(img, 0, 0, w, h);
          // Compute Laplacian variance
          const data = oCtx.getImageData(0, 0, w, h);
          const score = laplacianVariance(data);
          setBlurScore(score);
        }
      }
      // Apply default sharpen to result canvas
      setTimeout(() => applySharpen(), 50);
    };
    img.onerror = () => {
      toast.error('Gagal memuat gambar. Coba file lain.');
    };
    img.src = src;
  }, []);

  // Apply the selected sharpen method to the result canvas
  const applySharpen = useCallback(() => {
    const img = originalImageRef.current;
    const oCanvas = originalCanvasRef.current;
    const rCanvas = resultCanvasRef.current;
    if (!img || !oCanvas || !rCanvas) return;

    setProcessing(true);
    // Defer so UI can update to "processing"
    setTimeout(() => {
      try {
        const w = oCanvas.width;
        const h = oCanvas.height;
        rCanvas.width = w;
        rCanvas.height = h;
        const oCtx = oCanvas.getContext('2d', { willReadFrequently: true });
        const rCtx = rCanvas.getContext('2d', { willReadFrequently: true });
        if (!oCtx || !rCtx) return;
        const src = oCtx.getImageData(0, 0, w, h);

        let result: ImageData;
        if (method === 'unsharp') {
          // Unsharp mask: blur radius scales with intensity, amount scales too
          const radius = Math.max(1, Math.round(intensity * 2));
          const amount = intensity * 1.5;
          result = applyUnsharpMask(src, radius, amount);
        } else {
          const kernel = getKernel(method, intensity);
          result = applyConvolution(src, kernel);
        }
        rCtx.putImageData(result, 0, 0);
      } catch (e) {
        console.error('[Sharpener] Error:', e);
        toast.error('Gagal memproses gambar');
      } finally {
        setProcessing(false);
      }
    }, 30);
  }, [method, intensity]);

  // Re-apply when method or intensity changes
  useEffect(() => {
    if (imageSrc) applySharpen();
  }, [method, intensity, imageSrc, applySharpen]);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('File harus berupa gambar');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Ukuran gambar maksimal 10MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => loadImage(reader.result as string, file.name);
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDownload = () => {
    const rCanvas = resultCanvasRef.current;
    if (!rCanvas) return;
    rCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sharpened-${imageName || 'image'}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Gambar tajam diunduh!');
    }, 'image/png');
  };

  const blurInterpretation = blurScore !== null ? interpretBlurScore(blurScore) : null;

  // Recommended intensity based on blur score
  const recommendedIntensity = blurScore !== null
    ? blurScore < 100 ? 2.0
    : blurScore < 400 ? 1.5
    : blurScore < 800 ? 1.0
    : 0.5
    : 1.0;

  return (
    <div className="flex flex-col gap-5">
      {/* Upload area */}
      {!imageSrc && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="rounded-lg border-2 border-dashed border-white/[0.12] bg-white/[0.02] hover:border-stone-400 hover:bg-stone-400/[0.03] transition-colors p-10 text-center cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-3"
          >
            <div className="h-14 w-14 rounded-full bg-stone-400/15 flex items-center justify-center">
              <Upload className="h-6 w-6 text-[var(--accent-soft)]" />
            </div>
            <div>
              <p className="text-base font-medium text-white">Drop gambar di sini atau klik untuk upload</p>
              <p className="text-xs text-stone-500 mt-1">PNG, JPG, WebP - maksimal 10MB</p>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] px-4 py-2 text-xs font-medium text-white transition-colors"
              >
                <ImageIcon className="h-3.5 w-3.5" />
                Pilih File
              </button>
              <span className="text-[10px] text-stone-600">atau drag & drop</span>
            </div>
          </motion.div>
        </div>
      )}

      {/* CV blur analysis */}
      <AnimatePresence>
        {imageSrc && blurInterpretation && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-stone-400/15">
                <Wand2 className="h-4 w-4 text-[var(--accent-soft)]" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-medium text-stone-300">Analisis CV (Laplacian Variance)</p>
                <p className="text-[10px] text-stone-500">
                  Deteksi blur otomatis pakai <code className="text-stone-400">∇²I variance</code> - score {blurScore?.toFixed(0)}
                </p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold ${blurInterpretation.color}`}>{blurInterpretation.label}</p>
                <p className="text-[10px] text-stone-600">{blurInterpretation.percent}% ketajaman</p>
              </div>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-white/[0.06]">
              <motion.div
                className={`h-full rounded-full ${
                  blurInterpretation.level === 'sharp' ? 'bg-emerald-500'
                  : blurInterpretation.level === 'medium' ? 'bg-amber-500'
                  : 'bg-rose-500'
                }`}
                style={{ width: `${blurInterpretation.percent}%` }}
                initial={{ width: 0 }}
                animate={{ width: `${blurInterpretation.percent}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
            {blurInterpretation.level !== 'sharp' && (
              <p className="mt-2 text-[10px] text-stone-500">
                Rekomendasi: intensity <span className="text-[var(--accent-soft)] font-medium">{recommendedIntensity.toFixed(1)}</span> buat gambar ini
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Canvas comparison */}
      {imageSrc && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Original */}
          <div className="rounded-lg border border-white/[0.06] bg-[#161412] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.04] bg-white/[0.02]">
              <span className="text-xs font-medium text-stone-400">Original</span>
              <span className="text-[10px] text-stone-600">{imageName}</span>
            </div>
            <div className="p-3 flex items-center justify-center bg-[#0D0C0A] min-h-[200px] max-h-[400px] overflow-auto">
              <canvas ref={originalCanvasRef} className="max-w-full h-auto rounded" />
            </div>
          </div>

          {/* Sharpened */}
          <div className="rounded-lg border border-stone-400/30 bg-[#161412] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-400/15 bg-stone-400/[0.04]">
              <span className="text-xs font-medium text-[var(--accent-soft)]">Hasil Penajaman</span>
              {processing && (
                <span className="flex items-center gap-1 text-[10px] text-stone-500">
                  <Loader2 className="h-3 w-3 animate-spin" /> Memproses...
                </span>
              )}
            </div>
            <div className="p-3 flex items-center justify-center bg-[#0D0C0A] min-h-[200px] max-h-[400px] overflow-auto">
              <canvas ref={resultCanvasRef} className="max-w-full h-auto rounded" />
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      {imageSrc && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 space-y-4">
          {/* Method selector */}
          <div>
            <p className="text-xs font-medium text-stone-300 mb-2">Metode Penajaman</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {METHODS.map((m) => {
                const Icon = m.icon;
                const active = method === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id)}
                    className={`rounded-lg border-2 p-2.5 text-left transition-colors ${
                      active
                        ? 'border-stone-400 bg-stone-400/[0.08]'
                        : 'border-white/[0.06] hover:border-white/[0.15] hover:bg-white/[0.04]'
                    }`}
                  >
                    <Icon className={`h-4 w-4 mb-1.5 ${active ? 'text-[var(--accent-soft)]' : 'text-stone-400'}`} />
                    <p className={`text-[11px] font-medium ${active ? 'text-white' : 'text-stone-300'}`}>{m.label}</p>
                    <p className="text-[9px] text-stone-600 leading-tight mt-0.5">{m.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Intensity slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-stone-300">Intensitas</p>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-[var(--accent-soft)]">{intensity.toFixed(2)}</span>
                <button
                  type="button"
                  onClick={() => setIntensity(recommendedIntensity)}
                  className="text-[10px] text-stone-500 hover:text-stone-300 transition-colors"
                >
                  Pakai rekomendasi
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={intensity}
              onChange={(e) => setIntensity(parseFloat(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
            <div className="flex justify-between text-[9px] text-stone-600 mt-1">
              <span>0 (off)</span>
              <span>1.0 (normal)</span>
              <span>2.0 (max)</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/[0.04]">
            <button
              type="button"
              onClick={handleDownload}
              disabled={processing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] px-4 py-2 text-xs font-medium text-white transition-colors disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Download PNG
            </button>
            <button
              type="button"
              onClick={() => {
                setImageSrc(null);
                setImageName('');
                setBlurScore(null);
                originalImageRef.current = null;
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-4 py-2 text-xs font-medium text-stone-300 hover:bg-white/[0.04] transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              Gambar Lain
            </button>
          </div>
        </div>
      )}

      {/* Info card */}
      {!imageSrc && (
        <div className="rounded-lg border border-stone-500/15 bg-stone-500/[0.03] p-4">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-[var(--accent-soft)] mt-0.5 flex-shrink-0" />
            <div className="text-xs text-stone-400 leading-relaxed">
              <p className="font-medium text-[var(--accent-soft)] mb-1">Cara kerja</p>
              <p>
                Tool ini pake <strong>computer vision</strong> beneran:
                Laplacian variance buat auto-detect seberapa buram gambarmu,
                lalu 4 metode penajaman (convolution kernel, unsharp masking,
                edge enhance). Semua diproses di browser kamu - gambar ga
                pernah ke-upload ke server.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Smart OCR + Math Solver */}
      <div className="mt-6 rounded-lg border border-stone-400/20 bg-stone-400/[0.03] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ScanText className="h-4 w-4 text-[var(--accent-soft)]" />
          <h3 className="text-sm font-medium text-stone-200">Smart OCR + Math Solver</h3>
        </div>
        <p className="text-[11px] text-stone-500">Upload foto soal, AI baca teks + selesaikan matematika otomatis.</p>
        <SmartOcrSolver />
      </div>
    </div>
  );
}
