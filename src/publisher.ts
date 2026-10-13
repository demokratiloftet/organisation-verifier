import { Agent, CredentialSession, AppBskyGraphVerification } from '@atproto/api';
import { TID } from '@atproto/common';
import { policyVersion, type Check, type Mode } from './domain.js';
import { publicFetch, publicHandle } from './identity.js';
import { Store, type Publication, type PublicationState } from './store.js';

export const collection = 'app.bsky.graph.verification';
class RecordConflict extends Error {}
export interface RecordRemote {
  mode?: Mode;
  allowedOrgnrs?: ReadonlySet<string>;
  repo: string;
  get(rkey: string): Promise<unknown | undefined>;
  put(rkey: string, record: AppBskyGraphVerification.Record): Promise<string>;
  delete(rkey: string): Promise<void>;
}
export interface IssuerConfig {
  private?: boolean;
  service: string;
  did: string;
  identifier: string;
  password: string;
  orgnrs: string[];
}
export async function publicRemote(config: IssuerConfig, transport = publicFetch): Promise<RecordRemote> {
  return issuerRemote(config, transport, false);
}

// Explicit deployment-only endpoint, never derived from an organisation or DID document.
export const privateIssuerService = 'http://spaces-pds:3000';
export async function privateRemote(
  config: IssuerConfig,
  transport: typeof fetch = fetch,
): Promise<RecordRemote> {
  return issuerRemote(config, transport, true);
}

async function issuerRemote(
  config: IssuerConfig,
  transport: typeof fetch,
  privateMode: boolean,
): Promise<RecordRemote> {
  const service = new URL(config.service);
  if (privateMode) {
    if (config.service !== privateIssuerService)
      throw new Error('Private issuance requires the fixed internal Spaces PDS endpoint.');
  } else if (
    service.protocol !== 'https:' ||
    service.username ||
    service.password ||
    service.port ||
    service.pathname !== '/' ||
    service.search ||
    service.hash
  )
    throw new Error('Issuer PDS must be an HTTPS origin.');
  if (
    !config.did.startsWith('did:') ||
    !config.orgnrs.length ||
    config.orgnrs.some((id) => !/^\d{9}$/.test(id) || id.startsWith('000'))
  )
    throw new Error('An issuer DID and explicit pilot organisation numbers are required.');
  const session = new CredentialSession(service, (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== service.origin) throw new Error('Issuer PDS cannot change endpoints.');
    return transport(input, { ...init, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  });
  await session.login({ identifier: config.identifier, password: config.password });
  session.pdsUrl = service;
  if (session.did !== config.did) throw new Error('Issuer DID does not match the configured account.');
  const remote = agentRemote(new Agent(session), config.did);
  return {
    ...remote,
    mode: 'live',
    allowedOrgnrs: new Set(config.orgnrs),
    async put(rkey, record) {
      if (!publicHandle(record.handle)) throw new Error('Synthetic handles cannot be published publicly.');
      return remote.put(rkey, record);
    },
  };
}
function missing(error: unknown): boolean {
  return error instanceof Error && 'error' in error && error.error === 'RecordNotFound';
}
export async function fixtureRemote(
  service: URL,
  issuer: { did: string; handle: string },
): Promise<RecordRemote> {
  if (
    service.protocol !== 'http:' ||
    !['fixture', '127.0.0.1'].includes(service.hostname) ||
    service.port !== '2583'
  ) {
    throw new Error('Publisering er bare tilgjengelig på den isolerte test-PDS-en.');
  }
  const session = new CredentialSession(service, (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== service.origin) throw new Error('Test-PDS-en kan ikke bytte endepunkt.');
    return fetch(input, { ...init, signal: AbortSignal.timeout(8_000), redirect: 'error' });
  });
  await session.login({ identifier: issuer.handle, password: 'fixture-only-not-a-secret' });
  // dev-env advertises localhost in its DID document; stay on the fixed container endpoint.
  session.pdsUrl = service;
  const agent = new Agent(session);
  if (agent.did !== issuer.did) throw new Error('Utstederens DID har endret seg.');
  return agentRemote(agent, issuer.did);
}
function agentRemote(agent: Agent, repo: string): RecordRemote {
  return {
    repo,
    async get(rkey) {
      try {
        return (await agent.com.atproto.repo.getRecord({ repo, collection, rkey })).data.value;
      } catch (error) {
        if (missing(error)) return;
        throw error;
      }
    },
    async put(rkey, record) {
      return (await agent.com.atproto.repo.putRecord({ repo, collection, rkey, record, validate: true })).data
        .uri;
    },
    async delete(rkey) {
      try {
        await agent.com.atproto.repo.deleteRecord({ repo, collection, rkey });
      } catch (error) {
        if (!missing(error)) throw error;
      }
    },
  };
}

