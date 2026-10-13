import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FixtureSource } from '../src/sources.js';
import { fixtureRemote } from '../src/publisher.js';
import { Store } from '../src/store.js';
import { workOnce } from '../src/worker.js';

// Only the isolated fixture transport is used. No public credentials or endpoints.
const fixture = new FixtureSource('http://fixture:2584');
const network = await fixture.state('valid');
const remote = {
  ...(await fixtureRemote(new URL('http://fixture:2583'), network.issuer)),
  allowedOrgnrs: new Set([network.organisation.orgnr]),
};
const dir = await mkdtemp(join(tmpdir(), 'worker-pds-'));
const database = join(dir, 'worker.sqlite');
let store = new Store(database);
let scenario: 'valid' | 'name_changed' = 'valid';
const check = async () => fixture.check(await fixture.state(scenario));
try {
  store.set('import.phase', 'ready');
  store.set('registry.lastPoll', new Date().toISOString());
  store.enqueue(network.organisation.orgnr);
  await workOnce(store, remote, check);
  const publication = store.publications()[0]!;
  assert.equal(publication.state, 'published');
  const initial = await remote.get(publication.rkey);
  assert.ok(initial);
  store.close();
  store = new Store(database);
  store.enqueue(network.organisation.orgnr);
  await workOnce(store, remote, check);
  assert.deepEqual(await remote.get(publication.rkey), initial);
  scenario = 'name_changed';
  store.enqueue(network.organisation.orgnr);
  await workOnce(store, remote, check);
  assert.equal(await remote.get(publication.rkey), undefined);
  assert.equal(store.publications()[0]!.state, 'revoked');
  console.log('PASS: durable worker → real isolated PDS → database reopen → no duplicate → withdrawal');
} finally {
  for (const p of store.publications()) await remote.delete(p.rkey);
  await fixture.state('valid');
  store.close();
  await rm(dir, { recursive: true });
}
