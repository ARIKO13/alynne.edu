/**
 * Cron runner for LLM health check.
 *
 * Called daily by system cron on VPS:
 *   0 19 * * * cd /root/lina-learning-git/frontend && /usr/bin/tsx scripts/run-health-check.ts >> /var/log/llm-health.log 2>&1
 *
 * (19:00 UTC = 02:00 UTC+7 / WIB)
 *
 * Tests all 3 pi-bansos models via the local proxy, records result to
 * /root/lina-learning/.data/llm-health/latest.json so admin panel can read.
 * Bypasses HTTP entirely (no auth needed since this is CLI, not exposed).
 */
import { runHealthCheck } from '../src/pages/api/admin/llm-health';

async function main() {
  console.log(`[${new Date().toISOString()}] [cron] LLM health check starting...`);
  const t0 = Date.now();

  try {
    const result = await runHealthCheck('cron');
    const alive = result.models.filter(m => m.alive).length;
    const dead = result.models.length - alive;
    console.log(`[${new Date().toISOString()}] [cron] DONE in ${Date.now() - t0}ms — proxyReachable=${result.proxyReachable} alive=${alive}/${result.models.length} dead=${dead}`);

    if (!result.proxyReachable) {
      console.error('[cron][ERROR] pi-bansos proxy unreachable — pm2 status pi-bansos');
      process.exit(2);
    }
    if (alive === 0) {
      console.error('[cron][ERROR] all 3 models dead');
      process.exit(3);
    }
    if (dead > 0) {
      console.warn(`[cron][WARN] ${dead} model(s) dead — see admin panel for details`);
      // Exit 0 — partial failure is not a cron job failure (don't spam with cron error emails)
    }
    process.exit(0);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] [cron][FATAL]`, e);
    process.exit(1);
  }
}

main();
