/**
 * POST /api/stt/pre-summarize-resoomer
 *
 * Pre-summarize transcript menggunakan Resoomer (https://resoomer.com/) — gratis, no signup,
 * no captcha. Pakai mode "filtreSummary" (Résumé optimisé) — paling detail di antara 5 mode:
 *   - genericSummary (Assisté) — AI paraphrase, ~90% retention
 *   - autoSummary (Automatique) — auto sentence selection
 *   - manualSummary (Manuel) — user-driven selection
 *   - filtreSummary (Optimisé) ← INI YANG DIPAKAI — actual summarization, 30-70% retention (depends on input length)
 *   - analyzeSummary (Analyse du texte) — text analysis (keywords/themes)
 *
 * Flow (curl-style, NO Playwright):
 *   1. GET https://resoomer.com/ → collect PHPSESSID cookie + keyForm (CSRF token)
 *   2. POST step 1 to /controllers/AFC.php?action=sendText with featureView=filtreSummary + contentText + keyForm
 *      → returns HTML with JS triggering next step (language detection)
 *   3. POST steps 2-6 (processName: part_2, part_3, part_4, part_5, part_6) — multi-step pipeline
 *      Step 6 returns ~70K HTML containing generic summary + mode selector
 *   4. POST changeViewResult=filtre to https://resoomer.com/ (FormChangeViewResult submit)
 *      → server stores filtre mode in PHPSESSID session, returns JS redirect script
 *   5. GET https://resoomer.com/ → homepage now rendered with filtre summary in #returnFiltre
 *   6. Extract text from div#returnFiltre (clean — pure summary text)
 *
 * Time: ~30-45s total (homepage ~1s + 6 steps × ~1s each + changeView ~1s + final GET ~1s + parsing)
 *
 * Request body: { text: string }
 * Response: { summary: string, method: string, originalLength: number, summaryLength: number }
 *           or { summary: null, error: string }
 */

import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';

const URL = 'https://resoomer.com/';
const SUBMIT_URL = 'https://resoomer.com/controllers/AFC.php?action=sendText';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT_MS = 90_000; // 90s total budget

interface CookieJar {
  cookies: Record<string, string>;
  setFromResponse(setCookieHeaders: string[]): void;
  toHeader(): string;
}

function createCookieJar(): CookieJar {
  const cookies: Record<string, string> = {};
  return {
    cookies,
    setFromResponse(setCookieHeaders) {
      for (const header of setCookieHeaders) {
        const m = header.match(/^([^=;]+)=([^;]*)/);
        if (m) cookies[m[1].trim()] = m[2].trim();
      }
    },
    toHeader() {
      return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

async function fetchGet(url: string, jar: CookieJar, timeout = 30_000): Promise<{ body: string; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': jar.toHeader(),
      },
      signal: ctrl.signal,
      redirect: 'manual', // don't auto-follow (so we can capture cookies from 302)
    });
    jar.setFromResponse(res.headers.getSetCookie?.() || []);
    // If manual redirect, fetch the Location header
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (loc) return fetchGet(loc.startsWith('http') ? loc : new URL(loc, url).href, jar, timeout);
    }
    const body = await res.text();
    return { body, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPost(url: string, form: Record<string, string>, jar: CookieJar, timeout = 60_000): Promise<{ body: string; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const body = new URLSearchParams(form).toString();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': URL,
        'Origin': URL,
        'Cookie': jar.toHeader(),
      },
      body,
      signal: ctrl.signal,
      redirect: 'manual',
    });
    jar.setFromResponse(res.headers.getSetCookie?.() || []);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (loc) return fetchGet(loc.startsWith('http') ? loc : new URL(loc, url).href, jar, timeout);
    }
    const responseBody = await res.text();
    return { body: responseBody, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

function extractKeyForm(html: string): string | null {
  const m = html.match(/id="keyForm"[^>]*value="([^"]+)"/);
  return m ? m[1] : null;
}

