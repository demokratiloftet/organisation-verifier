import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startAutomation } from '../src/automation.js';
import { Store } from '../src/store.js';
import { workOnce } from '../src/worker.js';

// Deterministic latency, no DNS, Brreg or PDS traffic. Includes real SQLite leases,
// scheduling, the shared start-rate limit and independent worker refill.
for (const concurrency of [1, 4]) {
  const store = new Store(':memory:');
  const jobs = 16;
  for (let i = 0; i < jobs; i++) store.enqueue(String(100000000 + i));
  const started = performance.now();
  const stop = await startAutomation(
    store,
    { enabled: true, concurrency },
    {
      poll: async () => {},
      work: (db, remote) =>
        workOnce(db, remote, async (orgnr) => {
          await delay(1200);
          return {
            mode: 'live',
            organisation: { orgnr, name: orgnr, deleted: false },
            decision: 'no_match',
            reason: 'Synthetic benchmark',
            checkedAt: new Date().toISOString(),
          };
        }),
    },
  );
  try {
    while (store.status().queued && performance.now() - started < 60_000) await delay(25);
    assert.equal(store.status().queued, 0);
    console.log(JSON.stringify({ concurrency, jobs, milliseconds: Math.round(performance.now() - started) }));
  } finally {
    await stop();
    store.close();
  }
}
