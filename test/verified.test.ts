import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store, type Publication } from '../src/store.js';

test('directory scopes active public records to the current issuer, paginates beyond history, and searches literal Norwegian text', () => {
  const store = new Store(':memory:');
  const publication: Publication = {
    mode: 'live',
    repo: 'did:plc:issuer',
    orgnr: '922669708',
    rkey: 'base',
    state: 'published',
    updatedAt: '2026-10-14T17:14:35.000Z',
    record: {
      $type: 'app.bsky.graph.verification',
      subject: 'did:plc:subject',
      handle: 'devotta.no',
      displayName: 'Devotta AS',
      createdAt: '2026-10-14T17:00:00.000Z',
    },
  };
  try {
    for (let i = 0; i < 107; i++)
      store.savePublication({
        ...publication,
        rkey: String(i),
        orgnr: String(900000000 + i),
        record: { ...publication.record, displayName: `Organisasjon ${String(i).padStart(3, '0')}` },
      });
    for (const [i, change] of [
      { state: 'pending' as const },
      { state: 'revoking' as const },
      { state: 'revoked' as const },
      { repo: 'did:plc:old-issuer' },
      { mode: 'fixture' as const },
      { error: 'Uncertain result' },
    ].entries())
      store.savePublication({ ...publication, ...change, rkey: `excluded-${i}` });
    const first = store.verifiedOrganisations(publication.repo);
    assert.equal(first.total, 107);
    assert.equal(first.pages, 5);
    assert.equal(first.items.length, 25);
    const all = Array.from(
      { length: 5 },
      (_, i) => store.verifiedOrganisations(publication.repo, '', i + 1).items,
    ).flat();
    assert.equal(new Set(all.map((row) => row.rkey)).size, 107);
    assert.equal(store.verifiedOrganisations(publication.repo, '', 100).page, 5);
    assert.equal(store.verifiedOrganisations(publication.repo, '900000101').items[0]!.orgnr, '900000101');
    assert.equal(store.verifiedOrganisations(publication.repo, 'DEVOTTA.NO').matching, 107);
    store.savePublication({
      ...publication,
      record: { ...publication.record, displayName: 'ØVRE ÅS & Ærlig AS' },
    });
    assert.equal(store.verifiedOrganisations(publication.repo, 'øvre ås').matching, 1);
    for (const q of ['%', '_', "' OR 1=1 --", 'no match']) {
      const empty = store.verifiedOrganisations(publication.repo, q);
      assert.equal(empty.matching, 0);
      assert.equal(empty.page, 1);
      assert.deepEqual(empty.items, []);
    }
    store.savePublication({ ...publication, state: 'revoked' });
    assert.equal(store.verifiedOrganisations(publication.repo, 'øvre ås').matching, 0);
    assert.deepEqual(store.verifiedOrganisations('').items, []);
  } finally {
    store.close();
  }
});
