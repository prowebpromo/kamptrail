#!/usr/bin/env python3
"""Read PMTiles via a real HTTP range server and compare decoded PNG bytes with XYZ."""
import argparse
import hashlib
import json
import urllib.request
from collections import Counter
from pathlib import Path

from pmtiles.reader import Reader
from pack_fcc_tiles import expected_tiles


def verify(origin, packed, xyz):
    manifest=json.loads((packed/"manifest.json").read_text())
    previous=json.loads((xyz/"manifest.json").read_text())
    counts=Counter()
    for carrier in manifest["carriers"]:
        for region in carrier["regions"]:
            state,slug=region["id"],carrier["id"]
            n=region["archive"]["bytes"]
            url=f"{origin}/{manifest['release']}/{slug}/{state}.pmtiles"
            byte_cache={}
            def read(offset,length):
                key=(offset,length)
                if key not in byte_cache:
                    headers={"Range":f"bytes={offset}-{offset+length-1}","Accept-Encoding":"identity"}
                    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=8) as res:
                        assert res.status==206 and res.headers["Content-Range"]==f"bytes {offset}-{offset+length-1}/{n}"
                        assert res.headers.get("Content-Encoding","identity")=="identity"
                        payload=res.read(length+1)
                        assert len(payload)==length
                        counts["206 responses"]+=1
                        counts["response bytes"]+=length
                        byte_cache[key]=payload
                return byte_cache[key]
            rdr=Reader(read)
            coords=sorted(expected_tiles(region))
            probes=coords if len(coords)<=75 else coords[::max(1,len(coords)//48)]+coords[-1:]
            for z,x,y in probes:
                expected=(xyz/previous["release"]/slug/state/str(z)/str(x)/f"{y}.png").read_bytes()
                assert rdr.get(z,x,y)==expected
                counts["tile byte comparisons"]+=1
            if state=="AK":
                # The two Alaskan footprints are in the outer world columns. Europe is between them.
                assert rdr.get(8,128,70) is None
                counts["dateline gap absences"]+=1
            assert rdr.header()["addressed_tiles_count"]==len(coords)
            print("HTTP archive verified",state,slug,n,"bytes",flush=True)
    print("HTTP range totals",dict(counts),flush=True)


if __name__ == "__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--origin",required=True)
    p.add_argument("--packed",required=True,type=Path)
    p.add_argument("--xyz",required=True,type=Path)
    a=p.parse_args()
    verify(a.origin,a.packed,a.xyz)
