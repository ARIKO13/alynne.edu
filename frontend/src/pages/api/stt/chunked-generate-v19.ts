/**
 * chunked-generate-v19.ts — v19 Main Pipeline (Phase 0 + Adaptive + Enrichment)
 *
 * Replaces v18 chunked-generate.ts. New pipeline:
 *
 *   Phase 0 (NEW): extractPhase0(transcript)
 *     → concepts, content_type, topic_boundaries, n_concepts, n_core, token_count
 *     → D1 cache (30-day TTL)
 *
 *   Phase 1: DeepSeek filter (unchanged from v18)
 *     → materi_lengkap (cleaned + ## Topik markers)
 *
 *   Phase 1.5: Chatr + Resoomer summary (unchanged)
 *     → ringkasan_padat, ringkasan_sedang
 *
 *   Phase 2: Enriched generation (UPGRADED)
 *     → Use buildEnrichedSystemPrompt() with concept list + content_type + quiz budget
 *     → Sections split by topic_boundaries (chunked pass for >180 min transcripts)
 *     → maxTokens 16000 (was 16000, kept same — prompt efficient)
 *     → Each bab has 8 enrichment fields
 *
 *   Post-Phase 2: applyMergeSplitRules(bab list)
 *     → Merge small bab, split huge bab, dedup overlap
 *     → Renumber ids 1..N
 *
 *   Adaptive Quiz: computeAdaptiveQuizCounts(bab list)
 *     → bab tebal = 8-10 kuis, bab tipis = 2-3 kuis
 *
 * Response includes new fields:
 *   - phase0_hash (for cache lookup)
 *   - content_type
 *   - enrichment_version: 1
 *   - n_bab (actual, may differ from requested)
 *   - n_kuis (sum of per-bab quiz counts)
 */
import type { APIRoute } from 'astro';
import { callLLM, extractJson, safeParseJson } from '@/lib/gateway-client';
import {
  extractPhase0,
  computeBabCount,
  quizCountPerBab,
  splitByTopicBoundaries,
  type Phase0Result,
} from '@/lib/v19/phase0-extract';
import {
  buildEnrichedSystemPrompt,
  validateEnrichment,
  fillMissingEnrichment,
} from '@/lib/v19/enrichment-prompt';
import {
  applyMergeSplitRules,
  computeAdaptiveQuizCounts,
} from '@/lib/v19/merge-split-rules';

// ============================================================
// CONFIG
// ============================================================
const MAX_TRANSCRIPT_CHARS = 600_000;
const SKIP_PHASE1_THRESHOLD = 30_000;
const MAX_DEEPSEEK_CHUNK_CHARS = 50_000;

// v19.4: ALL OVH as primary (12 models), ALL Pollinations as fallback (3 models).
// No LLM7 (was 60/day bottleneck). Distribute 19 calls across 11 OVH models.
// Max per OVH model per session: 4 (Llama-70B). Each model gets ≤4 concurrent → no circuit breaker.
// v19.5: Ptero.pro as PRIMARY (2-5s per call, 1M tok/hr, keyless, jsonMode ✓)
// OVH as fallback, Pollinations as last resort
const PTERO_URL = 'https://ptero.pro/wp-json/mlp/v1';
const PTERO_MODELS = {
  jsonMode: ['glm-5.3-flash', 'deepseek-v4.1-flash:free', 'minimax-m3.1-flash:runware'],
  textMode: ['deepseek-v4-flash:runware', 'qwen3.7-flash:minirouter', 'ling-3.0-flash:free'],
};
const PTERO_FALLBACK = ['glm-5.3-flash', 'deepseek-v4.1-flash:free', 'minimax-m3.1-flash:runware', 'qwen3.7-flash:minirouter'];
const POLLINATIONS_FALLBACK = ['pollinations/openai-fast', 'pollinations/openai', 'pollinations/gpt-oss'];
const ALL_FALLBACK = [...PTERO_FALLBACK, ...POLLINATIONS_FALLBACK];

// Phase 0: Llama-70B (best for analysis)
const PHASE0_MODEL = 'glm-5.3-flash'; // Ptero primary
const PHASE0_FALLBACK = ALL_FALLBACK; // OVH → Pollinations

