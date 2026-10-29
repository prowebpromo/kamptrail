#!/usr/bin/env python3
"""Reproduce local national evidence and compare the decoder with pinned wgrib2.

No network calls and no publication. The supplied cached GRIB bytes must match
manifest SHA-256. Output contains small audit aggregates, never catalogue payloads.
"""
import argparse
from collections import Counter
import gzip
import json
import math
from pathlib import Path
import re
import subprocess
import sys

import fetch_forecasts as f


def crosscheck(cache, manifest, records):
    import grib2io
    import numpy as np
    binary = Path(sys.executable).parent/'wgrib2'
    results = {}
    for region in f.REGIONS:
        path = cache/f'{region}.bin'
        meta = next(x for x in manifest['source']['files'] if x['region']==region)
        assert f.file_hash(path)==meta['sha256'], f'{region}: source hash differs'
        references, timestamps, grids = set(), [], set()
        sampled, site_checks = [], []
        with grib2io.open(str(path)) as stream:
            messages = list(stream)
            selected = {0,len(messages)//2,len(messages)-1}
            for index,message in enumerate(messages):
                references.add(f.stamp(message.refDate));timestamps.append(f.stamp(message.validDate))
                grids.add(f.digest(f.encoded([int(n) for n in message.section3])))
                if index not in selected:continue
                lat,lon=message.grid();data=np.ma.asarray(message.data).filled(np.nan)
                ny,nx=data.shape
                points={(0,0),(0,nx-1),(1,0),(1,nx-1),(ny-1,0),(ny-1,nx-1),(ny//2,nx//2)}
                # Include finite odd/even scan rows as well as missing boundary cells.
                for parity in (0,1):
                    finite=np.argwhere(np.isfinite(data[parity::2]))
                    if len(finite):
                        r,c=finite[len(finite)//2];points.add((int(r)*2+parity,int(c)))
                points=sorted(points)
                args=[str(binary),str(path),'-d',str(index+1)]
                for r,c in points:args.extend(['-ijlat',str(c+1),str(r+1)])
                output=subprocess.run(args,check=True,text=True,capture_output=True,timeout=60).stdout
                matches=re.findall(r'\((\d+),(\d+)\),lon=([^,]+),lat=([^,]+),val=([^:\n]+)',output)
                assert len(matches)==len(points), 'Unexpected wgrib2 output'
                for (r,c),(wi,wj,wlon,wlat,wval) in zip(points,matches):
                    assert (int(wi)-1,int(wj)-1)==(c,r)
                    longitude_error=abs((float(lon[r,c])-float(wlon)+180)%360-180)
                    assert longitude_error<2e-6 and abs(float(lat[r,c])-float(wlat))<2e-6
                    expected=float(data[r,c]);actual=float(wval)
                    assert (not math.isfinite(expected) and actual>1e20) or abs(expected-actual)<0.001
                    sampled.append({'message':index+1,'row':r,'column':c,'latitude':round(float(lat[r,c]),7),
                                    'longitude':round(float(lon[r,c]),7),'kelvin':None if not math.isfinite(expected) else round(expected,5),
                                    'wgrib2_kelvin':None if actual>1e20 else actual})
                if index==0:
                    candidates=sorted((id,rec) for id,rec in records.items() if rec.get('region')==region)
                    chosen=[candidates[i] for i in sorted({0,len(candidates)//2,len(candidates)-1})] if candidates else []
                    queries=[list(map(float,rec['coordinate_key'].split(','))) for _,rec in chosen]
                    mappings=f.nearest_grid(lat,lon,message.projParameters,queries)
                    args=[str(binary),str(path),'-d','1']
                    for qlat,qlon in queries:args.extend(['-lon',str(qlon),str(qlat)])
                    output=subprocess.run(args,check=True,text=True,capture_output=True,timeout=60).stdout
                    matches=re.findall(r'lon=([^,]+),lat=([^,]+),val=([^:\n]+)',output)
                    assert len(matches)==len(chosen)
                    for (id,rec),mapping,(wlon,wlat,wval) in zip(chosen,mappings,matches):
                        assert mapping is not None
                        assert rec['grid_lat']==mapping['grid_lat'] and rec['grid_lng']==mapping['grid_lng']
                        assert abs(rec['grid_lat']-float(wlat))<2e-6
                        assert abs((rec['grid_lng']-float(wlon)+180)%360-180)<2e-6
                        actual=float(wval)
                        assert rec['temperatures_c'][0]==(None if actual>1e20 else f.temperature(actual))
                        site_checks.append({'id':id,'coordinate_key':rec['coordinate_key'],
                                            'grid_lat':rec['grid_lat'],'grid_lng':rec['grid_lng'],
                                            'grid_distance_m':rec['grid_distance_m'],'temperature_c':rec['temperatures_c'][0]})
                message.flush_data()
        assert sorted(references)==manifest['regions'][region]['reference_times']
        assert sorted(timestamps)==manifest['regions'][region]['times']
        assert grids=={manifest['regions'][region]['grid_sha256']}
        results[region]={'dimensions':[int(nx),int(ny)],'scan_flags':[int(x) for x in message.scanModeFlags],
                         'reference_times':sorted(references),'sample_count':len(timestamps),
                         'first_time':min(timestamps),'last_time':max(timestamps),
                         'grid_checks':sampled,'nearest_site_checks':site_checks}
    return results


def audit(catalogue,cache,output):
    manifest=json.loads((output/'manifest.json').read_bytes())
    rows,coordinate_hash=f.catalogue(catalogue)
    assert coordinate_hash==manifest['catalogue_sha256']
    records={};memberships={row['id']:row['states'] for row in rows}
    for state,meta in manifest['states'].items():
        compressed=(output/meta['asset']).read_bytes();raw=gzip.decompress(compressed)
        assert f.digest(compressed)==meta['sha256'] and f.digest(raw)==meta['json_sha256']
        assert len(compressed)==meta['bytes'] and len(raw)==meta['json_bytes']
        shard=json.loads(raw)
        assert shard['snapshot_id']==manifest['snapshot_id'] and shard['state']==state
        assert len(shard['records'])==meta['count']
        for id,record in shard['records'].items():
            assert state in memberships[id]
            assert id not in records or records[id]==record
            records[id]=record
    assert len(records)==len(rows)
    for row in rows:assert records[row['id']]['coordinate_key']==row['coordinate_key']
    now=f.utc(manifest['generated_at'])
    breakdown={};state_missing=Counter();complete={str(h):0 for h in (24,48)}
    for region in f.REGIONS:
        local=[(id,r) for id,r in records.items() if r.get('region')==region]
        stats=Counter(grid_known=len(local))
        for id,record in local:
            values=record['temperatures_c'];times=manifest['regions'][region]['times']
            stats['all_null' if all(v is None for v in values) else 'partial_null' if any(v is None for v in values) else 'all_samples_finite']+=1
            for hours in (24,48):
                success=f.complete_window(times,values,now,hours,manifest['regions'][region]['max_step_seconds'])
                complete[str(hours)]+=success
                stats[f'complete_{hours}h']+=success
                if hours==48 and not success:
                    for state in memberships[id]:state_missing[state]+=1
        breakdown[region]=dict(stats)
    checks=crosscheck(cache,manifest,records)
    return {'snapshot_id':manifest['snapshot_id'],'catalogue_sha256':coordinate_hash,
            'generated_at':manifest['generated_at'],'expires_at':manifest['expires_at'],
            'source_files':manifest['source']['files'],'coverage':manifest['coverage'],
            'complete_samples':complete,'by_region':breakdown,'incomplete_48h_state_memberships':dict(sorted(state_missing.items())),
            'state_count':len(manifest['states']),'state_gzip_bytes':sum(s['bytes'] for s in manifest['states'].values()),
            'largest_state_gzip_bytes':max(s['bytes'] for s in manifest['states'].values()),
            'largest_state_json_bytes':max(s['json_bytes'] for s in manifest['states'].values()),
            'manifest_bytes':(output/'manifest.json').stat().st_size,'decoder_crosschecks':checks}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalogue',type=Path,default=Path('data/campsites/search-index.json'))
    parser.add_argument('--cache',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    report=audit(args.catalogue,args.cache,args.output)
    f.atomic_bytes(args.report,json.dumps(report,indent=2,allow_nan=False).encode()+b'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('decoder_crosschecks','source_files')},sort_keys=True))


if __name__=='__main__':main()
