import type { APIRoute } from 'astro';
import { callLLM, extractJson } from '@/lib/gateway-client';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = ['llama-3.1-8b-instant', 'llama3-70b-8192'];

const SYSTEM_PROMPT = `Kamu adalah AI ahli mind mapping. TUGASMU: analisa teks transcript dan buat struktur mind map dalam JSON.

ATURAN:
1. Identifikasi TOPIK UTAMA (1 kata/frasa singkat, maks 4 kata).
2. Identifikasi 4-7 BRANCH utama (konsep kunci utama).
3. Setiap branch boleh punya 2-4 SUB-TOPIC (konsep pendukung).
4. Gunakan bahasa yang SAMA dengan input (Indonesia atau English).
5. Label harus RINGKAS: 1-4 kata per node.
6. Sub-topics harus RELEVAN dan spesifik, bukan generik.
7. Urutkan branch dari paling penting.

Kembalikan HANYA JSON valid (tanpa markdown, tanpa penjelasan):
{"title":"Topik Utama","branches":[{"label":"Branch 1","subtopics":["Sub 1a","Sub 1b"]},{"label":"Branch 2","subtopics":["Sub 2a","Sub 2b","Sub 2c"]}]}

Contoh output untuk transcript tentang fotosintesis:
{"title":"Fotosintesis","branches":[{"label":"Faktor","subtopics":["Cahaya matahari","Air dan mineral","Klorofil"]},{"label":"Proses","subtopics":["Fotolisis","Siklus Calvin","Elektron transport"]},{"label":"Hasil","subtopics":["Glukosa","Oksigen","ATP"]},{"label":"Lokasi","subtopics":["Tilakoid","Stroma","Kloroplas"]}]}`;

const GATEWAY_URL = 'https://gateway.polyvorlabs.com/v1/chat/completions';
const GATEWAY_KEY = process.env.GATEWAY_API_KEY || '';
const GATEWAY_MODEL = 'groq/llama-3.1-8b-instant';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function callGroq(systemPrompt: string, userPrompt: string): Promise<string | null> {
  for (const model of GROQ_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await sleep(15000);
        const res = await fetch(GROQ_URL, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + (process.env.GROQ_API_KEY || ''), 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], temperature: 0.3, max_tokens: 2048 }),
          signal: AbortSignal.timeout(60000),
        });
        if (res.ok) {
          const data = await res.json();
          return data.choices?.[0]?.message?.content || null;
        }
        const errBody = await res.text().catch(() => '');
        console.error('[mindmap-gen] ' + model + ' HTTP ' + res.status + ': ' + errBody.slice(0, 150));
        if ([401, 403].includes(res.status)) break;
      } catch (e: any) {
        console.error('[mindmap-gen] ' + model + ' exception:', e?.message);
      }
    }
  }
  return null;
}

async function callGateway(systemPrompt: string, userPrompt: string): Promise<{ content: string | null; source: string }> {
  if (!GATEWAY_KEY) return { content: null, source: '' };
  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + GATEWAY_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: GATEWAY_MODEL, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], temperature: 0.3, max_tokens: 2048 }),
      signal: AbortSignal.timeout(60000),
    });
    if (res.ok) {
      const data = await res.json();
      return { content: data.choices?.[0]?.message?.content || null, source: 'gateway' };
    }
    const errBody = await res.text().catch(() => '');
    console.error('[mindmap-gen] gateway HTTP ' + res.status + ': ' + errBody.slice(0, 150));
  } catch (e: any) {
    console.error('[mindmap-gen] gateway exception:', e?.message);
  }
  return { content: null, source: '' };
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const { text } = await request.json();
    if (!text?.trim() || text.trim().length < 30) {
      return Response.json({ error: 'Teks terlalu pendek' }, { status: 400 });
    }

    const maxInput = 4000;
    const inputText = text.length > maxInput ? text.slice(0, maxInput) + '...' : text;

    const userPrompt = 'Analisa teks berikut dan buat mind map:\n\n' + inputText;

    // ===== Step 1: pi-bansos primary (Cohere → Nemotron → Poolside via callLLM) =====
    console.log('[mindmap-gen] Trying pi-bansos first...');
    const piResult = await callLLM('structured-json', SYSTEM_PROMPT, userPrompt, {
      maxTokens: 2048,
      timeout: 60_000,
      temperature: 0.3,
      endpoint: 'mindmaps/generate',
    });
    let raw: string | null = piResult.content;
    let source = 'pi-bansos';

    // ===== Step 2: Fall back to Groq if pi-bansos fails =====
    if (!raw) {
      console.log('[mindmap-gen] pi-bansos failed, trying Groq...');
      raw = await callGroq(SYSTEM_PROMPT, userPrompt);
      if (raw) source = 'groq';
    }

    // ===== Step 3: Last resort — Gateway =====
    if (!raw) {
      console.log('[mindmap-gen] Groq failed, trying Gateway API...');
      const gw = await callGateway(SYSTEM_PROMPT, userPrompt);
      raw = gw.content;
      if (raw) source = gw.source;
    }

    if (!raw) {
      return Response.json({ error: 'Gagal menghasilkan mind map (pi-bansos + Groq + Gateway all failed). Coba lagi.' }, { status: 500 });
    }

    try {
      const parsed = JSON.parse(extractJson(raw));
      if (!parsed.title || !Array.isArray(parsed.branches) || parsed.branches.length === 0) {
        throw new Error('Invalid structure');
      }
      return Response.json({ ...parsed, source });
    } catch (e) {
      console.error('[mindmap-gen] Parse error:', e);
      return Response.json({ error: 'Gagal memparse mind map' }, { status: 500 });
    }
  } catch (e) {
    console.error('[mindmap-gen] Unhandled:', e);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
};