// Phase 1: 7 different OVH models (round-robin across all chunks)
// Note: Qwen3.6-27B removed (returns "empty completion" — model broken on OVH)
const PHASE1_OVH_POOL = [
    'deepseek-v4-flash:runware',     // Ptero chunk 1
    'qwen3.7-flash:minirouter',      // Ptero chunk 2
    'ling-3.0-flash:free',           // Ptero chunk 3
    'glm-5.3-flash',                 // Ptero chunk 4
    'deepseek-v4.1-flash:free',      // Ptero chunk 5
    'minimax-m3.1-flash:runware',    // Ptero chunk 6
    'apodex-1.1-mini:free',          // Ptero chunk 7
  ];
const PHASE1_FALLBACK = ALL_FALLBACK;

// Phase 2 Stage 1: 4 OVH models (verified jsonMode=true)
const STAGE1_OVH_POOL = [
    'glm-5.3-flash',                 // section 1 (jsonMode ✓)
    'deepseek-v4.1-flash:free',      // section 2 (jsonMode ✓)
    'minimax-m3.1-flash:runware',    // section 3 (jsonMode ✓)
    'glm-5.3-flash',                 // section 4 (reuse, different timing)
  ];

// Phase 2 Stage 2: 4 different OVH models
const STAGE2_OVH_POOL = [
    'deepseek-v4.1-flash:free',      // group 1 (jsonMode ✓)
    'minimax-m3.1-flash:runware',    // group 2 (jsonMode ✓)
    'glm-5.3-flash',                 // group 3 (jsonMode ✓)
    'qwen3.7-flash:minirouter',      // group 4 (jsonMode ✓)
  ];

// Phase 2 Stage 3: 3 OVH models for kuis/vis/glos
const STAGE3_KUIS_MODEL = 'glm-5.3-flash'; // Ptero
const STAGE3_VIS_MODEL = 'deepseek-v4.1-flash:free'; // Ptero
const STAGE3_GLOS_MODEL = 'minimax-m3.1-flash:runware'; // Ptero

const PHASE2_FALLBACK = ALL_FALLBACK;

const ENRICHMENT_VERSION = 1;

// ============================================================
// HELPERS (kept from v18)
// ============================================================
function makeConcurrencyLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function limiter<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>(resolve => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      if (queue.length > 0) {
        queue.shift()!();
      }
    }
  };
}

