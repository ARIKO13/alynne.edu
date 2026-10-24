import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * POST /api/admin/stt-fix
 * Body: { wrongWord: string, correctWord: string, type?: 'phrase' | 'ticker' | 'company' }
 *
 * Adds a new phonetic mapping to phonetic-map.json on the VPS, then
 * hot-reloads the in-memory dictionary cache so the new mapping is
 * immediately active (no PM2 restart needed).
 *
 * This is the Feedback Loop endpoint:
 *   1. Admin sees an unknown word in STT Failures view
 *   2. Admin types the correct mapping (e.g., "go dua" → "GOTO")
 *   3. This endpoint saves it to phonetic-map.json
 *   4. Cache is reset → next fuzzy-correct call picks up the new mapping
 *   5. The same unknown word will never fail again
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email || !isAdmin(session.user.email)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      wrongWord?: string;
      correctWord?: string;
      type?: 'phrase' | 'ticker' | 'company';
    };

    const wrongWord = (body.wrongWord || '').trim().toLowerCase();
    const correctWord = (body.correctWord || '').trim();
    if (!wrongWord || !correctWord) {
      return Response.json({ error: 'wrongWord and correctWord required' }, { status: 400 });
    }

    // Find phonetic-map.json on VPS
    const candidates = [
      join(process.cwd(), 'backend', 'data', 'phonetic-map.json'),
      '/root/lina-learning/backend/data/phonetic-map.json',
      join(process.cwd(), 'phonetic-map.json'),
    ];
    let phoneticPath = '';
    for (const p of candidates) {
      if (existsSync(p)) { phoneticPath = p; break; }
    }
    if (!phoneticPath) {
      return Response.json({ error: 'phonetic-map.json not found on server' }, { status: 500 });
    }

    // Read current file
    const raw = readFileSync(phoneticPath, 'utf-8');
    const phoneticMap = JSON.parse(raw);

    // Determine which field to add to based on type
    const type = body.type || 'phrase';
    let targetField: string;
    if (type === 'ticker') {
      targetField = 'phonetic_tickers';
    } else if (type === 'company') {
      targetField = 'company_names';
    } else {
      // Default: add to phonetic_tickers if correctWord looks like a ticker
      // (all caps, 2-4 letters), otherwise add to company_names
      if (/^[A-Z]{2,5}$/.test(correctWord)) {
        targetField = 'phonetic_tickers';
      } else {
        targetField = 'company_names';
      }
    }

    if (!phoneticMap[targetField]) {
      phoneticMap[targetField] = {};
    }

    // Check if mapping already exists
    const existing = phoneticMap[targetField][wrongWord];
    if (existing === correctWord) {
      return Response.json({
        success: true,
        message: 'Mapping already exists',
        field: targetField,
        wrongWord,
        correctWord,
        alreadyExists: true,
      });
    }

    // Add the new mapping
    phoneticMap[targetField][wrongWord] = correctWord;

    // Write back
    writeFileSync(phoneticPath, JSON.stringify(phoneticMap, null, 2));

    // Hot-reload: reset the in-memory cache so the next request reloads
    // We need to import the cache-reset function from stt-dictionary.ts
    try {
      const { resetDictionaryCache } = await import('@/lib/stt-dictionary');
      resetDictionaryCache();
    } catch (e) {
      console.warn('[stt-fix] Could not reset cache (will reload on next PM2 restart):', e);
    }

    const totalInField = Object.keys(phoneticMap[targetField]).length;
    console.log(`[stt-fix] Added: '${wrongWord}' → '${correctWord}' (${targetField}, now ${totalInField} entries)`);

    return Response.json({
      success: true,
      message: `Mapping added: "${wrongWord}" → "${correctWord}"`,
      field: targetField,
      wrongWord,
      correctWord,
      totalInField,
      cacheReset: true,
    });
  } catch (error) {
    console.error('[stt-fix] error:', error);
    return Response.json({ error: 'Failed to add mapping' }, { status: 500 });
  }
};
