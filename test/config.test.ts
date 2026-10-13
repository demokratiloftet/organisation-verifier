import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { automationConfig } from '../src/config.js';
import { privateRemote, publicRemote, Publisher, type RecordRemote } from '../src/publisher.js';
import { Store } from '../src/store.js';
import { policyVersion, type Check } from '../src/domain.js';

test('automation and issuance are opt-in and incomplete issuer configuration fails closed', async () => {
  assert.deepEqual(await automationConfig({}), { enabled: false, jetstream: undefined });
  await assert.rejects(automationConfig({ AUTOMATION_ENABLED: 'yes' }));
  await assert.rejects(automationConfig({ PUBLIC_ISSUANCE_ENABLED: 'true' }), /requires automation/);
  await assert.rejects(
    automationConfig({ AUTOMATION_ENABLED: 'true', PUBLIC_ISSUANCE_ENABLED: 'true' }),
    /requires/,
  );
  await assert.rejects(
    publicRemote({
      service: 'http://localhost:2583',
      did: 'did:plc:test',
      identifier: 'test',
      password: 'synthetic',
      orgnrs: ['922669708'],
    }),
    /HTTPS/,
  );
});

test('private issuance is explicit, mutually exclusive and restricted to the fixed internal PDS', async () => {
  await assert.rejects(automationConfig({ PRIVATE_ISSUANCE_ENABLED: 'yes' }));
  await assert.rejects(automationConfig({ PRIVATE_ISSUANCE_ENABLED: 'true' }), /requires automation/);
  await assert.rejects(
    automationConfig({
      AUTOMATION_ENABLED: 'true',
      PRIVATE_ISSUANCE_ENABLED: 'true',
      PUBLIC_ISSUANCE_ENABLED: 'true',
    }),
    /cannot both/,
  );
  let requests = 0;
  const transport: typeof fetch = async () => {
    requests++;
    throw new Error('Unexpected network access');
  };
  for (const service of [
    'http://127.0.0.1:3000',
    'https://issuer.example.org',
    'http://spaces-pds:3000/other',
    'http://spaces-pds:3000@attacker.example',
    'http://fixture:2583',
  ]) {
    await assert.rejects(
      privateRemote(
        { service, did: 'did:plc:test', identifier: 'test', password: 'synthetic', orgnrs: ['922669708'] },
        transport,
      ),
      /fixed internal/,
    );
  }
  assert.equal(requests, 0);
});

test('a public publisher rejects synthetic checks and synthetic handles before any remote access', async () => {
  const store = new Store(':memory:');
  let calls = 0;
  const remote: RecordRemote = {
    mode: 'live',
    repo: 'did:plc:bcdefghijklmnopqrstuvwxy',
    allowedOrgnrs: new Set(['922669708']),
    async get() {
      calls++;
      return undefined;
    },
    async put() {
      calls++;
      return 'unused';
    },
    async delete() {
      calls++;
    },
  };
  const check: Check = {
    mode: 'fixture',
    policyVersion,
    organisation: { orgnr: '922669708', name: 'Test', website: 'fjordverk.test', deleted: false },
    candidate: 'fjordverk.test',
    identity: {
      did: 'did:plc:abcdefghijklmnopqrstuvwx',
      handle: 'fjordverk.test',
      displayName: 'Test',
      pds: 'http://fixture:2583',
    },
    decision: 'match',
    reason: 'synthetic',
    checkedAt: new Date().toISOString(),
  };
  try {
    const publisher = new Publisher(store, remote);
    await assert.rejects(publisher.apply(check), /kan ikke publisere/);
    await assert.rejects(publisher.apply({ ...check, mode: 'live' }), /Synthetic/);
    assert.equal(calls, 0);
    assert.equal(store.publications().length, 0);
  } finally {
    store.close();
  }
});

for (const privateMode of [false, true])
  test(`${privateMode ? 'private' : 'public'} SDK transport pins the issuer DID and origin and performs record operations through the SDK`, async () => {
    const connect = privateMode ? privateRemote : publicRemote;
    const did = 'did:plc:bcdefghijklmnopqrstuvwxy';
    const service = privateMode ? 'http://spaces-pds:3000' : 'https://issuer.example.org';
    const config = {
      service,
      did,
      identifier: 'issuer.example.org',
      password: 'synthetic-test-value',
      orgnrs: ['922669708'],
    };
    const token = [
      Buffer.from('{}').toString('base64url'),
      Buffer.from(JSON.stringify({ sub: did, exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
        'base64url',
      ),
      'test',
    ].join('.');
    const requests: string[] = [];
    const records = new Map<string, unknown>();
    const transport: Parameters<typeof publicRemote>[1] = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      assert.equal(url.origin, service);
      assert.equal(request.redirect, 'error');
      requests.push(url.pathname);
      if (url.pathname.endsWith('createSession'))
        return Response.json({
          did,
          handle: 'issuer.example.org',
          accessJwt: token,
          refreshJwt: token,
          active: true,
        });
      assert.equal(request.headers.get('authorization'), `Bearer ${token}`);
      if (url.pathname.endsWith('getRecord')) {
        const key = url.searchParams.get('rkey')!;
        return records.has(key)
          ? Response.json({
              uri: `at://${did}/app.bsky.graph.verification/${key}`,
              cid: 'bafyreidc6sydkkbchcyg62v77wbhzvb2mvytlmsychqgwf2xojjtirmzj4',
              value: records.get(key),
            })
          : Response.json({ error: 'RecordNotFound' }, { status: 400 });
      }
      const body = (await request.json()) as { repo: string; rkey: string; record?: unknown };
      assert.equal(body.repo, did);
      if (url.pathname.endsWith('putRecord')) {
        records.set(body.rkey, body.record);
        return Response.json({
          uri: `at://${did}/app.bsky.graph.verification/${body.rkey}`,
          cid: 'bafyreidc6sydkkbchcyg62v77wbhzvb2mvytlmsychqgwf2xojjtirmzj4',
        });
      }
      if (url.pathname.endsWith('deleteRecord')) {
        records.delete(body.rkey);
        return Response.json({});
      }
      throw new Error('Unexpected SDK method');
    };
    const remote = await connect(config, transport);
    assert.equal(await remote.get('test'), undefined);
    const record = {
      $type: 'app.bsky.graph.verification' as const,
      subject: 'did:plc:abcdefghijklmnopqrstuvwx',
      handle: 'devotta.no',
      displayName: 'DEVOTTA AS',
      createdAt: new Date().toISOString(),
    };
    await remote.put('test', record);
    assert.deepEqual(await remote.get('test'), record);
    await remote.delete('test');
    assert.equal(records.size, 0);
    await assert.rejects(connect({ ...config, did: 'did:plc:abcdefghijklmnopqrstuvwx' }, transport), /DID/);
    assert.ok(requests.some((path) => path.endsWith('putRecord')));
  });
