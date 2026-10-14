import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectAccount } from '../src/identity.js';
const did = 'did:plc:abcdefghijklmnopqrstuvwx';
const doc = (id = did, handle = 'example.org', pds = 'https://pds.example.org') => ({
  id,
  alsoKnownAs: [`at://${handle}`],
  verificationMethod: [
    {
      id: `${id}#atproto`,
      controller: id,
      type: 'Multikey',
      publicKeyMultibase: 'zQ3shXjHeiBuRCKmM36cuYnm7YEMzhGnCmCyW92sRJ9pribSF',
    },
  ],
  service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: pds }],
});
const noHttp: typeof fetch = async () => {
  throw new Error('Unexpected HTTP request');
};

test('account evidence shows actual TXT data and the account PDS independently of an app viewer', async () => {
  const result = await inspectAccount('example.org', did, {
    txt: async (name) => {
      assert.equal(name, '_atproto.example.org');
      return [['did=', did]];
    },
    document: async (id) => {
      assert.equal(id, did);
      return doc();
    },
    http: noHttp,
  });
  assert.equal(result.matches, true);
  assert.equal(result.method, 'dns');
  assert.deepEqual(result.dnsRecords, [`did=${did}`]);
  assert.equal(result.pds, 'https://pds.example.org');
  assert.equal(result.documentUrl, `https://plc.directory/${did}`);
  assert.equal(new URL(result.repositoryUrl).searchParams.get('repo'), did);
});

test('HTTPS evidence reports the actual alternate method and supports hostname did:web documents', async () => {
  const id = 'did:web:account.example.org';
  const result = await inspectAccount('example.org', id, {
    txt: async () => {
      throw Object.assign(new Error('absent'), { code: 'ENODATA' });
    },
    document: async () => doc(id),
    http: async (input) => {
      assert.equal(String(input), 'https://example.org/.well-known/atproto-did');
      return new Response(id);
    },
  });
  assert.equal(result.matches, true);
  assert.equal(result.method, 'https');
  assert.deepEqual(result.dnsRecords, []);
  assert.equal(result.documentUrl, 'https://account.example.org/.well-known/did.json');
});

test('changed bindings are not presented as confirmed; lookup errors remain errors', async () => {
  for (const [resolved, claimed] of [
    [did, 'other.example.org'],
    ['did:plc:bcdefghijklmnopqrstuvwxy', 'example.org'],
  ]) {
    const result = await inspectAccount('example.org', did, {
      txt: async () => [[`did=${resolved}`]],
      document: async () => doc(did, claimed),
      http: noHttp,
    });
    assert.equal(result.matches, false);
  }
  await assert.rejects(
    inspectAccount('example.org', did, {
      txt: async () => {
        throw new Error('timeout');
      },
      document: async () => doc(),
      http: noHttp,
    }),
  );
  await assert.rejects(
    inspectAccount('example.org', did, {
      txt: async () => [[`did=${did}`]],
      document: async () => doc('did:plc:bcdefghijklmnopqrstuvwxy'),
      http: noHttp,
    }),
    /unavailable/,
  );
});

test('evidence never returns unsafe provider navigation URLs', async () => {
  for (const pds of [
    'http://pds.example.org',
    'https://127.0.0.1',
    'https://localhost',
    'https://user:secret@pds.example.org',
    'https://pds.example.org/path',
    'https://pds.example.org:8443',
  ]) {
    await assert.rejects(
      inspectAccount('example.org', did, {
        txt: async () => [[`did=${did}`]],
        document: async () => doc(did, 'example.org', pds),
        http: noHttp,
      }),
    );
  }
});
