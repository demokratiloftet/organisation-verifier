"""Export only the public verification certificate; secrets never reach stdout."""
import base64,json,os,tempfile
from pathlib import Path
names={'verifikasjon.demokratiloftet.no','pds.verifikasjon.demokratiloftet.no'}
source=json.loads(Path('/root/server-infrastructure/certs/acme.json').read_text())
certs=[c for r in source.values() if isinstance(r,dict) for c in r.get('Certificates',[]) if names.issubset({c['domain']['main'],*c['domain'].get('sans',[])})]
if not certs: raise SystemExit('Verification certificate not issued yet')
c=certs[-1]
output=Path('/root/organisation-verifier/.runtime/public-tls');output.mkdir(mode=0o755,exist_ok=True)
fd,tmp=tempfile.mkstemp(dir=output)
try:
 with os.fdopen(fd,'w') as f:
  json.dump({k:base64.b64decode(c[src]).decode() for k,src in [('key','key'),('cert','certificate')]},f)
  f.flush();os.fsync(f.fileno())
 os.chown(tmp,1000,1000);os.chmod(tmp,0o600);os.replace(tmp,output/'tls.json')
finally:
 if os.path.exists(tmp):os.unlink(tmp)
print('Verification TLS bundle exported')
