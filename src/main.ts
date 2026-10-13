import { mkdir, readFile, stat } from 'node:fs/promises';
import { Server as TLSServer } from 'node:tls';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { automationConfig } from './config.js';

const database = process.env.DATABASE_PATH ?? './data/verifier.sqlite';
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:3012';
const publicMode = new URL(origin).protocol === 'https:';
const readTls = async () => ({
  key: await readFile(process.env.TLS_KEY_FILE!),
  cert: await readFile(process.env.TLS_CERT_FILE!),
});
if (
  publicMode &&
  (!process.env.TLS_KEY_FILE || !process.env.TLS_CERT_FILE || !process.env.OPERATOR_CREDENTIALS_FILE)
)
  throw new Error('HTTPS requires certificate, key and operator credentials files.');
const credentials = publicMode
  ? (await readFile(process.env.OPERATOR_CREDENTIALS_FILE!, 'utf8')).trim()
  : undefined;
if (credentials && !/^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]{32,}$/.test(credentials))
  throw new Error(
    'Operator credentials require username:password with a random password of at least 32 characters.',
  );
await mkdir(dirname(database), { recursive: true });
const app = await createApp({
  tls: publicMode ? await readTls() : undefined,
  operatorCredentials: credentials,
  automation: await automationConfig(),
  database,
  fixtureBase: process.env.FIXTURE_URL ?? 'http://127.0.0.1:2584',
  origin,
});
// The existing VPS certificate timer refreshes these files. Keep the last valid pair on failure.
let certificateTime = publicMode ? (await stat(process.env.TLS_CERT_FILE!)).mtimeMs : 0;
const reload = publicMode
  ? setInterval(async () => {
      try {
        const modified = (await stat(process.env.TLS_CERT_FILE!)).mtimeMs;
        if (modified !== certificateTime && app.server instanceof TLSServer) {
          app.server.setSecureContext(await readTls());
          certificateTime = modified;
        }
      } catch {
        /* A later tick retries without disrupting the current listener. */
      }
    }, 60_000).unref()
  : undefined;
app.addHook('onClose', async () => {
  if (reload) clearInterval(reload);
});
await app.listen({ port: Number(process.env.PORT ?? 3012), host: process.env.HOST ?? '127.0.0.1' });
console.log(`Organisation verifier: ${process.env.APP_ORIGIN ?? 'http://127.0.0.1:3012'}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
