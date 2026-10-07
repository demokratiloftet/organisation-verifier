import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const id = execFileSync('docker', ['compose', 'ps', '-q', 'fixture'], { encoding: 'utf8' }).trim();
assert(id, 'Fixture must be running');
const [container] = JSON.parse(execFileSync('docker', ['inspect', id], { encoding: 'utf8' }));
assert.equal(container.HostConfig.ReadonlyRootfs, true);
assert.deepEqual(container.HostConfig.CapDrop, ['ALL']);
assert.equal(Object.keys(container.HostConfig.PortBindings || {}).length, 0);
assert.equal(container.Config.User, 'node');
const networks = Object.keys(container.NetworkSettings.Networks);
assert.equal(networks.length, 1);
const [network] = JSON.parse(
  execFileSync('docker', ['network', 'inspect', networks[0]], { encoding: 'utf8' }),
);
assert.equal(network.Internal, true);
assert.equal(network.EnableIPv6, false);
execFileSync('docker', ['exec', '-i', id, 'node', '--input-type=module', '-'], {
  input: `
import assert from 'node:assert/strict';
import net from 'node:net';
import {Resolver} from 'node:dns/promises';
const resolver = new Resolver({timeout:1000, tries:1});
await assert.rejects(resolver.resolve4('example.com'));
const reachable = await new Promise(resolve => {
  const socket = net.connect({host:'1.1.1.1',port:443});
  socket.setTimeout(1500);
  socket.once('connect',()=>{socket.destroy();resolve(true)});
  socket.once('error',()=>resolve(false));
  socket.once('timeout',()=>{socket.destroy();resolve(false)});
});
assert.equal(reachable, false);
assert.notEqual(process.getuid(),0);
`,
  stdio: ['pipe', 'inherit', 'inherit'],
});
console.log(
  'PASS fixture: internal network, no published ports, read-only root, non-root, no external TCP or DNS',
);
