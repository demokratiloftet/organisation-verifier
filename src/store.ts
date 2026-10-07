import { DatabaseSync } from 'node:sqlite';
import type { AppBskyGraphVerification } from '@atproto/api';
import type { Check, SavedCheck } from './domain.js';

export type PublicationState = 'pending' | 'published' | 'revoking' | 'revoked';
export interface Publication {
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
  publications(): Publication[] {
    return this.db
      .prepare('SELECT data FROM publications ORDER BY rowid DESC')
      .all()
      .map((row) => JSON.parse(String(row.data)) as Publication);
  }
  close(): void {
    this.db.close();
  }
}
