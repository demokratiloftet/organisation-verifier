import { setTimeout as delay } from 'node:timers/promises';
import { type AutomationConfig } from './config.js';
import { startJetstream } from './jetstream.js';
import { privateRemote, publicRemote } from './publisher.js';
import { pollRegistry } from './registry.js';
import { Store } from './store.js';
import { workOnce } from './worker.js';
import { policyVersion } from './domain.js';

export async function startAutomation(
  store: Store,
  config: AutomationConfig,
  tasks = { poll: pollRegistry, work: workOnce },
): Promise<() => Promise<void>> {
  if (!config.enabled) return async () => {};
  const concurrency = config.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error('Worker concurrency must be between 1 and 8.');
  const remote = config.issuer
    ? await (config.issuer.private ? privateRemote : publicRemote)(config.issuer)
    : undefined;
  // A policy change can admit previously rejected candidates with no known DID.
  // Queue fresh checks once; never publish old results or redownload the registry.
  if (store.get('worker.policyVersion') !== policyVersion)
    store.transaction(() => {
      store.db
        .prepare(
          `INSERT INTO jobs(key,due,priority)
        SELECT orgnr,?,CASE WHEN did IS NULL THEN 0 ELSE 1 END FROM organisations
        WHERE host IS NOT NULL OR did IS NOT NULL
        ON CONFLICT(key) DO UPDATE SET due=MIN(jobs.due,excluded.due),revision=jobs.revision+1`,
        )
        .run(Date.now());
      store.set('worker.policyVersion', policyVersion);
    });
  // Recheck previously discovered accounts when expanding scope; never replay old positives as proof.
  if (config.issuer?.scope === 'all_matching')
    store.transaction(() => {
      for (const row of store.db.prepare('SELECT orgnr FROM organisations WHERE did IS NOT NULL').all())
        store.enqueue(String(row.orgnr), Date.now(), 1);
    });
  if (config.issuer) for (const orgnr of config.issuer.orgnrs) store.enqueue(orgnr, Date.now(), 2);
  const stopStream = config.jetstream ? startJetstream(store, config.jetstream) : () => {};
  const controller = new AbortController();
  let stopping = false;
  const pause = (ms: number) => delay(ms, undefined, { signal: controller.signal }).catch(() => {});

  // A slow website must not delay registry freshness; catch-up must not pause
  // checks/withdrawals. Only new issuance waits for a fully caught-up registry.
  const polling = (async () => {
    let failures = 0;
    while (!stopping) {
      try {
        await tasks.poll(store);
        failures = 0;
        store.set('registry.error', '');
      } catch {
        failures++;
        store.set('registry.error', 'Registeroppdatering feilet; forsøker igjen.');
      }
      await pause(
        failures
          ? Math.min(60_000, 1000 * 2 ** Math.min(failures, 6))
          : store.get('import.phase') === 'catchup'
            ? 1000
            : 60_000,
      );
    }
  })();

  const active = new Set<Promise<void>>();
  let completed = 0;
  let totalDuration = 0;
  const recent: number[] = [];
  let workError = '';
  let nextSchedule = 0;
  let nextPrune = 0;
  let nextMetrics = 0;
  store.set('worker.startedAt', new Date().toISOString());
  const running = (async () => {
    while (!stopping) {
      try {
        const now = Date.now();
        if (now >= nextSchedule) {
          store.schedule();
          nextSchedule = now + 60_000;
        }
        if (now >= nextPrune) {
          store.db
            .prepare("DELETE FROM checks WHERE json_extract(data,'$.checkedAt')<?")
            .run(new Date(now - 90 * 86_400_000).toISOString());
          nextPrune = now + 86_400_000;
        }
        if (active.size < concurrency) {
          const started = Date.now();
          const job = tasks
            .work(store, remote)
            .then((worked) => {
              workError = '';
              if (worked) {
                completed++;
                totalDuration += Date.now() - started;
                recent.push(Date.now());
              }
            })
            .catch(() => {
              workError = 'Bakgrunnsarbeidet feilet; forsøker igjen.';
            })
            .finally(() => active.delete(job));
          active.add(job);
        }
        if (now >= nextMetrics) {
          while (recent.length && recent[0]! < now - 60_000) recent.shift();
          store.transaction(() => {
            store.set('worker.heartbeat', new Date().toISOString());
            store.set('worker.error', workError);
            store.set('worker.concurrency', String(concurrency));
            store.set('worker.active', String(active.size));
            store.set('worker.completed', String(completed));
            store.set('worker.completedLastMinute', String(recent.length));
            store.set('worker.meanDurationMs', String(completed ? Math.round(totalDuration / completed) : 0));
          });
          nextMetrics = now + 1000;
        }
      } catch {
        store.set('worker.error', 'Bakgrunnsarbeidet feilet; forsøker igjen.');
      }
      // At most four job starts/second across the pool, including fast failures.
      await pause(250);
    }
    await Promise.allSettled(active);
    store.set('worker.active', '0');
  })();
  return async () => {
    stopping = true;
    controller.abort();
    stopStream();
    // Drain network work before the caller closes SQLite.
    await Promise.all([running, polling]);
  };
}
