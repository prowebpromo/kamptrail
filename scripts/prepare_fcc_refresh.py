#!/usr/bin/env python3
"""Prepare the raw provider archives for the reviewed New York and Rhode Island release."""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import time
import urllib.request
import zipfile
from pathlib import Path

REGIONS = {"NY": "36", "RI": "44"}
PROVIDERS = {"att": ("130077", "AT&T"), "t-mobile": ("130403", "T-Mobile"),
             "verizon": ("131425", "Verizon")}
BOUNDARY = "https://www2.census.gov/geo/tiger/TIGER2025/STATE/tl_2025_us_state.zip"
ROOT = Path(__file__).resolve().parents[1]
MIN_ZOOM, MAX_ZOOM = 6, 10
GIB = 1024**3
MAX_COMPRESSED = 512 * 1024**2
MAX_EXPANDED = 2 * GIB


def sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def eligible(rows, fips, provider):
    selected = [r for r in rows if r.get("category") == "Provider"
                and r.get("subcategory") == "Raw Coverage" and r.get("file_type") == "gis"
                and r.get("technology_type") == "Mobile Broadband"
                and str(r.get("technology_code")) == "400" and r.get("state_fips") == fips
                and str(r.get("provider_id")) == provider]
    if not selected:
        return None
    if len(selected) != 1:
        raise ValueError(f"Expected one LTE raw mobile catalog file for FIPS {fips}, provider {provider}; found {len(selected)}.")
    row = selected[0]
    if (not re.fullmatch(r"[1-9]\d*", str(row["file_id"]))
            or not re.fullmatch(r"[1-9]\d*", str(row["record_count"]))
            or not re.fullmatch(r"[A-Za-z0-9_.-]{1,180}", row["file_name"])
            or not isinstance(row.get("provider_name"), str) or not row["provider_name"]):
        raise ValueError("Missing or invalid FCC catalog identity.")
    return row


def bound_zip(path):
    with zipfile.ZipFile(path) as archive:
        sizes = [x.file_size for x in archive.infolist()]
        if not sizes or len(sizes) > 50 or sum(sizes) > MAX_EXPANDED:
            raise ValueError("Archive exceeds the verified worker's expansion budget.")


class LimitedStream:
    """Bound the streamed reply even when the origin omits Content-Length."""
    def __init__(self, response, limit):
        self.response = response
        self.remaining = limit

    def __enter__(self):
        return self

    def __exit__(self, *unused):
        self.response.close()

    def read(self, n):
        block = self.response.read(min(n, self.remaining + 1))
        self.remaining -= len(block)
        if self.remaining < 0:
            raise ValueError("Archive exceeded this refresh worker's byte budget.")
        return block


def prepare(work):
    import fcc_download as fcc
    from osgeo import gdal
    import numpy
    import zlib
    work.mkdir(mode=0o700, parents=True, exist_ok=False)
    credentials = (os.environ["FCC_USERNAME"].strip(), os.environ["FCC_TOKEN"].strip())
    if not all(credentials):
        raise ValueError("FCC credentials unavailable.")
    last = 0.0

    def paced(call, *args):
        nonlocal last
        time.sleep(max(0.0, last + 7.0 - time.monotonic()))
        last = time.monotonic()
        return call(*args)

    envelope = fcc.read_json(paced(fcc.request, "listAsOfDates", credentials))
    dates = [fcc.filing_date(r.get("as_of_date")) for r in envelope["data"]
             if isinstance(r, dict) and r.get("data_type") == "availability"]
    if not dates or None in dates:
        raise ValueError("Could not establish the latest availability filing date.")
    date = max(dates).isoformat()
    catalog = paced(fcc.list_mobile, date, credentials, "Provider")
    boundary_file = work / "tl_2025_us_state.zip"
    request = urllib.request.Request(BOUNDARY, headers={"User-Agent":"KampTrail mobile coverage builder"})
    with urllib.request.urlopen(request, timeout=90) as response:
        meta = fcc.download(LimitedStream(response, 64 * 1024**2), boundary_file)
    bound_zip(boundary_file)
    boundary = {"path": str(boundary_file.resolve()), "layer": "tl_2025_us_state",
                "source": BOUNDARY, "sha256": meta["sha256"]}
    regions, source_records = [], []
    for region, fips in REGIONS.items():
        carriers = []
        for slug, (provider, brand) in PROVIDERS.items():
            row = eligible(catalog, fips, provider)
            if row is None:
                print(f"FCC has no raw LTE file for {brand} in {region} on {date}; scope omitted.")
                continue
            file_id = int(row["file_id"])
            path = work / f"{region}-{slug}-{file_id}.zip"
            response = paced(fcc.request, f"downloads/downloadFile/availability/{file_id}/2", credentials)
            meta = fcc.download(LimitedStream(response, MAX_COMPRESSED), path)
            bound_zip(path)
            entry = {"id":slug, "providerId":provider, "brand":brand, "providerName":row["provider_name"],
                     "fileId":file_id, "sourceFile":row["file_name"], "recordCount":int(row["record_count"]),
                     "sha256":meta["sha256"]}
            source_records.append({"region":region, **entry})
            carriers.append({**entry, "archive":str(path.resolve())})
            print(f"{region} {brand}: FCC file {file_id}; {meta['bytes']} bytes; {entry['recordCount']} catalog records.", flush=True)
        if carriers:
            regions.append({"id":region, "boundary":boundary, "carriers":carriers})
    if not regions:
        raise ValueError("No public LTE archives in the configured scope; retaining the published release.")
    # A filing may be revised without changing its reporting date. Content, selected
    # source identity and the renderer jointly determine immutable tile URLs.
    identity = {"date":date, "boundary":{k:boundary[k] for k in ("source", "sha256", "layer")}, "sources":source_records,
                "zooms":[MIN_ZOOM,MAX_ZOOM], "builder":sha256(ROOT / "scripts/build_fcc_tiles.py"),
                "gdal":gdal.VersionInfo("--version"), "numpy":numpy.__version__, "zlib":zlib.ZLIB_RUNTIME_VERSION}
    version = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    plan = {"release":date + "-" + version[:20], "asOf":date,
            "retrievedAt":dt.datetime.now(dt.timezone.utc).date().isoformat(),
            "minZoom":MIN_ZOOM, "maxZoom":MAX_ZOOM, "regions":regions}
    (work / "plan.json").write_text(json.dumps(plan), encoding="utf-8")
    print(f"Prepared {len(source_records)} provider archives for {plan['release']}.")



if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", required=True, type=Path)
    args = parser.parse_args()
    prepare(args.work.resolve())
