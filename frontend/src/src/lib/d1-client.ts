/**
 * Cloudflare D1 HTTP API Client
 */

function getEnv() {
  // In Astro server context, use import.meta.env or process.env
  return typeof process !== 'undefined' && process.env
    ? process.env
    : (globalThis as any).__env || {};
}

const env = getEnv();
const CF_ACCOUNT_ID = env.CF_ACCOUNT_ID!;
const CF_DATABASE_ID = env.CF_DATABASE_ID!;
const CF_API_TOKEN = env.CF_API_TOKEN!;

const D1_API_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_DATABASE_ID}/query`;

interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  meta: {
    changed_db: boolean;
    changes: number;
    duration: number;
    last_row_id: number;
    rows_read: number;
    rows_written: number;
    size_after: number;
  };
  results: T[];
}

// D1 HTTP API wraps results in a top-level envelope
interface D1ApiResponse<T = Record<string, unknown>> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result: D1Result<T>[];
}

async function unwrap<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<D1Result<T>> {
  const res = await fetch(D1_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`D1 API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as D1ApiResponse<T>;

  if (!data.success) {
    const errMsg = data.errors?.map(e => e.message).join(', ') || 'Unknown error';
    throw new Error(`D1 query error: ${errMsg}`);
  }

  // D1 wraps each query result in the "result" array
  const firstResult = data.result?.[0];
  if (!firstResult) {
    throw new Error(`D1: no result returned for query: ${sql.slice(0, 80)}`);
  }

  return firstResult;
}

async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await unwrap<T>(sql, params);
  return result.results || [];
}

async function execute(
  sql: string,
  params: unknown[] = []
): Promise<{ changes: number; lastRowId: number }> {
  const result = await unwrap(sql, params);
  return {
    changes: result.meta?.changes ?? 0,
    lastRowId: result.meta?.last_row_id ?? 0,
  };
}

export const d1 = { query, execute };
