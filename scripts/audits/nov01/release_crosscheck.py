"""Independent 2.33/2.34 index and clearance package audit. Run from the repo root."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

LIVE = 'https://kamptrail.com/'
BEFORE = '16fcc1bbd904b98358ce1d5bb557943c1067e6f0'
RELEASE = '9c9304666847827af41ab2a1eb73d921969add0a'
INDEX = 'data/campsites/search-index.json'
EXPECTED = '83e6f21c026796ab6ee54f7963855d676536f29a5d95d256dadbbaf53b06c33a'
ROOT = Path.cwd()
OUT = ROOT / 'dist/kamptrail'


def fetch(path):
    req = urllib.request.Request(LIVE + path, headers={'User-Agent': 'KampTrail independent release check'})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, b''


def digest(payload):
    return hashlib.sha256(payload).hexdigest()


def from_git(commit, path):
    return subprocess.check_output(['git', 'show', f'{commit}:{path}'])


def examine_index(before_bytes, after_bytes):
    before, after = [json.loads(data) for data in (before_bytes, after_bytes)]
    old_rows, new_rows = before.pop('sites'), after.pop('sites')
    old_by_id = {r['id']: r for r in old_rows}
    new_by_id = {r['id']: r for r in new_rows}
    diffs, unexpected = [], []
    for ident in sorted(old_by_id.keys() & new_by_id.keys()):
        old, new = old_by_id[ident], new_by_id[ident]
        if old == new:
            continue
        old_meta, new_meta = dict(old['m']), dict(new['m'])
        prior, current = old_meta.pop('r', []), new_meta.pop('r', [])
        if dict(old, m=old_meta) != dict(new, m=new_meta):
            unexpected.append(ident)
        diffs.append({'id': ident, 'before': prior, 'after': current})
    def counts(rows):
        return dict(sorted(Counter(rig for row in rows for rig in row['m'].get('r', [])).items()))
    return {'before_sha256': digest(before_bytes), 'after_sha256': digest(after_bytes),
            'rows': [len(old_rows), len(new_rows)],
            'unique_ids': [len(old_by_id), len(new_by_id)],
            'removed_ids': sorted(old_by_id.keys()-new_by_id.keys()),
            'added_ids': sorted(new_by_id.keys()-old_by_id.keys()),
            'row_order_unchanged': [r['id'] for r in old_rows] == [r['id'] for r in new_rows],
            'other_top_level_fields_unchanged': before == after,
            'changed_count': len(diffs), 'changed_beyond_rig': unexpected, 'changed': diffs,
            'rig_counts_before': counts(old_rows), 'rig_counts_after': counts(new_rows)}


def main():
    marker_code, marker_body = fetch('release.json')
    idx_code, idx_body = fetch(INDEX)
    if marker_code != 200 or idx_code != 200:
        raise RuntimeError(f'cannot read live marker/index: {marker_code}, {idx_code}')
    marker = json.loads(marker_body)['source_commit']
    if not re.fullmatch('[a-f0-9]{40}', marker):
        raise ValueError('invalid release marker')
    index = examine_index(from_git(BEFORE, INDEX), idx_body)
    subprocess.run(['node', 'scripts/build-release.js'], check=True,
                   env=dict(os.environ,KAMPTRAIL_PUBLIC_URL=LIVE), stdout=sys.stderr)
    inventory = sorted(p.relative_to(OUT).as_posix() for p in (OUT/'data/clearances').rglob('*') if p.is_file())
    national_markers = re.compile(r'data/clearances/(?:index|tiles|excluded)|kamptrail-clearances(?:-state)?-3|clearance_candidates_manifest')
    client_files = sorted(p for p in OUT.rglob('*') if p.suffix.lower() in {'.js','.html','.css','.webmanifest'} or p.name=='manifest.json')
    references = []
    for p in client_files:
        for m in national_markers.finditer(p.read_text(encoding='utf-8')):
            references.append([p.relative_to(OUT).as_posix(), m.group()])
    key_assets = ['index.html','service-worker.js','app.js','data-quality.js','data-loader.js','filters.js',
                  'clearances.js','route-clearance.js','data/clearances/RI.json','data/campsites/identity-hosts.json']
    def asset_check(path):
        code, body = fetch(path)
        return {'path':path,'http':code,'sha256':digest(body),'matches_package':code==200 and body==(OUT/path).read_bytes()}
    with ThreadPoolExecutor(max_workers=3) as pool:
        assets = list(pool.map(asset_check, key_assets))
    manifest_code, _ = fetch('data/clearances/index.json')
    marker_end = json.loads(fetch('release.json')[1])['source_commit']
    report = {'utc':dt.datetime.now(dt.timezone.utc).isoformat(),'initial_marker':marker,'final_marker':marker_end,
              'release':json.loads((ROOT/'package.json').read_text())['version'],
              'live_index_matches_release_git':idx_body==from_git(RELEASE, INDEX),
              'index':index,'clearance_files':inventory,'client_files_scanned':len(client_files),
              'national_client_references':references,'live_national_manifest_http':manifest_code,
              'live_vs_package':assets}
    passing = (marker==marker_end and report['live_index_matches_release_git'] and index['after_sha256']==EXPECTED
               and index['rows']==[33370,33370] and index['unique_ids']==index['rows']
               and not index['added_ids'] and not index['removed_ids'] and index['row_order_unchanged']
               and index['other_top_level_fields_unchanged'] and index['changed_count']==237
               and not index['changed_beyond_rig'] and index['rig_counts_before']=={'tent':5963,'trailer':2989,'rv':242}
               and index['rig_counts_after']=={'tent':5783,'trailer':2848,'rv':187}
               and inventory==['data/clearances/RI.json'] and not references and manifest_code==404
               and all(a['matches_package'] for a in assets))
    report['pass'] = passing
    print(json.dumps(report,indent=2))
    return 0 if passing else 1


if __name__=='__main__':
    sys.exit(main())
