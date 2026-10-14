import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store, type Publication } from '../src/store.js';
import type { Check } from '../src/domain.js';

const check: Check = {
  mode: 'live',
  organisation: { orgnr: '991965726', name: 'MULTIARC Kjernsmo', website: 'multiarc.no', deleted: false },
  candidate: 'multiarc.no',
  identity: {
    did: 'did:plc:example',
    handle: 'multiarc.no',
    displayName: 'Multiarc',
    pds: 'https://eurosky.social',
  },
  decision: 'needs_review',
  reason: 'Profilnavnet avviker.',
  checkedAt: '2026-10-14T18:00:00.000Z',
};

test('diagnostics finds exact register domains and org numbers, keeps bounded live history, and does not mutate state', () => {
  const store = new Store(':memory:');
  try {
    store.checked(check, Date.now() + 1000);
    for (let i = 0; i < 25; i++)
      store.saveCheck({
        ...check,
        checkedAt: new Date(Date.parse(check.checkedAt) + i * 1000).toISOString(),
      });
    store.saveCheck({ ...check, mode: 'fixture', reason: 'must not appear' });
    store.db
      .prepare("UPDATE jobs SET attempts=2,token='private-lease',error='internal-error' WHERE key=?")
      .run(check.organisation.orgnr);
    const publication: Publication = {
      mode: 'live',
      repo: 'did:plc:issuer',
      orgnr: check.organisation.orgnr,
      rkey: 'one',
      state: 'revoking',
      error: 'PDS-kallet feilet.',
      updatedAt: check.checkedAt,
      record: {
        $type: 'app.bsky.graph.verification',
        subject: check.identity!.did,
        handle: 'multiarc.no',
        displayName: 'MULTIARC Kjernsmo',
        createdAt: check.checkedAt,
      },
    };
    store.savePublication(publication);
    store.savePublication({ ...publication, rkey: 'old', repo: 'did:plc:old' });
    store.savePublication({ ...publication, rkey: 'fixture', mode: 'fixture' });
    const before = store.db.prepare('SELECT total_changes() n').get()!.n;
    for (const query of [
      '991965726',
      '991 965 726',
      'MULTIARC.NO',
      'https://multiarc.no/',
      'www.multiarc.no',
    ]) {
      const result = store.diagnostics(query, 'did:plc:issuer');
      assert.equal(result.items.length, 1);
      const item = result.items[0]!;
      assert.equal(item.checks.length, 20);
      assert(item.checks.every((c) => c.mode === 'live'));
      assert.equal(item.checks[0]!.identity?.displayName, 'Multiarc');
      assert.equal(item.job?.attempts, 2);
      assert.deepEqual(item.publications, [publication]);
      assert(!JSON.stringify(result).includes('private-lease'));
      assert(!JSON.stringify(result).includes('internal-error'));
    }
    assert.equal(store.db.prepare('SELECT total_changes() n').get()!.n, before);
    assert.deepEqual(store.diagnostics('unknown.no', '').items, []);
    assert.throws(() => store.diagnostics("' OR 1=1 --", ''));
    assert.throws(() => store.diagnostics('multiarc.no/path', ''));
    assert.equal(store.diagnostics('multiarc.no', '').items[0]!.publications.length, 0);
    store.upsertOrganisation({ ...check.organisation, orgnr: '999999999', name: 'Shared host' });
    assert.equal(store.diagnostics('multiarc.no', '').items.length, 2);
  } finally {
    store.close();
  }
});

test('attention overview deduplicates, excludes normal absence and fixture checks, and drops resolved cases', () => {
  const store = new Store(':memory:');
  try {
    for (let i = 0; i < 30; i++) store.saveCheck(check);
    store.saveCheck({
      ...check,
      mode: 'fixture',
      organisation: { ...check.organisation, orgnr: '999999999' },
    });
    store.saveCheck({
      ...check,
      decision: 'no_match',
      organisation: { ...check.organisation, orgnr: '888888888' },
    });
    assert.equal(store.diagnostics('', '').recent.length, 1);
    store.saveCheck({ ...check, decision: 'match' });
    assert.equal(store.diagnostics('', '').recent.length, 0);
    store.saveCheck({ ...check, decision: 'unavailable' });
    assert.equal(store.diagnostics('', '').recent[0]!.decision, 'unavailable');
  } finally {
    store.close();
  }
});
