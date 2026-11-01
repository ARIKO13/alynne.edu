/**
 * PDF Module Generator Route — /api/pdf/generate-module
 *
 * v19 P1-B: Generates 11-section professional PDF module via Playwright.
 * Uses HTML template (pdf-module-template.html) + Handlebars-style templating.
 *
 * Flow:
 *   1. Receive materi_hash (or full materi data) in POST body
 *   2. Check D1 pdf_module_cache (7-day TTL)
 *   3. If cache miss: render HTML template with data → Playwright print-to-PDF
 *   4. Save PDF bytes to D1 cache (base64)
 *   5. Return PDF (or signed URL)
 *
 * Target: <5MB per PDF. WebP compression for embedded images.
 */
import type { APIRoute } from 'astro';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { spawn } from 'child_process';

// ============================================================
// CONFIG
// ============================================================
const TEMPLATE_PATH = join(process.cwd(), 'scripts/v19-upgrade/pdf-module-template.html');
const PDF_CACHE_TTL_DAYS = 7;

// ============================================================
// HELPERS
// ============================================================

/**
 * Simple template renderer — replaces {{VAR}} placeholders.
 * Supports {{#each list}}...{{/each}} loops and {{add @index 1}} for numbering.
 */
function renderTemplate(template: string, data: Record<string, any>): string {
  let result = template;

  // Replace simple variables first ({{VAR}})
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' || typeof value === 'number') {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(regex, String(value));
    }
  }

  // Handle {{#each list}}...{{/each}} blocks
  const eachRegex = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
  result = result.replace(eachRegex, (_, listName, blockContent) => {
    const list = data[listName];
    if (!Array.isArray(list)) return '';
    return list.map((item, idx) => {
      let itemContent = blockContent;
      // Replace {{this.field}} with item.field
      if (typeof item === 'object') {
        for (const [k, v] of Object.entries(item)) {
          const r = new RegExp(`\\{\\{this\\.${k}\\}\\}`, 'g');
          itemContent = itemContent.replace(r, String(v));
        }
      } else {
        itemContent = itemContent.replace(/\{\{this\}\}/g, String(item));
      }
      // Replace {{add @index N}} with idx + N
      itemContent = itemContent.replace(/\{\{add @index (\d+)\}\}/g, (_, n) => String(idx + parseInt(n)));
      return itemContent;
    }).join('');
  });

  // Replace {{add @index N}} outside loops (fallback)
  result = result.replace(/\{\{add @index (\d+)\}\}/g, (_, n) => String(parseInt(n)));

  return result;
}

/**
 * Render HTML to PDF via Playwright (headless Chromium).
 * Returns PDF bytes.
 */
async function renderHtmlToPdf(html: string, headerTitle: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Write HTML to temp file
    const tmpHtml = `/tmp/pdf-module-${Date.now()}.html`;
    const tmpPdf = `/tmp/pdf-module-${Date.now()}.pdf`;
    writeFileSync(tmpHtml, html);

    // Spawn Playwright script as .cjs (CommonJS) since project is ESM
    const script = `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('file://${tmpHtml}', { waitUntil: 'networkidle' });
  await page.pdf({
    path: '${tmpPdf}',
    format: 'A4',
    printBackground: true,
    margin: { top: '18mm', right: '18mm', bottom: '18mm', left: '18mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div style="font-size:9pt;color:#94A3B8;text-align:right;width:100%;padding-right:18mm;padding-top:4mm;">${headerTitle}</div>',
    footerTemplate: '<div style="font-size:9pt;color:#64748B;text-align:center;width:100%;">Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></div>',
  });
  await browser.close();
  console.log('PDF_GENERATED:${tmpPdf}');
})();
`;

    const tmpScript = `/tmp/pdf-render-${Date.now()}.cjs`;
    writeFileSync(tmpScript, script);

    const proc = spawn('node', [tmpScript], {
      cwd: '/root/lina-learning',
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: '/root/.cache/ms-playwright',
        NODE_PATH: '/root/lina-learning/node_modules',
      },
    });

    let output = '';
    proc.stdout.on('data', d => output += d.toString());
    proc.stderr.on('data', d => output += d.toString());

    proc.on('close', code => {
      if (code === 0 && output.includes('PDF_GENERATED:')) {
        const pdfPath = output.match(/PDF_GENERATED:(.+)/)?.[1]?.trim();
        if (pdfPath) {
          const pdfBytes = readFileSync(pdfPath);
          // Cleanup
          unlinkSync(tmpHtml);
          unlinkSync(tmpScript);
          unlinkSync(pdfPath);
          resolve(pdfBytes);
        } else {
          reject(new Error('PDF path not found in output'));
        }
      } else {
        reject(new Error(`Playwright failed: ${output.slice(0, 500)}`));
      }
    });
  });
}

