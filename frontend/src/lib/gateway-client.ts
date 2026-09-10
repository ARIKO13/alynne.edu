/**
 * Shared Polyvor Gateway client for Lina Learning
 * Used by mindmap generate & structure-module APIs
 */

const GATEWAY_URL = 'https://gateway.polyvorlabs.com/v1/chat/completions';

// Model assignments per user spec
export const MODELS = {
  // Strong document reader + structured output
  structure: 'jr/gemini-3.1-pro' as const,
  // Alternative strong reader
  structureAlt: 'bb/gpt-5.4' as const,
  // Clean summarizer
  summary: 'bb/claude-sonnet-4.6' as const,
} as const;

const MAX_RETRIES = 2;
const RETRY_DELAYS = [5000, 15000]; // ms

export async function callPolyvor(model: string, systemPrompt: string, userContent: string, opts?: { maxTokens?: number; timeout?: number }): Promise<string | null> {
  const maxTokens = opts?.maxTokens ?? 4096;
  const timeout = opts?.timeout ?? 120_000;
  const key = process.env.GATEWAY_API_KEY || '';

  if (!key) {
    console.error('[gateway] No GATEWAY_API_KEY set');
    return null;
  }

  let lastError = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS[attempt - 1] || 15000;
      console.log('[gateway] ' + model + ' retry ' + attempt + '/' + MAX_RETRIES + ', waiting ' + (delay/1000) + 's...');
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const res = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: 0.2,
          max_tokens: maxTokens,
          stream: false,
        }),
        signal: AbortSignal.timeout(timeout),
      });

      if (res.status === 429) {
        lastError = 'Rate limited (429)';
        const errBody = await res.text().catch(() => '');
        console.error('[gateway] ' + model + ' HTTP 429: ' + errBody.slice(0, 100));
        continue; // retry
      }

      if (res.status === 401) {
        const errBody = await res.text().catch(() => '');
        console.error('[gateway] ' + model + ' HTTP 401: ' + errBody.slice(0, 100));
        return null; // don't retry auth errors
      }

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || null;
        if (content) {
          console.log('[gateway] ' + model + ' success (' + (data.usage?.total_tokens ?? '?') + ' tokens)');
          return content;
        }
        lastError = 'Empty response content';
        console.error('[gateway] ' + model + ' empty content');
        continue;
      }

      const errBody = await res.text().catch(() => '');
      lastError = 'HTTP ' + res.status;
      console.error('[gateway] ' + model + ' HTTP ' + res.status + ': ' + errBody.slice(0, 150));
      return null;
    } catch (e: any) {
      lastError = e?.message || 'unknown';
      console.error('[gateway] ' + model + ' fail: ' + lastError);
      if (lastError.includes('timeout') || lastError.includes('abort')) return null;
      continue;
    }
  }

  console.error('[gateway] ' + model + ' all retries failed: ' + lastError);
  return null;
}

export function extractJson(text: string): string {
  const cb = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cb) return cb[1].trim();
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : text;
}

export function extractMermaid(text: string): string {
  // Remove markdown fences if present
  let cleaned = text.replace(/```(?:mermaid)?\s*/g, '').replace(/```/g, '').trim();
  // Ensure it starts with 'mindmap'
  if (!cleaned.startsWith('mindmap')) {
    const idx = cleaned.indexOf('mindmap');
    if (idx >= 0) cleaned = cleaned.slice(idx);
  }
  return cleaned;
}
