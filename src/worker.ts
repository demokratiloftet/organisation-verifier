import { type Check, policyVersion } from './domain.js';
import { discoverHandle } from './identity.js';
import { Publisher, type RecordRemote } from './publisher.js';
import { liveCheck } from './sources.js';
import { Store } from './store.js';

export const recheckInterval = 24 * 60 * 60_000;
export const maxEvidenceAge = 7 * recheckInterval;

// One worker. Jobs are at-least-once; Publisher's durable intent makes remote retries safe.
export async function workOnce(
  store: Store,
  remote?: RecordRemote,
  checkOrganisation = liveCheck,
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
    if (store.get('import.phase') === 'loading') {
      store.finish(job, 'Registerimport pågår.');
      return true;
    }
    const previous = store.organisation(job.key);
    if (check.decision === 'unavailable' && previous) check = { ...check, organisation: previous };
    store.transaction(() => {
      store.upsertOrganisation(check.organisation);
      if (check.decision === 'match' && check.candidate && store.sharedHost(check.candidate))
        check = {
          ...check,
          decision: 'needs_review',
          reason: 'Flere organisasjoner har registrert dette domenet. Automatisk publisering holdes tilbake.',
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
    const inPilot = remote?.allowedOrgnrs?.has(job.key) ?? false;
    if (existing && !inPilot)
      publicationCheck = {
        ...check,
        policyVersion,
        decision: 'no_match',
        reason: 'Organisasjonen er tatt ut av pilotlisten.',
      };
    const registryFresh = Date.now() - Date.parse(store.get('registry.lastPoll') ?? '') < 5 * 60_000;
    const canIssue = store.get('import.phase') === 'ready' && registryFresh;
    // Withdrawals, including expiry, must still work during a register outage.
    if (remote && (inPilot || existing) && (publicationCheck.decision !== 'match' || canIssue)) {
      await new Publisher(store, remote).apply(publicationCheck);
      if (store.publications(remote.repo, job.key).some((p) => p.state !== 'revoked' && p.error))
        throw new Error('Publisering må forsøkes igjen; se recordens status.');
    }
    if (check.decision === 'unavailable') throw new Error(check.reason);
    // Revisit a pilot quickly if catch-up or a stale registry feed prevented publication.
    if (inPilot && publicationCheck.decision === 'match' && !canIssue)
      throw new Error('Venter på komplett og oppdatert register før publisering.');
    store.finish(job);
  } catch {
    // Source/SDK errors can include request details. Persist a safe summary, never credentials.
    store.finish(job, 'Kontroll eller publisering feilet. Nytt forsøk er planlagt.');
  }
  return true;
}
