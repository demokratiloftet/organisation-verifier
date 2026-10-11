import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { backupDatabase } from './backup.js';
import { downloadSnapshot, importSnapshot } from './registry.js';
import { Store } from './store.js';

const database = process.env.DATABASE_PATH ?? './data/verifier.sqlite';
const [command, ...args] = process.argv.slice(2);
await mkdir(dirname(database), { recursive: true });
if (command === 'backup') {
  if (!args[0]) throw new Error('Supply a separate backup path.');
  await backupDatabase(database, args[0]);
  console.log('Backup completed and integrity checked.');
} else {
  const store = new Store(database);
  try {
    if (command === 'status') console.log(JSON.stringify(store.status(), null, 2));
    else if (command === 'enqueue') {
      if (!args.length || args.some((id) => !/^\d{9}$/.test(id)))
        throw new Error('Supply organisation numbers.');
      store.transaction(() => {
        for (const id of args) store.enqueue(id);
      });
      console.log(`Queued ${args.length} organisation(s).`);
    } else if (command === 'download') {
      if (!args[0]) throw new Error('Supply a destination .json.gz file.');
      console.log(`Replay start: ${await downloadSnapshot(args[0])}`);
    } else if (command === 'import') {
      if (!args[0])
        throw new Error('Supply the completed snapshot .json.gz file. Stop the app before importing.');
      const since = args[1] ?? (await readFile(`${args[0]}.since`, 'utf8')).trim();
      console.log(
        `Imported ${await importSnapshot(store, args[0], since)} organisations. Change catch-up runs on app startup.`,
      );
    } else
      throw new Error(
        'Usage: cli status | enqueue <orgnr...> | download <file.json.gz> | import <file.json.gz> [since] | backup <file.sqlite>',
      );
  } finally {
    store.close();
  }
}
