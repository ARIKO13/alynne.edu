/**
 * POST /api/stt/convert-file
 *
 * Konversi file APAPUN jadi teks pakai tool server-side:
 *   - PDF             → pdftotext (poppler). Kalau empty (scanned), pdftoppm + tesseract OCR
 *   - DOCX/DOC/ODT/RTF→ libreoffice --headless --convert-to txt
 *   - PPTX/PPT        → libreoffice --headless --convert-to pdf → pdftotext
 *   - XLSX/XLS/CSV    → libreoffice --headless --convert-to csv (atau langsung baca CSV)
 *   - HTML/HTM/EPUB/MD→ pandoc -t plain
 *   - TXT/CSV/JSON/XML→ baca langsung
 *   - Gambar (jpg/png/tiff/bmp/webp/gif) → tesseract OCR (Bahasa Indonesia + English)
 *
 * Request: multipart/form-data dengan field `file` (File)
 * Response: { text: string, method: string, originalName: string, charCount: number, pageCount?: number }
 *           atau { text: null, error: string }
 *
 * Flow client:
 *   - FileUpload (DocumentUpload.tsx) → POST /api/stt/convert-file → text
 *   - text → useAppStore.appendTranscriptBatch() → StudyPipeline preSummarize() → chunked-generate
 *
 * Limit file 50MB. Timeout 90s (libreoffice convert office gede bisa 30-60s).
 */

import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const TMP_BASE = '/tmp/alynne-convert';

// 50MB limit
const MAX_FILE_SIZE = 50 * 1024 * 1024;
// 90s for convert (libreoffice cold start ~5-10s, large PPTX up to 30-60s)
const CONVERT_TIMEOUT_MS = 90_000;

interface ConvertResult {
  text: string;
  method: string;
  pageCount?: number;
}

