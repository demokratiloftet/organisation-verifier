import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createApp } from '../src/app.js';

test('operator routes reject foreign hosts, cross-origin requests and invalid bodies before accessing sources', async () => {
  const app = await createApp({
    database: ':memory:',
    fixtureBase: 'http://127.0.0.1:2584',
    origin: 'http://127.0.0.1:3012',
  });
  const url = '/api/live/check';
  const headers = { host: '127.0.0.1:3012', origin: 'http://127.0.0.1:3012' };
  try {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { ...headers, host: 'evil.test' },
          payload: { orgnr: '974760673' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { ...headers, origin: 'https://evil.test' },
          payload: { orgnr: '974760673' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url, headers, payload: { orgnr: 'https://internal/' } }))
        .statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url, headers, payload: { orgnr: '974760673', publish: true } }))
        .statusCode,
      400,
    );
    assert.equal((await app.inject({ url: '/', headers })).statusCode, 200);
  } finally {
    await app.close();
  }
});

test('fixture failures return a generic response without leaking internal details', async () => {
  const app = await createApp({
    database: ':memory:',
    fixtureBase: 'http://127.0.0.1:1',
    origin: 'http://127.0.0.1:3012',
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/fixture/check',
      headers: { host: '127.0.0.1:3012', origin: 'http://127.0.0.1:3012' },
      payload: { scenario: 'valid' },
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'Kontrollen kunne ikke fullføres. Prøv igjen senere.' });
  } finally {
    await app.close();
  }
});
