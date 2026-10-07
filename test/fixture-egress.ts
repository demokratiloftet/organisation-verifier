import assert from 'node:assert/strict';
import net from 'node:net';
import { Resolver } from 'node:dns/promises';
const resolver = new Resolver({ timeout: 1000, tries: 1 });
await assert.rejects(resolver.resolve4('example.com'));
const reachable = await new Promise<boolean>((resolve) => {
  const socket = net.connect({ host: '1.1.1.1', port: 443 });
  const done = (connected: boolean) => {
    socket.destroy();
    resolve(connected);
  };
  socket.setTimeout(1500);
  socket.once('connect', () => done(true));
  socket.once('error', () => done(false));
  socket.once('timeout', () => done(false));
});
assert.equal(reachable, false);
assert.notEqual(process.getuid?.(), 0);
