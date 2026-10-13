import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { claimedHandle, decide, websiteHandle, hostVariants } from '../src/domain.js';

test('shared-host grouping respects public and private suffix boundaries in both directions', () => {
  for (const suffix of ['co.uk', 'com.au', 'github.io', 's3.amazonaws.com']) {
    assert.deepEqual(hostVariants(suffix), [suffix]);
    assert.deepEqual(hostVariants(`www.${suffix}`), [`www.${suffix}`]);
    const host = `company.${suffix}`;
    assert.deepEqual(hostVariants(host), [host, `www.${host}`]);
    assert.deepEqual(hostVariants(`www.${host}`), [`www.${host}`, host]);
  }
});

test('only unambiguous registered hostnames become handles', () => {
  assert.equal(websiteHandle('https://WWW.fjordverk.no/'), 'www.fjordverk.no');
  assert.equal(websiteHandle('fjordverk.no'), 'fjordverk.no');
  for (const website of [
    'https://shared.no/fjordverk',
    'user:password@fjordverk.no',
    'http://127.0.0.1',
    'http://localhost',
    'ftp://fjordverk.no',
    'https://fjordverk.no:444',
    'fjordverk.no?q=x',
    'fjordverk.no/#tenant',
  ]) {
    assert.equal(websiteHandle(website), undefined, website);
  }
});
test('use first valid atproto alias, never a convenient later one', () => {
  assert.equal(
    claimedHandle(['https://example.no', 'at://invalid', 'at://first.no', 'at://second.no']),
    'first.no',
  );
});
test('matching names alone cannot verify another domain; deletion and ambiguity block publication', () => {
  const org = { orgnr: '000000001', name: 'Fjordverk AS', website: 'fjordverk.test', deleted: false };
  const identity = {
    did: 'did:plc:fixture',
    handle: 'fjordverk.test',
    displayName: ' FJORDVERK  AS ',
    pds: 'http://fixture:2583',
  };
  assert.equal(decide(org, org.website, identity).decision, 'match');
  assert.equal(decide(org, org.website, { ...identity, handle: 'attacker.test' }).decision, 'no_match');
  assert.equal(decide(org, org.website, { ...identity, displayName: 'Fjordverk' }).decision, 'needs_review');
  assert.equal(decide({ ...org, deleted: true }, org.website, identity).decision, 'no_match');
  assert.equal(decide(org, undefined, identity).decision, 'needs_review');
  assert.equal(decide(org, org.website).decision, 'no_match');
});
