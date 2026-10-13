import { setTimeout as delay } from 'node:timers/promises';
import { type AutomationConfig } from './config.js';
import { startJetstream } from './jetstream.js';
import { privateRemote, publicRemote } from './publisher.js';
import { pollRegistry } from './registry.js';
import { Store } from './store.js';
import { workOnce } from './worker.js';

export async function startAutomation(store: Store, config: AutomationConfig): Promise<() => Promise<void>> {
  if (!config.enabled) return async () => {};
  const remote = config.issuer
    ? await (config.issuer.private ? privateRemote : publicRemote)(config.issuer)
    : undefined;
  if (config.issuer) for (const orgnr of config.issuer.orgnrs) store.enqueue(orgnr, Date.now(), 2);
  const stopStream = config.jetstream ? startJetstream(store, config.jetstream) : () => {};
  const controller = new AbortController();
  let stopping = false;
  let nextPoll = 0;
  let nextSchedule = 0;
  let nextPrune = 0;
  const running = (async () => {
    while (!stopping) {
      try {
        if (Date.now() >= nextPoll) {
          try {
            await pollRegistry(store);
            store.set('registry.error', '');
          } catch {
            store.set('registry.error', 'Registeroppdatering feilet; forsøker igjen.');
          }
          nextPoll = Date.now() + (store.get('import.phase') === 'catchup' ? 1000 : 60_000);
        }
        if (stopping) break;
        if (Date.now() >= nextSchedule) {
          store.schedule();
          nextSchedule = Date.now() + 60_000;
        }
        if (Date.now() >= nextPrune) {
          // Keep publication evidence; cap routine check history to 90 days.
          store.db
            .prepare("DELETE FROM checks WHERE json_extract(data,'$.checkedAt')<?")
            .run(new Date(Date.now() - 90 * 86_400_000).toISOString());
          nextPrune = Date.now() + 86_400_000;
        }
        // Finish the finite snapshot replay before spending time on domain lookups.
        // Publication already waits for this same complete registry boundary.
        if (store.get('import.phase') !== 'catchup') await workOnce(store, remote);
        store.set('worker.heartbeat', new Date().toISOString());
        store.set('worker.error', '');
      } catch {
        store.set('worker.error', 'Bakgrunnsarbeidet feilet; forsøker igjen.');
      }
      await delay(1000, undefined, { signal: controller.signal }).catch(() => {});
    }
  })();
  return async () => {
    stopping = true;
    controller.abort();
    stopStream();
    await running;
  };
}
