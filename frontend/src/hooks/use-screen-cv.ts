'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useScreenCv - Combined OCR + Computer Vision for screen capture.
 *
 * When the user enables "Entire Screen" STT mode, this hook samples frames
 * from the display stream and runs two pipelines in parallel:
 *
 *   1. OCR (tesseract.js) - extracts text from screen frames every 5s
 *      (e.g., text on slides, code editors, documents).
 *
 *   2. Frame diff (Computer Vision) - samples every 1s, computes pixel
 *      difference with previous frame, detects slide changes.
 *
 * Both pipelines downscale frames for performance (max 1280px wide for OCR,
 * 320x180 for frame diff) and run off the main thread (OCR uses tesseract's
 * Web Worker; diff runs in a 1s setInterval but the work is tiny).
 *
 * Refs:
 *   - tesseract.js v7 API: createWorker(langs) → worker.recognize(canvas)
 *   - Laplacian/variance CV techniques: see also image-sharpener.tsx
 */

interface UseScreenCvOptions {
  /** Called when OCR extracts new (deduplicated) text from a frame */
  onOcrText?: (text: string, confidence: number) => void;
  /** Called when frame diff detects a slide change */
  onSlideChange?: (diffPercent: number) => void;
  /** OCR sampling interval (default 5000ms) */
  ocrIntervalMs?: number;
  /** Frame diff sampling interval (default 1000ms) */
  diffIntervalMs?: number;
  /** Slide change threshold - fraction of pixels that must change (default 0.15 = 15%) */
  diffThreshold?: number;
  /** Language codes for tesseract (default Indonesian + English) */
  ocrLanguages?: string[];
}

interface UseScreenCvReturn {
  start: (stream: MediaStream) => Promise<void>;
  stop: () => void;
  isOcrProcessing: boolean;
  isModelLoading: boolean;
  modelProgress: number; // 0..1
  lastOcrAt: number | null;
  lastSlideChangeAt: number | null;
  slideChangeCount: number;
  ocrChunkCount: number;
  error: string | null;
}

