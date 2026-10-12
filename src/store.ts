import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { AppBskyGraphVerification } from '@atproto/api';
import { registryHost, hostVariants, type Check, type SavedCheck, type Organisation } from './domain.js';

export interface Job {
  key: string;
  revision: number;
  token: string;
  attempts: number;
}

export type PublicationState = 'pending' | 'published' | 'revoking' | 'revoked';
export interface Publication {
  mode?: 'live' | 'fixture';
  rkey: string;
  repo: string;
  orgnr: string;
  record: AppBskyGraphVerification.Record;
  state: PublicationState;
  uri?: string;
  error?: string;
  updatedAt: string;
}

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS checks (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publications (rkey TEXT PRIMARY KEY, data TEXT NOT NULL);
    `);
    const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
    if (version > 1) throw new Error('Database schema is newer than this application.');
    if (version < 1)
      this.transaction(() =>
        this.db.exec(`
      CREATE TABLE organisations (
        orgnr TEXT PRIMARY KEY, host TEXT, did TEXT, data TEXT NOT NULL,
        next_check INTEGER NOT NULL DEFAULT 0, last_success INTEGER, seen TEXT
      );
      CREATE INDEX organisations_host ON organisations(host);
      CREATE INDEX organisations_did ON organisations(did);
      CREATE INDEX organisations_due ON organisations(next_check);
      CREATE TABLE jobs (
        key TEXT PRIMARY KEY, due INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
        attempts INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, token TEXT,
        error TEXT, priority INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX jobs_due ON jobs(priority DESC,due,key);
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX publications_owner ON publications(json_extract(data,'$.repo'),json_extract(data,'$.orgnr'));
      PRAGMA user_version=1;
    `),
      );
  }
  transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key);
    return row ? String(row.value) : undefined;
  }
  set(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value);
  }
  organisation(orgnr: string): Organisation | undefined {
    const row = this.db.prepare('SELECT data FROM organisations WHERE orgnr=?').get(orgnr);
    return row ? (JSON.parse(String(row.data)) as Organisation) : undefined;
  }
  // Call inside the same transaction as the source cursor / import checkpoint.
  upsertOrganisation(organisation: Organisation, seen?: string): void {
    const host = organisation.deleted
      ? null
      : organisation.website
        ? (registryHost(organisation.website) ?? null)
        : null;
    const previous = this.db.prepare('SELECT host FROM organisations WHERE orgnr=?').get(organisation.orgnr);
    this.db
      .prepare(
        `INSERT INTO organisations(orgnr,host,data,seen) VALUES (?,?,?,?)
      ON CONFLICT(orgnr) DO UPDATE SET host=excluded.host,data=excluded.data,seen=COALESCE(excluded.seen,organisations.seen)`,
      )
      .run(organisation.orgnr, host, JSON.stringify(organisation), seen ?? null);
    if (previous?.host !== host) {
      const priority = seen ? 0 : 1;
      if (host) this.enqueue(organisation.orgnr, Date.now(), priority);
      // Only crossing the unique/shared boundary changes other organisations' decisions.
      // Do not fan out to thousands of tenants each time another shared website is imported.
      for (const affectedHost of [previous?.host, host]) {
        if (!affectedHost) continue;
        const variants = hostVariants(String(affectedHost));
        const members = this.db
          .prepare('SELECT orgnr FROM organisations WHERE host IN (?,?) LIMIT 3')
          .all(variants[0]!, variants[1] ?? null);
        if (members.length <= 2)
          for (const member of members) this.enqueue(String(member.orgnr), Date.now(), priority);
      }
    }
  }
  affected(did: string, handle?: string): string[] {
    const variants = handle ? hostVariants(handle) : [];
    return this.db
      .prepare('SELECT orgnr FROM organisations WHERE did=? OR host IN (?,?)')
      .all(did, variants[0] ?? null, variants[1] ?? null)
      .map((row) => String(row.orgnr));
  }
  sharedHost(host: string): boolean {
    const variants = hostVariants(host);
    return (
      this.db
        .prepare('SELECT orgnr FROM organisations WHERE host IN (?,?) LIMIT 2')
        .all(variants[0]!, variants[1] ?? null).length > 1
    );
  }
  enqueue(orgnr: string, due = Date.now(), priority = 1): void {
    this.db
      .prepare(
        `INSERT INTO jobs(key,due,priority) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET
      due=MIN(jobs.due,excluded.due),priority=MAX(jobs.priority,excluded.priority),revision=jobs.revision+1`,
      )
      .run(orgnr, due, priority);
  }
  schedule(now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO jobs(key,due,priority) SELECT orgnr,?,CASE WHEN did IS NULL THEN 0 ELSE 1 END FROM organisations
      WHERE next_check<=? AND (host IS NOT NULL OR did IS NOT NULL) ON CONFLICT(key) DO NOTHING`,
      )
      .run(now, now);
  }
  claim(now = Date.now()): Job | undefined {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          'SELECT key,revision,attempts FROM jobs WHERE due<=? AND lease_until<=? ORDER BY priority DESC,due,key LIMIT 1',
        )
        .get(now, now);
      if (!row) return;
      const token = randomUUID();
      this.db
        .prepare('UPDATE jobs SET token=?,lease_until=? WHERE key=?')
        .run(token, now + 120_000, String(row.key));
      return { key: String(row.key), revision: Number(row.revision), attempts: Number(row.attempts), token };
    });
  }
  owns(job: Job): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM jobs WHERE key=? AND token=? AND lease_until>?')
      .get(job.key, job.token, Date.now());
  }
  finish(job: Job, error?: string, now = Date.now()): void {
    if (error) {
      this.db
        .prepare(
          `UPDATE jobs SET token=NULL,lease_until=0,attempts=attempts+1,error=?,due=?
        WHERE key=? AND token=?`,
        )
        .run(error, now + Math.min(3_600_000, 30_000 * 2 ** Math.min(job.attempts, 7)), job.key, job.token);
    } else
      this.transaction(() => {
        this.db
          .prepare('DELETE FROM jobs WHERE key=? AND token=? AND revision=?')
          .run(job.key, job.token, job.revision);
        // An event arrived while checking. Keep it queued for another authoritative check.
        this.db
          .prepare('UPDATE jobs SET token=NULL,lease_until=0,attempts=0,error=NULL WHERE key=? AND token=?')
          .run(job.key, job.token);
      });
  }
  checked(check: Check, nextCheck: number): void {
    this.upsertOrganisation(check.organisation);
    this.saveCheck(check);
    this.db
      .prepare(
        `UPDATE organisations SET did=CASE WHEN ? THEN did ELSE ? END,
      last_success=CASE WHEN ? THEN last_success ELSE ? END,next_check=? WHERE orgnr=?`,
      )
      .run(
        check.decision === 'unavailable' ? 1 : 0,
        check.identity?.did ?? null,
        check.decision === 'unavailable' ? 1 : 0,
        Date.parse(check.checkedAt),
        nextCheck,
        check.organisation.orgnr,
      );
  }
  lastSuccess(orgnr: string): number | undefined {
    const value = this.db
      .prepare('SELECT last_success FROM organisations WHERE orgnr=?')
      .get(orgnr)?.last_success;
    return value == null ? undefined : Number(value);
  }
  status() {
    return {
      organisations: Number(this.db.prepare('SELECT count(*) AS n FROM organisations').get()!.n),
      queued: Number(this.db.prepare('SELECT count(*) AS n FROM jobs').get()!.n),
      retrying: Number(this.db.prepare('SELECT count(*) AS n FROM jobs WHERE attempts>0').get()!.n),
      oldestDue: this.db.prepare('SELECT min(due) AS due FROM jobs').get()!.due,
      recentErrors: this.db
        .prepare('SELECT key,attempts,error FROM jobs WHERE error IS NOT NULL ORDER BY due LIMIT 10')
        .all(),
      progress: Object.fromEntries(
        this.db
          .prepare('SELECT key,value FROM metadata')
          .all()
          .map((row) => [String(row.key), String(row.value)]),
      ),
    };
  }
  saveCheck(check: Check): SavedCheck {
    const result = this.db.prepare('INSERT INTO checks(data) VALUES (?)').run(JSON.stringify(check));
    return { ...check, id: Number(result.lastInsertRowid) };
  }
  checks(): SavedCheck[] {
    return this.db
      .prepare('SELECT id, data FROM checks ORDER BY id DESC LIMIT 100')
      .all()
      .map((row) => ({ ...(JSON.parse(String(row.data)) as Check), id: Number(row.id) }));
  }
  savePublication(publication: Publication): void {
    this.db
      .prepare(
        'INSERT INTO publications(rkey,data) VALUES (?,?) ON CONFLICT(rkey) DO UPDATE SET data=excluded.data',
      )
      .run(publication.rkey, JSON.stringify(publication));
  }
  publications(repo?: string, orgnr?: string): Publication[] {
    return this.db
      .prepare(
        repo && orgnr
          ? "SELECT data FROM publications WHERE json_extract(data,'$.repo')=? AND json_extract(data,'$.orgnr')=? ORDER BY rowid DESC"
          : 'SELECT data FROM publications ORDER BY rowid DESC LIMIT 100',
      )
      .all(...(repo && orgnr ? [repo, orgnr] : []))
      .map((row) => JSON.parse(String(row.data)) as Publication);
  }
  close(): void {
    this.db.close();
  }
}
