import { readFile } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { Scenario } from './domain.js';
import { FixtureSource, liveCheck } from './sources.js';
import { fixtureRemote, Publisher } from './publisher.js';
import { Store } from './store.js';
import { type AutomationConfig } from './config.js';
import { startAutomation } from './automation.js';

export interface AppOptions {
  tls?: { key: Buffer; cert: Buffer };
  operatorCredentials?: string;
  automation?: AutomationConfig;
  database: string;
  fixtureBase: string;
  origin: string;
}
export async function createApp(options: AppOptions) {
  const origin = new URL(options.origin);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) && !options.operatorCredentials)
    throw new Error('Internet access requires operator credentials.');
  if (options.operatorCredentials && (!options.tls || origin.protocol !== 'https:'))
    throw new Error('Operator credentials require HTTPS.');
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expected = options.operatorCredentials
    ? digest(`Basic ${Buffer.from(options.operatorCredentials).toString('base64')}`)
    : undefined;
  const app = Fastify({
    https: options.tls ?? null,
    logger: false,
    bodyLimit: 2048,
    ajv: { customOptions: { removeAdditional: false } },
  });
  const store = new Store(options.database);
  const fixture = new FixtureSource(options.fixtureBase);
  let busy = false;
  const exclusive = async <T>(action: () => Promise<T>): Promise<T> => {
    if (busy)
      throw Object.assign(new Error('En kontroll kjører allerede. Prøv igjen når den er ferdig.'), {
        statusCode: 409,
      });
    busy = true;
    try {
      return await action();
    } finally {
      busy = false;
    }
  };
  let stopAutomation = async () => {};
  app.addHook('onReady', async () => {
    stopAutomation = await startAutomation(store, options.automation ?? { enabled: false });
  });
  app.addHook('onClose', async () => {
    await stopAutomation();
    store.close();
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    // Exact Host/Origin checks apply to both local and authenticated HTTPS deployments.
    if (request.headers.host !== origin.host) return reply.code(403).send({ error: 'Uventet vert.' });
    if (expected && !timingSafeEqual(expected, digest(request.headers.authorization ?? '')))
      return reply
        .code(401)
        .header('www-authenticate', 'Basic realm="Loftet", charset="UTF-8"')
        .send({ error: 'Logg inn for å bruke demoen.' });
    if (request.method === 'POST' && request.headers.origin !== origin.origin)
      return reply.code(403).send({ error: 'Uventet opprinnelse.' });
  });
  const assets = [
    ['/', 'index.html', 'text/html'],
    ['/veiledning', 'veiledning.html', 'text/html'],
    ['/app.js', 'app.js', 'text/javascript'],
    ['/style.css', 'style.css', 'text/css'],
  ] as const;
  const assetDirectory = new URL(
    import.meta.url.endsWith('.ts') ? '../dist/public/' : '../public/',
    import.meta.url,
  );
  const guide = await readFile(new URL('veiledning.html', assetDirectory), 'utf8');
  for (const [route, file, type] of assets) {
    const content = await readFile(new URL(file, assetDirectory), 'utf8');
    // The shared ingress permits the root path; the guide is a read-only view
    // behind the same operator authentication, without a gateway-wide rollout.
    app.get(route, async (request, reply) =>
      reply
        .type(type)
        .send(route === '/' && new URL(request.url, origin).searchParams.has('veiledning') ? guide : content),
    );
  }
  app.get('/health', async () => ({ ok: true }));
  app.get('/ready', async (_request, reply) => {
    const issues: string[] = [];
    if (options.automation?.enabled) {
      if (!(Date.now() - Date.parse(store.get('worker.heartbeat') ?? '') < 120_000)) issues.push('worker');
      if (
        store.get('registry.since') &&
        !(Date.now() - Date.parse(store.get('registry.lastPoll') ?? '') < 300_000)
      )
        issues.push('registry');
      if (
        options.automation.jetstream &&
        !(Date.now() - Date.parse(store.get('jetstream.lastEvent') ?? '') < 120_000)
      )
        issues.push('jetstream');
      if (store.get('worker.error')) issues.push('worker-error');
    }
    return reply.code(issues.length ? 503 : 200).send({ ok: !issues.length, issues });
  });
  app.get('/api/automation', async () => ({
    enabled: options.automation?.enabled ?? false,
    publishing: !!options.automation?.issuer,
    privateIssuance: options.automation?.issuer?.private ?? false,
    issuanceScope: options.automation?.issuer ? (options.automation.issuer.scope ?? 'pilot') : null,
    ...store.status(),
  }));
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
      const check = await exclusive(async () => {
        const network = await fixture.state(request.body.scenario);
        const check = store.saveCheck(await fixture.check(network));
        const service = new URL(options.fixtureBase);
        service.port = '2583';
        const publisher = new Publisher(store, await fixtureRemote(service, network.issuer));
        await publisher.apply(check);
        return check;
      });
      return { ok: true, check };
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
      const check = await exclusive(async () => store.saveCheck(await liveCheck(request.body.orgnr)));
      return { ok: true, check };
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
