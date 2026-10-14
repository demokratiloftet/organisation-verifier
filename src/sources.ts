import { Agent } from '@atproto/api';
import { publicFetch as safeFetch, resolveIdentity } from './identity.js';
export { resolveIdentity } from './identity.js';
import {
  claimedHandle,
  policyVersion,
  decide,
  websiteHandle,
  withoutWww,
  type Check,
  type Identity,
  type Organisation,
  type Scenario,
} from './domain.js';

export const registryBase = 'https://data.brreg.no/enhetsregisteret/api';

export async function fetchOrganisation(orgnr: string, transport = safeFetch): Promise<Organisation> {
  if (!/^\d{9}$/.test(orgnr)) throw new Error('Organisasjonsnummer må ha ni siffer.');
  const response = await transport(`${registryBase}/enheter/${orgnr}`, {
    redirect: 'error',
    headers: { accept: 'application/vnd.brreg.enhetsregisteret.enhet.v2+json' },
  });
  if (response.status === 404 || response.status === 410) {
    await response.body?.cancel();
    return { orgnr, name: orgnr, deleted: true };
  }
  if (!response.ok) throw new Error(`Brreg svarte med HTTP ${response.status}.`);
  const data = (await response.json()) as Record<string, unknown>;
  if (
    data.organisasjonsnummer !== orgnr ||
    (typeof data.navn !== 'string' && typeof data.slettedato !== 'string')
  )
    throw new Error('Uventet svar fra Brreg.');
  return {
    orgnr,
    name: typeof data.navn === 'string' ? data.navn : orgnr,
    website: typeof data.hjemmeside === 'string' ? data.hjemmeside : undefined,
    deleted: typeof data.slettedato === 'string',
  };
}

export async function liveCheck(
  orgnr: string,
  organisationSource = fetchOrganisation,
  identitySource = resolveIdentity,
): Promise<Check> {
  let organisation: Organisation = { orgnr, name: orgnr, deleted: false };
  let candidate: string | undefined;
  try {
    organisation = await organisationSource(orgnr);
    candidate = organisation.website ? websiteHandle(organisation.website) : undefined;
    let identity = candidate && !organisation.deleted ? await identitySource(candidate) : undefined;
    const fallback = candidate ? withoutWww(candidate) : undefined;
    // Only confirmed absence permits a fallback. A timeout must remain uncertain.
    if (!identity && fallback && !organisation.deleted) {
      candidate = fallback;
      identity = await identitySource(candidate);
    }
    return {
      mode: 'live',
      policyVersion,
      organisation,
      candidate,
      identity,
      ...decide(organisation, candidate, identity),
      checkedAt: new Date().toISOString(),
    };
  } catch {
    // SDK/network errors can contain request details. Do not persist or display them.
    return {
      mode: 'live',
      policyVersion,
      organisation,
      candidate,
      decision: 'unavailable',
      reason: 'Register- eller identitetsoppslaget feilet. Prøv igjen senere.',
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
    const base = {
      policyVersion,
      mode: 'fixture' as const,
      organisation,
      candidate,
      checkedAt: new Date().toISOString(),
    };
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
