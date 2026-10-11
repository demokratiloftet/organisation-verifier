import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { automationConfig } from './config.js';

const database = process.env.DATABASE_PATH ?? './data/verifier.sqlite';
await mkdir(dirname(database), { recursive: true });
const app = await createApp({
  automation: await automationConfig(),
  database,
  fixtureBase: process.env.FIXTURE_URL ?? 'http://127.0.0.1:2584',
  origin: process.env.APP_ORIGIN ?? 'http://127.0.0.1:3012',
});
await app.listen({ port: Number(process.env.PORT ?? 3012), host: process.env.HOST ?? '127.0.0.1' });
console.log(`Organisation verifier: ${process.env.APP_ORIGIN ?? 'http://127.0.0.1:3012'}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
