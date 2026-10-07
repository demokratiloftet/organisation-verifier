import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Publisher, type RecordRemote } from '../src/publisher.js';
import { Store } from '../src/store.js';
import type { Check } from '../src/domain.js';

const check: Check = {
  mode: 'fixture',
  organisation: { orgnr: '000000001', name: 'Fjordverk AS', website: 'fjordverk.test', deleted: false },
  candidate: 'fjordverk.test',
  identity: {
    did: 'did:plc:abcdefghijklmnopqrstuvwx',
    handle: 'fjordverk.test',
    displayName: 'Fjordverk AS',
    pds: 'http://fixture:2583',
  },
  checkedAt: '2026-10-07T12:00:00.000Z',
  decision: 'match',
  reason: 'Test',
};
function remote() {
  const records = new Map<string, unknown>();
  let writes = 0;
  let uncertainPut = false;
  let uncertainDelete = false;
  const client: RecordRemote = {
    repo: 'did:plc:bcdefghijklmnopqrstuvwxy',
    async get(key) {
      return records.get(key);
    },
    async put(key, value) {
      writes++;
      records.set(key, value);
      if (uncertainPut) {
        uncertainPut = false;
        throw new Error('Connection lost after commit');
      }
      return `at://${client.repo}/app.bsky.graph.verification/${key}`;
    },
    async delete(key) {
      records.delete(key);
      if (uncertainDelete) {
        uncertainDelete = false;
        throw new Error('Connection lost after delete');
      }
    },
  };
  return {
    client,
    records,
    writes: () => writes,
    losePutResponse: () => {
      uncertainPut = true;
    },
    loseDeleteResponse: () => {
      uncertainDelete = true;
    },
  };
}
test('lost put response + process restart reconciles at the same key, with unchanged createdAt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifier-'));
  const path = join(dir, 'test.sqlite');
  const wire = remote();
  let store = new Store(path);
  try {
    wire.losePutResponse();
    await new Publisher(store, wire.client).apply(check);
    const pending = store.publications()[0]!;
    assert.equal(pending.state, 'pending');
    assert.equal(wire.records.size, 1);
    store.close();
    store = new Store(path);
    await new Publisher(store, wire.client).apply(check);
    await new Publisher(store, wire.client).apply(check);
    assert.equal(store.publications().length, 1);
    assert.equal(store.publications()[0]!.rkey, pending.rkey);
    assert.equal(store.publications()[0]!.record.createdAt, pending.record.createdAt);
    assert.equal(store.publications()[0]!.state, 'published');
    assert.equal(wire.writes(), 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
test('temporary outage keeps a record; changed evidence revokes it, including a lost delete response', async () => {
  const store = new Store(':memory:');
  const wire = remote();
  const publisher = new Publisher(store, wire.client);
  try {
    await publisher.apply(check);
    await publisher.apply({ ...check, decision: 'unavailable' });
    assert.equal(wire.records.size, 1);
    wire.loseDeleteResponse();
    await publisher.apply({ ...check, decision: 'needs_review' });
    assert.equal(store.publications()[0]!.state, 'revoking');
    await publisher.apply({ ...check, decision: 'needs_review' });
    assert.equal(wire.records.size, 0);
    assert.equal(store.publications()[0]!.state, 'revoked');
  } finally {
    store.close();
  }
});
test('live mode and unexpected remote record contents cannot cause writes or deletes', async () => {
  const store = new Store(':memory:');
  const wire = remote();
  const publisher = new Publisher(store, wire.client);
  try {
    await assert.rejects(publisher.apply({ ...check, mode: 'live' }), /kan ikke publisere/);
    assert.equal(wire.writes(), 0);
    await publisher.apply(check);
    const publication = store.publications()[0]!;
    wire.records.set(publication.rkey, { unexpected: true });
    await publisher.apply({ ...check, decision: 'no_match' });
    assert.equal(wire.records.size, 1);
    assert.match(store.publications()[0]!.error!, /Manuell kontroll/);
  } finally {
    store.close();
  }
});
