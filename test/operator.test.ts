import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { LightMyRequestResponse } from 'fastify';
import { createApp } from '../src/app.js';

test('internet operator UI requires HTTPS and authenticates every route before data access', async () => {
  const options = {
    database: ':memory:',
    fixtureBase: 'http://127.0.0.1:1',
    origin: 'https://verifier.example:8443',
  };
  await assert.rejects(createApp(options), /requires operator credentials/);
  const operatorCredentials = 'operator:' + 'test-secret-'.repeat(4);
  await assert.rejects(createApp({ ...options, operatorCredentials }), /require HTTPS/);
  const directory = await mkdtemp(join(tmpdir(), 'verifier-tls-'));
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=verifier.example',
        '-keyout',
        join(directory, 'key.pem'),
        '-out',
        join(directory, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    );
    app = await createApp({
      ...options,
      operatorCredentials,
      tls: {
        key: await readFile(join(directory, 'key.pem')),
        cert: await readFile(join(directory, 'cert.pem')),
      },
    });
    const headers = { host: 'verifier.example:8443' };
    for (const url of [
      '/',
      '/veiledning',
      '/?veiledning',
      '/app.js',
      '/api/state',
      '/api/state?view=verified',
      '/api/automation',
      '/health',
      '/ready',
    ]) {
      const anonymous: LightMyRequestResponse = await app.inject({ url, headers });
      assert.equal(anonymous.statusCode, 401, url);
      assert.match(String(anonymous.headers['www-authenticate']), /^Basic /);
    }
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/fixture/check',
          headers: { ...headers, origin: options.origin },
          payload: { scenario: 'valid' },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (await app.inject({ url: '/api/state', headers: { ...headers, authorization: 'Basic wrong' } }))
        .statusCode,
      401,
    );
    const authenticated = {
      ...headers,
      authorization: `Basic ${Buffer.from(operatorCredentials).toString('base64')}`,
    };
    assert.equal((await app.inject({ url: '/', headers: authenticated })).statusCode, 200);
    assert.equal((await app.inject({ url: '/veiledning', headers: authenticated })).statusCode, 200);
    const guide = await app.inject({ url: '/?veiledning', headers: authenticated });
    assert.equal(guide.statusCode, 200);
    assert.match(guide.body, /_atproto.example.com/);
    const state = await app.inject({ url: '/api/state', headers: authenticated });
    assert.equal(state.statusCode, 200);
    assert(!state.body.includes(operatorCredentials));
    const verified = await app.inject({ url: '/api/state?view=verified', headers: authenticated });
    assert.equal(verified.statusCode, 200);
    assert.deepEqual(verified.json().items, []);
    assert.equal(verified.json().issuer, null);
    assert(!verified.body.includes(operatorCredentials));
    for (const query of ['page=0', 'page=1.5', 'page=100001', 'q=' + 'a'.repeat(101)])
      assert.equal(
        (await app.inject({ url: '/api/state?view=verified&' + query, headers: authenticated })).statusCode,
        400,
      );

    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/fixture/check',
          headers: { ...authenticated, origin: 'https://evil.example' },
          payload: { scenario: 'valid' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ url: '/', headers: { ...authenticated, host: 'evil.example' } })).statusCode,
      403,
    );
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
