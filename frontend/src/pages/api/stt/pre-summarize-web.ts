/**
 * POST /api/stt/pre-summarize-web
 *
 * Pre-summarize transcript menggunakan PDFSummarizer.net API (gratis, no signup).
 * API flow:
 *   1. POST ai-services.formatech.io/files/upload-url → {key, url} (S3 presigned)
 *   2. PUT {url} → upload file ke S3
 *   3. POST ai-services.formatech.io/files/initialize → {sessionId, status: "PROCESSING"}
 *   4. Poll POST ai-services.formatech.io/files/status → {status: "COMPLETED", summary: "..."}
 *
 * Request body: { text: string }
 * Response: { summary: string, method: string } atau { summary: null, error: string }
 *
 * Fallback chain di client:
 *   1. PDFSummarizer.net API (this endpoint) — gratis, no signup, handle file up to 50MB
 *   2. Chrome Summarizer API (client-side) — gratis, on-device, Chrome 127+
 *   3. Raw transcript (Phase 1 DeepSeek di server)
 */

import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const API_BASE = 'https://ai-services.formatech.io';
const WEBSITE = 'pdf-summarizer';
const ORIGIN = 'https://pdfsummarizer.net';

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as { text?: string };
    const text = (body.text || '').trim();

    if (!text || text.length < 100) {
      return Response.json({ error: 'Text too short (min 100 chars)' }, { status: 400 });
    }

    // Generate unique userId for this request
    const userId = randomUUID().replace(/-/g, '').slice(0, 32);
    const filename = `transcript_${Date.now()}.txt`;
    const tempPath = join('/tmp', filename);

    // Save text to temp file
    writeFileSync(tempPath, text, 'utf-8');
    console.log(`[pre-summarize-web] Saved ${text.length} chars to ${tempPath}`);

    try {
      // Step 1: Get upload URL
      console.log('[pre-summarize-web] Step 1: upload-url');
      const uploadRes = await fetch(`${API_BASE}/files/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': ORIGIN },
        body: JSON.stringify({ filename, contentType: 'text/plain', userId, website: WEBSITE }),
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        throw new Error(`upload-url HTTP ${uploadRes.status}: ${err.slice(0, 200)}`);
      }
      const uploadData = await uploadRes.json() as { key: string; url: string };
      const { key, url } = uploadData;
      console.log(`[pre-summarize-web] Step 1 OK: key=${key.slice(0, 40)}...`);

      // Step 2: Upload file to S3
      console.log('[pre-summarize-web] Step 2: S3 upload');
      const fileBuffer = Buffer.from(text, 'utf-8');
      const s3Res = await fetch(url, {
        method: 'PUT',
        body: fileBuffer,
        headers: { 'Content-Type': 'text/plain' },
      });
      if (!s3Res.ok && s3Res.status !== 200) {
        throw new Error(`S3 upload HTTP ${s3Res.status}`);
      }
      console.log('[pre-summarize-web] Step 2 OK: S3 upload done');

      // Step 3: Initialize processing
      console.log('[pre-summarize-web] Step 3: initialize');
      const initRes = await fetch(`${API_BASE}/files/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': ORIGIN },
        body: JSON.stringify({ key, filename, userId, website: WEBSITE }),
      });
      if (!initRes.ok) {
        const err = await initRes.text();
        throw new Error(`initialize HTTP ${initRes.status}: ${err.slice(0, 200)}`);
      }
      const initData = await initRes.json() as { sessionId: string; status: string };
      const { sessionId } = initData;
      console.log(`[pre-summarize-web] Step 3 OK: sessionId=${sessionId}, status=${initData.status}`);

      // Step 4: Poll status (every 5s, max 120s)
      console.log('[pre-summarize-web] Step 4: poll status...');
      for (let i = 0; i < 24; i++) {
        await sleep(5000);
        const statusRes = await fetch(`${API_BASE}/files/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Origin': ORIGIN },
          body: JSON.stringify({ sessionId, userId }),
        });
        if (!statusRes.ok) {
          const err = await statusRes.text();
          console.log(`[pre-summarize-web] poll ${i * 5}s: HTTP ${statusRes.status} ${err.slice(0, 100)}`);
          continue;
        }
        const statusData = await statusRes.json() as {
          status: string;
          summary?: string;
          result?: string;
          content?: string;
          text?: string;
          output?: string;
        };
        const status = statusData.status || '';
        const summary = statusData.summary || statusData.result || statusData.content || statusData.text || statusData.output;

        console.log(`[pre-summarize-web] poll ${i * 5}s: status=${status}` + (summary ? `, summary=${summary.length} chars` : `, keys=${Object.keys(statusData).join(',')}`));

        if (status.toUpperCase() === 'COMPLETED' || status.toUpperCase() === 'DONE' || summary) {
          console.log(`[pre-summarize-web] ✓ COMPLETED! Summary: ${(summary || '').length} chars`);
          // Cleanup temp file
          try { unlinkSync(tempPath); } catch {}
          return Response.json({
            summary: summary || '',
            method: 'pdfsummarizer-net-api',
            originalLength: text.length,
            summaryLength: (summary || '').length,
          });
        }
      }

      // Timeout — processing took too long
      console.log('[pre-summarize-web] ✗ Timeout after 120s');
      try { unlinkSync(tempPath); } catch {}
      return Response.json({
        summary: null,
        error: 'timeout',
        message: 'PDFSummarizer.net processing timed out (120s). Falling back to other methods.',
      });
    } catch (apiErr: any) {
      console.log('[pre-summarize-web] API error:', apiErr?.message?.slice(0, 200));
      try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch {}
      return Response.json({
        summary: null,
        error: 'api_error',
        message: apiErr?.message || 'PDFSummarizer.net API failed',
      });
    }
  } catch (e: any) {
    console.error('[pre-summarize-web] fatal:', e);
    return Response.json({
      summary: null,
      error: 'server_error',
      message: 'Pre-summarize failed. Server will use LLM fallback.',
    });
  }
};

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
