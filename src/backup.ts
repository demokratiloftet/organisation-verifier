import { backup, DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

// Open read-only so taking a pre-upgrade backup cannot itself run a migration.
export async function backupDatabase(source: string, destination: string): Promise<void> {
  if (resolve(source) === resolve(destination)) throw new Error('Backup must use a separate file.');
  const database = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(database, destination);
  } finally {
    database.close();
  }
  const copy = new DatabaseSync(destination, { readOnly: true });
  try {
    if (copy.prepare('PRAGMA integrity_check').get()!.integrity_check !== 'ok')
      throw new Error('Backup integrity check failed.');
  } finally {
    copy.close();
  }
}
