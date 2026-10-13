import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { backup, DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.js';
import { importSnapshot, queueUpdates, pollRegistry } from '../src/registry.js';
import { queueEvent } from '../src/jetstream.js';
import { policyVersion, type Check } from '../src/domain.js';
import { workOnce, maxEvidenceAge } from '../src/worker.js';
import { type RecordRemote } from '../src/publisher.js';

const org = { orgnr: '922669708', name: 'DEVOTTA AS', website: 'devotta.no', deleted: false };
const positive: Check = {
  mode: 'live',
  policyVersion,
  organisation: org,
  candidate: 'devotta.no',
  decision: 'match',
  reason: 'test',
  identity: {
    did: 'did:plc:abcdefghijklmnopqrstuvwx',
    handle: 'devotta.no',
    displayName: 'DEVOTTA AS',
    pds: 'https://pds.example.org',
  },
  checkedAt: new Date().toISOString(),
};
function remote() {
  const records = new Map<string, unknown>();
  const client: RecordRemote = {
    mode: 'live',
    allowedOrgnrs: new Set([org.orgnr]),
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
function ready(store: Store) {
  store.set('import.phase', 'ready');
  store.set('registry.lastPoll', new Date().toISOString());
}

test('job leases recover, events arriving during a check survive its acknowledgement, and retries back off', () => {
  const store = new Store(':memory:');
  try {
    store.enqueue(org.orgnr, 100);
    const first = store.claim(100)!;
    assert.equal(store.claim(101), undefined);
    store.enqueue(org.orgnr, 101);
    store.finish(first, undefined, 102);
    const second = store.claim(102)!;
    assert.ok(second);
    assert.notEqual(second.token, first.token);
    const recovered = store.claim(120_103)!;
    assert.ok(recovered);
    store.finish(second); // stale worker must not delete the recovered lease
    assert.equal(store.status().queued, 1);
    store.finish(recovered, 'failure', 120_104);
    assert.equal(store.claim(120_105), undefined);
    assert.equal(store.claim(150_104)!.attempts, 1);
  } finally {
    store.close();
  }
});

test('old database migrates without losing history; backup restores queue, source cursors and publications', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'verifier-restore-'));
  const path = join(dir, 'source.sqlite');
  const old = new DatabaseSync(path);
  old.exec(
    'CREATE TABLE checks(id INTEGER PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE publications(rkey TEXT PRIMARY KEY,data TEXT NOT NULL)',
  );
  old.prepare('INSERT INTO checks(data) VALUES (?)').run(JSON.stringify(positive));
  old.close();
  const store = new Store(path);
  try {
    store.enqueue(org.orgnr);
    store.set('registry.cursor', '42');
    store.savePublication({
      mode: 'live',
      repo: 'did:plc:test',
      orgnr: org.orgnr,
      rkey: 'one',
      state: 'pending',
      updatedAt: positive.checkedAt,
      record: {
        $type: 'app.bsky.graph.verification',
        subject: positive.identity!.did,
        handle: 'devotta.no',
        displayName: org.name,
        createdAt: positive.checkedAt,
      },
    });
    const copy = join(dir, 'backup.sqlite');
    await backup(store.db, copy);
    const restored = new Store(copy);
    try {
      assert.equal(restored.checks().length, 1);
      assert.equal(restored.get('registry.cursor'), '42');
      assert.equal(restored.claim()!.key, org.orgnr);
      assert.equal(restored.publications()[0]!.state, 'pending');
    } finally {
      restored.close();
    }
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});

test('streamed snapshot imports idempotently, catches shared/path domains, and advances updates atomically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'verifier-import-'));
  const store = new Store(':memory:');
  try {
    const file = join(dir, 'snapshot.json.gz');
    await writeFile(
      file,
      gzipSync(
        JSON.stringify([
          { organisasjonsnummer: org.orgnr, navn: org.name, hjemmeside: 'devotta.no' },
          { organisasjonsnummer: '123456789', navn: 'Other', hjemmeside: 'https://devotta.no/tenant' },
        ]),
      ),
    );
    assert.equal(await importSnapshot(store, file, '2026-10-01T00:00:00Z'), 2);
    assert.equal(store.sharedHost('devotta.no'), true);
    assert.equal(store.get('import.phase'), 'catchup');
    assert.equal(await importSnapshot(store, file, '2026-10-01T00:00:00Z'), 2);
    assert.equal(store.status().organisations, 2);
    queueUpdates(store, [{ oppdateringsid: 4, organisasjonsnummer: org.orgnr, endringstype: 'Endring' }]);
    assert.equal(store.get('registry.cursor'), '4');
    const revision = store.db.prepare('SELECT revision FROM jobs WHERE key=?').get(org.orgnr)!.revision;
    queueUpdates(store, [{ oppdateringsid: 4, organisasjonsnummer: org.orgnr, endringstype: 'Endring' }]);
    assert.equal(
      store.db.prepare('SELECT revision FROM jobs WHERE key=?').get(org.orgnr)!.revision,
      revision,
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});

test('interrupted import keeps progress, remains unpublished, and can replay the same snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'verifier-resume-'));
  const store = new Store(':memory:');
  try {
    const file = join(dir, 'snapshot.json.gz');
    const rows = Array.from({ length: 600 }, (_, i) => ({
      organisasjonsnummer: String(100000000 + i),
      navn: `Org ${i}`,
      hjemmeside: `org${i}.no`,
    }));
    await writeFile(file, gzipSync(JSON.stringify(rows)));
    const upsert = store.upsertOrganisation.bind(store);
    let fail = true;
    store.upsertOrganisation = (organisation, seen) => {
      if (fail && organisation.orgnr === '100000300') throw new Error('interrupted');
      upsert(organisation, seen);
    };
    await assert.rejects(importSnapshot(store, file, '2026-10-01T00:00:00Z'), /interrupted/);
    assert.equal(store.get('import.count'), '250');
    assert.equal(store.get('import.phase'), 'loading');
    assert.equal(await workOnce(store), false);
    fail = false;
    assert.equal(await importSnapshot(store, file, '2026-10-01T00:00:00Z'), 600);
    assert.equal(store.status().organisations, 600);
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});

test('Jetstream events enqueue authoritative checks and duplicates cannot advance or amplify work', () => {
  const store = new Store(':memory:');
  try {
    store.upsertOrganisation(org);
    store.db.exec('DELETE FROM jobs');
    const event = {
      $type: 'message',
      payload: {
        $type: 'network.bsky.jetstream.subscribeEvents#identity',
        seq: 10,
        time: '2026-10-11T12:00:00Z',
        did: positive.identity!.did,
        identity: { handle: 'devotta.no' },
      },
    };
    queueEvent(store, event);
    queueEvent(store, event);
    assert.equal(store.status().queued, 1);
    assert.equal(store.get('jetstream.cursor'), '10');
    assert.equal(store.claim()!.revision, 1);
    assert.throws(() => queueEvent(store, { $type: 'message', payload: { seq: 11, did: 'garbage' } }));
    assert.equal(store.get('jetstream.cursor'), '10');
    assert.equal(store.publications().length, 0);
  } finally {
    store.close();
  }
});

test('worker publishes only approved live checks, retries outages, expires stale evidence and revokes shared domains', async () => {
  const store = new Store(':memory:');
  const wire = remote();
  ready(store);
  try {
    store.enqueue(org.orgnr);
    await workOnce(store, wire.client, async () => positive);
    assert.equal(wire.records.size, 1);
    const key = store.publications()[0]!.rkey;
    store.enqueue(org.orgnr);
    await workOnce(store, wire.client, async () => positive);
    assert.equal(store.publications()[0]!.rkey, key);
    store.enqueue(org.orgnr);
    await workOnce(store, wire.client, async () => ({ ...positive, decision: 'unavailable' }));
    assert.equal(wire.records.size, 1);
    assert.equal(store.status().retrying, 1);
    store.db
      .prepare('UPDATE organisations SET last_success=? WHERE orgnr=?')
      .run(Date.now() - maxEvidenceAge - 1000, org.orgnr);
    store.enqueue(org.orgnr);
    await workOnce(store, wire.client, async () => ({ ...positive, decision: 'unavailable' }));
    assert.equal(wire.records.size, 0);
    store.enqueue(org.orgnr);
    await workOnce(store, wire.client, async () => positive);
    assert.equal(wire.records.size, 1);
    store.upsertOrganisation({ ...org, orgnr: '123456789', website: 'devotta.no/team' });
    store.db.prepare('DELETE FROM jobs WHERE key<>?').run(org.orgnr);
    store.enqueue(org.orgnr);
    await workOnce(store, wire.client, async () => positive);
    assert.equal(wire.records.size, 0);
    assert.equal(store.checks()[0]!.decision, 'needs_review');
  } finally {
    store.close();
  }
});

test('preview, incomplete import and out-of-pilot checks never issue public records', async () => {
  for (const phase of ['loading', 'catchup', 'ready']) {
    const store = new Store(':memory:');
    const wire = remote();
    try {
      store.set('import.phase', phase);
      store.enqueue(org.orgnr);
      await workOnce(store, wire.client, async () => positive);
      assert.equal(wire.records.size, 0); // ready without a fresh registry poll also blocks writes
    } finally {
      store.close();
    }
  }
  const store = new Store(':memory:');
  const wire = remote();
  ready(store);
  try {
    store.enqueue(org.orgnr);
    await workOnce(store, undefined, async () => positive);
    assert.equal(wire.records.size, 0);
    store.enqueue('123456789');
    await workOnce(store, wire.client, async () => ({
      ...positive,
      organisation: { ...org, orgnr: '123456789' },
    }));
    assert.equal(wire.records.size, 0);
  } finally {
    store.close();
  }
});

test('expiry and leaving the pilot revoke existing publications even when registry monitoring is unavailable', async () => {
  const store = new Store(':memory:');
  const wire = remote();
  ready(store);
  try {
    store.enqueue(org.orgnr);
    await workOnce(store, wire.client, async () => positive);
    assert.equal(wire.records.size, 1);
    store.set('registry.lastPoll', '2000-01-01T00:00:00Z');
    store.db.prepare('UPDATE organisations SET last_success=?').run(Date.now() - maxEvidenceAge - 1000);
    store.enqueue(org.orgnr);
    await workOnce(store, wire.client, async () => ({ ...positive, decision: 'unavailable' }));
    assert.equal(wire.records.size, 0);
    ready(store);
    store.enqueue(org.orgnr);
    await workOnce(store, wire.client, async () => positive);
    assert.equal(wire.records.size, 1);
    wire.client.allowedOrgnrs = new Set();
    store.enqueue(org.orgnr);
    await workOnce(store, wire.client, async () => positive);
    assert.equal(wire.records.size, 0);
  } finally {
    store.close();
  }
});

test('registry catch-up fetches entries before committing jobs and cursor; a failed lookup replays the whole page', async () => {
  const store = new Store(':memory:');
  try {
    store.set('registry.since', '2026-10-01T00:00:00Z');
    store.set('import.source', 'snapshot');
    store.set('import.phase', 'ready');
    const updates = [
      { oppdateringsid: 5, organisasjonsnummer: org.orgnr, endringstype: 'Endring' },
      { oppdateringsid: 6, organisasjonsnummer: '123456789', endringstype: 'Ny' },
    ];
    await assert.rejects(
      pollRegistry(
        store,
        async () => updates,
        async (id) => {
          if (id === '123456789') throw new Error('503');
          return org;
        },
      ),
    );
    assert.equal(store.get('registry.cursor'), undefined);
    assert.equal(store.organisation(org.orgnr), undefined);
    assert.equal(store.get('import.phase'), 'catchup');
    await pollRegistry(
      store,
      async () => updates,
      async (id) => ({ ...org, orgnr: id }),
    );
    assert.equal(store.get('registry.cursor'), '6');
    assert.equal(store.sharedHost('devotta.no'), true);
    assert.equal(store.get('import.phase'), 'catchup');
    await pollRegistry(
      store,
      async () => [],
      async () => {
        throw new Error('not called');
      },
    );
    assert.equal(store.get('import.phase'), 'ready');
    const enqueue = store.enqueue.bind(store);
    store.enqueue = () => {
      throw new Error('disk failure');
    };
    assert.throws(
      () =>
        queueUpdates(store, [{ oppdateringsid: 7, organisasjonsnummer: org.orgnr, endringstype: 'Endring' }]),
      /disk failure/,
    );
    assert.equal(store.get('registry.cursor'), '6');
    store.enqueue = enqueue;
  } finally {
    store.close();
  }
});

test('Jetstream identity events without handles use discovery jobs; retention gaps schedule a full recheck', () => {
  const store = new Store(':memory:');
  try {
    store.upsertOrganisation(org);
    store.db.exec('DELETE FROM jobs; UPDATE organisations SET next_check=9999999999999');
    queueEvent(store, {
      $type: 'message',
      payload: {
        $type: 'network.bsky.jetstream.subscribeEvents#identity',
        seq: 10,
        time: '2026-10-11T12:00:00Z',
        did: positive.identity!.did,
        identity: { did: positive.identity!.did },
      },
    });
    assert.equal(store.claim()!.key, positive.identity!.did);
    queueEvent(store, {
      $type: 'message',
      payload: { $type: 'network.bsky.jetstream.subscribeEvents#info', name: 'OutdatedCursor' },
    });
    assert.equal(store.get('jetstream.gap'), 'OutdatedCursor');
    store.schedule();
    assert.equal(store.status().queued, 2);
    assert.equal(store.get('jetstream.cursor'), '0');
  } finally {
    store.close();
  }
});

test('pre-upgrade backup does not migrate the source database', async () => {
  const { backupDatabase } = await import('../src/backup.js');
  const dir = await mkdtemp(join(tmpdir(), 'verifier-before-upgrade-'));
  try {
    const path = join(dir, 'old.sqlite');
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE example(value TEXT); INSERT INTO example VALUES ('kept')");
    db.close();
    const copy = join(dir, 'before.sqlite');
    await backupDatabase(path, copy);
    for (const file of [path, copy]) {
      const read = new DatabaseSync(file, { readOnly: true });
      assert.equal(read.prepare('PRAGMA user_version').get()!.user_version, 0);
      assert.equal(read.prepare('SELECT value FROM example').get()!.value, 'kept');
      read.close();
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('shared-domain changes recheck unique/shared transitions without fanning out across every tenant', () => {
  const store = new Store(':memory:');
  try {
    for (let i = 0; i < 100; i++)
      store.upsertOrganisation({ ...org, orgnr: String(100000000 + i), website: 'shared.no/tenant' + i });
    store.db.exec('DELETE FROM jobs');
    store.upsertOrganisation({ ...org, orgnr: '200000000', website: 'shared.no/new' });
    assert.equal(store.status().queued, 1);
    store.db.exec('DELETE FROM jobs');
    store.upsertOrganisation({ ...org, orgnr: '200000001', website: 'unique.no' });
    store.upsertOrganisation({ ...org, orgnr: '200000002', website: 'unique.no' });
    store.db.exec('DELETE FROM jobs');
    store.upsertOrganisation({ ...org, orgnr: '200000002', deleted: true });
    assert.equal(store.claim()!.key, '200000001');
  } finally {
    store.close();
  }
});

test('www and bare hosts share conflict checks and event/recheck scheduling, including existing rows', async () => {
  const store = new Store(':memory:');
  const wire = remote();
  ready(store);
  const wwwOrg = { ...org, website: 'www.devotta.no' };
  const check = { ...positive, organisation: wwwOrg };
  try {
    store.enqueue(org.orgnr);
    await workOnce(store, wire.client, async () => check);
    assert.equal(wire.records.size, 1);
    assert.deepEqual(store.affected('did:plc:unknown', 'devotta.no'), [org.orgnr]);
    // A path-based tenant still counts as conflicting registered use of the bare domain.
    store.upsertOrganisation({ ...org, orgnr: '123456789', website: 'devotta.no/team' });
    assert.equal(store.sharedHost('devotta.no'), true);
    assert.equal(store.sharedHost('www.devotta.no'), true);
    assert(store.db.prepare('SELECT 1 FROM jobs WHERE key=?').get(org.orgnr));
    store.db.prepare('DELETE FROM jobs WHERE key<>?').run(org.orgnr);
    await workOnce(store, wire.client, async () => check);
    assert.equal(wire.records.size, 0);
    assert.equal(store.checks()[0]!.decision, 'needs_review');
    store.upsertOrganisation({ ...org, orgnr: '123456789', deleted: true });
    assert.equal(store.sharedHost('devotta.no'), false);
    assert(store.db.prepare('SELECT 1 FROM jobs WHERE key=?').get(org.orgnr));
  } finally {
    store.close();
  }
});

test('a regressed Jetstream sequence with newer evidence recovers and schedules rechecks; replay duplicates do not', () => {
  const store = new Store(':memory:');
  try {
    store.upsertOrganisation(org);
    store.db.exec('DELETE FROM jobs; UPDATE organisations SET next_check=9999999999999');
    store.set('jetstream.cursor', '26940181548');
    store.set('jetstream.time', '2026-10-13T12:28:59.458Z');
    const event = (seq: number, witnessedAt: string) => ({
      $type: 'message',
      payload: {
        $type: 'network.bsky.jetstream.subscribeEvents#identity',
        seq,
        witnessedAt,
        did: positive.identity!.did,
        identity: { handle: 'devotta.no' },
      },
    });
    queueEvent(store, event(25989630252, '2026-10-13T12:28:58Z'));
    assert.equal(store.get('jetstream.cursor'), '26940181548');
    assert.equal(store.get('jetstream.gap'), undefined);
    assert.equal(store.status().queued, 0);
    queueEvent(store, event(25989630252, '2026-10-13T17:20:48.975Z'));
    assert.equal(store.get('jetstream.gap'), 'SequenceReset');
    assert.equal(store.get('jetstream.cursor'), '25989630252');
    assert.equal(store.status().queued, 1);
    assert.equal(
      store.db.prepare('SELECT next_check FROM organisations WHERE orgnr=?').get(org.orgnr)!.next_check,
      0,
    );
    const revision = store.db.prepare('SELECT revision FROM jobs WHERE key=?').get(org.orgnr)!.revision;
    queueEvent(store, event(25989630252, '2026-10-13T17:20:48.975Z'));
    assert.equal(
      store.db.prepare('SELECT revision FROM jobs WHERE key=?').get(org.orgnr)!.revision,
      revision,
    );
    queueEvent(store, event(25989630259, '2026-10-13T17:20:49Z'));
    assert.equal(store.get('jetstream.cursor'), '25989630259');
  } finally {
    store.close();
  }
});
