import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decide,
  matchesName,
  policyVersion,
  type Check,
  type Organisation,
  type Identity,
} from '../src/domain.js';
import { liveCheck } from '../src/sources.js';
import { Store } from '../src/store.js';
import { backgroundCheck, workOnce } from '../src/worker.js';
import { startAutomation } from '../src/automation.js';
import { type RecordRemote } from '../src/publisher.js';

// Public source values observed 2026-10-14. Tests use memory-only transports, never public writes.
const examples = [
  {
    orgnr: '971377461',
    name: 'MILJØPARTIET DE GRØNNE',
    handle: 'mdg.no',
    displayName: 'Miljøpartiet De Grønne',
  },
  { orgnr: '890412882', name: 'AFTENPOSTEN AS', handle: 'aftenposten.no', displayName: 'Aftenposten' },
  { orgnr: '866948542', name: 'MORGENBLADET AS', handle: 'morgenbladet.no', displayName: 'Morgenbladet' },
];
const mdg = examples[0]!;
function organisation(example = mdg): Organisation {
  return { orgnr: example.orgnr, name: example.name, website: `www.${example.handle}`, deleted: false };
}
function identity(example = mdg): Identity {
  return {
    did: 'did:plc:abcdefghijklmnopqrstuvwx',
    handle: example.handle,
    displayName: example.displayName,
    pds: 'https://pds.example.org',
  };
}
function prepare() {
  const store = new Store(':memory:');
  store.set('import.phase', 'ready');
  store.set('registry.lastPoll', new Date().toISOString());
  return store;
}
function remote() {
  const records = new Map<string, unknown>();
  const client: RecordRemote = {
    mode: 'live',
    scope: 'all_matching',
    repo: 'did:plc:bcdefghijklmnopqrstuvwxy',
    async get(key) {
      return records.get(key);
    },
    async put(key, value) {
      records.set(key, value);
      return `at://${client.repo}/app.bsky.graph.verification/${key}`;
    },
    async delete(key) {
      records.delete(key);
    },
  };
  return { client, records };
}
const peers: Organisation[] = [
  {
    orgnr: '912482642',
    name: 'MILJØPARTIET DE GRØNNES STORTINGSGRUPPE',
    website: 'www.mdg.no',
    deleted: false,
  },
  { orgnr: '914736315', name: 'MILJØPARTIET DE GRØNNE KARMØY', website: 'mdg.no', deleted: false },
  { orgnr: '996054241', name: 'OSLO MILJØPARTIET DE GRØNNE', website: 'www.mdg.no/oslo/', deleted: false },
];

test('AS exception removes only one separate trailing AS from the registered name', () => {
  for (const [registered, profile] of [
    ['AFTENPOSTEN AS', 'Aftenposten'],
    ['MORGENBLADET AS', 'Morgenbladet'],
    ['  FJORDVERK\u00a0 ＡＳ ', ' fjordverk '],
    ['Fjordverk AS', 'Fjordverk AS'],
    ['MILJØPARTIET DE GRØNNE', ' Miljøpartiet  De Grønne '],
  ])
    assert.equal(matchesName(registered!, profile!), true, `${registered} / ${profile}`);
  for (const [registered, profile] of [
    ['AS FJORDVERK', 'Fjordverk'],
    ['FJORDVERK ASA', 'Fjordverk'],
    ['FJORDVERK A/S', 'Fjordverk'],
    ['ATLAS', 'Atl'],
    ['Fjordverk AS AS', 'Fjordverk'],
    ['Fjordverk', 'Fjordverk AS'],
    ['Fjordverk AS', 'Fjordverk Holding'],
    ['AS', ''],
    [' ', ' '],
    ['MORGENBLADET AS', 'Morgenbladet 📰'],
  ])
    assert.equal(matchesName(registered!, profile!), false, `${registered} / ${profile}`);
});

for (const example of examples)
  test(`${example.displayName}: fresh checks issue once and retain the actual profile name`, async () => {
    const store = prepare();
    const wire = remote();
    const org = organisation(example);
    try {
      store.upsertOrganisation(org);
      if (example === mdg) for (const peer of peers) store.upsertOrganisation(peer);
      store.db.exec('DELETE FROM jobs');
      let registryReads = 0;
      const check = () =>
        backgroundCheck(
          store,
          org.orgnr,
          false,
          async () => {
            registryReads++;
            return org;
          },
          async (handle) => (handle === example.handle ? identity(example) : undefined),
        );
      for (let i = 0; i < 2; i++) {
        store.enqueue(org.orgnr);
        await workOnce(store, wire.client, check);
        assert.equal(store.checks()[0]!.decision, 'match');
        assert.equal(store.checks()[0]!.policyVersion, policyVersion);
        assert.equal(wire.records.size, 1);
        assert.equal(store.publications()[0]!.record.displayName, example.displayName);
      }
      assert.equal(registryReads, 2, 'cached names must not authorize issuance');
      assert.equal(store.publications().length, 1);
      for (const peer of example === mdg ? peers : []) {
        const result = decide(
          peer,
          peer.website?.includes('/oslo') ? undefined : 'mdg.no',
          identity(example),
        );
        assert.notEqual(result.decision, 'match', peer.name);
      }
    } finally {
      store.close();
    }
  });

