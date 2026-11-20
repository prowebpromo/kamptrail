#!/usr/bin/env python3
"""Read-only measurement. Results are aggregate logs, all input/output is ephemeral."""
import datetime as dt
import hashlib
import json
import math
import os
import shutil
import sys
import tempfile
import time
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from osgeo import ogr, osr

import build_fcc_tiles as tiles
import fcc_download as fcc
import prepare_fcc_refresh as source


def emit(kind, **values):
    print(kind, json.dumps(values, separators=(",", ":"), sort_keys=True), flush=True)


def counts(bounds):
    per_zoom = {}
    for zoom in range(6, 11):
        x0, y0, x1, y1 = tiles.tile_grid(bounds, zoom)
        per_zoom[zoom] = (x1-x0+1)*(y1-y0+1)
    return per_zoom


def census_footprints(path):
    ds = ogr.Open("/vsizip/" + str(path))
    layer = ds.GetLayerByName("tl_2025_us_state")
    srs = layer.GetSpatialRef().Clone()
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    xf = osr.CoordinateTransformation(srs, tiles.spatial_ref(4326))
    for feature in layer:
        code = feature.GetFieldAsString("STUSPS")
        fips = feature.GetFieldAsString("STATEFP")
        geom = feature.GetGeometryRef().Clone()
        if geom.Transform(xf) != 0:
            raise RuntimeError("state projection failed")
        w, e, s, n = geom.GetEnvelope()
        envelopes = [[w,s,e,n]]
        if e-w >= 180:
            # This is only a count estimate. Operational renderer currently refuses the dateline.
            envelopes = []
            for xmin, xmax in ((-180, 0), (0, 180)):
                stencil = ogr.CreateGeometryFromWkt(
                    f"POLYGON (({xmin} -85,{xmax} -85,{xmax} 85,{xmin} 85,{xmin} -85))")
                fragment = geom.Intersection(stencil)
                if not fragment.IsEmpty():
                    west,east,south,north = fragment.GetEnvelope()
                    envelopes.append([west,south,east,north])
        yield code,fips,envelopes


def national(catalog, boundary):
    areas = defaultdict(Counter)
    raws = defaultdict(Counter)
    sizes = defaultdict(list)
    missing = defaultdict(list)
    omitted = []
    for state,fips,envelopes in census_footprints(boundary):
        states_and_dc = int(fips) < 60
        groups = (["50_states_plus_DC"] + (["contiguous_48_plus_DC"] if state not in ("AK","HI") else [])
                  if states_and_dc else ["territories"])
        groups.append("all_census_jurisdictions")
        matches = [(slug,source.eligible(catalog,fips,provider))
                   for slug,(provider,_) in source.PROVIDERS.items()]
        available = [(slug,r) for slug,r in matches if r]
        n = len(available)
        for key,row in matches:
            if not row:
                missing[key].append(state)
        if not n:
            omitted.append(state)
        allcounts = Counter()
        for footprint in envelopes:
            allcounts.update(counts(footprint))
        tilespec = {str(max_z):sum(v for z,v in allcounts.items() if z <= max_z)*n for max_z in (8,9,10)}
        for group in groups:
            areas[group]["states"] += 1
            areas[group]["available_archives"] += n
            areas[group]["eligible_records"] += sum(int(r["record_count"]) for _,r in available)
            areas[group].update(tilespec)
            raws[group].update({str(z):v*n for z,v in allcounts.items()})
        sizes["z10"].append((tilespec["10"],state))
        if state in ("AK", "HI", "NY", "TX", "CA", "RI"):
            emit("REGION",region=state,scope_count=n,bounds=envelopes,cumulative_files=tilespec)
    for group,values in areas.items():
        emit("FOOTPRINT",scope=group,summary=dict(values),single_zoom=dict(raws[group]))
    emit("CATALOG",missing=dict(missing),no_selected_providers=omitted,largest_z10=sorted(sizes["z10"],reverse=True)[:8])


