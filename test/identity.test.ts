import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { safeFetchWrap } from '@atproto-labs/fetch-node';
import { resolveHandle, publicHandle } from '../src/identity.js';
const did = 'did:plc:abcdefghijklmnopqrstuvwx';
const absent = () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENODATA' }));
const timeout = () => Promise.reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }));

test('HTTPS handle resolution follows redirects without changing the requested handle', async () => {
  for (const status of [200, 404, 410, 503]) {
    const lookup = resolveHandle('www.devotta.no', absent, async (input, init) => {
      assert.equal(String(input), 'https://www.devotta.no/.well-known/atproto-did');
      assert.equal(init?.redirect, 'follow');
      return new Response(status === 200 ? `${did}\n` : '', { status });
    });
    if (status === 503) await assert.rejects(lookup, /midlertidig/);
    else assert.equal(await lookup, status === 200 ? did : undefined);
  }
});

test('guarded redirect dispatch rejects unsafe destinations before connecting, preserving uncertainty', async () => {
  for (const origin of [
    'http://devotta.no',
    'https://devotta.no:8443',
    'https://127.0.0.1',
    'https://169.254.169.254',
    'https://[::1]',
    'https://localhost',
  ]) {
    let dispatched = false;
    const http = safeFetchWrap({
      allowIpHost: false,
      fetch: async (_input, init) => {
        // Native fetch sends every redirected request through this same agent.
        // Exercise that actual SDK guard with an unsafe second hop, without IO.
        const { dispatcher } = init as RequestInit & {
          dispatcher: { dispatch(options: object, handler: object): boolean };
        };
        dispatched = true;
        return new Promise<Response>((_resolve, reject) => {
          dispatcher.dispatch(
            { origin, path: '/.well-known/atproto-did', method: 'GET' },
            {
              onError: reject,
              onConnect: () => reject(new Error('unsafe redirect escaped the URL guard')),
              onHeaders: () => {},
              onData: () => {},
              onComplete: () => {},
            },
          );
        });
      },
    });
    await assert.rejects(
      resolveHandle('devotta.no', absent, http),
      origin === 'https://localhost' ? /Hostname is not a public domain/ : /Blocked by url policy/,
    );
    assert.equal(dispatched, true);
  }
});

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
