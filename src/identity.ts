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
  const response = await http(`https://${handle}/.well-known/atproto-did`, { redirect: 'error' });
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
