import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import type { Scenario } from './domain.js';
import { FixtureSource, liveCheck } from './sources.js';
import { fixtureRemote, Publisher } from './publisher.js';
import { Store } from './store.js';

export interface AppOptions {
  database: string;
  fixtureBase: string;
  origin: string;
}
export async function createApp(options: AppOptions) {
  const app = Fastify({
    logger: false,
    bodyLimit: 2048,
    ajv: { customOptions: { removeAdditional: false } },
  });
  const store = new Store(options.database);
  const fixture = new FixtureSource(options.fixtureBase);
  const origin = new URL(options.origin);
  let busy = false;
  const exclusive = async (action: () => Promise<void>) => {
    if (busy)
      throw Object.assign(new Error('En kontroll kjører allerede. Prøv igjen når den er ferdig.'), {
        statusCode: 409,
      });
    busy = true;
    try {
      await action();
    } finally {
      busy = false;
    }
  };
  app.addHook('onClose', async () => store.close());
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    // This operator demo is loopback/SSH-only. Host validation also blocks DNS rebinding.
    if (request.headers.host !== origin.host) return reply.code(403).send({ error: 'Uventet vert.' });
    if (request.method === 'POST' && request.headers.origin !== origin.origin)
      return reply.code(403).send({ error: 'Uventet opprinnelse.' });
  });
  const assets = [
    ['/', 'index.html', 'text/html'],
    ['/app.js', 'app.js', 'text/javascript'],
    ['/style.css', 'style.css', 'text/css'],
  ] as const;
  for (const [route, file, type] of assets) {
    const content = await readFile(
      new URL(
        import.meta.url.endsWith('.ts') ? '../dist/public/' + file : '../public/' + file,
        import.meta.url,
      ),
      'utf8',
    );
    app.get(route, async (_request, reply) => reply.type(type).send(content));
  }
  app.get('/health', async () => ({ ok: true }));
  app.get('/api/state', async () => {
    let network;
    try {
      network = await fixture.state();
    } catch {
      /* Live reads remain usable when the fixture is down. */
    }
    return { checks: store.checks(), publications: store.publications(), network, busy };
  });
  app.post<{ Body: { scenario: Scenario } }>(
    '/api/fixture/check',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['scenario'],
          properties: {
            scenario: { enum: ['valid', 'name_changed', 'website_changed', 'no_account', 'unavailable'] },
          },
        },
      },
    },
    async (request) => {
      await exclusive(async () => {
        const network = await fixture.state(request.body.scenario);
        const check = store.saveCheck(await fixture.check(network));
        const service = new URL(options.fixtureBase);
        service.port = '2583';
        const publisher = new Publisher(store, await fixtureRemote(service, network.issuer));
        await publisher.apply(check);
      });
      return { ok: true };
    },
  );
  app.post<{ Body: { orgnr: string } }>(
    '/api/live/check',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['orgnr'],
          properties: { orgnr: { type: 'string', pattern: '^\\d{9}$' } },
        },
      },
    },
    async (request) => {
      await exclusive(async () => {
        store.saveCheck(await liveCheck(request.body.orgnr));
      });
      return { ok: true };
    },
  );
  app.setErrorHandler((error, _request, reply) => {
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode ?? 500;
    reply
      .code(status)
      .send({ error: status < 500 ? err.message : 'Kontrollen kunne ikke fullføres. Prøv igjen senere.' });
  });
  return app;
}