export function useScreenCv(options: UseScreenCvOptions = {}): UseScreenCvReturn {
  const {
    onOcrText,
    onSlideChange,
    ocrIntervalMs = 5000,
    diffIntervalMs = 1000,
    diffThreshold = 0.15,
    ocrLanguages = ['ind', 'eng'],
  } = options;

  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [lastOcrAt, setLastOcrAt] = useState<number | null>(null);
  const [lastSlideChangeAt, setLastSlideChangeAt] = useState<number | null>(null);
  const [slideChangeCount, setSlideChangeCount] = useState(0);
  const [ocrChunkCount, setOcrChunkCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Refs for things that shouldn't trigger re-renders
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ocrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<any | null>(null);
  const ocrIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const diffIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFrameDataRef = useRef<Uint8ClampedArray | null>(null);
  const lastOcrTextRef = useRef<string>('');

  // Keep latest callbacks without re-creating intervals
  const callbacksRef = useRef({ onOcrText, onSlideChange });
  useEffect(() => {
    callbacksRef.current = { onOcrText, onSlideChange };
  }, [onOcrText, onSlideChange]);

  const stop = useCallback(() => {
    if (ocrIntervalRef.current) {
      clearInterval(ocrIntervalRef.current);
      ocrIntervalRef.current = null;
    }
    if (diffIntervalRef.current) {
      clearInterval(diffIntervalRef.current);
      diffIntervalRef.current = null;
    }
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch {}
      try { videoRef.current.srcObject = null; } catch {}
      videoRef.current = null;
    }
    if (workerRef.current) {
      try { workerRef.current.terminate(); } catch {}
      workerRef.current = null;
    }
    ocrCanvasRef.current = null;
    diffCanvasRef.current = null;
    lastFrameDataRef.current = null;
    lastOcrTextRef.current = '';
    setIsOcrProcessing(false);
    setIsModelLoading(false);
  }, []);

  const start = useCallback(
    async (stream: MediaStream) => {
      setError(null);
      setOcrChunkCount(0);
      setSlideChangeCount(0);

      // Get video track
      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length === 0) {
        setError('No video track in stream, OCR/CV unavailable');
        return;
      }

      try {
        // Create hidden video element to draw frames from
        const video = document.createElement('video');
        video.srcObject = new MediaStream(videoTracks);
        video.muted = true;
        video.playsInline = true;
        await video.play();
        videoRef.current = video;

        // Create canvases for frame sampling
        ocrCanvasRef.current = document.createElement('canvas');
        diffCanvasRef.current = document.createElement('canvas');

        // === Load tesseract.js worker (downloads model on first use) ===
        setIsModelLoading(true);
        setModelProgress(0);
        const Tesseract = await import('tesseract.js');
        const worker = await Tesseract.createWorker(ocrLanguages, 1, {
          logger: (m: any) => {
            if (m.status === 'recognizing text') {
              setModelProgress(m.progress);
            } else if (m.status === 'loading language traineddata') {
              setModelProgress(m.progress);
            }
          },
        });
        workerRef.current = worker;
        setIsModelLoading(false);
        setModelProgress(1);

        // === OCR pipeline - every N ms, capture frame + recognize text ===
        ocrIntervalRef.current = setInterval(async () => {
          const canvas = ocrCanvasRef.current;
          const vid = videoRef.current;
          const w = workerRef.current;
          if (!canvas || !vid || !w) return;
          if (vid.videoWidth === 0 || vid.videoHeight === 0) return;

          // Downscale for performance (max 1280px wide)
          const maxW = 1280;
          const scale = Math.min(1, maxW / vid.videoWidth);
          canvas.width = Math.round(vid.videoWidth * scale);
          canvas.height = Math.round(vid.videoHeight * scale);
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);

          setIsOcrProcessing(true);
          try {
            const result = await w.recognize(canvas);
            const text: string = (result?.data?.text || '').trim();
            const conf: number = result?.data?.confidence ?? 0;

            // Deduplicate: skip if same as last OCR text
            if (text && text.length > 8 && text !== lastOcrTextRef.current) {
              // Normalize whitespace
              const clean = text.replace(/\s+/g, ' ').trim();
              if (clean && clean !== lastOcrTextRef.current) {
                lastOcrTextRef.current = clean;
                setLastOcrAt(Date.now());
                setOcrChunkCount((n) => n + 1);
                callbacksRef.current.onOcrText?.(clean, conf);
              }
            }
          } catch (e) {
            console.warn('[ScreenCV] OCR error:', e);
          } finally {
            setIsOcrProcessing(false);
          }
        }, ocrIntervalMs);

        // === Frame diff (CV) pipeline - every 1s, detect slide changes ===
        diffIntervalRef.current = setInterval(() => {
          const canvas = diffCanvasRef.current;
          const vid = videoRef.current;
          if (!canvas || !vid) return;
          if (vid.videoWidth === 0 || vid.videoHeight === 0) return;

          // Use small frame for diff (320x180 = 57k pixels - fast)
          const diffW = 320;
          const diffH = 180;
          canvas.width = diffW;
          canvas.height = diffH;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(vid, 0, 0, diffW, diffH);
          const frame = ctx.getImageData(0, 0, diffW, diffH);
          const data = frame.data;

          // Convert to grayscale
          const gray = new Uint8ClampedArray(diffW * diffH);
          for (let i = 0; i < diffW * diffH; i++) {
            const idx = i * 4;
            // ITU-R BT.601 luminance
            gray[i] = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) | 0;
          }

          const prev = lastFrameDataRef.current;
          lastFrameDataRef.current = gray;

          if (!prev) return; // first frame - no diff

          // Compute pixel-wise absolute difference
          let changedPixels = 0;
          const threshold = 25; // grayscale diff threshold (0-255)
          for (let i = 0; i < gray.length; i++) {
            if (Math.abs(gray[i] - prev[i]) > threshold) changedPixels++;
          }
          const diffPercent = changedPixels / gray.length;

          // Detect slide change - above threshold
          if (diffPercent > diffThreshold) {
            setLastSlideChangeAt(Date.now());
            setSlideChangeCount((n) => n + 1);
            callbacksRef.current.onSlideChange?.(diffPercent);
          }
        }, diffIntervalMs);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to start OCR/CV';
        console.error('[ScreenCV] start error:', e);
        setError(msg);
        setIsModelLoading(false);
      }
    },
    [ocrIntervalMs, diffIntervalMs, diffThreshold, ocrLanguages]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => stop();
  }, [stop]);

  return {
    start,
    stop,
    isOcrProcessing,
    isModelLoading,
    modelProgress,
    lastOcrAt,
    lastSlideChangeAt,
    slideChangeCount,
    ocrChunkCount,
    error,
  };
}
