import os,secrets,json,urllib.request,urllib.parse
from pathlib import Path
os.umask(0o077)
root=Path('/root/organisation-verifier/.runtime')
p=root/'public-pds.env'
if not p.exists():
 p.write_text('\n'.join(k+'='+secrets.token_hex(32) for k in ['PDS_JWT_SECRET','PDS_ADMIN_PASSWORD','PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX'])+'\n')
data=root/'public-pds-data';data.mkdir(exist_ok=True,mode=0o700);os.chown(data,1000,1000)
values={}
for line in Path('/root/server-infrastructure/.env').read_text().splitlines():
 if '=' in line and not line.lstrip().startswith('#'):
  k,v=line.split('=',1);values[k.strip()]=v.strip().strip('"').strip("'")
domain='demokratiloftet.no';query='?teamId='+urllib.parse.quote(values['VERCEL_TEAM_ID'])
def request(path,data=None):
 r=urllib.request.Request('https://api.vercel.com'+path+query+('&limit=100' if data is None else ''),data=json.dumps(data).encode() if data is not None else None,headers={'Authorization':'Bearer '+values['VERCEL_API_TOKEN'],'Content-Type':'application/json'})
 with urllib.request.urlopen(r,timeout=30) as res:return json.load(res)
r=request('/v5/domains/'+domain+'/records');assert not r.get('pagination',{}).get('next')
for name in ['verifikasjon','pds.verifikasjon']:
 existing=[x for x in r['records'] if x['name']==name]
 if existing:
  assert len(existing)==1 and existing[0]['type']=='A' and existing[0]['value']=='187.124.129.149','Existing DNS differs; preserve it'
 else:
  request('/v2/domains/'+domain+'/records',{'name':name,'type':'A','value':'187.124.129.149','ttl':60,'comment':'Public Demokratiloftet verification issuer on own VPS'})
 print('DNS ready:',name+'.'+domain)
