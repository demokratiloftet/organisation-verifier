import { Agent, CredentialSession, AppBskyGraphVerification } from '@atproto/api';
import { TID } from '@atproto/common';
import type { Check } from './domain.js';
import { Store, type Publication, type PublicationState } from './store.js';

export const collection = 'app.bsky.graph.verification';
export interface RecordRemote {
  repo: string;
  get(rkey: string): Promise<unknown | undefined>;
  put(rkey: string, record: AppBskyGraphVerification.Record): Promise<string>;
  delete(rkey: string): Promise<void>;
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
  const repo = issuer.did;
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
  ) {}

  async apply(check: Check): Promise<void> {
    if (check.mode !== 'fixture') throw new Error('Levende oppslag kan ikke publisere i denne versjonen.');
    if (check.decision === 'unavailable') return;
    const identity = check.decision === 'match' ? check.identity : undefined;
    const current = this.store
      .publications()
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
    try {
      const actual = await this.remote.get(publication.rkey);
      if (publication.state === 'revoking') {
        if (actual) {
          if (!sameRecord(actual, publication.record))
            throw new Error('Recorden er endret utenfor tjenesten. Manuell kontroll kreves.');
          await this.remote.delete(publication.rkey);
        }
        publication.state = 'revoked';
      } else {
        if (actual && !sameRecord(actual, publication.record))
          throw new Error('Record-nøkkelen har annet innhold. Manuell kontroll kreves.');
        publication.uri = actual
          ? `at://${publication.repo}/${collection}/${publication.rkey}`
          : await this.remote.put(publication.rkey, publication.record);
        publication.state = 'published';
      }
      publication.error = undefined;
    } catch (error) {
      publication.error = error instanceof Error ? error.message : 'Publisering feilet.';
    }
    publication.updatedAt = new Date().toISOString();
    this.store.savePublication(publication);
    return publication.state;
  }
}
