import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.js';
import { backgroundCheck } from '../src/worker.js';
import { startAutomation } from '../src/automation.js';

const org = { orgnr: '922669708', name: 'DEVOTTA AS', website: 'devotta.no', deleted: false };
const identity = {
  did: 'did:plc:abcdefghijklmnopqrstuvwx',
  handle: 'devotta.no',
  displayName: 'DEVOTTA AS',
  pds: 'https://pds.example.org',
};
function ready(store: Store) {
  store.set('import.phase', 'ready');
  store.set('registry.lastPoll', new Date().toISOString());
  store.upsertOrganisation(org);
}

test('discovery reuses the fresh registry index, but a positive result requires a fresh organisation and identity', async () => {
  const store = new Store(':memory:');
  try {
    ready(store);
    let reads = 0;
    let identities = 0;
    const source = async () => {
      reads++;
      return { ...org, name: 'Changed name' };
    };
    const negative = await backgroundCheck(store, org.orgnr, false, source, async () => undefined);
    assert.equal(reads, 0);
    assert.equal(negative.decision, 'no_match');
    assert.equal(negative.registrySource, 'index');
    const check = await backgroundCheck(store, org.orgnr, false, source, async () => {
      identities++;
      return identity;
    });
    assert.equal(reads, 1);
    assert.equal(identities, 2);
    assert.equal(check.decision, 'needs_review');
    assert.equal(check.organisation.name, 'Changed name');
    const unavailable = await backgroundCheck(
      store,
      org.orgnr,
      false,
      async () => {
        throw new Error('503');
      },
      async () => identity,
    );
    assert.equal(unavailable.decision, 'unavailable');
  } finally {
    store.close();
  }
});

test('stale, incomplete, pilot and known-account checks bypass the registry cache', async () => {
  const store = new Store(':memory:');
  try {
    ready(store);
    let reads = 0;
    const source = async () => {
      reads++;
      return org;
    };
    const noIdentity = async () => undefined;
    await backgroundCheck(store, org.orgnr, true, source, noIdentity);
    store.set('import.phase', 'catchup');
    await backgroundCheck(store, org.orgnr, false, source, noIdentity);
    ready(store);
    store.set('registry.lastPoll', '2000-01-01T00:00:00Z');
    await backgroundCheck(store, org.orgnr, false, source, noIdentity);
    ready(store);
    store.db.prepare('UPDATE organisations SET did=?').run(identity.did);
    await backgroundCheck(store, org.orgnr, false, source, noIdentity);
    assert.equal(reads, 4);
  } finally {
    store.close();
  }
});

test('ambiguous shared hosts stop before identity network access and never create a match', async () => {
  const store = new Store(':memory:');
  try {
    ready(store);
    store.upsertOrganisation({ ...org, orgnr: '123456789', website: 'www.devotta.no/tenant' });
    const unexpected = async (): Promise<never> => {
      throw new Error('Unexpected network access');
    };
    const check = await backgroundCheck(store, org.orgnr, false, unexpected, unexpected);
    assert.equal(check.decision, 'needs_review');
    assert.equal(check.registrySource, 'index');
  } finally {
    store.close();
  }
});

test('bounded workers continue during a blocked registry poll and shutdown drains both', async () => {
  const store = new Store(':memory:');
  const releases: (() => void)[] = [];
  let releasePoll!: () => void;
  let calls = 0;
  let active = 0;
  let peak = 0;
  let stopped = false;
  const stop = await startAutomation(
    store,
    { enabled: true, concurrency: 3 },
    {
      poll: async () => {
        await new Promise<void>((resolve) => {
          releasePoll = resolve;
        });
      },
      work: async () => {
        calls++;
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active--;
        return true;
      },
    },
  );
  try {
    const deadline = Date.now() + 5000;
    while (calls < 3 && Date.now() < deadline) await delay(20);
    assert.equal(calls, 3);
    await delay(300);
    assert.equal(calls, 3, 'pool must not exceed configured concurrency');
    assert.equal(peak, 3);
    releases.shift()!();
    while (calls < 4 && Date.now() < deadline) await delay(20);
    assert.equal(calls, 4, 'a free slot must not wait for the slowest worker');
    const draining = stop().then(() => {
      stopped = true;
    });
    await delay(20);
    assert.equal(stopped, false);
    for (const release of releases) release();
    releasePoll();
    await draining;
    assert.equal(active, 0);
    assert.equal(store.get('worker.active'), '0');
  } finally {
    for (const release of releases) release();
    releasePoll();
    await stop();
    store.close();
  }
});