/**
 * Build template data from materi (mega_cache response).
 */
function buildTemplateData(materi: any, userInfo: { name: string; level: string }): Record<string, any> {
  const babList = (materi.modul?.bab || []).map((bab: any) => ({
    id: bab.id,
    judul: bab.judul,
    tujuan: bab.tujuan || '',
    konsep_kunci: bab.konsep_kunci || [],
    penjelasan: bab.penjelasan || '',
    contoh: bab.contoh || '',
    emoji: bab.emoji || '📖',
    eli5: bab.eli5 || '',
    connectTo: bab.connectTo || '',
    callouts: {
      insight: bab.analogy || bab.realWorldExample || '',
      misconception: bab.commonMistake || '',
      takeaway: [bab.examTip, bab.mnemonic].filter(Boolean).join(' '),
    },
  }));

  const kuisList = materi.kuis || [];
  const glosariumList = materi.glosarium || [];

  // Build objectives from bab tujuan
  const objectives = babList.map((b: any) => b.tujuan).filter(Boolean);

  // Build ringkasan points (5 key points)
  const ringkasanPoints = (materi.ringkasan_padat || '')
    .split(/\.\s+/)
    .filter((s: string) => s.length > 30)
    .slice(0, 5);

  // Build action steps (3 concrete steps)
  const actionSteps = babList.slice(0, 3).map((b: any) =>
    `Pelajari bab ${b.id}: ${b.judul}. Pahami konsep inti dan kerjakan kuis terkait.`,
  );

  return {
    TITLE: materi.modul?.judul || 'Materi Belajar',
    SUBTITLE: materi.content_type
      ? `Modul ${materi.content_type} dengan ${babList.length} bab dan ${kuisList.length} soal latihan`
      : `Modul pembelajaran dengan ${babList.length} bab`,
    SOURCE: materi.source || 'YouTube Transcript',
    DATE: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
    LEVEL: userInfo.level || 'Umum',
    USER_NAME: userInfo.name || 'Learner',
    PREREQUISITE: materi.prerequisite || 'Tidak ada prerequisite khusus. Pengetahuan umum cukup.',
    bab_list: babList,
    kuis_list: kuisList,
    glosarium_list: glosariumList,
    objectives,
    ringkasan_points: ringkasanPoints,
    action_steps: actionSteps,
    YOUTUBE_URL: materi.youtube_url || '',
    YOUTUBE_TIMESTAMPS: materi.youtube_timestamps || [],
    CONTENT_TYPE: materi.content_type || 'lecture',
    BAB_COUNT: babList.length,
    KUIS_COUNT: kuisList.length,
  };
}

// ============================================================
// MAIN HANDLER
// v19.1: NO D1 CACHE — always regenerate PDF via Playwright (~4s).
// LLM is free, Playwright is fast enough, cache adds complexity.
// ============================================================
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { materi, userInfo } = body;

    if (!materi) {
      return Response.json({ error: 'materi required (pass full materi data, no cache lookup)' }, { status: 400 });
    }

    const materiData = materi;
    const userData = userInfo || { name: 'Learner', level: 'Umum' };

    // Render HTML template (always fresh, no cache check)
    const template = readFileSync(TEMPLATE_PATH, 'utf-8');
    const templateData = buildTemplateData(materiData, userData);
    const html = renderTemplate(template, templateData);

    // Render to PDF via Playwright
    console.log(`[pdf-module] rendering PDF for "${materiData.modul?.judul}"...`);
    const pdfBytes = await renderHtmlToPdf(html, materiData.modul?.judul || 'Materi Belajar');
    const sizeMB = pdfBytes.length / (1024 * 1024);
    console.log(`[pdf-module] PDF generated: ${(sizeMB).toFixed(2)} MB`);

    if (sizeMB > 5) {
      console.warn(`[pdf-module] WARNING: PDF size ${sizeMB.toFixed(2)} MB > 5 MB target`);
    }

    // Return PDF (no cache save)
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${materiData.modul?.judul || 'module'}.pdf"`,
        'Content-Length': String(pdfBytes.length),
      },
    });

  } catch (err: any) {
    console.error('[pdf-module] FATAL:', err);
    return Response.json({
      error: 'pdf_generation_failed',
      message: err?.message || 'Unknown error',
    }, { status: 500 });
  }
};
