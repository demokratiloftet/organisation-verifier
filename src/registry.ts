import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { JSONParser } from '@streamparser/json-node';
import { type Organisation } from './domain.js';
import { Store } from './store.js';
import { fetchOrganisation, registryBase } from './sources.js';

export function registryOrganisation(value: unknown): Organisation {
  const data = value as Record<string, unknown>;
  if (
    !data ||
    typeof data.organisasjonsnummer !== 'string' ||
    !/^\d{9}$/.test(data.organisasjonsnummer) ||
    (typeof data.navn !== 'string' && typeof data.slettedato !== 'string')
  )
    throw new Error('Invalid organisation in registry response.');
  return {
    orgnr: data.organisasjonsnummer,
    name: typeof data.navn === 'string' ? data.navn : data.organisasjonsnummer,
    website: typeof data.hjemmeside === 'string' ? data.hjemmeside : undefined,
    deleted: typeof data.slettedato === 'string',
  };
}

// Fixed official download. A completed file is renamed atomically and can be replayed after a crash.
export async function downloadSnapshot(path: string): Promise<string> {
  if (existsSync(path)) throw new Error('Snapshot already exists. Import it, or download to a new filename.');
  const response = await fetch(`${registryBase}/enheter/lastned`, {
    redirect: 'error',
    signal: AbortSignal.timeout(30 * 60_000),
    headers: { accept: 'application/vnd.brreg.enhetsregisteret.enhet.v2+gzip' },
  });
  if (!response.ok || !response.body) throw new Error(`Registry download failed: ${response.status}`);
  const modified = Date.parse(
    (response.headers.get('last-modified') ?? '').replace('CEST', 'GMT+0200').replace('CET', 'GMT+0100'),
  );
  if (!Number.isFinite(modified)) {
    await response.body.cancel();
    throw new Error('Snapshot has no valid Last-Modified date.');
  }
  // Daily snapshots predate the download. Replay from before the snapshot, not from download time.
  const since = new Date(modified - 86_400_000).toISOString();
  await pipeline(
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
    createWriteStream(`${path}.part`, { mode: 0o600 }),
  );
  await writeFile(`${path}.since`, since, { mode: 0o600 });
  await rename(`${path}.part`, path);
  return since;
}