test('shared-domain uniqueness counts AS-equivalent and path-based names; there is no exact-name tie-breaker', () => {
  const store = prepare();
  const org = organisation(examples[1]!);
  try {
    store.upsertOrganisation(org);
    assert.equal(store.uniqueNameMatch('aftenposten.no', 'Aftenposten', org.orgnr), true);
    const peer = { ...org, orgnr: '123456789', name: 'AFTENPOSTEN', website: 'aftenposten.no/team' };
    store.upsertOrganisation(peer);
    assert.equal(store.uniqueNameMatch('www.aftenposten.no', 'Aftenposten', org.orgnr), false);
    assert.equal(store.uniqueNameMatch('aftenposten.no', 'Aftenposten', peer.orgnr), false);
    assert.equal(store.uniqueNameMatch('aftenposten.no', 'Aftenposten AS', org.orgnr), true);
    store.upsertOrganisation({ ...peer, deleted: true });
    assert.equal(store.uniqueNameMatch('aftenposten.no', 'Aftenposten', org.orgnr), true);
    assert.equal(store.uniqueNameMatch('aftenposten.no', 'Aftenposten', peer.orgnr), false);
    assert.equal(store.uniqueNameMatch('other.no', 'Aftenposten', org.orgnr), false);
    assert.equal(store.uniqueNameMatch('aftenposten.no', '', org.orgnr), false);
  } finally {
    store.close();
  }
});

test('a peer rename on an already shared domain queues withdrawal; resolving ambiguity permits fresh reissue', async () => {
  const store = prepare();
  const wire = remote();
  const org = organisation();
  const check = () =>
    liveCheck(
      org.orgnr,
      async () => org,
      async (handle) => (handle === 'mdg.no' ? identity() : undefined),
    );
  try {
    store.upsertOrganisation(org);
    for (const peer of peers) store.upsertOrganisation(peer);
    store.db.exec('DELETE FROM jobs');
    store.enqueue(org.orgnr);
    await workOnce(store, wire.client, check);
    assert.equal(wire.records.size, 1);
    store.upsertOrganisation({ ...peers[2]!, name: `${org.name} AS` });
    assert.ok(store.db.prepare('SELECT 1 FROM jobs WHERE key=?').get(org.orgnr));
    store.db.prepare('DELETE FROM jobs WHERE key<>?').run(org.orgnr);
    await workOnce(store, wire.client, check);
    assert.equal(wire.records.size, 0);
    assert.equal(store.checks()[0]!.decision, 'needs_review');
    store.upsertOrganisation(peers[2]!);
    store.db.prepare('DELETE FROM jobs WHERE key<>?').run(org.orgnr);
    await workOnce(store, wire.client, check);
    assert.equal(wire.records.size, 1);
  } finally {
    store.close();
  }
});

test('peer renames during identity lookup or publisher read cannot publish ambiguous evidence', async () => {
  for (const during of ['check', 'publication']) {
    const store = prepare();
    const wire = remote();
    const org = organisation();
    const rename = () => store.upsertOrganisation({ ...peers[0]!, name: org.name });
    try {
      store.upsertOrganisation(org);
      for (const peer of peers) store.upsertOrganisation(peer);
      store.db.exec('DELETE FROM jobs');
      store.enqueue(org.orgnr);
      if (during === 'publication')
        wire.client.get = async () => {
          rename();
          return undefined;
        };
      await workOnce(store, wire.client, async () => {
        const check: Check = await liveCheck(
          org.orgnr,
          async () => org,
          async (handle) => (handle === 'mdg.no' ? identity() : undefined),
        );
        if (during === 'check') rename();
        return check;
      });
      assert.equal(wire.records.size, 0, during);
      assert.ok(store.db.prepare('SELECT 1 FROM jobs WHERE key=?').get(org.orgnr));
    } finally {
      store.close();
    }
  }
});

test('policy upgrade queues previously rejected candidates once, without publishing saved results', async () => {
  const store = prepare();
  const tasks = { poll: async () => {}, work: async () => false };
  try {
    for (const example of examples) store.upsertOrganisation(organisation(example));
    store.upsertOrganisation({ orgnr: '123456789', name: 'No website', deleted: false });
    store.db.exec('DELETE FROM jobs');
    store.db.prepare('UPDATE organisations SET next_check=?').run(Date.now() + 86_400_000);
    store.set('worker.policyVersion', 'www-psl-v3');
    await (
      await startAutomation(store, { enabled: true }, tasks)
    )();
    assert.equal(store.status().queued, 3);
    assert.equal(store.get('worker.policyVersion'), policyVersion);
    assert.equal(store.publications().length, 0);
    store.db.exec('DELETE FROM jobs');
    await (
      await startAutomation(store, { enabled: true }, tasks)
    )();
    assert.equal(store.status().queued, 0);
  } finally {
    store.close();
  }
});