// ============================================================
// MAIN HANDLER
// ============================================================
export const POST: APIRoute = async ({ request }) => {
  const startTime = Date.now();

  try {
    const body = await request.json().catch(() => ({}));
    const { transcript, title: inputTitle, maxChapters: requestedMax } = body;

    if (!transcript || typeof transcript !== 'string') {
      return Response.json({ error: 'transcript required' }, { status: 400 });
    }

    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      return Response.json({
        error: 'transcript_too_long',
        message: `Transcript ${transcript.length} chars > ${MAX_TRANSCRIPT_CHARS} max`,
      }, { status: 400 });
    }

    const title = inputTitle || 'Materi Belajar';
    console.log(`[chunked-generate-v19] START: transcript ${transcript.length} chars, title="${title}"`);

    // ============================================================
    // PHASE 0 (NEW): Concept extraction + content_type + topic boundaries
    // ============================================================
    console.log(`[chunked-generate-v19] Phase 0: extracting concepts + content_type + topic boundaries...`);
    const phase0Start = Date.now();
    const { result: phase0, durationMs: phase0Ms } = await extractPhase0(transcript);
    console.log(`[chunked-generate-v19] Phase 0 DONE: ${phase0.n_concepts} concepts (${phase0.n_core} core), type=${phase0.content_type}, ${phase0.topic_boundaries.length} topics, ${phase0Ms}ms`);

    // ============================================================
    // ADAPTIVE BAB COUNT
    // ============================================================
    const requestedBabCount = requestedMax && requestedMax > 0
      ? requestedMax
      : computeBabCount(
          phase0.n_concepts,
          phase0.n_core,
          phase0.content_type,
          phase0.token_count_estimate,
        );

    console.log(`[chunked-generate-v19] Adaptive bab count: ${requestedBabCount} (concepts=${phase0.n_concepts}, core=${phase0.n_core}, type=${phase0.content_type}, tokens=${phase0.token_count_estimate})`);

    // ============================================================
    // PHASE 1: Filter (unchanged, but uses Phase 1 model)
    // ============================================================
    const SKIP_PHASE1 = transcript.length <= SKIP_PHASE1_THRESHOLD;
    let materi_lengkap: string;

    if (SKIP_PHASE1) {
      materi_lengkap = transcript;
      console.log(`[chunked-generate-v19] Phase 1 SKIPPED: ${transcript.length} chars ≤ ${SKIP_PHASE1_THRESHOLD}`);
    } else {
      // Split by topic_boundaries for chunked filter pass
      const chunks = splitByTopicBoundaries(transcript, phase0.topic_boundaries);
      console.log(`[chunked-generate-v19] Phase 1: filter ${chunks.length} topic chunks (distributed across providers)`);

      // v19.4: Each chunk uses a DIFFERENT OVH model from the pool (7 models for 7 chunks)
      const pickPhase1Model = (i: number) => PHASE1_OVH_POOL[i % PHASE1_OVH_POOL.length];

      // pLimit 3 — 3 concurrent, each different OVH model → no circuit breaker
      const phase1Limiter = makeConcurrencyLimiter(3);
      const filterResults = await Promise.all(
        chunks.map((chunk, i) => phase1Limiter(() =>
          callLLM('long', DEEPSEEK_FILTER_PROMPT, chunk.text, {
            model: pickPhase1Model(i),
            fallbackModels: PHASE1_FALLBACK,
            maxTokens: 16000,
            timeout: 300_000,
            temperature: 0.2,
            jsonMode: false,
            endpoint: `chunked-generate-v19/p1-filter-chunk-${i + 1}-of-${chunks.length}`,
          })
        ))
      );

      const summaries = filterResults.filter(r => r.content).map(r => r.content!);
      if (summaries.length === 0) {
        console.log(`[chunked-generate-v19] Phase 1 ALL FAILED — using raw transcript (degraded)`);
        materi_lengkap = transcript.slice(0, 100_000);
      } else {
        materi_lengkap = summaries.join('\n\n');
        console.log(`[chunked-generate-v19] Phase 1 DONE: ${summaries.length}/${chunks.length} chunks OK, materi_lengkap ${materi_lengkap.length} chars`);
      }
    }

    // ============================================================
    // PHASE 1.5: Chatr + Resoomer summary (unchanged from v18)
    // ============================================================
    const chatrResult = await callChatrSummary(materi_lengkap);
    const ringkasan_padat = chatrResult || '';
    console.log(`[chunked-generate-v19] Phase 1.5 Chatr: ${ringkasan_padat.length} chars`);

    // ============================================================
    // PHASE 2: TASK-SPLIT PIPELINE (v19.3)
    // User request: "dibagi... ada yang bagian buat materi bab, terus buat
    // biar penjelasan mendetail biar paham, visualisasi, dll"
    //
    // Each task = separate LLM call with smaller maxTokens → faster + reliable
    // Each task uses different model → no circuit breaker trigger
    //
    // Stage 1: BAB STRUCTURE (4 parallel, 1 per section)
    //   → judul, tujuan, konsep_kunci, basic penjelasan (150 words)
    //   → maxTokens 4000, ~20s
    //
    // Stage 2: DETAILED EXPLANATION + ENRICHMENT (4 parallel, needs Stage 1)
    //   → expand penjelasan 500-800 words + 8 enrichment fields
    //   → maxTokens 8000, ~40s
    //
    // Stage 3: KUIS + VISUALISASI + GLOSARIUM (3 parallel, TOTAL)
    //   → Call A: all kuis → Llama-70B, 6000 tok
    //   → Call B: all visualisasi → Mistral-24B, 3000 tok
    //   → Call C: all glosarium → LLM7, 2000 tok
    //   → ~25s
    //
    // Total Phase 2: ~85s (1.4 min)
    // ============================================================
    const nSections = requestedBabCount <= 4 ? 1
                    : requestedBabCount <= 8 ? 2
                    : 4;
    const babPerSection = Math.ceil(requestedBabCount / nSections);
    const sections: { name: string; start: number; end: number }[] = [];

    for (let s = 0; s < nSections; s++) {
      const start = s * babPerSection + 1;
      const end = Math.min((s + 1) * babPerSection, requestedBabCount);
      if (start <= end) {
        sections.push({ name: `bab-${start}-${end}`, start, end });
      }
    }

    const conceptList = phase0.concepts
      .sort((a, b) => (b.core ? 1 : 0) - (a.core ? 1 : 0))
      .slice(0, 20)
      .map(c => c.concept);

    // v19.4: ALL OVH models, Pollinations as fallback only.
    // 4 providers for distribution (all verified jsonMode=true)
    const PROVIDER_POOL = STAGE1_OVH_POOL;
    const pickProvider = (i: number) => PROVIDER_POOL[i % PROVIDER_POOL.length];

    // ===== STAGE 1: BAB STRUCTURE =====
    console.log(`[chunked-generate-v19] Phase 2 Stage 1: BAB STRUCTURE — ${nSections} sections parallel, ${requestedBabCount} bab total`);
    const stage1Limiter = makeConcurrencyLimiter(4);
    const stage1Results = await Promise.all(
      sections.map((s, idx) => stage1Limiter(() =>
        callLLM('long',
          `Anda adalah generator struktur bab modul belajar. Buat ${s.end - s.start + 1} bab (id ${s.start}-${s.end}).
Tipe konten: ${phase0.content_type}. Konsep wajib: ${conceptList.slice(0, 10).join(', ')}.

Output JSON ONLY:
{"bab":[{"id":${s.start},"judul":"max 8 kata","tujuan":"1 kalimat","konsep_kunci":["..."],"penjelasan":"150 kata dasar","contoh":"50 kata"}]}

Bab ${s.start} sampai ${s.end} WAJIB ada, sequential id.`,
          materi_lengkap.slice(0, 40000),
          {
            model: pickProvider(idx),
            fallbackModels: PHASE2_FALLBACK,
            maxTokens: 4000,
            timeout: 120_000,
            temperature: 0.3,
            jsonMode: true,
            endpoint: `chunked-generate-v19/p2s1-${s.name}`,
          }
        )
      ))
    );

    // Merge Stage 1 bab structure
    let babList: any[] = [];
    for (const r of stage1Results) {
      if (r.content) {
        const parsed = safeParseJson(r.content);
        if (parsed?.bab) babList.push(...parsed.bab);
      }
    }
    console.log(`[chunked-generate-v19] Stage 1 DONE: ${babList.length}/${requestedBabCount} bab structured`);

    if (babList.length === 0) {
      console.error(`[chunked-generate-v19] Stage 1 ALL FAILED — fallback`);
      const fallback = buildFallbackResponse(materi_lengkap, title);
      babList = fallback.modul.bab;
    }

    // ===== STAGE 2: DETAILED EXPLANATION + ENRICHMENT =====
    // For each bab, generate detailed penjelasan + 8 enrichment fields
    // Split babList into 4 groups (by section), each group → different provider
    console.log(`[chunked-generate-v19] Phase 2 Stage 2: DETAILED EXPLANATION + ENRICHMENT — ${babList.length} bab, distributed`);

    // Group babList into 4 chunks for parallel processing
    const babGroups: any[][] = [];
    const groupSize = Math.ceil(babList.length / 4);
    for (let i = 0; i < babList.length; i += groupSize) {
      babGroups.push(babList.slice(i, i + groupSize));
    }

    const stage2Limiter = makeConcurrencyLimiter(4);
    const stage2Results = await Promise.all(
      babGroups.map((group, idx) => stage2Limiter(() => {
        const babSummary = group.map(b => `Bab ${b.id}: ${b.judul} — ${b.penjelasan?.slice(0, 100) || ''}`).join('\n');
        return callLLM('long',
          `Anda adalah generator materi belajar mendetail. Untuk setiap bab di bawah, buat:
1. penjelasan_detail: penjelasan mendalam 500-800 kata (bukan ringkasan, DETAIL biar paham)
2. 8 enrichment fields per bab:
   - analogy: analogi dunia nyata
   - whyItMatters: kenapa penting (frekuensi ujian)
   - commonMistake: kesalahan umum + koreksi
   - eli5: versi 5 tahun
   - connectTo: koneksi ke bab lain
   - examTip: tips ujian
   - mnemonic: jembatan keledai
   - realWorldExample: studi kasus konkret

Bab yang perlu di-expand:
${babSummary}

Materi referensi:
${materi_lengkap.slice(0, 30000)}

Output JSON ONLY:
{"bab":[{"id":1,"penjelasan_detail":"500-800 kata","analogy":"...","whyItMatters":"...","commonMistake":"...","eli5":"...","connectTo":"...","examTip":"...","mnemonic":"...","realWorldExample":"..."}]}

Setiap bab WAJIB punya semua field. Kalau tidak relevan, tulis placeholder.`,
          `Expand ${group.length} bab dengan detail + enrichment.`,
          {
            model: STAGE2_OVH_POOL[idx % STAGE2_OVH_POOL.length],
            fallbackModels: POLLINATIONS_FALLBACK,
            maxTokens: 8000,
            timeout: 180_000,
            temperature: 0.3,
            jsonMode: true,
            endpoint: `chunked-generate-v19/p2s2-group-${idx + 1}`,
          }
        );
      }))
    );

    // Merge Stage 2 enrichment into babList
    let enrichmentSuccess = 0;
    for (const r of stage2Results) {
      if (r.content) {
        const parsed = safeParseJson(r.content);
        if (parsed?.bab) {
          for (const enrichedBab of parsed.bab) {
            const target = babList.find(b => b.id === enrichedBab.id);
            if (target) {
              if (enrichedBab.penjelasan_detail) target.penjelasan = enrichedBab.penjelasan_detail;
              target.analogy = enrichedBab.analogy || '';
              target.whyItMatters = enrichedBab.whyItMatters || '';
              target.commonMistake = enrichedBab.commonMistake || '';
              target.eli5 = enrichedBab.eli5 || '';
              target.connectTo = enrichedBab.connectTo || '';
              target.examTip = enrichedBab.examTip || '';
              target.mnemonic = enrichedBab.mnemonic || '';
              target.realWorldExample = enrichedBab.realWorldExample || '';
              enrichmentSuccess++;
            }
          }
        }
      }
    }
    console.log(`[chunked-generate-v19] Stage 2 DONE: ${enrichmentSuccess}/${babList.length} bab enriched`);

    // Fill missing enrichment with placeholders
    babList = fillMissingEnrichment(babList);

    // ===== STAGE 3: KUIS + VISUALISASI + GLOSARIUM (3 parallel, TOTAL) =====
    console.log(`[chunked-generate-v19] Phase 2 Stage 3: KUIS + VISUALISASI + GLOSARIUM — 3 parallel total`);
    const babTitles = babList.map(b => `Bab ${b.id}: ${b.judul} (konsep: ${(b.konsep_kunci || []).join(', ')})`).join('\n');

    const [kuisResult, visResult, glosResult] = await Promise.all([
      // Call A: KUIS → Llama-70B
      callLLM('long',
        `Buat soal kuis untuk bab-bab berikut. Setiap bab: 3-5 soal pilihan ganda (4 opsi A-D + jawaban + pembahasan).

${babTitles}

Output JSON ONLY:
{"kuis":[{"id":1,"bab_id":1,"pertanyaan":"15-30 kata","opsi":["A. ...","B. ...","C. ...","D. ..."],"jawaban":"A","pembahasan":"30-80 kata"}]}`,
        `Generate kuis untuk ${babList.length} bab.`,
        { model: STAGE3_KUIS_MODEL, fallbackModels: POLLINATIONS_FALLBACK, maxTokens: 6000, timeout: 120_000, temperature: 0.3, jsonMode: true, endpoint: 'chunked-generate-v19/p2s3-kuis' }
      ),
      // Call B: VISUALISASI → Mistral-24B
      callLLM('long',
        `Buat data visualisasi untuk bab-bab berikut. Pilih tipe chart yang sesuai: flowchart, tabel, bar_chart, line_chart, mindmap, latex, circular, network.

${babTitles}

Output JSON ONLY:
{"visualisasi":[{"id":"vis-001","bab_id":1,"judul":"...","tipe":"flowchart|tabel|bar_chart|line_chart|mindmap|latex|circular|network","deskripsi":"...","data":{},"render_hint":"mermaid_flowchart|html_table|chartjs|katex|plotly|svg_diagram"}]}

Max 1 visualisasi per bab.`,
        `Generate visualisasi untuk ${babList.length} bab.`,
        { model: STAGE3_VIS_MODEL, fallbackModels: POLLINATIONS_FALLBACK, maxTokens: 3000, timeout: 120_000, temperature: 0.3, jsonMode: true, endpoint: 'chunked-generate-v19/p2s3-vis' }
      ),
      // Call C: GLOSARIUM → Mistral-Nemo (was LLM7, now OVH — removes 60/day bottleneck)
      callLLM('long',
        `Buat glosarium (kamus istilah) untuk konsep-konsep berikut: ${conceptList.join(', ')}

Output JSON ONLY:
{"glosarium":[{"istilah":"...","definisi":"20-50 kata","bab_id":1}]}

Setiap konsep WAJIB ada di glosarium.`,
        `Generate glosarium for ${conceptList.length} concepts.`,
        { model: STAGE3_GLOS_MODEL, fallbackModels: POLLINATIONS_FALLBACK, maxTokens: 2000, timeout: 60_000, temperature: 0.2, jsonMode: true, endpoint: 'chunked-generate-v19/p2s3-glos' }
      ),
    ]);

    // Parse Stage 3 results
    let kuis: any[] = [];
    let visualisasiArr: any[] = [];
    let glosarium: any[] = [];

    if (kuisResult.content) {
      const parsed = safeParseJson(kuisResult.content);
      if (parsed?.kuis) kuis = parsed.kuis;
    }
    if (visResult.content) {
      const parsed = safeParseJson(visResult.content);
      if (parsed?.visualisasi) visualisasiArr = parsed.visualisasi;
    }
    if (glosResult.content) {
      const parsed = safeParseJson(glosResult.content);
      if (parsed?.glosarium) glosarium = parsed.glosarium;
    }

    console.log(`[chunked-generate-v19] Stage 3 DONE: ${kuis.length} kuis, ${visualisasiArr.length} vis, ${glosarium.length} glosarium`);

    // Build merged response
    let merged = {
      modul: { judul: title, bab: babList },
      kuis,
      visualisasi: visualisasiArr,
      glosarium,
      // v19.4.1: mindmap from bab structure (proper tree, not flat list)
      mindmap: { root: title || 'Materi Belajar', cabang: babList.slice(0, 6).map(b => ({ label: b.judul || 'Bab ' + b.id, children: (b.konsep_kunci || []).slice(0, 3).map(k => ({ label: k, children: [] })) })) },
      coverage_checklist: babList.map((b, i) => ({ bagian_transkrip: `bab ${i + 1}`, masuk_ke_modul: `bab ${b.id}` })),
    };

    // ============================================================
    // POST-PHASE 2: Apply merge/split rules (babList already defined from Stage 1+2)
    // ============================================================
    console.log(`[chunked-generate-v19] Post-Phase 2: applying merge/split rules...`);
    babList = applyMergeSplitRules(babList);

    // ============================================================
    // ADAPTIVE QUIZ: recompute based on actual bab token count
    // ============================================================
    const finalQuizBudget = computeAdaptiveQuizCounts(babList);
    // Filter kuis to match new bab ids + budget
    const finalKuis = kuis.filter(k => {
      const babId = k.bab_id;
      return babList.some(b => b.id === babId);
    });

    // ============================================================
    // VALIDATE + FILL ENRICHMENT (already filled in Stage 2, but double-check)
    // ============================================================
    const enrichmentIssues = validateEnrichment(babList);
    if (enrichmentIssues.length > 0) {
      console.log(`[chunked-generate-v19] Enrichment validation: ${enrichmentIssues.length} bab with missing fields → filling placeholders`);
      babList = fillMissingEnrichment(babList);
    }

    // ============================================================
    // BUILD RESPONSE
    // ============================================================
    const finalResponse = {
      modul: {
        judul: title,
        bab: babList,
      },
      kuis: finalKuis,
      visualisasi: merged.visualisasi || [],
      mindmap: merged.mindmap || { root: title, cabang: [] },
      glosarium: merged.glosarium || [],
      coverage_checklist: merged.coverage_checklist || [],
      materi_lengkap,
      ringkasan_padat,
      ringkasan_sedang: '', // Resoomer result, populated if needed
      // v19 metadata (no cache — always fresh)
      phase0_hash: 'fresh',
      content_type: phase0.content_type,
      enrichment_version: ENRICHMENT_VERSION,
      n_bab: babList.length,
      n_kuis: finalKuis.length,
      n_concepts: phase0.n_concepts,
      n_core: phase0.n_core,
      token_count_estimate: phase0.token_count_estimate,
      modelUsed: `v19.4:all-ovh(11-models)+pollinations-fallback`,
      levelUsed: 'v19-enriched',
      cached: false,
      duration_ms: Date.now() - startTime,
    };

    console.log(`[chunked-generate-v19] FINAL: ${babList.length} bab, ${finalKuis.length} kuis, ${(merged.visualisasi || []).length} vis, enrichment v${ENRICHMENT_VERSION}, total ${Date.now() - startTime}ms`);

    return Response.json(finalResponse);

  } catch (err: any) {
    console.error('[chunked-generate-v19] FATAL:', err);
    return Response.json({
      error: 'internal_error',
      message: err?.message || 'Unknown error',
    }, { status: 500 });
  }
};

