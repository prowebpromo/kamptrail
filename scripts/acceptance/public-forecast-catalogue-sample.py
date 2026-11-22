from datetime import datetime, timezone
import hashlib
import json
import os
import time
import urllib.error
import urllib.request

ROOT = 'https://kamptrail.com/'
TARGET = 'df5e63b0cc11e267692f2efb9d5ee57583e6e9f046b6184c3de2523d86ff7141'

def utc(ts):
    return datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()

def get(path, cap):
    req = urllib.request.Request(ROOT + path, headers={'Cache-Control':'no-cache','User-Agent':'KampTrail forecast catalogue verification'})
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            data = response.read(cap + 1)
            if len(data) > cap:
                raise ValueError('response exceeds expected size')
            return response.status, response.headers, data
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read(2048)

for attempt in range(27):
    code, _, raw = get('data/campsites/coordinate-index.json?catalogue-check='+str(int(time.time())), 8192)
    index = json.loads(raw) if code == 200 else {}
    if index.get('sha256') == TARGET and index.get('count') == 33605:
        print('PUBLIC CATALOGUE',index,flush=True)
        break
    if attempt == 26:
        raise ValueError('hosting has not served target catalogue')
    print('Waiting for target catalogue (current count)',index.get('count'),flush=True)
    time.sleep(90)

for attempt in range(3):
    code, headers, raw = get('api/forecast.php?kind=index',262144)
    try: result = json.loads(raw)
    except (ValueError,UnicodeError): result = {}
    m = result.get('manifest',{})
    if code==200 and result.get('ok') is True and m.get('catalogue_sha256') == TARGET:
        assert m['coverage']['total'] == 33605
        assert utc(m['generated_at']) <= utc(result['server_now']) + 300
        assert utc(result['server_now']) < utc(m['expires_at'])
        assert time.time()<utc(m['expires_at'])
        break
    print('PUBLIC READER WAIT',code,result.get('error'),m.get('catalogue_sha256'),headers.get('Retry-After'),flush=True)
    if attempt==2 or code not in (200,429,503):
        raise ValueError('new catalogue lacks fresh public forecast')
    retry = int(headers.get('Retry-After') or 900)
    if retry < 0 or retry > 900:
        raise ValueError('server requested a later check')
    time.sleep(retry+3)

sid=m['snapshot_id']
print('FORECAST',json.dumps({'snapshot':sid,'count':m['coverage']['total'],'catalogue':m['catalogue_sha256'],'generated':m['generated_at'],'serverNow':result['server_now'],'expires':m['expires_at']}),flush=True)
import re
assert re.fullmatch('[a-f0-9]{24}',sid)
code, _, raw=get('api/forecast.php?kind=state&state=NY&snapshot='+sid,8*1024*1024)
state=json.loads(raw)
spec=m['states']['NY']
actual=hashlib.sha256(raw).hexdigest()
assert code==200 and state['state']=='NY' and state['snapshot_id']==sid
assert spec['json_bytes']==len(raw) and spec['json_sha256']==actual
assert state['expires_at']==m['expires_at'] and len(state['records'])==spec['count'] and spec['count']>0
assert time.time()<utc(state['expires_at'])
print('STATE',json.dumps({'state':'NY','snapshot':sid,'http':code,'records':spec['count'],'bytes':len(raw),'sha256':actual,'verified':True}),flush=True)
