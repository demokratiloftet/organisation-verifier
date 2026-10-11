import { isValidHandle } from '@atproto/syntax';

export type Mode = 'fixture' | 'live';
export type Decision = 'match' | 'no_match' | 'needs_review' | 'unavailable';
export type Scenario = 'valid' | 'name_changed' | 'website_changed' | 'no_account' | 'unavailable';
export const policyVersion = 'exact-domain-v1';
export interface Organisation {
  orgnr: string;
  name: string;
  website?: string;
  deleted: boolean;
}
export interface Identity {
  did: string;
  handle: string;
  displayName: string;
  pds: string;
}
export interface Check {
  policyVersion?: string;
  mode: Mode;
  organisation: Organisation;
  candidate?: string;
  identity?: Identity;
  decision: Decision;
  reason: string;
  checkedAt: string;
}
export type SavedCheck = Check & { id: number };

// Index every registered host, including path-based websites, to detect shared ownership.
export function registryHost(website: string): string | undefined {
  try {
    const url = new URL(website.includes('://') ? website : `https://${website}`);
    return ['http:', 'https:'].includes(url.protocol) && isValidHandle(url.hostname)
      ? url.hostname.toLowerCase()
      : undefined;
  } catch {
    return undefined;
  }
}

// A registered URL with a path can belong to a tenant on someone else's domain.
// Keep this first policy conservative; parent-domain fallback needs its own policy.
export function websiteHandle(website: string): string | undefined {
  try {
    const url = new URL(website.includes('://') ? website : `https://${website}`);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      return;
    const handle = url.hostname.toLowerCase();
    return isValidHandle(handle) ? handle : undefined;
  } catch {
    return;
  }
}

export function claimedHandle(aliases: string[] = []): string | undefined {
  for (const alias of aliases) {
    if (alias.startsWith('at://') && isValidHandle(alias.slice(5))) return alias.slice(5);
  }
  return;
}

const normalizeName = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('nb-NO');

export function decide(
  organisation: Organisation,
  candidate: string | undefined,
  identity?: Identity,
): Pick<Check, 'decision' | 'reason'> {
  if (organisation.deleted) return { decision: 'no_match', reason: 'Enheten er slettet i registeret.' };
  if (!organisation.website) return { decision: 'no_match', reason: 'Registeret har ingen hjemmeside.' };
  if (!candidate)
    return {
      decision: 'needs_review',
      reason: 'Hjemmesiden er ikke et entydig domene. Sti, port og delt vert krever vurdering.',
    };
  if (!identity)
    return {
      decision: 'no_match',
      reason: 'Ingen toveis bekreftet atproto-konto på det registrerte domenet.',
    };
  if (identity.handle !== candidate)
    return { decision: 'no_match', reason: 'Handle og DID peker ikke tilbake på hverandre.' };
  if (!identity.displayName || normalizeName(identity.displayName) !== normalizeName(organisation.name)) {
    return {
      decision: 'needs_review',
      reason: 'Profilnavnet avviker fra det registrerte navnet. Automatisk publisering holdes tilbake.',
    };
  }
  return { decision: 'match', reason: 'Registrert domene, toveis identitet og profilnavn samsvarer.' };
}