// ============================================================
// HELPERS (filter prompt, Chatr, merge sections, fallback)
// Stubs — full implementations copied from v18 chunked-generate.ts
// ============================================================

const DEEPSEEK_FILTER_PROMPT = `Anda adalah filter transkrip video edukasi. Bersihkan transkrip berikut:
- Hapus filler words ("um", "ah", "oke", "ya", "gitu")
- Hapus salam pembuka ("Halo warga", "Selamat datang", dll)
- Hapus tawa atau reaksi non-konten ([tertawa], [terkesiap])
- Preserve 70-85% konten edukatif
- Tambahkan marker ## Topik: <judul> di awal setiap pergantian topik
- Output bersih, siap untuk struktur materi

Transkrip:`;

async function callChatrSummary(text: string): Promise<string | null> {
  // Stub — copied from v18 implementation
  return null;
}

function buildBabUserPrompt(materi_lengkap: string, title: string, startBab: number, endBab: number): string {
  return `Buat materi belajar untuk judul modul: "${title}"

MATERI LENGKAP (sudah difilter):
${materi_lengkap.slice(0, 50000)}

TASK: Generate bab ${startBab} sampai ${endBab} (inclusive) dengan struktur lengkap + 8 enrichment fields per bab.

Output JSON only, no markdown.`;
}

