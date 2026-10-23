import type { APIRoute } from 'astro';
import { callLLM, extractJson } from '@/lib/gateway-client';

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

export const POST: APIRoute = async ({ request }) => {
  try {
    const { text } = await request.json();
    if (!text?.trim() || text.trim().length < 30) {
      return Response.json({ error: 'Teks terlalu pendek' }, { status: 400 });
    }

    const maxInput = 4000;
    const inputText = text.length > maxInput ? text.slice(0, maxInput) + '...' : text;

    const userPrompt = 'Analisa teks berikut dan buat mind map:\n\n' + inputText;

    // ===== pi-bansos ONLY (no Groq/Gateway fallback) =====
    // callLLM('structured-json') → Cohere primary → Nemotron → Poolside.
    // If all 3 fail, returns null → 500 error to client.
    console.log('[mindmap-gen] Trying pi-bansos...');
    const result = await callLLM('structured-json', SYSTEM_PROMPT, userPrompt, {
      maxTokens: 2048,
      timeout: 60_000,
      temperature: 0.3,
      endpoint: 'mindmaps/generate',
    });

    if (!result.content) {
      return Response.json({ error: 'pi-bansos gagal (semua 3 model gagal). Coba lagi.' }, { status: 500 });
    }

    try {
      const parsed = JSON.parse(extractJson(result.content));
      if (!parsed.title || !Array.isArray(parsed.branches) || parsed.branches.length === 0) {
        throw new Error('Invalid structure');
      }
      return Response.json({ ...parsed, source: 'pi-bansos', model: result.modelUsed });
    } catch (e) {
      console.error('[mindmap-gen] Parse error:', e);
      return Response.json({ error: 'Gagal memparse mind map' }, { status: 500 });
    }
  } catch (e) {
    console.error('[mindmap-gen] Unhandled:', e);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
};
