import { request } from 'node:https';
import { readFileSync } from 'node:fs';
const origin = new URL(process.env.APP_ORIGIN!);
const credentials = readFileSync(process.env.OPERATOR_CREDENTIALS_FILE!, 'utf8').trim();
const req = request(
  {
    hostname: '127.0.0.1',
    port: Number(process.env.PORT ?? 3012),
    path: '/health',
    servername: origin.hostname,
    rejectUnauthorized: false,
    headers: { host: origin.host, authorization: `Basic ${Buffer.from(credentials).toString('base64')}` },
  },
  (res) => {
    res.resume();
    process.exit(res.statusCode === 200 ? 0 : 1);
  },
);
req.setTimeout(3000, () => {
  req.destroy();
  process.exit(1);
});
req.on('error', () => process.exit(1));
req.end();