def main():
    secret = (os.environ.pop("FCC_USERNAME").strip(), os.environ.pop("FCC_TOKEN").strip())
    if not all(secret) or fcc.BASE != "https://broadbandmap.fcc.gov/api/public/map/":
        raise RuntimeError("Approved source or account unavailable")
    previous = 0
    def paced(function, *args):
        nonlocal previous
        time.sleep(max(0, previous+26 - time.monotonic()))
        previous=time.monotonic()
        return function(*args)

    date_rows = fcc.read_json(paced(fcc.request, "listAsOfDates", secret))["data"]
    date = max(fcc.filing_date(r["as_of_date"]) for r in date_rows if r["data_type"]=="availability").isoformat()
    catalog = paced(fcc.list_mobile, date, secret, "Provider")
    emit("FILING",as_of=date,mobile_catalog_rows=len(catalog))
    with tempfile.TemporaryDirectory(prefix="fcc-national-",dir=os.environ["RUNNER_TEMP"]) as directory:
        work = Path(directory)
        boundary = work / "tl_2025_us_state.zip"
        with urllib.request.urlopen(urllib.request.Request(source.BOUNDARY,headers={"User-Agent":"KampTrail mobile coverage builder"}),timeout=90) as resp:
            fcc.download(source.LimitedStream(resp,64*1024**2),boundary)
        source.bound_zip(boundary)
        national(catalog,boundary)
        carriers = []
        incomplete = []
        for slug,(provider,brand) in source.PROVIDERS.items():
            row = source.eligible(catalog,"36",provider)
            if row is None:
                incomplete.append(slug)
                continue
            fid = int(row["file_id"])
            path = work / f"{fid}.zip"
            response = paced(fcc.request, f"downloads/downloadFile/availability/{fid}/2", secret)
            with response:
                announced=response.headers.get("Content-Length")
                size=int(announced) if announced and announced.isdigit() else None
                emit("NY_HEADERS",carrier=slug,fileId=fid,record_count=int(row["record_count"]),content_length=size)
                if size is not None and size>source.MAX_COMPRESSED:
                    emit("NY_BUDGET",carrier=slug,reason="declared compressed file exceeds 512MiB")
                    incomplete.append(slug)
                    continue
                before=time.perf_counter()
                try:
                    meta=fcc.download(source.LimitedStream(response,source.MAX_COMPRESSED),path)
                    source.bound_zip(path)
                except ValueError as err:
                    emit("NY_BUDGET",carrier=slug,reason=str(err))
                    incomplete.append(slug)
                    continue
                elapsed=round(time.perf_counter()-before,2)
            with zipfile.ZipFile(path) as archive:
                expanded=sum(e.file_size for e in archive.infolist())
            emit("NY_SOURCE",carrier=slug,fileId=fid,bytes=meta["bytes"],expanded=expanded,
                 records=int(row["record_count"]),source_sha256=meta["sha256"],download_s=elapsed)
            carriers.append({"id":slug,"providerId":provider,"brand":brand,"providerName":row["provider_name"],
                             "fileId":fid,"sourceFile":row["file_name"],"recordCount":int(row["record_count"]),
                             "sha256":meta["sha256"],"archive":str(path)})
        for carrier in carriers:
            region={"id":"NY","boundary":{"path":str(boundary),"layer":"tl_2025_us_state","source":source.BOUNDARY},
                    "carriers":[carrier]}
            plan={"release":date+"-preflight","asOf":date,"retrievedAt":dt.date.today().isoformat(),
                  "minZoom":6,"maxZoom":10,"regions":[region]}
            directory=work / ("tiles-"+carrier["id"])
            before=time.perf_counter()
            try:
                tiles.build(plan,directory)
                levels=defaultdict(list)
                for path in directory.rglob("*.png"):
                    levels[int(path.parts[-3])].append(path.stat().st_size)
                sums={}
                for cap in (8,9,10):
                    sizes=[sz for zoom,values in levels.items() if zoom<=cap for sz in values]
                    sums[str(cap)]={"bytes":sum(sizes),"files":len(sizes),"largest":max(sizes)}
                emit("NY_RENDER",carrier=carrier["id"],wall_s=round(time.perf_counter()-before,2),cumulative=sums)
            except (ValueError,RuntimeError,OSError) as exc:
                emit("NY_FAILED_RENDER",carrier=carrier["id"],error=type(exc).__name__,detail=str(exc)[:300])
                incomplete.append(carrier["id"])
            finally:
                if directory.exists():
                    shutil.rmtree(directory)
        emit("PREFLIGHT_DONE",partial=sorted(set(incomplete)),free_GiB=round(shutil.disk_usage(work).free/1024**3,1))


if __name__ == "__main__":
    main()
