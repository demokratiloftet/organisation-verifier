"""Run on the VPS only. Secrets stay in root-only runtime files; stdout is metadata.

Creates/reuses one dedicated public issuer account on the separate official PDS.
Does not enable issuance, change DNS, restart a PDS, or create synthetic claims.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess

root = Path('/root/organisation-verifier/.runtime')
if os.geteuid() != 0 or not root.is_dir():
    raise SystemExit('Run on the configured VPS as root.')
os.umask(0o077)
account_file = root / 'public-issuer-account.json'
app_file = root / 'public-issuer-password'
if account_file.exists():
    account = json.loads(account_file.read_text())
else:
    account = {
        'handle': 'verifikasjon.demokratiloftet.no',
        'email': 'edvin@devotta.no',
        'password': secrets.token_urlsafe(48),
    }
    # Save before createAccount: retry can recover a response lost after success.
    account_file.write_text(json.dumps(account))
account_file.chmod(0o600)
program = r'''
let input = ''; for await (const chunk of process.stdin) input += chunk;
const config = JSON.parse(input);
async function rpc(method, body, token) {
  const response = await fetch('http://127.0.0.1:3000/xrpc/' + method, {
    method:body === undefined ? 'GET' : 'POST', headers:{'content-type':'application/json', ...(token ? {authorization:'Bearer '+token} : {})},
    body:JSON.stringify(body), signal:AbortSignal.timeout(20000), redirect:'error',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(method + ': ' + response.status + ' ' + data.error);
  return data;
}
try {
  let session;
  try { session = await rpc('com.atproto.server.createSession', {identifier:config.handle,password:config.password}); }
  catch (error) {
    if (config.did) throw error;
    const invitation = await fetch('http://127.0.0.1:3000/xrpc/com.atproto.server.createInviteCode', {
      method:'POST',headers:{'content-type':'application/json',authorization:'Basic '+Buffer.from('admin:'+process.env.PDS_ADMIN_PASSWORD).toString('base64')},
      body:JSON.stringify({useCount:1}),signal:AbortSignal.timeout(20000),
    });
    if (!invitation.ok) throw new Error('Could not provision an issuer invitation');
    const {code} = await invitation.json();
    session = await rpc('com.atproto.server.createAccount', {handle:config.handle,email:config.email,password:config.password,inviteCode:code});
  }
  if (config.did && config.did !== session.did) throw new Error('Issuer identity mismatch');
  await rpc('com.atproto.repo.putRecord', {
    repo:session.did,collection:'app.bsky.actor.profile',rkey:'self',
    record:{$type:'app.bsky.actor.profile',displayName:'Demokratiloftet verifikasjon',
      description:'Utsteder for kontroll av organisasjoners domenetilknytning. Utstedt av Demokratiloftet på egen PDS. Ikke juridisk fullmakt.'},
  }, session.accessJwt);
  let appPassword;
  if (config.needAppPassword) {
    // Recover a lost response without accumulating orphaned credentials.
    const name = 'public-organisation-verifier';
    const list = await rpc('com.atproto.server.listAppPasswords', undefined, session.accessJwt);
    if (list.passwords.some(p => p.name === name))
      await rpc('com.atproto.server.revokeAppPassword', {name}, session.accessJwt);
    appPassword = (await rpc('com.atproto.server.createAppPassword', {name,privileged:false}, session.accessJwt)).password;
  }
  process.stdout.write(JSON.stringify({did:session.did,handle:session.handle,appPassword}));
} catch (error) { console.error(error.message); process.exit(1); }
'''
request = dict(account, needAppPassword=not app_file.exists())
result = subprocess.run(
    ['docker', 'exec', '-i', 'public-verification-pds', 'node', '--input-type=module', '-e', program],
    input=json.dumps(request), text=True, capture_output=True,
)
if result.returncode:
    # Do not echo server/SDK output, which could contain request details.
    raise SystemExit('Public account provisioning failed; saved credentials retained for recovery.')
data = json.loads(result.stdout)
account.update(did=data['did'])
account_file.write_text(json.dumps(account))
if data.get('appPassword'):
    app_file.write_text(data['appPassword'] + '\n')
    app_file.chmod(0o600)
    os.chown(app_file, 1000, 1000)
metadata = {'did': data['did'], 'handle': data['handle'], 'service': 'https://pds.verifikasjon.demokratiloftet.no'}
(root / 'public-issuer.json').write_text(json.dumps(metadata, indent=2) + '\n')
(root / 'public-tls/issuer.json').write_text(json.dumps(metadata))
(root / 'public-tls/issuer.json').chmod(0o644)
print(json.dumps(metadata))