export async function importSnapshot(store: Store, path: string, since: string): Promise<number> {
  if (!Number.isFinite(Date.parse(since))) throw new Error('Import requires the snapshot replay start date.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const source = hash.digest('hex');
  const previous = store.get('import.source');
  if (previous !== source)
    store.transaction(() => {
      store.set('import.source', source);
      store.set('import.count', '0');
      store.set('import.phase', 'loading');
      store.set('registry.since', since);
      store.set('registry.cursor', '0');
    });
  if (store.get('import.phase') !== 'loading') return Number(store.get('import.count'));
  const skipped = Number(store.get('import.count') ?? 0);
  let count = 0;
  let batch: Organisation[] = [];
  const flush = () =>
    store.transaction(() => {
      for (const org of batch) {
        store.upsertOrganisation(org, source);
        if (org.website) store.enqueue(org.orgnr, Date.now(), 0);
      }
      store.set('import.count', String(count));
      batch = [];
    });
  await pipeline(
    createReadStream(path),
    createGunzip(),
    new JSONParser({ paths: ['$.*'], keepStack: false }),
    async (records) => {
      for await (const { value } of records) {
        const organisation = registryOrganisation(value);
        count++;
        if (count <= skipped) continue;
        batch.push(organisation);
        if (batch.length >= 250) flush();
      }
    },
  );
  if (!count) throw new Error('Empty snapshot; refusing to replace registry.');
  flush();
  store.transaction(() => {
    // Previously known organisations absent from a complete snapshot need an authoritative recheck.
    store.db
      .prepare(
        `INSERT INTO jobs(key,due) SELECT orgnr,0 FROM organisations WHERE seen IS NOT ?
      ON CONFLICT(key) DO UPDATE SET due=0,revision=jobs.revision+1`,
      )
      .run(source);
    store.set('import.phase', 'catchup');
  });
  return count;
}

export interface RegistryUpdate {
  oppdateringsid: number;
  organisasjonsnummer: string;
  endringstype: string;
}
export async function fetchUpdates(cursor: number, since: string): Promise<RegistryUpdate[]> {
  const url = new URL(`${registryBase}/oppdateringer/enheter`);
  url.search = new URLSearchParams({
    size: '100',
    sort: 'id,ASC',
    ...(cursor ? { oppdateringsid: String(cursor + 1) } : { dato: since }),
  }).toString();
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Registry updates failed: ${response.status}`);
  const data = (await response.json()) as {
    _embedded?: { oppdaterteEnheter?: RegistryUpdate[] };
    page?: { totalElements?: number };
  };
  const updates = data._embedded?.oppdaterteEnheter;
  if (!updates && data.page?.totalElements === 0) return [];
  if (!Array.isArray(updates)) throw new Error('Invalid registry updates response.');
  let last = cursor;
  for (const update of updates) {
    if (
      !Number.isSafeInteger(update.oppdateringsid) ||
      update.oppdateringsid <= last ||
      !/^\d{9}$/.test(update.organisasjonsnummer) ||
      !['Ny', 'Endring', 'Sletting', 'Fjernet', 'Ukjent'].includes(update.endringstype)
    )
      throw new Error('Invalid registry update.');
    last = update.oppdateringsid;
  }
  return updates;
}

export function queueUpdates(
  store: Store,
  updates: RegistryUpdate[],
  organisations: Organisation[] = [],
): void {
  store.transaction(() => {
    const cursor = Number(store.get('registry.cursor') ?? 0);
    const pending = updates.filter((update) => update.oppdateringsid > cursor);
    const latest = [...new Map(pending.map((update) => [update.organisasjonsnummer, update])).values()];
    const changed = new Set<string>();
    for (const org of organisations) {
      const previous = store.organisation(org.orgnr);
      const known = store.db.prepare('SELECT did FROM organisations WHERE orgnr=?').get(org.orgnr)?.did;
      if (
        (!previous ||
          previous.name !== org.name ||
          previous.website !== org.website ||
          previous.deleted !== org.deleted) &&
        (org.website || previous?.website || known)
      )
        changed.add(org.orgnr);
      store.upsertOrganisation(org);
    }
    for (const update of latest) {
      // Employee counts and other unrelated changes need no identity lookup.
      // A removed website still needs a check, so old verification is withdrawn.
      if (
        !organisations.length ||
        changed.has(update.organisasjonsnummer) ||
        update.endringstype === 'Fjernet'
      )
        store.enqueue(update.organisasjonsnummer);
      if (update.endringstype === 'Fjernet') {
        store.upsertOrganisation({
          orgnr: update.organisasjonsnummer,
          name: update.organisasjonsnummer,
          deleted: true,
        });
        store.db
          .prepare(
            "DELETE FROM checks WHERE json_extract(data,'$.mode')='live' AND json_extract(data,'$.organisation.orgnr')=?",
          )
          .run(update.organisasjonsnummer);
      }
    }
    store.set('registry.cursor', String(pending.at(-1)?.oppdateringsid ?? cursor));
    store.set('registry.lastPoll', new Date().toISOString());
  });
}

export async function pollRegistry(
  store: Store,
  updatesSource = fetchUpdates,
  organisationSource = fetchOrganisation,
): Promise<void> {
  if (store.get('import.phase') === 'loading') return;
  const since = store.get('registry.since');
  if (!since) return;
  const updates = await updatesSource(Number(store.get('registry.cursor') ?? 0), since);
  if (updates.length) {
    store.set('import.phase', 'catchup');
    // Fetch current entries before advancing the cursor or allowing publication.
    const organisations: Organisation[] = [];
    const unique = [...new Map(updates.map((update) => [update.organisasjonsnummer, update])).values()];
    for (let offset = 0; offset < unique.length; offset += 4)
      organisations.push(
        ...(await Promise.all(
          unique
            .slice(offset, offset + 4)
            .map((update) =>
              update.endringstype === 'Fjernet'
                ? { orgnr: update.organisasjonsnummer, name: update.organisasjonsnummer, deleted: true }
                : organisationSource(update.organisasjonsnummer),
            ),
        )),
      );
    queueUpdates(store, updates, organisations);
  } else
    store.transaction(() => {
      store.set('registry.lastPoll', new Date().toISOString());
      if (store.get('import.source')) store.set('import.phase', 'ready');
    });
}
