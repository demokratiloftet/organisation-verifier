import { Resolver } from 'node:dns/promises';
import { IdResolver, ensureAtpDocument } from '@atproto/identity';
import { isValidDid, isValidHandle } from '@atproto/syntax';
import { safeFetchWrap } from '@atproto-labs/fetch-node';
import { claimedHandle, type Identity } from './domain.js';

export const publicFetch = safeFetchWrap({ allowIpHost: false, timeout: 8_000, responseMaxSize: 512_000 });
const dns = new Resolver({ timeout: 5_000, tries: 1 });
// The SDK's did:web resolver treats every non-2xx as missing. Preserve uncertain failures.
const didResolver = new IdResolver({
  timeout: 5_000,
  fetch: async (input, init) => {
    const response = await publicFetch(input, { ...init, redirect: 'error' });
    if (!response.ok && response.status !== 404) {
      await response.body?.cancel();
      throw new Error('DID-oppslaget er midlertidig utilgjengelig.');
    }
    return response;
  },
});

export function publicHandle(handle: string): boolean {
  return (
    isValidHandle(handle) && !/\.(test|localhost|local|internal|invalid|example|onion|alt|arpa)$/.test(handle)
  );
}

// Use the SDK's DNS parser, but retain DNS/HTTP error information which resolve() discards.
export async function resolveHandle(
  handle: string,
  txt = (name: string) => dns.resolveTxt(name),
  http: typeof publicFetch = publicFetch,
): Promise<string | undefined> {
  if (!publicHandle(handle)) throw new Error('Domenet kan ikke brukes i offentlig verifikasjon.');
  let dnsFailed = false;
  try {
    const records = await txt(`_atproto.${handle}`);
    const did = didResolver.handle.parseDnsResult(records);
    if (did && isValidDid(did)) return did;
  } catch (error) {
    dnsFailed = !['ENODATA', 'ENOTFOUND'].includes(String((error as NodeJS.ErrnoException).code));
  }
  // Handle resolution permits redirects. The SDK guards every hop (HTTPS/public
  // addresses only); fetch limits hops and the 8s budget covers the whole chain.
  // resolveIdentity still requires the DID document to claim the original handle.
  const response = await http(`https://${handle}/.well-known/atproto-did`, { redirect: 'follow' });
  if (response.ok) {
    const did = (await response.text()).split('\n')[0]!.trim();
    if (isValidDid(did)) return did;
  } else {
    await response.body?.cancel();
    if (![404, 410].includes(response.status))
      throw new Error('Handle-oppslaget er midlertidig utilgjengelig.');
  }
  if (dnsFailed) throw new Error('DNS-oppslaget er midlertidig utilgjengelig.');
  return undefined;
}

export async function resolveIdentity(handle: string): Promise<Identity | undefined> {
  const did = await resolveHandle(handle);
  if (!did) return;
  const doc = await didResolver.did.resolve(did, true);
  if (!doc || claimedHandle(doc.alsoKnownAs) !== handle) return;
  const data = ensureAtpDocument(doc);
  const statusUrl = new URL('/xrpc/com.atproto.sync.getRepoStatus', data.pds);
  statusUrl.search = new URLSearchParams({ did }).toString();
  const statusResponse = await publicFetch(statusUrl, { redirect: 'error' });
  if (!statusResponse.ok) throw new Error('Kontostatus kunne ikke kontrolleres.');
  const status = (await statusResponse.json()) as { did?: string; active?: boolean; status?: string };
  if (status.did !== did || typeof status.active !== 'boolean') throw new Error('Uventet kontostatus.');
  if (!status.active) {
    if (['deactivated', 'deleted', 'takendown', 'suspended'].includes(status.status ?? '')) return;
    throw new Error('Kontostatus er uavklart.');
  }
  const url = new URL('/xrpc/com.atproto.repo.getRecord', data.pds);
  url.search = new URLSearchParams({
    repo: did,
    collection: 'app.bsky.actor.profile',
    rkey: 'self',
  }).toString();
  const response = await publicFetch(url, { redirect: 'error' });
  const profile = (await response.json()) as { error?: string; value?: { displayName?: unknown } };
  if (!response.ok && !([400, 404].includes(response.status) && profile.error === 'RecordNotFound')) {
    throw new Error('Profiloppslaget er midlertidig utilgjengelig.');
  }
  return {
    did,
    handle,
    pds: data.pds,
    displayName: typeof profile.value?.displayName === 'string' ? profile.value.displayName : '',
  };
}

export async function discoverHandle(did: string): Promise<string | undefined> {
  if (!isValidDid(did)) throw new Error('Invalid DID.');
  const doc = await didResolver.did.resolve(did, true);
  return doc ? claimedHandle(doc.alsoKnownAs) : undefined;
}

// A read-only explanation of the current domain/DID binding, fetched only on demand.
export async function inspectAccount(
  handle: string,
  expectedDid: string,
  sources = {
    txt: (name: string) => dns.resolveTxt(name),
    document: (did: string) => didResolver.did.resolve(did, true),
    http: publicFetch,
  },
) {
  if (!publicHandle(handle) || !isValidDid(expectedDid)) throw new Error('Invalid account identity.');
  let records: string[][] | undefined;
  const resolvedDid = await resolveHandle(
    handle,
    async (name) => {
      records = await sources.txt(name);
      return records;
    },
    sources.http,
  );
  const doc = await sources.document(expectedDid);
  if (!doc || doc.id !== expectedDid) throw new Error('Account DID document is unavailable.');
  const data = ensureAtpDocument(doc);
  const pds = new URL(data.pds);
  if (
    pds.protocol !== 'https:' ||
    !publicHandle(pds.hostname) ||
    pds.port ||
    pds.username ||
    pds.password ||
    pds.pathname !== '/' ||
    pds.search ||
    pds.hash
  )
    throw new Error('Account server must be a public HTTPS origin.');
  const claimed = claimedHandle(doc.alsoKnownAs);
  const method = !resolvedDid
    ? null
    : records && didResolver.handle.parseDnsResult(records) === resolvedDid
      ? 'dns'
      : 'https';
  const webHost = expectedDid.startsWith('did:web:') ? expectedDid.slice(8) : '';
  const documentUrl = /^did:plc:[a-z2-7]{24}$/.test(expectedDid)
    ? `https://plc.directory/${expectedDid}`
    : publicHandle(webHost)
      ? `https://${webHost}/.well-known/did.json`
      : undefined;
  const repositoryUrl = new URL('/xrpc/com.atproto.repo.describeRepo', pds);
  repositoryUrl.search = new URLSearchParams({ repo: expectedDid }).toString();
  return {
    handle,
    did: expectedDid,
    resolvedDid: resolvedDid ?? null,
    claimedHandle: claimed ?? null,
    matches: resolvedDid === expectedDid && claimed === handle,
    method,
    dnsName: `_atproto.${handle}`,
    dnsRecords: records?.map((parts) => parts.join('')) ?? [],
    wellKnownUrl: `https://${handle}/.well-known/atproto-did`,
    pds: pds.origin,
    repositoryUrl: repositoryUrl.href,
    documentUrl,
    checkedAt: new Date().toISOString(),
  };
}
export type AccountEvidence = Awaited<ReturnType<typeof inspectAccount>>;
