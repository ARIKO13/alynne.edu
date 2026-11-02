/**
 * Database HTTP client — Turso (libSQL)
 *
 * Riwayat: dulu client ini nembak Cloudflare D1 HTTP API, tapi token CF
 * mati dan D1 ternyata bukan database primary (kosong). Primary sekarang
 * Turso: libsql://alynne-edu-arushiko.aws-ap-southeast-1.turso.io
 *
 * Interface TIDAK berubah supaya 10+ route yang `import { d1 }` di sini
 * tidak perlu disentuh:
 *   d1.query<T>(sql, params)  → T[]          (SELECT)
 *   d1.execute(sql, params)   → { changes, lastRowId }  (INSERT/UPDATE/DELETE)
 *
 * Transport: Turso/libSQL HTTP v2 pipeline (POST /v2/pipeline).
 */

function getEnv() {
  return typeof process !== 'undefined' && process.env
    ? process.env
    : (globalThis as any).__env || {};
}

const env = getEnv();
const TURSO_URL = String(env.TURSO_DATABASE_URL || env.LIBSQL_URL || '')
  .replace(/^libsql:\/\//, 'https://')
  .replace(/\/+$/, '');
const TURSO_TOKEN = env.TURSO_AUTH_TOKEN || env.LIBSQL_AUTH_TOKEN || '';

if (!TURSO_URL) {
  console.warn('[db] TURSO_DATABASE_URL tidak diset — semua query DB akan gagal');
}

// Argumen dikirim dalam format typed Hrana (Turso v2).
function toHranaArg(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return { type: 'null', value: null };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { type: 'int', value: v } : { type: 'float', value: v };
  }
  if (typeof v === 'boolean') return { type: 'int', value: v ? 1 : 0 };
  return { type: 'str', value: String(v) };
}

// Nilai balikan bisa berupa typed object {type,value} (server lama/baru) atau JSON biasa.
function unwrapVal(v: unknown): unknown {
  if (v && typeof v === 'object' && 'value' in (v as any) && 'type' in (v as any)) {
    return (v as any).value;
  }
  return v;
}

interface HranaResult {
  cols: Array<{ name: string }>;
  rows: unknown[][];
  affected_row_count?: number;
  last_insert_rowid?: { value?: unknown } | unknown;
}

async function runPipeline(
  statements: Array<{ sql: string; args: unknown[] }>
): Promise<HranaResult[]> {
  const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TURSO_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: statements.map((s) => ({
        type: 'execute',
        stmt: { sql: s.sql, args: s.args.map(toHranaArg) },
      })),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Turso API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const out: HranaResult[] = [];
  for (const r of data.results ?? []) {
    const errObj = r?.error ?? (r?.type === 'error' ? r : null);
    if (errObj) {
      throw new Error(`Turso query error: ${errObj.message || errObj.code || 'unknown'}`);
    }
    const result = r?.response?.result;
    if (!result) continue; // 'ok' tanpa result (mis. step close)
    out.push(result as HranaResult);
  }
  return out;
}

async function unwrap<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<HranaResult> {
  const results = await runPipeline([{ sql, args: params }]);
  const first = results[0];
  if (!first) throw new Error(`Turso: no result for query: ${sql.slice(0, 80)}`);
  return first;
}

async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await unwrap<T>(sql, params);
  const cols = (result.cols || []).map((c) => c.name);
  return (result.rows || []).map((row) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((c, i) => {
      obj[c] = unwrapVal(row[i]);
    });
    return obj as T;
  });
}

async function execute(
  sql: string,
  params: unknown[] = []
): Promise<{ changes: number; lastRowId: number }> {
  const result = await unwrap(sql, params);
  const rawId = result.last_insert_rowid as { value?: unknown } | undefined;
  return {
    changes: result.affected_row_count ?? 0,
    lastRowId: Number((rawId && typeof rawId === 'object' ? rawId.value : rawId) ?? 0),
  };
}

export const d1 = { query, execute };
