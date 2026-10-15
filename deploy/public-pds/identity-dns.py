from pathlib import Path
import json,urllib.request,urllib.parse
values={}
for line in Path('/root/server-infrastructure/.env').read_text().splitlines():
 if '=' in line and not line.lstrip().startswith('#'):
  k,v=line.split('=',1);values[k.strip()]=v.strip().strip('"').strip("'")
issuer=json.loads(Path('/root/organisation-verifier/.runtime/public-issuer.json').read_text())
query='?teamId='+urllib.parse.quote(values['VERCEL_TEAM_ID'])
def request(path,data=None):
 r=urllib.request.Request('https://api.vercel.com'+path+query+('&limit=100' if data is None else ''),data=json.dumps(data).encode() if data is not None else None,headers={'Authorization':'Bearer '+values['VERCEL_API_TOKEN'],'Content-Type':'application/json'})
 with urllib.request.urlopen(r,timeout=30) as res:return json.load(res)
r=request('/v5/domains/demokratiloftet.no/records');assert not r.get('pagination',{}).get('next')
name='_atproto.verifikasjon';value='did='+issuer['did']
existing=[x for x in r['records'] if x['name']==name]
if existing:assert len(existing)==1 and existing[0]['type']=='TXT' and existing[0]['value'].strip('"')==value
else:request('/v2/domains/demokratiloftet.no/records',{'name':name,'type':'TXT','value':value,'ttl':60,'comment':'Public verification issuer identity'})
print('Public issuer handle TXT ready',issuer['handle'],issuer['did'])
