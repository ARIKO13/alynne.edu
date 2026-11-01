/**
 * pdf-export.ts — Generate proper PDF from chapters + quizzes
 *
 * Uses jsPDF (already installed) to create downloadable PDF.
 * Two modes:
 *   - generateMicroPDF(chapter, quiz): PDF for single chapter
 *   - generateMasterPDF(chapters, quizzes): PDF combining all chapters
 */

import { jsPDF } from 'jspdf';
import type { Chapter, QuizQuestion } from './stt-chapter-splitter';

const COLORS = {
  primary: [139, 92, 246] as [number, number, number], // #0284C7
  dark: [24, 24, 27] as [number, number, number], // zinc-900
  gray: [161, 161, 170] as [number, number, number], // zinc-400
  light: [244, 244, 245] as [number, number, number], // zinc-100
  green: [34, 197, 94] as [number, number, number],
  red: [239, 68, 68] as [number, number, number],
};

/**
 * Generate PDF for a single chapter + its quiz.
 */
export function generateMicroPDF(chapter: Chapter, quiz: QuizQuestion[]): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Header bar
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, pageWidth, 25, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('ALYNNE.EDU - Modul Belajar', margin, 16);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Bab ${chapter.id}`, pageWidth - margin, 16, { align: 'right' });

  y = 35;

  // Chapter title
  doc.setTextColor(...COLORS.dark);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  const titleLines = doc.splitTextToSize(chapter.title, contentWidth);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 7 + 3;

  // Meta info
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.gray);
  doc.text(`${chapter.wordCount} kata | Dibuat: ${new Date().toLocaleDateString('id-ID')}`, margin, y);
  y += 8;

  // Divider
  doc.setDrawColor(...COLORS.primary);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // Chapter content
  doc.setTextColor(...COLORS.dark);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  const contentLines = doc.splitTextToSize(chapter.content, contentWidth);
  for (const line of contentLines) {
    if (y > pageHeight - 30) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += 5.5;
  }

  // Quiz section
  if (quiz.length > 0) {
    y += 10;
    if (y > pageHeight - 40) {
      doc.addPage();
      y = margin;
    }

    doc.setFillColor(...COLORS.primary);
    doc.rect(margin - 5, y - 5, contentWidth + 10, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`Kuis Bab ${chapter.id}`, margin, y + 2);
    y += 12;

    quiz.forEach((q, i) => {
      if (y > pageHeight - 40) {
        doc.addPage();
        y = margin;
      }

      doc.setTextColor(...COLORS.dark);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(`${i + 1}. ${q.question}`, margin, y);
      y += 6;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      q.options?.forEach((opt) => {
        if (y > pageHeight - 20) {
          doc.addPage();
          y = margin;
        }
        const isCorrect = opt === q.correctAnswer;
        doc.setTextColor(...(isCorrect ? COLORS.green : COLORS.gray));
        doc.text(`   ${isCorrect ? '[V]' : '[ ]'} ${opt}`, margin + 2, y);
        y += 5;
      });
      y += 3;
    });
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.gray);
    doc.text(
      `ALYNNE.EDU | Halaman ${i} dari ${pageCount}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
  }

  doc.save(`alynne-bab-${chapter.id}.pdf`);
}

/**
 * Generate master PDF combining all chapters + quizzes.
 */
export function generateMasterPDF(chapters: Chapter[], quizzes: Record<number, QuizQuestion[]>): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Cover page
  doc.setFillColor(...COLORS.dark);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  doc.setTextColor(...COLORS.primary);
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text('ALYNNE.EDU', pageWidth / 2, pageHeight / 2 - 30, { align: 'center' });

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'normal');
  doc.text('Modul Belajar dari STT', pageWidth / 2, pageHeight / 2 - 15, { align: 'center' });

  doc.setFontSize(11);
  doc.setTextColor(...COLORS.gray);
  doc.text(`Total: ${chapters.length} bab`, pageWidth / 2, pageHeight / 2 + 5, { align: 'center' });
  doc.text(`Total kata: ${chapters.reduce((s, c) => s + c.wordCount, 0)}`, pageWidth / 2, pageHeight / 2 + 12, { align: 'center' });
  doc.text(`Dibuat: ${new Date().toLocaleString('id-ID')}`, pageWidth / 2, pageHeight / 2 + 19, { align: 'center' });

  // Table of contents
  doc.addPage();
  y = margin;
  doc.setTextColor(...COLORS.dark);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Daftar Isi', margin, y);
  y += 10;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  chapters.forEach((ch, i) => {
    if (y > pageHeight - 20) {
      doc.addPage();
      y = margin;
    }
    doc.setTextColor(...COLORS.gray);
    doc.text(`${i + 1}.`, margin, y);
    doc.setTextColor(...COLORS.dark);
    const titleLines = doc.splitTextToSize(ch.title, contentWidth - 20);
    doc.text(titleLines[0], margin + 8, y);
    doc.setTextColor(...COLORS.gray);
    doc.text(`${ch.wordCount} kata`, pageWidth - margin, y, { align: 'right' });
    y += 6;
  });

  // Each chapter
  chapters.forEach((ch) => {
    doc.addPage();
    y = margin;

    // Chapter header
    doc.setFillColor(...COLORS.primary);
    doc.rect(0, 0, pageWidth, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text(`Bab ${ch.id}`, margin, 14);

    y = 30;
    doc.setTextColor(...COLORS.dark);
    doc.setFontSize(14);
    const titleLines = doc.splitTextToSize(ch.title, contentWidth);
    doc.text(titleLines, margin, y);
    y += titleLines.length * 6 + 5;

    // Content
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const contentLines = doc.splitTextToSize(ch.content, contentWidth);
    for (const line of contentLines) {
      if (y > pageHeight - 25) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += 5.5;
    }

    // Quiz
    const quiz = quizzes[ch.id] || [];
    if (quiz.length > 0) {
      y += 8;
      if (y > pageHeight - 30) {
        doc.addPage();
        y = margin;
      }
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.primary);
      doc.text(`Kuis Bab ${ch.id}`, margin, y);
      y += 7;

      quiz.forEach((q, i) => {
        if (y > pageHeight - 25) {
          doc.addPage();
          y = margin;
        }
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.dark);
        const qLines = doc.splitTextToSize(`${i + 1}. ${q.question}`, contentWidth);
        qLines.forEach((line: string) => {
          doc.text(line, margin, y);
          y += 5;
        });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        q.options?.forEach((opt) => {
          if (y > pageHeight - 15) {
            doc.addPage();
            y = margin;
          }
          const isCorrect = opt === q.correctAnswer;
          doc.setTextColor(...(isCorrect ? COLORS.green : COLORS.gray));
          doc.text(`   ${isCorrect ? '[V]' : '[ ]'} ${opt}`, margin + 2, y);
          y += 4.5;
        });
        y += 2;
      });
    }
  });

  // Footer page numbers
  const pageCount = doc.getNumberOfPages();
  for (let i = 2; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.gray);
    doc.text(
      `ALYNNE.EDU | Halaman ${i - 1} dari ${pageCount - 1}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
  }

  doc.save(`alynne-modul-master-${Date.now()}.pdf`);
}
