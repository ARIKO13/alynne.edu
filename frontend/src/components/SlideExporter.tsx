/**
 * SlideExporter.tsx  -  Export chapters to presentation slides
 *
 * Generates HTML-based slide presentation from STT chapters.
 * Each chapter becomes a slide with title + content + quiz.
 *
 * Output: Downloadable HTML file (self-contained, no dependencies).
 * Can be opened in any browser, presented fullscreen.
 */

import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Presentation,
  Download,
  Loader2,
  X,
  FileText,
} from 'lucide-react';
import type { Chapter, QuizQuestion } from '@/lib/stt-chapter-splitter';
import { toast } from 'sonner';

interface SlideExporterProps {
  open: boolean;
  onClose: () => void;
  chapters: Chapter[];
  quizzes?: Record<number, QuizQuestion[]>;
}

export function SlideExporter({ open, onClose, chapters, quizzes = {} }: SlideExporterProps) {
  const [generating, setGenerating] = useState(false);

  const generateSlides = useCallback(async () => {
    if (chapters.length === 0) {
      toast.error('Belum ada bab untuk dibuat slide');
      return;
    }

    setGenerating(true);
    await new Promise((r) => setTimeout(r, 500));

    const slides = chapters.map((ch, i) => {
      const quiz = quizzes[ch.id] || [];
      return generateSlideHTML(ch, i + 1, chapters.length, quiz);
    });

    const html = generatePresentationHTML(slides, chapters);

    // Download
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alynne-slides-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);

    setGenerating(false);
    toast.success(`Slide dibuat! ${chapters.length} slides.`);
    onClose();
  }, [chapters, quizzes, onClose]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md ">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Presentation className="h-5 w-5 text-[var(--accent-soft)]" />
            Export ke Slide Presentasi
          </DialogTitle>
          <DialogDescription className="text-stone-400">
            Bikin presentasi HTML dari bab-bab STT kamu.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-blue-400" />
              <span className="text-sm text-stone-300">Slide Preview</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-stone-500">Total Slide</p>
                <p className="text-lg font-bold text-white">{chapters.length}</p>
              </div>
              <div>
                <p className="text-stone-500">Total Kuis</p>
                <p className="text-lg font-bold text-white">
                  {Object.values(quizzes).reduce((s, q) => s + q.length, 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-stone-500 space-y-1">
            <p>✓ Setiap bab jadi 1 slide</p>
            <p>✓ Kuis otomatis di akhir slide</p>
            <p>✓ Bisa presentasi fullscreen</p>
            <p>✓ Self-contained HTML (buka di browser apapun)</p>
          </div>

          <Button
            onClick={generateSlides}
            disabled={generating}
            className="w-full bg-[var(--accent)] hover:bg-[var(--accent)]"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Download Slide HTML
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function generateSlideHTML(chapter: Chapter, slideNum: number, total: number, quiz: QuizQuestion[]): string {
  const quizHTML = quiz.length > 0
    ? `
    <div class="quiz">
      <h3>Kuis</h3>
      ${quiz.map((q, i) => `
        <div class="quiz-item">
          <p class="quiz-q">${i + 1}. ${q.question}</p>
          <div class="quiz-options">
            ${q.options?.map((opt) => `
              <span class="quiz-opt ${opt === q.correctAnswer ? 'correct' : ''}">${opt}</span>
            `).join('') || ''}
          </div>
        </div>
      `).join('')}
    </div>
  `
    : '';

  return `
    <section class="slide">
      <div class="slide-header">
        <span class="slide-num">Slide ${slideNum} / ${total}</span>
        <span class="slide-badge">Bab ${chapter.id}</span>
      </div>
      <h1 class="slide-title">${escapeHTML(chapter.title)}</h1>
      <div class="slide-content">${escapeHTML(chapter.content)}</div>
      ${quizHTML}
      <div class="slide-footer">ALYNNE.EDU | Modul dari STT</div>
    </section>
  `;
}

function generatePresentationHTML(slides: string[], chapters: Chapter[]): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ALYNNE.EDU - Presentasi Modul</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0D0C0A;
    color: #fff;
    overflow: hidden;
  }
  .presentation {
    width: 100vw;
    height: 100vh;
    position: relative;
  }
  .slide {
    display: none;
    width: 100%;
    height: 100%;
    padding: 60px 80px;
    flex-direction: column;
    background: linear-gradient(135deg, #0D0C0A 0%, #1a1a2e 50%, #16213e 100%);
  }
  .slide.active { display: flex; }
  .slide-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 30px;
  }
  .slide-num { color: #78716C; font-size: 14px; }
  .slide-badge {
    background: #7FC4B8;
    color: white;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
  }
  .slide-title {
    font-size: 36px;
    color: #7FC4B8;
    margin-bottom: 24px;
    line-height: 1.3;
  }
  .slide-content {
    font-size: 18px;
    line-height: 1.8;
    color: #D6D3D1;
    flex: 1;
    overflow-y: auto;
    white-space: pre-wrap;
  }
  .quiz {
    margin-top: 30px;
    padding: 20px;
    background: rgba(139, 92, 246, 0.1);
    border-radius: 12px;
    border: 1px solid rgba(124, 58, 237, 0.3);
  }
  .quiz h3 { color: #7FC4B8; margin-bottom: 12px; }
  .quiz-item { margin-bottom: 16px; }
  .quiz-q { color: #F5F2ED; margin-bottom: 8px; font-size: 16px; }
  .quiz-options { display: flex; flex-wrap: wrap; gap: 8px; }
  .quiz-opt {
    padding: 6px 14px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    font-size: 14px;
    color: #ABA49A;
  }
  .quiz-opt.correct {
    background: rgba(34, 197, 94, 0.2);
    border-color: rgba(34, 197, 94, 0.5);
    color: #4ade80;
    font-weight: 600;
  }
  .slide-footer {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid rgba(255,255,255,0.05);
    color: #57534E;
    font-size: 12px;
    text-align: center;
  }
  .controls {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 12px;
    z-index: 100;
  }
  .controls button {
    background: rgba(124, 58, 237, 0.2);
    border: 1px solid rgba(124, 58, 237, 0.3);
    color: white;
    padding: 10px 20px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    transition: background 0.15s, border-color 0.15s;
  }
  .controls button:hover { background: rgba(124, 58, 237, 0.4); }
  .progress {
    position: fixed;
    top: 0;
    left: 0;
    height: 3px;
    background: #7FC4B8;
    z-index: 100;
    transition: width 0.3s;
  }
</style>
</head>
<body>
<div class="progress" id="progress" style="width: ${100 / slides.length}%"></div>
<div class="presentation" id="presentation">
  ${slides.join('\n  ')}
</div>
<div class="controls">
  <button onclick="prevSlide()">Sebelumnya</button>
  <span id="counter" style="color: #78716C; padding: 10px 20px;">1 / ${slides.length}</span>
  <button onclick="nextSlide()">Berikutnya</button>
  <button onclick="toggleFullscreen()">Fullscreen</button>
</div>
<script>
  let current = 0;
  const slides = document.querySelectorAll('.slide');
  const total = slides.length;
  const counter = document.getElementById('counter');
  const progress = document.getElementById('progress');

  function showSlide(n) {
    slides.forEach(s => s.classList.remove('active'));
    slides[n].classList.add('active');
    counter.textContent = (n + 1) + ' / ' + total;
    progress.style.width = ((n + 1) / total * 100) + '%';
  }
  function nextSlide() { if (current < total - 1) { current++; showSlide(current); } }
  function prevSlide() { if (current > 0) { current--; showSlide(current); } }
  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ') nextSlide();
    if (e.key === 'ArrowLeft') prevSlide();
    if (e.key === 'f') toggleFullscreen();
  });
  showSlide(0);
</script>
</body>
</html>`;
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
