import { TestNetworkNoAppView } from '@atproto/dev-env';
import { createServer } from 'node:http';

// Ephemeral, synthetic network. Compose denies this container internet access.
const network = await TestNetworkNoAppView.create({
  plc: { port: 2582 },
  pds: {
    port: 2583,
    hostname: 'localhost',
    serviceHandleDomains: ['.test'],
    crawlers: [],
    handleBackupNameservers: [],
    serviceName: 'LOFT-76 isolated fixture',
    homeUrl: 'http://localhost:2583',
    termsOfServiceUrl: 'http://localhost:2583',
    privacyPolicyUrl: 'http://localhost:2583',
    supportUrl: 'http://localhost:2583',
  },
});
type FixtureAgent = ReturnType<typeof network.pds.getAgent>;
const accounts = new Map<string, { agent: FixtureAgent; did: string; handle: string }>();
function account(handle: string) {
  const found = accounts.get(handle);
  if (!found) throw new Error('Missing fixture account');
  return found;
}
for (const [handle, displayName] of [
  ['issuer.test', 'Loftet testutsteder'],
  ['fjordverk.test', 'Fjordverk AS'],
  ['annen.test', 'En annen organisasjon'],
] as const) {
  const agent = network.pds.getAgent();
  const { data } = await agent.createAccount({
    handle,
    email: `${handle}@example.invalid`,
    password: 'fixture-only-not-a-secret',
  });
  await agent.com.atproto.repo.putRecord({
    repo: data.did,
    collection: 'app.bsky.actor.profile',
    rkey: 'self',
    record: { $type: 'app.bsky.actor.profile', displayName },
  });
  accounts.set(handle, { agent, did: data.did, handle });
}
let scenario = 'valid';
const scenarios = ['valid', 'name_changed', 'website_changed', 'no_account', 'unavailable'];
function state() {
  return {
    issuer: { did: account('issuer.test').did, handle: 'issuer.test' },
    scenario,
    organisation: {
      orgnr: '000000001',
      name: 'Fjordverk AS',
      deleted: false,
      website:
        scenario === 'website_changed'
          ? 'annen.test'
          : scenario === 'no_account'
            ? 'ukjent.test'
            : 'fjordverk.test',
    },
  };
}
const server = createServer(async (req, res) => {
  try {
    if (req.url !== '/state') {
      res.writeHead(404).end();
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1024) throw new Error('Too large');
      }
      const input: unknown = JSON.parse(body);
      const next =
        typeof input === 'object' && input !== null && 'scenario' in input ? input.scenario : undefined;
      if (typeof next !== 'string' || !scenarios.includes(next)) {
        res.writeHead(400).end();
        return;
      }
      const subject = account('fjordverk.test');
      await subject.agent.com.atproto.repo.putRecord({
        repo: subject.did,
        collection: 'app.bsky.actor.profile',
        rkey: 'self',
        record: {
          $type: 'app.bsky.actor.profile',
          displayName: next === 'name_changed' ? 'Helt annet profilnavn' : 'Fjordverk AS',
        },
      });
      scenario = next;
    } else if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(state()));
  } catch {
    res.writeHead(500).end('Fixture operation failed');
  }
});
server.listen(2584, '0.0.0.0');
console.log('Isolated fixture ready; accounts reset when this container restarts.');
async function stop() {
  server.close();
  await network.close();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