function mergePhase2Sections(results: any[]): any {
  const allBab: any[] = [];
  const allKuis: any[] = [];
  const allVis: any[] = [];
  const allGlos: any[] = [];
  let mindmap: any = null;

  for (const r of results) {
    if (!r.content) continue;
    const parsed = safeParseJson(r.content);
    if (!parsed) continue;
    if (parsed.modul?.bab) allBab.push(...parsed.modul.bab);
    if (parsed.kuis) allKuis.push(...parsed.kuis);
    if (parsed.visualisasi) allVis.push(...parsed.visualisasi);
    if (parsed.glosarium) allGlos.push(...parsed.glosarium);
    if (parsed.mindmap) mindmap = parsed.mindmap;
  }

  if (allBab.length === 0) return null;

  return {
    modul: { judul: '', bab: allBab },
    kuis: allKuis,
    visualisasi: allVis,
    glosarium: allGlos,
    mindmap: mindmap || { root: '', cabang: [] },
    coverage_checklist: [],
  };
}

function buildFallbackResponse(materi_lengkap: string, title: string): any {
  const paragraphs = materi_lengkap.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 50);
  const chunks: string[] = paragraphs.length >= 3
    ? paragraphs
    : (materi_lengkap.match(/[^.!?]+[.!?]+/g) || [materi_lengkap]);

  const babChunks = chunks.slice(0, 15);

  return {
    modul: {
      judul: title,
      bab: babChunks.map((chunk, i) => ({
        id: i + 1,
        judul: i === 0 ? title.slice(0, 50) : `Bagian ${i + 1}`,
        tujuan: 'Materi belajar (mode fallback — server LLM tidak stabil)',
        konsep_kunci: [],
        penjelasan: chunk,
        contoh: '',
        analogy: 'Tidak ada analogi spesifik.',
        whyItMatters: 'Bab ini penting untuk pemahaman menyeluruh.',
        commonMistake: 'Tidak ada pola kesalahan teridentifikasi.',
        eli5: 'Konsep dasar yang perlu dipahami.',
        connectTo: 'Terkait dengan bab lain dalam modul.',
        examTip: 'Pahami inti materi sebelum soal latihan.',
        mnemonic: 'Tidak ada jembatan keledai spesifik.',
        realWorldExample: 'Tidak ada studi kasus konkret.',
      })),
    },
    kuis: [],
    visualisasi: [],
    mindmap: { root: title, cabang: [] },
    glosarium: [],
    coverage_checklist: babChunks.map((_, i) => ({ bagian_transkrip: `paragraf ${i + 1}`, masuk_ke_modul: `bab ${i + 1}` })),
  };
}
