/**
 * llm-health-log.ts — file-based log for LLM health checks + fallback events.
 *
 * Storage: /root/lina-learning/.data/llm-health/ (or wherever DATA_DIR points)
 *   - latest.json     — most recent health-check result (overwritten each run)
 *   - fallback.jsonl  — append-only log of fallback events (one JSON per line)
 *
 * Why file-based (not D1)?
 *   - LLM health is operational metadata, not user data. D1 is for User table.
 *   - File is faster to read in admin panel (no D1 round-trip).
 *   - Survives restarts, easy to grep/inspect manually.
 *
 * File rotation: fallback.jsonl grows unbounded. Admin should manually
 * archive/clear it periodically (e.g. monthly). Or set up logrotate.
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.LLM_HEALTH_DATA_DIR || '/root/lina-learning/.data/llm-health';
const LATEST_FILE = path.join(DATA_DIR, 'latest.json');
const FALLBACK_FILE = path.join(DATA_DIR, 'fallback.jsonl');

// ── Types ──────────────────────────────────────────────────────────
export interface ModelHealth {
  modelId: string;
  alive: boolean;
  replySnippet?: string;       // first 80 chars of successful reply
  errorType?: string;
  errorMessage?: string;
  responseMs: number;          // how long the test request took
}

export interface HealthCheckResult {
  checkedAt: string;           // ISO timestamp
  triggeredBy: 'cron' | 'manual' | 'fallback';  // who initiated
  proxyReachable: boolean;
  models: ModelHealth[];
}

export interface FallbackEvent {
  timestamp: string;           // ISO timestamp
  fromModel: string;
  toModel: string;
  task: string;
  errorType: string;
  errorMessage: string;
  endpoint: string;            // which call site triggered this (e.g. 'ai/chat', 'mindmaps/generate')
}

// ── Init ────────────────────────────────────────────────────────────
function ensureDataDir(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    // Ignore — likely already exists or no permission. Read calls will
    // fail gracefully below.
  }
}

// ── Health check writer ─────────────────────────────────────────────
export function recordHealthCheck(result: HealthCheckResult): void {
  ensureDataDir();
  try {
    fs.writeFileSync(LATEST_FILE, JSON.stringify(result, null, 2), 'utf-8');
  } catch (e) {
    console.error('[llm-health] failed to write latest.json:', e);
  }
}

// ── Health check reader ─────────────────────────────────────────────
export function getLatestHealth(): HealthCheckResult | null {
  try {
    const raw = fs.readFileSync(LATEST_FILE, 'utf-8');
    return JSON.parse(raw) as HealthCheckResult;
  } catch {
    return null;
  }
}

// ── Fallback event log (append-only) ───────────────────────────────
export function logFallbackEvent(event: FallbackEvent): void {
  ensureDataDir();
  try {
    fs.appendFileSync(FALLBACK_FILE, JSON.stringify(event) + '\n', 'utf-8');
  } catch (e) {
    console.error('[llm-health] failed to append fallback.jsonl:', e);
  }
}

// ── Fallback event reader ───────────────────────────────────────────
export function getRecentFallbackEvents(limit = 50): FallbackEvent[] {
  try {
    const raw = fs.readFileSync(FALLBACK_FILE, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    // Take last `limit` lines, reverse for newest-first
    const recent = lines.slice(-limit).reverse();
    return recent.map(line => {
      try { return JSON.parse(line) as FallbackEvent; }
      catch { return null; }
    }).filter((e): e is FallbackEvent => e !== null);
  } catch {
    return [];
  }
}

// ── Counts (for admin panel summary) ────────────────────────────────
export function getFallbackCount24h(): number {
  try {
    const raw = fs.readFileSync(FALLBACK_FILE, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let count = 0;
    for (const line of lines) {
      try {
        const ev = JSON.parse(line) as FallbackEvent;
        if (new Date(ev.timestamp).getTime() >= cutoff) count++;
      } catch { /* skip malformed */ }
    }
    return count;
  } catch {
    return 0;
  }
}
