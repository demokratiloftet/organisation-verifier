import { isValidHandle } from '@atproto/syntax';
import { getDomain } from 'tldts';

export type Mode = 'fixture' | 'live';
export type Decision = 'match' | 'no_match' | 'needs_review' | 'unavailable';
export type Scenario = 'valid' | 'name_changed' | 'website_changed' | 'no_account' | 'unavailable';
export const policyVersion = 'www-psl-v3';
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
  registrySource?: 'index' | 'live';
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
// Paths and arbitrary parent-domain fallbacks remain unsupported.
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

export function withoutWww(host: string): string | undefined {
  if (!host.startsWith('www.')) return;
  const bare = host.slice(4);
  // Never strip the registrable label: www.co.uk and www.github.io are accounts,
  // not aliases for their public/private suffix. PSL is a boundary, not ownership proof.
  return !bare.startsWith('www.') && isValidHandle(bare) && getDomain(bare, { allowPrivateDomains: true })
    ? bare
    : undefined;
}

// Treat the two supported spellings together for shared-domain checks and events.
export function hostVariants(host: string): string[] {
  if (host.startsWith('www.')) {
    const bare = withoutWww(host);
    return bare ? [host, bare] : [host];
  }
  const www = `www.${host}`;
  return isValidHandle(www) && withoutWww(www) === host ? [host, www] : [host];
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
  const registered = websiteHandle(organisation.website);
  if (!registered || (candidate !== registered && candidate !== withoutWww(registered)))
    return { decision: 'no_match', reason: 'Kontoens domene samsvarer ikke med hjemmesiden i registeret.' };
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
  return {
    decision: 'match',
    reason:
      candidate === registered
        ? 'Registrert domene, toveis identitet og profilnavn samsvarer.'
        : 'Domenet uten www, toveis identitet og profilnavn samsvarer.',
  };
}