export function sameRecord(actual: unknown, expected: AppBskyGraphVerification.Record): boolean {
  if (!actual || typeof actual !== 'object') return false;
  const record = actual as Partial<AppBskyGraphVerification.Record>;
  return (
    record.$type === expected.$type &&
    record.subject === expected.subject &&
    record.handle === expected.handle &&
    record.displayName === expected.displayName &&
    record.createdAt === expected.createdAt
  );
}

// Intent is committed locally before any remote mutation. Retrying always uses the same TID.
export class Publisher {
  constructor(
    private readonly store: Store,
    private readonly remote: RecordRemote,
    private readonly mayIssue = () => true,
  ) {}

  async apply(check: Check): Promise<void> {
    if (check.mode !== (this.remote.mode ?? 'fixture'))
      throw new Error('Denne modusen kan ikke publisere til valgt PDS.');
    if (check.mode === 'live') {
      if (
        (!this.remote.allowedOrgnrs?.has(check.organisation.orgnr) &&
          (check.decision === 'match' ||
            !this.store
              .publications(this.remote.repo, check.organisation.orgnr)
              .some((p) => p.mode === 'live' && p.state !== 'revoked'))) ||
        check.policyVersion !== policyVersion
      )
        throw new Error('Live publication requires an approved pilot organisation and current policy.');
      if (
        check.identity &&
        (!publicHandle(check.identity.handle) || new URL(check.identity.pds).protocol !== 'https:')
      )
        throw new Error('Synthetic identities cannot be published publicly.');
    }
    if (check.decision === 'unavailable') return;
    const identity = check.decision === 'match' ? check.identity : undefined;
    const current = this.store
      .publications(this.remote.repo, check.organisation.orgnr)
      .filter(
        (p) => p.repo === this.remote.repo && p.orgnr === check.organisation.orgnr && p.state !== 'revoked',
      );
    for (const publication of current) {
      const unchanged =
        identity &&
        publication.record.subject === identity.did &&
        publication.record.handle === identity.handle &&
        publication.record.displayName === identity.displayName;
      if (!unchanged || publication.state === 'revoking') {
        publication.state = 'revoking';
        this.store.savePublication(publication);
        const state = await this.reconcile(publication);
        if (state !== 'revoked') return;
      } else {
        await this.reconcile(publication);
        return;
      }
    }
    if (!identity) return;
    const now = new Date().toISOString();
    const record: AppBskyGraphVerification.Record = {
      $type: collection,
      subject: identity.did,
      handle: identity.handle,
      displayName: identity.displayName,
      createdAt: now,
    };
    const validation = AppBskyGraphVerification.validateRecord(record);
    if (!validation.success) throw new Error('Verifikasjonsrecorden følger ikke lexiconet.');
    const publication: Publication = {
      mode: check.mode,
      rkey: TID.nextStr(),
      orgnr: check.organisation.orgnr,
      repo: this.remote.repo,
      record,
      state: 'pending',
      updatedAt: now,
    };
    this.store.savePublication(publication);
    await this.reconcile(publication);
  }

  async reconcile(publication: Publication): Promise<PublicationState> {
    if (publication.repo !== this.remote.repo || publication.state === 'revoked') return publication.state;
    if ((publication.mode ?? 'fixture') !== (this.remote.mode ?? 'fixture'))
      throw new Error('Publication transport mismatch.');
    try {
      const actual = await this.remote.get(publication.rkey);
      if (publication.state === 'revoking') {
        if (actual) {
          if (!sameRecord(actual, publication.record))
            throw new RecordConflict('Recorden er endret utenfor tjenesten. Manuell kontroll kreves.');
          await this.remote.delete(publication.rkey);
        }
        publication.state = 'revoked';
      } else {
        if (actual && !sameRecord(actual, publication.record))
          throw new RecordConflict('Record-nøkkelen har annet innhold. Manuell kontroll kreves.');
        // A registry/event update may arrive while the remote read is in flight.
        // Recheck the worker's evidence/lease gate immediately before a new write.
        if (!actual && !this.mayIssue()) throw new Error('Verification evidence changed before issuance.');
        publication.uri = actual
          ? `at://${publication.repo}/${collection}/${publication.rkey}`
          : await this.remote.put(publication.rkey, publication.record);
        publication.state = 'published';
      }
      publication.error = undefined;
    } catch (error) {
      publication.error =
        error instanceof RecordConflict
          ? error.message
          : 'PDS-kallet feilet. Nytt forsøk må avstemme samme record.';
    }
    publication.updatedAt = new Date().toISOString();
    this.store.savePublication(publication);
    return publication.state;
  }
}