function findNextStep(body: string): string | null {
  const m = body.match(/processName['"]?\s*[:=]\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

function extractContainerText(html: string, containerId: string): string | null {
  // Try textarea first (more reliable for content), then div
  const textareaPat = new RegExp(`<textarea[^>]*id="${containerId}"[^>]*>([\\s\\S]*?)</textarea>`, 'i');
  let m = textareaPat.exec(html);
  if (m) {
    return decodeEntities(stripTags(m[1]).replace(/\s+/g, ' ').trim());
  }
  const divPat = new RegExp(`<div[^>]*id="${containerId}"[^>]*>([\\s\\S]*?)</div>`, 'i');
  m = divPat.exec(html);
  if (m) {
    return decodeEntities(stripTags(m[1]).replace(/\s+/g, ' ').trim());
  }
  return null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/g, ' ');
}

function detectLang(text: string): string {
  // Simple heuristic — Resoomer's guessLanguage.js does similar
  // Check for Indonesian keywords
  const idKeywords = /\b(dan|atau|tetapi|karena|sebagai|yang|dengan|untuk|dari|pada|akan|sudah|bisa|adalah|dalam|oleh|ke|di)\b/gi;
  const idMatches = (text.match(idKeywords) || []).length;
  // English keywords
  const enKeywords = /\b(the|and|or|but|because|as|which|with|for|from|on|will|can|is|are|in|by|to|of|a)\b/gi;
  const enMatches = (text.match(enKeywords) || []).length;
  if (idMatches > enMatches * 1.5) return 'id';
  if (enMatches > 5) return 'en';
  return 'en'; // default to English
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export const POST: APIRoute = async ({ request }) => {
  const startedAt = Date.now();
  try {
    const session = await getSession(request);
    if (!session?.user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reqBody = await request.json() as { text?: string };
    const text = (reqBody.text || '').trim();
    if (!text || text.length < 100) {
      return Response.json({ error: 'Text too short (min 100 chars)' }, { status: 400 });
    }

    console.log(`[pre-summarize-resoomer] Start: ${text.length} chars, target mode=filtreSummary`);

    const jar = createCookieJar();

    // Step 1: GET homepage → cookies + keyForm
    console.log('[pre-summarize-resoomer] Step 1: GET homepage');
    const homeRes = await fetchGet(URL, jar, 30_000);
    const keyForm = extractKeyForm(homeRes.body);
    if (!keyForm) {
      throw new Error('Failed to extract keyForm from homepage');
    }
    const keyFormShort = keyForm.slice(0, 10);
    console.log(`[pre-summarize-resoomer] keyForm=${keyForm}, short=${keyFormShort}`);

    // Step 2: POST step 1 — sendText with featureView=filtreSummary
    console.log('[pre-summarize-resoomer] Step 2: POST sendText');
    const step1Res = await fetchPost(SUBMIT_URL, {
      featureView: 'filtreSummary',
      featureViewDesktop: URL,
      contentText: text,
      langSite: 'fr',
      keyForm,
      sampleText: '',
      adBlockerDetect: '0',
      enableProcess: '0',
      issetPost: '0',
      contentIndexText: '0',
      contentIndexTextView: '',
      submitFromIndexSummary: '0',
      alternateAds: '0',
      alternateAdsWidth: '',
    }, jar, 60_000);
    let nextStep = findNextStep(step1Res.body);
    console.log(`[pre-summarize-resoomer] Step 2 response: ${step1Res.body.length} chars, next=${nextStep}`);

    // Step 3-7: Multi-step pipeline (part_2 to part_6)
    const lang = detectLang(text);
    let stepNum = 1;
    while (nextStep && stepNum < 10 && Date.now() - startedAt < TIMEOUT_MS - 15_000) {
      stepNum++;
      console.log(`[pre-summarize-resoomer] Step ${stepNum}: POST ${nextStep} (lang=${lang})`);
      const stepRes = await fetchPost(SUBMIT_URL, {
        processing: '1',
        langSite: 'fr',
        adBlockerDetect: '0',
        sampleText: '0',
        keyForm: keyFormShort,
        processName: nextStep,
        langText: lang,
      }, jar, 60_000);
      console.log(`[pre-summarize-resoomer] Step ${stepNum} response: ${stepRes.body.length} chars`);
      nextStep = findNextStep(stepRes.body);
    }

    // Step 8: POST changeViewResult=filtre (switch to filtre mode)
    console.log('[pre-summarize-resoomer] Step 8: POST changeViewResult=filtre');
    const changeRes = await fetchPost(URL, {
      ViewResultSelect: 'filtre',
      changeViewResult: '1',
    }, jar, 30_000);
    console.log(`[pre-summarize-resoomer] ChangeView response: ${changeRes.body.length} chars`);

    // Step 9: GET homepage (now contains filtre summary in #returnFiltre)
    console.log('[pre-summarize-resoomer] Step 9: GET homepage (after changeView)');
    const finalRes = await fetchGet(URL, jar, 30_000);
    console.log(`[pre-summarize-resoomer] Final homepage: ${finalRes.body.length} chars`);

    // Extract filtre summary
    const filtreText = extractContainerText(finalRes.body, 'returnFiltre')
      || extractContainerText(finalRes.body, 'defautTextFiltre')
      || extractContainerText(finalRes.body, 'defautSentences');

    if (!filtreText || filtreText.length < 50) {
      throw new Error(`Failed to extract filtre summary (got ${filtreText?.length || 0} chars)`);
    }

    console.log(`[pre-summarize-resoomer] ✓ DONE: ${text.length} → ${filtreText.length} chars (${(filtreText.length * 100 / text.length).toFixed(0)}% retention) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

    return Response.json({
      summary: filtreText,
      method: 'resoomer-filtreSummary',
      originalLength: text.length,
      summaryLength: filtreText.length,
    });
  } catch (e: any) {
    console.error('[pre-summarize-resoomer] error:', e?.message?.slice(0, 300), e?.stack?.slice(0, 500));
    return Response.json({
      summary: null,
      error: 'api_error',
      message: e?.message || 'Resoomer pre-summarize failed',
    }, { status: 200 }); // 200 so client can fall back gracefully
  }
};
