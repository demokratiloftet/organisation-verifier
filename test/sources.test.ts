import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liveCheck } from '../src/sources.js';
import { type Identity, type Organisation, policyVersion } from '../src/domain.js';

const org: Organisation = {
  orgnr: '922669708',
  name: 'DEVOTTA AS',
  website: 'www.devotta.no',
  deleted: false,
};
const account = (handle: string, displayName = 'Devotta AS'): Identity => ({
  did: 'did:plc:abcdefghijklmnopqrstuvwx',
  handle,
  displayName,
  pds: 'https://pds.example.org',
});

test('www fallback checks the exact host first and retains the registered website in the evidence', async () => {
  const calls: string[] = [];
  const check = await liveCheck(
    org.orgnr,
    async () => org,
    async (handle) => {
      calls.push(handle);
      return handle === 'devotta.no' ? account(handle) : undefined;
    },
  );
  assert.deepEqual(calls, ['www.devotta.no', 'devotta.no']);
  assert.equal(check.decision, 'match');
  assert.equal(check.organisation.website, 'www.devotta.no');
  assert.equal(check.candidate, 'devotta.no');
  assert.equal(check.policyVersion, policyVersion);
  assert.match(check.reason, /uten www/);
});

test('www fallback never bypasses a confirmed account, name mismatch or lookup failure', async () => {
  for (const displayName of ['Devotta AS', 'Another company']) {
    const calls: string[] = [];
    const check = await liveCheck(
      org.orgnr,
      async () => org,
      async (handle) => {
        calls.push(handle);
        return account(handle, displayName);
      },
    );
    assert.deepEqual(calls, ['www.devotta.no']);
    assert.equal(check.decision, displayName === 'Devotta AS' ? 'match' : 'needs_review');
  }
  const calls: string[] = [];
  const failed = await liveCheck(
    org.orgnr,
    async () => org,
    async (handle) => {
      calls.push(handle);
      throw new Error('DNS timeout');
    },
  );
  assert.deepEqual(calls, ['www.devotta.no']);
  assert.equal(failed.decision, 'unavailable');
  const mismatch = await liveCheck(
    org.orgnr,
    async () => org,
    async (handle) => (handle === 'devotta.no' ? account(handle, 'Other company') : undefined),
  );
  assert.equal(mismatch.decision, 'needs_review');
  const wrongDomain = await liveCheck(
    org.orgnr,
    async () => org,
    async (handle) => (handle === 'devotta.no' ? account('attacker.no') : undefined),
  );
  assert.equal(wrongDomain.decision, 'no_match');
});

test('multi-label and private suffixes retain the organisation boundary during www fallback', async () => {
  for (const handle of ['company.co.uk', 'company.com.au', 'company.github.io', 'company.no']) {
    const calls: string[] = [];
    const check = await liveCheck(
      org.orgnr,
      async () => ({ ...org, website: `www.${handle}` }),
      async (candidate) => {
        calls.push(candidate);
        return candidate === handle ? account(candidate) : undefined;
      },
    );
    assert.deepEqual(calls, [`www.${handle}`, handle]);
    assert.equal(check.decision, 'match');
  }
  for (const website of ['www.co.uk', 'www.com.au', 'www.github.io', 'www.s3.amazonaws.com']) {
    const calls: string[] = [];
    const check = await liveCheck(
      org.orgnr,
      async () => ({ ...org, website }),
      async (candidate) => {
        calls.push(candidate);
        return candidate === website ? undefined : account(candidate);
      },
    );
    assert.deepEqual(calls, [website]);
    assert.equal(check.decision, 'no_match');
  }
});

test('no arbitrary parent fallback, invalid URL fallback, or lookup of a deleted organisation', async () => {
  for (const website of [
    'team.devotta.no',
    'devotta.no',
    'www.devotta.no/team',
    'www.no',
    'www.www.devotta.no',
  ]) {
    const calls: string[] = [];
    const check = await liveCheck(
      org.orgnr,
      async () => ({ ...org, website }),
      async (handle) => {
        calls.push(handle);
        return undefined;
      },
    );
    assert.deepEqual(calls, website.includes('/') ? [] : [website]);
    assert.notEqual(check.decision, 'match');
  }
  const deleted = await liveCheck(
    org.orgnr,
    async () => ({ ...org, deleted: true }),
    async () => {
      throw new Error('Must not query');
    },
  );
  assert.equal(deleted.decision, 'no_match');
});

test('Brreg 410 is a removed entry, not an endless transient retry; server failures stay uncertain', async () => {
  const { fetchOrganisation } = await import('../src/sources.js');
  for (const status of [404, 410])
    assert.deepEqual(await fetchOrganisation(org.orgnr, async () => new Response(null, { status })), {
      orgnr: org.orgnr,
      name: org.orgnr,
      deleted: true,
    });
  await assert.rejects(
    fetchOrganisation(org.orgnr, async () => new Response(null, { status: 503 })),
    /503/,
  );
});

test('source errors cannot leak request details into saved checks or operator responses', async () => {
  const failure = async (): Promise<never> => {
    throw new Error('Request failed: Authorization: Bearer sensitive-request-value');
  };
  for (const check of [
    await liveCheck(org.orgnr, failure),
    await liveCheck(org.orgnr, async () => org, failure),
  ]) {
    assert.equal(check.decision, 'unavailable');
    assert.match(check.reason, /oppslaget feilet/);
    assert.doesNotMatch(JSON.stringify(check), /Authorization|sensitive-request-value/);
  }
});
