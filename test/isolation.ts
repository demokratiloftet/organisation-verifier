import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
interface ContainerInspection {
  HostConfig: { ReadonlyRootfs: boolean; CapDrop: string[]; PortBindings: Record<string, unknown> | null };
  Config: { User: string };
  NetworkSettings: { Networks: Record<string, unknown> };
}
interface NetworkInspection {
  Internal: boolean;
  EnableIPv6: boolean;
}
const id = execFileSync('docker', ['compose', 'ps', '-q', 'fixture'], { encoding: 'utf8' }).trim();
assert(id, 'Fixture must be running');
const [container] = JSON.parse(
  execFileSync('docker', ['inspect', id], { encoding: 'utf8' }),
) as ContainerInspection[];
assert(container, 'Docker must return the fixture container');
assert.equal(container.HostConfig.ReadonlyRootfs, true);
assert.deepEqual(container.HostConfig.CapDrop, ['ALL']);
assert.equal(Object.keys(container.HostConfig.PortBindings || {}).length, 0);
assert.equal(container.Config.User, 'node');
const networks = Object.keys(container.NetworkSettings.Networks);
assert.equal(networks.length, 1);
assert(networks[0], 'Fixture network must exist');
const [network] = JSON.parse(
  execFileSync('docker', ['network', 'inspect', networks[0]], { encoding: 'utf8' }),
) as NetworkInspection[];
assert(network, 'Docker must return the fixture network');
assert.equal(network.Internal, true);
assert.equal(network.EnableIPv6, false);
execFileSync('docker', ['exec', '-i', id, 'node', '--input-type=module', '-'], {
  input: readFileSync(new URL('./fixture-egress.js', import.meta.url), 'utf8'),
  stdio: ['pipe', 'inherit', 'inherit'],
});
console.log(
  'PASS fixture: internal network, no published ports, read-only root, non-root, no external TCP or DNS',
);