export const POST: APIRoute = async ({ request }) => {
  // Ensure tmp dir
  if (!existsSync(TMP_BASE)) mkdirSync(TMP_BASE, { recursive: true });

  let workDir = '';
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return Response.json({ text: null, error: 'Unauthorized' }, { status: 401 });
    }

    // Parse multipart form
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return Response.json({ text: null, error: 'Expected multipart/form-data with file field' }, { status: 400 });
    }
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return Response.json({ text: null, error: 'No file uploaded (field name must be "file")' }, { status: 400 });
    }
    if (file.size === 0) {
      return Response.json({ text: null, error: 'File kosong' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return Response.json({ text: null, error: `File terlalu besar (${(file.size / 1024 / 1024).toFixed(1)} MB). Maks 50 MB.` }, { status: 413 });
    }

    // Build a unique work dir
    const jobId = randomUUID().replace(/-/g, '').slice(0, 16);
    workDir = join(TMP_BASE, jobId);
    mkdirSync(workDir, { recursive: true });

    // Sanitize filename — keep extension, replace weird chars
    const safeExt = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const inPath = join(workDir, `input.${safeExt || 'bin'}`);
    const buf = Buffer.from(await file.arrayBuffer());
    writeFileSync(inPath, buf);
    console.log(`[convert-file] Received: "${file.name}" (${file.size} bytes, ext=${safeExt || 'none'}, mime=${file.type})`);

    const t0 = Date.now();
    const result = await convertToText(inPath, workDir, safeExt, file.name);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[convert-file] ✓ ${result.method}: ${result.text.length} chars in ${elapsed}s`);

    if (!result.text || result.text.trim().length < 10) {
      return Response.json({
        text: null,
        error: `Hasil ekstraksi terlalu pendek (${result.text?.trim().length || 0} char). Mungkin file berisi gambar tanpa teks OCR-able, atau file korup.`,
        method: result.method,
      }, { status: 422 });
    }

    return Response.json({
      text: result.text,
      method: result.method,
      originalName: file.name,
      charCount: result.text.length,
      pageCount: result.pageCount,
      elapsedMs: Date.now() - t0,
    });
  } catch (e: any) {
    console.error('[convert-file] error:', e?.message?.slice(0, 300), e?.stack?.slice(0, 500));
    return Response.json({
      text: null,
      error: e?.message || 'Konversi gagal',
    }, { status: 500 });
  } finally {
    // Cleanup work dir
    if (workDir) {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  }
};

// ── File-type → converter dispatch ──
async function convertToText(inPath: string, workDir: string, ext: string, originalName: string): Promise<ConvertResult> {
  // Text-based formats — read directly
  const textExts = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log'];
  if (textExts.includes(ext)) {
    const text = readFileSync(inPath, 'utf-8');
    return { text, method: 'direct-read' };
  }

  // PDF — pdftotext, fallback to OCR if empty (scanned PDF)
  if (ext === 'pdf') {
    return await convertPdf(inPath, workDir);
  }

  // Images — tesseract OCR (id+eng)
  const imgExts = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'webp', 'gif', 'pbm', 'pgm', 'ppm'];
  if (imgExts.includes(ext)) {
    return await convertImage(inPath, workDir);
  }

  // Office formats — libreoffice convert to txt/pdf/csv, then extract
  const officeTextExts = ['docx', 'doc', 'odt', 'rtf', 'sxw'];
  if (officeTextExts.includes(ext)) {
    return await convertOffice(inPath, workDir, 'txt:Text', 'txt');
  }

  const officePdfExts = ['pptx', 'ppt', 'odp', 'sxi', 'key'];
  if (officePdfExts.includes(ext)) {
    return await convertOffice(inPath, workDir, 'pdf', 'pdf');
  }

  const officeSheetExts = ['xlsx', 'xls', 'ods', 'sxc'];
  if (officeSheetExts.includes(ext)) {
    return await convertOffice(inPath, workDir, 'csv', 'csv');
  }

  // HTML/HTM/EPUB — pandoc to plain
  const pandocExts = ['html', 'htm', 'xhtml', 'epub', 'mobi', 'azw', 'azw3'];
  if (pandocExts.includes(ext)) {
    return await convertPandoc(inPath, workDir);
  }

  // Unknown — try libreoffice with txt:Text as last resort
  console.log(`[convert-file] unknown ext "${ext}", attempting libreoffice --convert-to txt:Text`);
  try {
    return await convertOffice(inPath, workDir, 'txt:Text', 'txt');
  } catch (e: any) {
    throw new Error(`Format file .${ext} belum didukung. Coba: PDF, DOCX, PPTX, XLSX, gambar (JPG/PNG/TIFF), HTML, EPUB, TXT. Detail: ${e?.message?.slice(0, 150)}`);
  }
}

// ── PDF: pdftotext → if empty, OCR fallback ──
async function convertPdf(inPath: string, workDir: string): Promise<ConvertResult> {
  const txtPath = join(workDir, 'out.txt');
  // -layout: keep layout, -q: quiet
  try {
    await execAsync(`pdftotext -layout -q "${inPath}" "${txtPath}"`, { timeout: CONVERT_TIMEOUT_MS });
  } catch (e: any) {
    // pdftotext can fail on protected/encrypted PDF — try without -layout
    try {
      await execAsync(`pdftotext -q "${inPath}" "${txtPath}"`, { timeout: CONVERT_TIMEOUT_MS });
    } catch (e2: any) {
      throw new Error(`pdftotext failed: ${e2?.message?.slice(0, 100)}`);
    }
  }
  let text = existsSync(txtPath) ? readFileSync(txtPath, 'utf-8') : '';
  const pageCount = await getPdfPageCount(inPath);

  // Scanned PDF — text empty or too short relative to page count → OCR
  // Threshold: < 50 char per page = scanned
  const isScanned = pageCount > 0 && text.trim().length < pageCount * 50;
  if (isScanned) {
    console.log(`[convert-file] PDF looks scanned (${text.length} char / ${pageCount} page) — fallback to OCR`);
    const ocrText = await ocrPdf(inPath, workDir);
    if (ocrText.length > text.length) {
      text = ocrText;
    }
    return { text, method: 'pdf-ocr', pageCount };
  }

  return { text, method: 'pdftotext', pageCount };
}

async function getPdfPageCount(pdfPath: string): Promise<number> {
  try {
    // pdfinfo gives "Pages: N"
    const { stdout } = await execAsync(`pdfinfo "${pdfPath}"`, { timeout: 10_000 });
    const m = stdout.match(/^Pages:\s+(\d+)/m);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

// OCR a PDF: convert each page to PNG (pdftoppm), then tesseract each
async function ocrPdf(pdfPath: string, workDir: string): Promise<string> {
  const ppmDir = join(workDir, 'ppm');
  mkdirSync(ppmDir, { recursive: true });
  try {
    // -r 200: 200 DPI (good for OCR), -png: output PNG
    await execAsync(`pdftoppm -r 200 -png "${pdfPath}" "${join(ppmDir, 'page')}"`, { timeout: CONVERT_TIMEOUT_MS });
  } catch (e: any) {
    console.log(`[convert-file] pdftoppm failed: ${e?.message?.slice(0, 100)}`);
    return '';
  }
  // List generated pages
  const files = await listDir(ppmDir).then(files => files.filter(f => f.endsWith('.png')).sort());
  if (files.length === 0) return '';
  // OCR each page (limit to 30 pages max for safety)
  const pagesToOcr = files.slice(0, 30);
  const pages: string[] = [];
  for (let i = 0; i < pagesToOcr.length; i++) {
    const f = pagesToOcr[i];
    const outBase = join(ppmDir, `ocr-${i}`);
    try {
      await execAsync(`tesseract "${f}" "${outBase}" -l ind+eng --psm 6 2>/dev/null`, { timeout: 30_000 });
      const text = readFileSync(`${outBase}.txt`, 'utf-8');
      if (text.trim()) pages.push(text);
    } catch (e: any) {
      console.log(`[convert-file] tesseract page ${i} failed: ${e?.message?.slice(0, 80)}`);
    }
  }
  return pages.join('\n\n');
}

// ── Image OCR via tesseract (Indonesian + English) ──
async function convertImage(inPath: string, workDir: string): Promise<ConvertResult> {
  const outBase = join(workDir, 'out');
  // --psm 6: assume a single uniform block of text (most flexible for documents)
  // ind+eng: Indonesian + English combined
  try {
    await execAsync(`tesseract "${inPath}" "${outBase}" -l ind+eng --psm 6 2>/dev/null`, { timeout: 60_000 });
    const text = readFileSync(`${outBase}.txt`, 'utf-8');
    return { text, method: 'tesseract-ocr' };
  } catch (e: any) {
    // Try with default language pack (eng only) if ind not installed
    try {
      await execAsync(`tesseract "${inPath}" "${outBase}" --psm 6 2>/dev/null`, { timeout: 60_000 });
      const text = readFileSync(`${outBase}.txt`, 'utf-8');
      return { text, method: 'tesseract-ocr-eng-only' };
    } catch (e2: any) {
      throw new Error(`tesseract OCR gagal: ${e2?.message?.slice(0, 100)}`);
    }
  }
}

// ── Office files via LibreOffice headless ──
async function convertOffice(inPath: string, workDir: string, filter: string, outputExt: string): Promise<ConvertResult> {
  // soffice --headless --convert-to <filter>[:<filter-options>] --outdir <workDir> <inPath>
  // -env:UserInstallation=file:///tmp/lo-<random> to avoid profile conflicts in concurrent calls
  const profileDir = `/tmp/lo-profile-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const outdir = workDir;
  // filter format: e.g. "txt:Text", "pdf", "csv"
  // Output file will be named <input basename without ext>.<outputExt>
  const baseName = inPath.split('/').pop()!.replace(/\.[^.]+$/, '');
  const expectedOut = join(outdir, `${baseName}.${outputExt}`);

  try {
    const cmd = `soffice --headless --norestore --nolockcheck -env:UserInstallation=file://${profileDir} --convert-to "${filter}" --outdir "${outdir}" "${inPath}"`;
    console.log(`[convert-file] soffice: ${cmd.slice(0, 150)}`);
    await execAsync(cmd, { timeout: CONVERT_TIMEOUT_MS });
  } catch (e: any) {
    throw new Error(`libreoffice convert-to ${filter} failed: ${e?.message?.slice(0, 150)}`);
  }

  if (!existsSync(expectedOut)) {
    throw new Error(`libreoffice tidak menghasilkan file (${expectedOut})`);
  }

  // If output is PDF (pptx→pdf), extract text via pdftotext
  if (outputExt === 'pdf') {
    const txtPath = join(workDir, 'slides.txt');
    try {
      await execAsync(`pdftotext -layout -q "${expectedOut}" "${txtPath}"`, { timeout: 30_000 });
      const text = readFileSync(txtPath, 'utf-8');
      const pageCount = await getPdfPageCount(expectedOut);
      return { text, method: `libreoffice-pdf+pdftotext`, pageCount };
    } catch (e: any) {
      throw new Error(`pdftotext setelah convert PDF gagal: ${e?.message?.slice(0, 100)}`);
    }
  }

  // For txt/csv — read directly
  const text = readFileSync(expectedOut, 'utf-8');
  return { text, method: `libreoffice-${outputExt}` };
}

// ── Pandoc: HTML/EPUB → plain text ──
async function convertPandoc(inPath: string, workDir: string): Promise<ConvertResult> {
  const outPath = join(workDir, 'out.txt');
  try {
    // -t plain: plain text output, no markdown formatting
    // --wrap=none: no line wrapping
    await execAsync(`pandoc -f auto -t plain --wrap=none "${inPath}" -o "${outPath}"`, { timeout: CONVERT_TIMEOUT_MS });
    const text = readFileSync(outPath, 'utf-8');
    return { text, method: 'pandoc' };
  } catch (e: any) {
    throw new Error(`pandoc failed: ${e?.message?.slice(0, 100)}`);
  }
}

// ── Helper: list directory ──
function listDir(dir: string): Promise<string[]> {
  return Promise.resolve(readdirSync(dir));
}
