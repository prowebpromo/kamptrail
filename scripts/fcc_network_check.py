#!/usr/bin/env python3
"""Inspect one official mobile broadband archive on the ephemeral Actions runner."""
import datetime
import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

BASE = "https://broadbandmap.fcc.gov/api/public/map/"
UA = "KampTrail coverage importer (+https://github.com/prowebpromo/kamptrail)"
LIMIT = 512 * 1024 * 1024
last_request = 0

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None

def get(path):
    global last_request
    time.sleep(max(0, last_request + 7 - time.monotonic()))
    req = urllib.request.Request(BASE + path, headers={
        "username": os.environ["FCC_USERNAME"], "hash_value": os.environ["FCC_TOKEN"],
        "User-Agent": UA, "Accept": "application/json, application/zip, application/octet-stream"})
    last_request = time.monotonic()
    try:
        return urllib.request.build_opener(NoRedirect()).open(req, timeout=150)
    except urllib.error.HTTPError as e:
        print("FCC HTTP status", e.code, "; redirect host:",
              urllib.parse.urlsplit(e.headers.get("Location", "")).hostname or "none", flush=True)
        if e.headers.get_content_type() == "application/json":
            detail=json.loads(e.read(12000))
            print("API result:", {k: str(detail[k])[:200] for k in ("status", "status_code", "message") if k in detail})
        raise SystemExit(1) from None

def records(path):
    with get(path) as response:
        value = json.load(response)
    if not isinstance(value.get("data"), list):
        raise ValueError("Missing record list.")
    print("JSON envelope", value.get("status_code"), value.get("status"), flush=True)
    return value["data"]

def ident(value):
    return '"' + value.replace('"','""') + '"'

def inspect_gpkg(src, dest):
    with src, dest.open("wb") as local:
        shutil.copyfileobj(src, local)
    with sqlite3.connect(dest.resolve().as_uri() + "?mode=ro&immutable=1", uri=True) as db:
        layers = db.execute("select table_name,column_name,geometry_type_name,srs_id from gpkg_geometry_columns").fetchall()
        print("GeoPackage geometry columns", json.dumps(layers))
        for layer, geom, typ, srs in layers:
            attrs = [c[1] for c in db.execute("pragma table_info("+ident(layer)+")") if c[1] != geom]
            print("Layer", layer, "fields", attrs, "count", db.execute("select count(*) from "+ident(layer)).fetchone()[0])
            sample_fields=[x for x in attrs if x.lower() in {"brandname","brand_name","providerid","provider_id","technology","technology_code","tech","mindown","minup","min_down","min_up","environmnt","env","environment","bizrescode","speed","model","state_fips","h3_res9_id","h3index"}]
            if sample_fields:
                fields = ",".join(ident(c) for c in sample_fields)
                print("Attribute examples", json.dumps(db.execute("select distinct "+fields+" from "+ident(layer)+" limit 20").fetchall(),default=str))
            print("Layer extent", db.execute("select min_x,min_y,max_x,max_y from gpkg_contents where table_name=?", (layer,)).fetchone())

def run():
    dates = records("listAsOfDates")
    available = [r["as_of_date"] for r in dates if r.get("data_type")=="availability" and r.get("as_of_date")]
    print("Availability dates", sorted(available), flush=True)
    date = max(available)[:10]
    datetime.date.fromisoformat(date)
    query = urllib.parse.urlencode({"category":"Provider", "technology_type":"Mobile Broadband"})
    rows = records("downloads/listAvailabilityData/"+date+"?"+query)
    print("Provider catalog count",len(rows))
    fields = ("file_id","file_name","file_type","category","subcategory","technology_type","technology_code","technology_code_desc","state_fips","state_name","provider_id","provider_name","speed_tier","record_count","revision_date","file_record_count")
    def show(row):
        return {k: row[k] for k in fields if k in row}
    print("State row example", json.dumps(show(rows[0]) if rows else {}))
    if rows: print("Field names",sorted(rows[0]))
    ri=[r for r in rows if str(r.get("state_fips","")).zfill(2)=="44" or str(r.get("state_name","")).lower()=="rhode island"]
    print("RI provider listings",json.dumps([show(r) for r in ri if str(r.get("technology_code"))=="400"]),flush=True)
    choices=[r for r in ri if str(r.get("technology_code"))=="400" and r.get("subcategory")=="Raw Coverage" and "verizon" in str(r.get("provider_name","")).lower()]
    if len(choices)!=1:
        raise SystemExit("No unambiguous RI Verizon raw LTE dataset.")
    rid=int(choices[0]["file_id"])
    with tempfile.TemporaryDirectory() as tmp:
        folder=Path(tmp)
        archive=folder / "fcc.zip"
        h=hashlib.sha256()
        length=0
        with get("downloads/downloadFile/availability/"+str(rid)+"/2") as response, archive.open("wb") as f:
            print("Download status",response.status,response.headers.get_content_type())
            while block:=response.read(2**20):
                length+=len(block)
                if length>LIMIT: raise SystemExit("Archive exceeds verification limit.")
                h.update(block)
                f.write(block)
        print("Archive validation", "file_id",rid,"filing",date,"bytes",length,"sha256",h.hexdigest(),flush=True)
        with zipfile.ZipFile(archive) as z:
            infos=z.infolist()
            print("Archive inventory", [(i.filename,i.file_size) for i in infos[:20]])
            gpkg=[i for i in infos if i.filename.lower().endswith(".gpkg") and i.file_size<=2**31]
            if not gpkg: raise SystemExit("No GeoPackage in selected archive.")
            for i,info in enumerate(gpkg):
                inspect_gpkg(z.open(info),folder / ("sample"+str(i)+".gpkg"))

if __name__=="__main__":
    run()
