import hashlib,json,subprocess,datetime
from pathlib import Path
root=Path('/workspace/scratch/2f7921418a46/audit-pilot-76da')
raw=(root/'data/campsites/search-index.json').read_bytes(); index=json.loads(raw); hostsraw=(root/'data/campsites/identity-hosts.json').read_bytes(); hosts=json.loads(hostsraw)
owners={};conflicts=[]
for row in index['sites']:
 for key in set([row['id']]+row.get('legacy_ids',[])):
  if key in owners and owners[key]!=row['id']: conflicts.append([key,owners[key],row['id']])
  owners[key]=row['id']
expected={r['id']:r['legacy_ids'] for r in index['sites'] if r.get('legacy_ids')}
assert hosts['hosts']==expected
assert hosts['index_sha256']==hashlib.sha256(raw).hexdigest()
assert hosts['index_sites']==len(index['sites'])
assert not conflicts
prior=json.loads(subprocess.check_output(['git','show','041ff76c:data/campsites/search-index.json'],cwd=root))
priorowners={key:r['id'] for r in prior['sites'] for key in set([r['id']]+r.get('legacy_ids',[]))}
assert owners==priorowners
rawlog=subprocess.check_output(['git','show','59964aae:docs/acceptance/76da929f/raw-output.txt'],cwd=root)
print(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'baseline':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'listings':len(index['sites']),'ids':len(owners),'conflicts':conflicts,'lost_or_moved_since_041ff76c':0,'host_map_matches_index':True,'index_sha256':hashlib.sha256(raw).hexdigest(),'hosts_sha256':hashlib.sha256(hostsraw).hexdigest(),'claude_raw_output_sha256':hashlib.sha256(rawlog).hexdigest()},indent=2))
