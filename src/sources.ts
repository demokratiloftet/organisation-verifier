import { Agent } from '@atproto/api';
import { IdResolver, ensureAtpDocument } from '@atproto/identity';
import { safeFetchWrap } from '@atproto-labs/fetch-node';
import {
  claimedHandle,
  decide,
  websiteHandle,
  type Check,
  type Identity,
  type Organisation,
  type Scenario,
} from './domain.js';

export const registryBase = 'https://data.brreg.no/enhetsregisteret/api';
const safeFetch = safeFetchWrap({ allowIpHost: false, timeout: 8_000, responseMaxSize: 512_000 });
const resolver = new IdResolver({ timeout: 5_000 });

export async function fetchOrganisation(orgnr: string): Promise<Organisation> {
  if (!/^\d{9}$/.test(orgnr)) throw new Error('Organisasjonsnummer må ha ni siffer.');
  const response = await safeFetch(`${registryBase}/enheter/${orgnr}`, {
    redirect: 'error',
    headers: { accept: 'application/vnd.brreg.enhetsregisteret.enhet.v2+json' },
  });
  if (response.status === 404) throw new Error('Organisasjonsnummeret finnes ikke i Enhetsregisteret.');
  if (!response.ok) throw new Error(`Brreg svarte med HTTP ${response.status}.`);
  const data = (await response.json()) as Record<string, unknown>;
  if (data.organisasjonsnummer !== orgnr || typeof data.navn !== 'string')
    throw new Error('Uventet svar fra Brreg.');
  return {
    orgnr,
    name: data.navn,
    website: typeof data.hjemmeside === 'string' ? data.hjemmeside : undefined,
    deleted: typeof data.slettedato === 'string',
  };
}

export async function resolveIdentity(handle: string): Promise<Identity | undefined> {
  const did = await resolver.handle.resolve(handle);
  if (!did) return;
  const doc = await resolver.did.ensureResolve(did, true);
  if (claimedHandle(doc.alsoKnownAs) !== handle) return;
  const data = ensureAtpDocument(doc);
  const url = new URL('/xrpc/com.atproto.repo.getRecord', data.pds);
  url.search = new URLSearchParams({
    repo: did,
    collection: 'app.bsky.actor.profile',
    rkey: 'self',
  }).toString();
  const response = await safeFetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error(`Profiloppslag svarte med HTTP ${response.status}.`);
  const profile = (await response.json()) as { value?: { displayName?: unknown } };
  return {
    did,
    handle,
    pds: data.pds,
    displayName: typeof profile.value?.displayName === 'string' ? profile.value.displayName : '',
  };
}

export async function liveCheck(orgnr: string): Promise<Check> {
  let organisation: Organisation = { orgnr, name: orgnr, deleted: false };
  let candidate: string | undefined;
  try {
    organisation = await fetchOrganisation(orgnr);
    candidate = organisation.website ? websiteHandle(organisation.website) : undefined;
    const identity = candidate && !organisation.deleted ? await resolveIdentity(candidate) : undefined;
    return {
      mode: 'live',
      organisation,
      candidate,
      identity,
      ...decide(organisation, candidate, identity),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      mode: 'live',
      organisation,
      candidate,
      decision: 'unavailable',
      reason: error instanceof Error ? error.message : 'Oppslaget feilet.',
      checkedAt: new Date().toISOString(),
    };
  }
}

export interface FixtureState {
  issuer: { did: string; handle: string };
  organisation: Organisation;
  scenario: Scenario;
}

// Only this adapter has access to the isolated test network. No user-supplied URLs.
export class FixtureSource {
  readonly agent: Agent;
  constructor(readonly base: string) {
    const host = new URL(base);
    if (host.protocol !== 'http:' || !['fixture', '127.0.0.1'].includes(host.hostname)) {
      throw new Error('Fixture-adapteren krever den isolerte testverten.');
    }
    this.agent = new Agent({ service: new URL('http://' + host.hostname + ':2583') });
  }
  async state(scenario?: Scenario): Promise<FixtureState> {
    const response = await fetch(`${this.base}/state`, {
      method: scenario ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: scenario ? JSON.stringify({ scenario }) : undefined,
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Testnettverket er ikke klart.');
    return response.json() as Promise<FixtureState>;
  }
  async check(state: FixtureState): Promise<Check> {
    const organisation = state.organisation;
    const candidate = organisation.website ? websiteHandle(organisation.website) : undefined;
    const base = { mode: 'fixture' as const, organisation, candidate, checkedAt: new Date().toISOString() };
    if (state.scenario === 'unavailable')
      return {
        ...base,
        decision: 'unavailable',
        reason: 'Simulert nettverksfeil. En eksisterende publisering beholdes inntil ny kontroll.',
      };
    let identity: Identity | undefined;
    if (candidate) {
      let did: string | undefined;
      try {
        did = (await this.agent.resolveHandle({ handle: candidate })).data.did;
      } catch (error) {
        if (!(error instanceof Error) || !('error' in error) || error.error !== 'HandleNotFound') throw error;
      }
      if (did) {
        const plc = new URL(this.base);
        plc.port = '2582';
        plc.pathname = `/${did}`;
        const response = await fetch(plc, { signal: AbortSignal.timeout(5_000), redirect: 'error' });
        if (!response.ok) throw new Error('Den lokale PLC-katalogen svarte ikke.');
        const doc = (await response.json()) as { id: string; alsoKnownAs?: string[] };
        if (doc.id === did && claimedHandle(doc.alsoKnownAs) === candidate) {
          const profile = await this.agent.com.atproto.repo.getRecord({
            repo: did,
            collection: 'app.bsky.actor.profile',
            rkey: 'self',
          });
          const value = profile.data.value as { displayName?: string };
          identity = {
            did,
            handle: candidate,
            displayName: value.displayName ?? '',
            pds: `http://${plc.hostname}:2583`,
          };
        }
      }
    }
    return { ...base, identity, ...decide(organisation, candidate, identity) };
  }
}
