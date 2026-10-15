import { type Check, policyVersion } from './domain.js';
import { discoverHandle, resolveIdentity } from './identity.js';
import { allowsOrganisation, Publisher, type RecordRemote } from './publisher.js';
import { fetchOrganisation, liveCheck } from './sources.js';
import { Store } from './store.js';

export const recheckInterval = 24 * 60 * 60_000;
export const maxEvidenceAge = 7 * recheckInterval;

export function registryReady(store: Store): boolean {
  return (
    store.get('import.phase') === 'ready' &&
    Date.now() - Date.parse(store.get('registry.lastPoll') ?? '') < 5 * 60_000
  );
}

// The complete, caught-up registry is a discovery index, never the sole basis
// for a positive result. Known accounts and issuer jobs always get fresh evidence.
export async function backgroundCheck(
  store: Store,
  orgnr: string,
  fresh = false,
  organisationSource = fetchOrganisation,
  identitySource = resolveIdentity,
): Promise<Check> {
  const cached = registryReady(store) ? store.organisation(orgnr) : undefined;
  const known = store.db.prepare('SELECT did FROM organisations WHERE orgnr=?').get(orgnr)?.did;
  if (!cached || fresh || known) return liveCheck(orgnr, organisationSource, identitySource);
  const check = await liveCheck(orgnr, async () => cached, identitySource);
  return check.decision === 'match'
    ? liveCheck(orgnr, organisationSource, identitySource)
    : { ...check, registrySource: 'index' };
}

// Leases isolate concurrent jobs; durable publication intent makes retries safe.
export async function workOnce(
  store: Store,
  remote?: RecordRemote,
  checkOrganisation = (orgnr: string) =>
    backgroundCheck(
      store,
      orgnr,
      remote?.allowedOrgnrs?.has(orgnr) ||
        (!!remote && store.publications(remote.repo, orgnr).some((p) => p.state !== 'revoked')),
    ),
  discover = discoverHandle,
): Promise<boolean> {
  if (store.get('import.phase') === 'loading') return false;
  const job = store.claim();
  if (!job) return false;
  try {
    if (job.key.startsWith('did:')) {
      const handle = await discover(job.key);
      store.transaction(() => {
        for (const orgnr of store.affected(job.key, handle)) store.enqueue(orgnr);
      });
      store.finish(job);
      return true;
    }
    let check = await checkOrganisation(job.key);
    if (!store.owns(job)) return true;
    if (!store.current(job)) {
      // Registry/identity evidence changed while the network request was in flight.
      // Leave the newer revision queued rather than overwrite or publish stale data.
      store.finish(job);
      return true;
    }
    if (store.get('import.phase') === 'loading') {
      store.finish(job, 'Registerimport pågår.');
      return true;
    }
    const previous = store.organisation(job.key);
    if (check.decision === 'unavailable' && previous) check = { ...check, organisation: previous };
    store.transaction(() => {
      store.upsertOrganisation(check.organisation);
      if (check.decision === 'match' && !uniqueOrganisation(store, check))
        check = {
          ...check,
          decision: 'needs_review',
          reason:
            'Profilnavnet matcher ikke entydig én organisasjon på domenet. Automatisk publisering holdes tilbake.',
        };
      store.checked(check, Date.now() + (check.decision === 'match' ? recheckInterval : 7 * recheckInterval));
    });
    let publicationCheck: Check = check;
    const lastSuccess = store.lastSuccess(job.key);
    if (
      check.decision === 'unavailable' &&
      lastSuccess !== undefined &&
      Date.now() - lastSuccess >= maxEvidenceAge
    ) {
      publicationCheck = {
        ...check,
        policyVersion,
        decision: 'no_match',
        reason:
          'Kontrollgrunnlaget er eldre enn syv dager. Verifikasjonen trekkes tilbake til ny kontroll lykkes.',
      };
      store.saveCheck(publicationCheck);
    }
    const existing = remote
      ? store
          .publications(remote.repo, job.key)
          .some((p) => p.state !== 'revoked' && (p.mode ?? 'fixture') === (remote.mode ?? 'fixture'))
      : false;
    const inScope = remote ? allowsOrganisation(remote, job.key) : false;
    if (existing && !inScope)
      publicationCheck = {
        ...check,
        policyVersion,
        decision: 'no_match',
        reason: 'Organisasjonen er utenfor konfigurert utstedelsesomfang.',
      };
    const canIssue = registryReady(store);
    // Withdrawals, including expiry, must still work during a register outage.
    if (
      remote &&
      (existing || (inScope && publicationCheck.decision === 'match')) &&
      (publicationCheck.decision !== 'match' || canIssue)
    ) {
      const evidenceJob = {
        ...job,
        revision: Number(store.db.prepare('SELECT revision FROM jobs WHERE key=?').get(job.key)?.revision),
      };
      await new Publisher(
        store,
        remote,
        () =>
          store.current(evidenceJob) && registryReady(store) && uniqueOrganisation(store, publicationCheck),
      ).apply(publicationCheck);
      if (store.publications(remote.repo, job.key).some((p) => p.state !== 'revoked' && p.error))
        throw new Error('Publisering må forsøkes igjen; se recordens status.');
    }
    if (check.decision === 'unavailable') throw new Error(check.reason);
    // Revisit a matching organisation quickly if catch-up or a stale registry feed prevented publication.
    if (inScope && publicationCheck.decision === 'match' && !canIssue)
      throw new Error('Venter på komplett og oppdatert register før publisering.');
    store.finish(job);
  } catch {
    // Source/SDK errors can include request details. Persist a safe summary, never credentials.
    const known = store.db.prepare('SELECT did FROM organisations WHERE orgnr=?').get(job.key)?.did;
    const tracked =
      known ||
      remote?.allowedOrgnrs?.has(job.key) ||
      (remote && store.publications(remote.repo, job.key).some((p) => p.state !== 'revoked'));
    // Repeated failures on unclaimed websites must not crowd out new candidates.
    // Known accounts/publications retain hourly retries and the seven-day expiry.
    store.finish(
      job,
      'Kontroll eller publisering feilet. Nytt forsøk er planlagt.',
      Date.now(),
      tracked ? 3_600_000 : recheckInterval,
    );
  }
  return true;
}

function uniqueOrganisation(store: Store, check: Check): boolean {
  return (
    !!check.candidate &&
    !!check.identity &&
    store.uniqueNameMatch(check.candidate, check.identity.displayName, check.organisation.orgnr)
  );
}
