import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolveHandle, publicHandle } from '../src/identity.js';
const did = 'did:plc:abcdefghijklmnopqrstuvwx';
const absent = () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENODATA' }));
const timeout = () => Promise.reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }));

test('DNS/HTTP lookup errors are not negative proof; either successful method can resolve a handle', async () => {
  assert.equal(
    await resolveHandle(
      'devotta.no',
      async () => [[`did=${did}`]],
      async () => {
        throw new Error('must not fetch');
      },
    ),
    did,
  );
  assert.equal(await resolveHandle('devotta.no', timeout, async () => new Response(did)), did);
  assert.equal(
    await resolveHandle('devotta.no', absent, async () => new Response('', { status: 404 })),
    undefined,
  );
  await assert.rejects(
    resolveHandle('devotta.no', timeout, async () => new Response('', { status: 404 })),
    /DNS/,
  );
  await assert.rejects(
    resolveHandle('devotta.no', absent, async () => new Response('', { status: 503 })),
    /midlertidig/,
  );
  await assert.rejects(
    resolveHandle('devotta.no', absent, async () => {
      throw new Error('TLS');
    }),
    /TLS/,
  );
});
test('reserved handles cannot reach public DNS or HTTP transports', async () => {
  for (const host of ['fjordverk.test', 'handle.invalid', 'foo.local', 'foo.internal']) {
    assert.equal(publicHandle(host), false);
    await assert.rejects(
      resolveHandle(host, async () => {
        throw new Error('should not query');
      }),
      /offentlig/,
    );
  }
});
