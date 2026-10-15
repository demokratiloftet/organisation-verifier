import { strict as assert } from 'node:assert';
import { Agent } from '@atproto/api';
import type { SavedCheck } from '../src/domain.js';
import type { Publication } from '../src/store.js';
import { collection } from '../src/publisher.js';

// Run inside the app container: the fixture deliberately exposes no host ports.
const base = 'http://127.0.0.1:3012';
const pds = new Agent({ service: 'http://fixture:2583' });
async function state(): Promise<{
  checks: SavedCheck[];
  publications: Publication[];
  network: { issuer: { did: string } };
}> {
  return (await fetch(`${base}/api/state`)).json();
}
async function run(scenario: string) {
  const response = await fetch(`${base}/api/fixture/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ scenario }),
  });
  const body = await response.text();
  assert.equal(response.status, 200, body);
  const result = JSON.parse(body) as { check: SavedCheck };
  const current = await state();
  assert.deepEqual(result.check, current.checks[0], 'Return the requested result directly to the operator');
  return current;
}
async function records(repo: string) {
  return (await pds.com.atproto.repo.listRecords({ repo, collection, limit: 100 })).data.records;
}
// Start from a withdrawn record so this suite also works after an earlier demo.
await run('name_changed');
const first = await run('valid');
assert.equal(first.checks[0]!.decision, 'match');
const repo = first.network.issuer.did;
const initial = await records(repo);
assert.equal(initial.length, 1);
await run('valid');
assert.deepEqual(await records(repo), initial, 'Repeat runs must preserve URI, CID and createdAt');
await run('unavailable');
assert.deepEqual(await records(repo), initial, 'Transient failures must not withdraw the record');
await run('name_changed');
assert.equal((await records(repo)).length, 0, 'Record must actually be removed from the PDS');
assert.equal((await state()).publications[0]!.state, 'revoked');
await run('no_account');
assert.equal((await state()).checks[0]!.decision, 'no_match');
assert.equal((await records(repo)).length, 0);
await run('website_changed');
assert.equal((await state()).checks[0]!.decision, 'needs_review');
assert.equal((await records(repo)).length, 0);
await run('valid');
assert.equal((await records(repo)).length, 1);
console.log('PASS: real PDS publish → repeat → outage → revoke → no account → different domain → republish');
