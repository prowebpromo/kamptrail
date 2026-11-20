#!/usr/bin/env python3
"""Pack verified FCC native XYZ tiles into immutable PMTiles v3 PNG archives."""
import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path

from pmtiles.reader import MmapSource, Reader, all_tiles
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import write

from build_fcc_tiles import check, sha256, tile_grid

MAX_ARCHIVE = 96 * 1024**2


def expected_tiles(region):
    bounds = region.get("footprints") or [region["bounds"]]
    result = set()
    for box in bounds:
        for z in range(region["minZoom"], region["maxZoom"] + 1):
            left, top, right, bottom = tile_grid(box, z)
            result.update((z, x, y) for x in range(left, right + 1) for y in range(top, bottom + 1))
    return result


def pack_region(prefix, out, region, carrier, as_of, attribution):
    coords = expected_tiles(region)
    actual = {tuple(map(int, p.relative_to(prefix).with_suffix("").parts)) for p in prefix.rglob("*.png")}
    check(coords and coords == actual, "Missing or unexpected input tile in declared regional footprints")
    footprints = region.get("footprints") or [region["bounds"]]
    enclosing = [min(b[0] for b in footprints), min(b[1] for b in footprints),
                 max(b[2] for b in footprints), max(b[3] for b in footprints)]
    bounds = dict(zip(("min_lon_e7","min_lat_e7","max_lon_e7","max_lat_e7"), (round(n*1e7) for n in enclosing)))
    west,south,east,north = footprints[0]
    header = {**bounds, "tile_type":TileType.PNG, "tile_compression":Compression.NONE,
              "center_lon_e7":round((west+east)*5e6), "center_lat_e7":round((south+north)*5e6)}
    raw = {}
    with write(out) as writer:
        for z,x,y in sorted(coords, key=lambda c:zxy_to_tileid(*c)):
            tile = (prefix / str(z) / str(x) / f"{y}.png").read_bytes()
            check(tile[:8]==b"\x89PNG\r\n\x1a\n" and len(tile) <= 512*1024, "Invalid source PNG")
            raw[(z,x,y)]=hashlib.sha256(tile).digest()
            writer.write_tile(zxy_to_tileid(z,x,y),tile)
        writer.finalize(header, {"name":f"{region['id']} {carrier} outdoor LTE", "asOf":as_of,
                                 "footprints":footprints, "attribution":attribution})
    size = out.stat().st_size
    check(size < MAX_ARCHIVE, "Archive exceeds 96 MiB; subdivide this region before publication")
    with out.open("rb") as f:
        source=MmapSource(f)
        h=Reader(source).header()
        check(h["version"] == 3 and h["addressed_tiles_count"] == len(coords) and
              h["tile_type"] == TileType.PNG and h["tile_compression"] == Compression.NONE, "Invalid archive header")
        # Traverse each archive directory once; repeated random lookup is expensive on a national build.
        for coord, observed in all_tiles(source):
            expected=raw.pop(tuple(coord), None)
            check(expected and observed and hashlib.sha256(observed).digest()==expected,
                  "Unexpected, duplicate or changed tile in archive")
        check(not raw, "A qualified native tile is missing from the archive")
    print(f"{region['id']} {carrier}: {len(coords)} verified native tiles, {size} packed bytes", flush=True)
    return {"format":"pmtiles-v3","bytes":size,"sha256":sha256(out)}


def pack(source, output):
    source,output = Path(source).resolve(),Path(output).resolve()
    check(not output.exists(), "Use a fresh archive output directory")
    output.parent.mkdir(parents=True,exist_ok=True)
    data = json.loads((source / "manifest.json").read_text())
    check(data["schema"]==1 and data["technology"]=="4G LTE" and data["environment"]=="Outdoor stationary", "Unexpected source manifest")
    import re
    check(re.fullmatch(r"\d{4}-\d\d-\d\d-[\w-]{1,80}",data["release"]), "Unsafe source release identifier")
    with tempfile.TemporaryDirectory(prefix=".fcc-pack-", dir=output.parent) as scratch:
        stage=Path(scratch) / "public"
        files=stage / "pending"
        for carrier in data["carriers"]:
            slug=carrier["id"]
            check(slug in {"att","t-mobile","verizon"},"Unrecognized carrier")
            (files / slug).mkdir(parents=True,exist_ok=False)
            for region in carrier["regions"]:
                state=region["id"]
                check(re.fullmatch("[A-Z]{2}",state),"Invalid region")
                prefix=source/data["release"]/slug/state
                target=files/slug/(state+".pmtiles")
                check(not target.exists(),"Duplicate carrier/region")
                region["archive"]=pack_region(prefix,target,region,slug,data["asOf"],data["attribution"])
                if "footprints" not in region:
                    region["footprints"]=[region["bounds"]]
        # Retrieval day alone does not change immutable URLs. Source and packed bytes do.
        signature={k:v for k,v in data.items() if k!="retrievedAt"}
        digest=hashlib.sha256(json.dumps(signature,sort_keys=True,separators=(",",":")).encode()).hexdigest()
        data["schema"]=2
        data["release"]=data["asOf"]+"-"+digest[:20]
        files.rename(stage/data["release"])
        (stage/"manifest.json").write_text(json.dumps(data,separators=(",",":"))+"\n")
        os.rename(stage,output)
    return data


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xyz",required=True,type=Path)
    parser.add_argument("--output",required=True,type=Path)
    args=parser.parse_args()
    pack(args.xyz,args.output)
