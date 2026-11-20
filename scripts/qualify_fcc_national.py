#!/usr/bin/env python3
"""Branch-only acquisition and qualification of FCC outdoor LTE PMTiles. No publication."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

import fcc_download as fcc
from prepare_fcc_refresh import BOUNDARY, PROVIDERS, eligible

SCRIPT = Path(__file__).resolve().parent
GIB = 1024**3
SLOT = 12
MAX_ARCHIVE = 6 * GIB
MAX_EXPANSION = 18 * GIB
DISK_RESERVE = 5 * GIB
LANE_OUTPUT_LIMIT = 96 * 1024**2
# Census boundary layers also contain the territories. This plan covers the 50 states and DC.
US = set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split())


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(",",":")).encode()).hexdigest()


def file_hash(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream,"sha256").hexdigest()


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path,value):
    path.write_text(json.dumps(value,sort_keys=True,separators=(",",":"))+"\n",encoding="utf-8")


COMPONENTS = ("fcc_download.py","build_fcc_tiles.py","build_fcc_alaska_tiles.py","prepare_fcc_refresh.py",
              "acceptance/check-fcc-tiles.py","pack_fcc_tiles.py","qualify_fcc_national.py","requirements-fcc-pmtiles.txt")


def environment():
    creds=(os.environ.pop("FCC_USERNAME").strip(),os.environ.pop("FCC_TOKEN").strip())
    require(all(creds),"FCC credentials unavailable.")
    return creds


def bounded_copy(response,path,cap):
    with response, path.open("xb") as stream:
        length=response.headers.get("Content-Length")
        require(length is None or 0 < int(length) <= cap,"Source Content-Length exceeds worker budget.")
        n=0
        h=hashlib.sha256()
        while block:=response.read(min(1024**2, cap-n+1)):
            n+=len(block)
            require(n<=cap,"Source exceeded bounded capacity.")
            stream.write(block)
            h.update(block)
        require(n > 0 and (length is None or n == int(length)),"Incomplete source transfer.")
    return n,h.hexdigest()


def boundary(path):
    req=urllib.request.Request(BOUNDARY,headers={"User-Agent":"KampTrail FCC coverage qualifier"})
    _,sha=bounded_copy(urllib.request.urlopen(req,timeout=120),path,64*1024**2)
    return {"source":BOUNDARY,"layer":"tl_2025_us_state","sha256":sha}


def assignments(rows,geos,scope):
    states=sorted(US) if scope == "US" else [scope]
    require(set(states)<=US and set(geos)==US,"Unrecognized state or incomplete Census geography list.")
    lanes=[[] for _ in range(4 if scope=="US" else 1)]
    weights=[0]*len(lanes)
    items,missing=[],[]
    for state in states:
        for slug,(provider,brand) in PROVIDERS.items():
            row=eligible(rows,geos[state],provider)
            if row is None:
                missing.append({"region":state,"carrier":slug,"reason":"No raw LTE entry for this provider in this filing."})
                continue
            items.append({"region":state,"fips":geos[state],"id":slug,"providerId":provider,"brand":brand,
                          "providerName":row["provider_name"],"fileId":int(row["file_id"]),
                          "sourceFile":row["file_name"],"recordCount":int(row["record_count"])})
    require(items,"No applicable public carrier archives.")
    # Record count approximates rendering cost. Lanes persist in the original plan on reruns.
    for entry in sorted(items,key=lambda a:(-a["recordCount"],a["region"],a["id"])):
        k=min(range(len(lanes)),key=weights.__getitem__)
        lanes[k].append(entry)
        weights[k]+=entry["recordCount"]
    return lanes,missing


def check_national_inventory(asof,lanes):
    # The 2026-11-20 independent catalog preflight found 152 public files in the
    # June filing for these 153 pairs. New availability can legitimately be added.
    if asof!="2026-06-30":
        return
    known={(p,s) for p in PROVIDERS for s in US} - {("t-mobile","AK")}
    found={(r["id"],r["region"]) for lane in lanes for r in lane}
    absent=sorted(known-found)
    require(not absent, f"Catalog lost previously verified June 2026 source rows: {absent}")


def mobile_catalog(asof,creds):
    envelope=fcc.read_json(fcc.request("downloads/listAvailabilityData/"+asof+
                           "?category=Provider&technology_type=Mobile+Broadband",creds))
    rows=envelope["data"]
    if "result_count" in envelope and envelope["result_count"] is not None:
        require(str(envelope["result_count"])==str(len(rows)),"FCC catalog count differs from returned rows.")
    return [r for r in rows if isinstance(r,dict) and r.get("category")=="Provider" and
            r.get("file_type")=="gis" and r.get("technology_type")=="Mobile Broadband"]


def plan(scope,out):
    import fiona
    out.mkdir(parents=True,exist_ok=False)
    with tempfile.TemporaryDirectory() as tmp:
        path=Path(tmp)/"states.zip"
        bounds=boundary(path)
        with fiona.open("zip://"+str(path),layer=bounds["layer"]) as col:
            geos={row["properties"]["STUSPS"]:row["properties"]["STATEFP"] for row in col
                  if row["properties"]["STUSPS"] in US}
    creds=environment()
    data=fcc.read_json(fcc.request("listAsOfDates",creds))["data"]
    dates=[fcc.filing_date(row["as_of_date"]) for row in data if row.get("data_type")=="availability"]
    require(dates and None not in dates,"Missing or invalid FCC filing date.")
    asof=max(dates).isoformat()
    time.sleep(SLOT)
    rows=mobile_catalog(asof,creds)
    lanes,missing=assignments(rows,geos,scope)
    if scope=="US": check_national_inventory(asof,lanes)
    versions={p:file_hash(SCRIPT/p) for p in COMPONENTS}
    record={"schema":1,"scope":scope,"asOf":asof,"retrievedAt":dt.datetime.now(dt.timezone.utc).date().isoformat(),
            "sourceCommit":os.environ.get("GITHUB_SHA"),"componentHashes":versions,"boundary":bounds,
            "catalogSha256":digest(sorted(rows,key=lambda r:(str(r.get("file_id")),str(r.get("file_name"))))),
            "lanes":lanes,"missing":missing,"notBefore":int(time.time())+SLOT+1}
    record["planId"]=digest(record)
    write(out/"plan.json",record)
    n=sum(map(len,lanes))
    print(f"{asof}: {n} expected provider/state archives, {len(missing)} absent, {len(lanes)} worker lane(s).",flush=True)
    if os.getenv("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"],"a") as stream:
            print("lanes="+json.dumps(list(range(len(lanes)))),file=stream)


def verify_plan(path):
    record=read(path)
    stable=dict(record)
    actual=stable.pop("planId")
    require(digest(stable)==actual and actual==record["planId"],"Plan checksum mismatch.")
    require(record["sourceCommit"]==os.environ.get("GITHUB_SHA"),"Plan code commit mismatch.")
    require(set(record["componentHashes"]) == set(COMPONENTS), "Unexpected component paths.")
    require(all(file_hash(SCRIPT/p)==v for p,v in record["componentHashes"].items()),"Qualification code changed.")
    return record


def slot_start(now,lane,count,not_before=0,previous=-1):
    # One-second admission window per unique lane. Adjacent windows are 12 seconds apart.
    now=max(now,not_before)
    slot=max(int(now//SLOT), previous+1)
    slot+=(lane - slot%count)%count
    if now >= slot*SLOT+1:
        slot+=count
    return slot


class Pace:
    def __init__(self,lane,n,earliest):
        self.lane,self.n,self.earliest,self.last=lane,n,earliest,-1
    def wait(self):
        while True:
            slot=slot_start(time.time(),self.lane,self.n,self.earliest,self.last)
            delay=max(0, max(slot*SLOT,self.earliest)-time.time())
            if delay: time.sleep(delay)
            now=time.time()
            if slot*SLOT <= now < slot*SLOT+1 and now >= self.earliest:
                self.last=slot
                return


def source_download(item,creds,archive):
    free=shutil.disk_usage(archive.parent).free
    cap=min(MAX_ARCHIVE,free-DISK_RESERVE)
    require(cap>0,"Insufficient free disk before source fetch.")
    rid=item["fileId"]
    response=fcc.request(f"downloads/downloadFile/availability/{rid}/2",creds)
    size,sha=bounded_copy(response,archive,cap)
    with zipfile.ZipFile(archive) as z:
        infos=z.infolist()
        gpkg=[i for i in infos if i.filename.lower().endswith(".gpkg")]
        expanded=sum(i.file_size for i in infos)
        require(len(infos)<=50 and len(gpkg)==1 and 0 < expanded <= MAX_EXPANSION,
                "Unsupported archive structure or expansion size.")
        # Renderer and geometry verifier run sequentially. Allow temporary spatial work.
        require(shutil.disk_usage(archive.parent).free >= DISK_RESERVE+expanded*2,
                "Insufficient runner disk for the original polygon and spatial verification.")
    return size,sha,expanded


def run_script(script,*args):
    subprocess.run([sys.executable,str(SCRIPT/script),*map(str,args)],check=True)


def candidate(item,profile,zipinfo,bounds,work):
    size,sha,expanded=zipinfo
    slug,state=item["id"],item["region"]
    seed=digest([profile["asOf"],bounds["sha256"],item,sha,profile["componentHashes"]])
    release=profile["asOf"]+"-"+seed[:20]
    src={**item,"archive":str(work/"provider.zip"),"sha256":sha}
    plan={"release":release,"asOf":profile["asOf"],"retrievedAt":profile["retrievedAt"],"minZoom":6,"maxZoom":10,
          "regions":[{"id":state,"boundary":bounds,"carriers":[src]}]}
    write(work/"local-plan.json",plan)
    renderer="build_fcc_alaska_tiles.py" if state=="AK" else "build_fcc_tiles.py"
    xyz,packed=work/"xyz",work/"packed"
    run_script(renderer,"--plan",work/"local-plan.json","--output",xyz)
    run_script("acceptance/check-fcc-tiles.py","--plan",work/"local-plan.json","--input",xyz,"--output",work/"spatial.json")
    spatial=read(work/"spatial.json")
    require(spatial["result"]=="PASS" and spatial["release"]==release and len(spatial["checks"])==1,
            "Independent spatial verification failed.")
    run_script("pack_fcc_tiles.py","--xyz",xyz,"--output",packed)
    manifest=read(packed/"manifest.json")
    require(manifest["schema"]==2 and len(manifest["carriers"])==1,"Invalid packed carrier manifest.")
    c=manifest["carriers"][0]
    require(c["id"]==slug and len(c["regions"])==1 and c["regions"][0]["id"]==state,"Wrong packed carrier or state.")
    reg=c["regions"][0]
    output=packed/manifest["release"]/slug/(state+".pmtiles")
    require(file_hash(output)==reg["archive"]["sha256"] and 0 < output.stat().st_size==reg["archive"]["bytes"] < 100_000_000,
            "Packed archive receipt mismatch.")
    receipt={"planId":profile["planId"],"carrier":slug,"region":state,"fileId":item["fileId"],
             "bytes":size,"expanded":expanded,"sourceSha256":sha,"asOf":profile["asOf"],
             "retrievedAt":profile["retrievedAt"],"metadata":reg,"attribution":manifest["attribution"],
             "spatial":spatial["checks"][0],"sourceRelease":release,"format":manifest["technology"],
             "environment":manifest["environment"]}
    return output,receipt


def acquire(plan_path,num,out):
    profile=verify_plan(plan_path)
    lanes=profile["lanes"]
    require(0<=num<len(lanes),"Invalid lane.")
    out.mkdir(parents=True,exist_ok=False)
    receipts_dir=out/"receipts"
    receipts_dir.mkdir()
    pace=Pace(num,len(lanes),profile["notBefore"])
    failures,done,total=[],0,0
    creds=environment()
    with tempfile.TemporaryDirectory() as scratch:
        scratch=Path(scratch)
        path=scratch/"boundary.zip"
        b=boundary(path)
        require(b==profile["boundary"],"Census boundary changed after catalog acquisition.")
        b["path"]=str(path)
        for item in lanes[num]:
            state,slug=item["region"],item["id"]
            current=f"{state}/{slug}"
            try:
                with tempfile.TemporaryDirectory(dir=scratch) as private:
                    work=Path(private)
                    pace.wait()
                    started=time.monotonic()
                    free_before=shutil.disk_usage(work).free
                    files=source_download(item,creds,work/"provider.zip")
                    fetched=time.monotonic()
                    pm,receipt=candidate(item,profile,files,b,work)
                    receipt.update(downloadSeconds=round(fetched-started,2),qualifySeconds=round(time.monotonic()-fetched,2),
                                   initialFreeBytes=free_before,freeBytesWithQualifiedSource=shutil.disk_usage(work).free)
                    size=pm.stat().st_size
                    require(total+size<=LANE_OUTPUT_LIMIT,"Lane artifact budget exceeded.")
                    folder=out/"archives"/slug
                    folder.mkdir(parents=True,exist_ok=True)
                    shutil.move(str(pm),folder/(state+".pmtiles"))
                    write(receipts_dir/(state+"-"+slug+".json"),receipt)
                    total+=size
                    done+=1
                print(f"{current}: verified one provider archive and {size:,} PMTiles bytes.",flush=True)
            except (ValueError,OSError,subprocess.CalledProcessError,fcc.SafeError,zipfile.BadZipFile) as exc:
                reason=type(exc).__name__
                if isinstance(exc,(ValueError,fcc.SafeError)):
                    reason=str(exc)[:200]
                failures.append({"region":state,"carrier":slug,"reason":reason})
                print(f"{current}: qualification failed ({reason}).",flush=True)
                if isinstance(exc,fcc.SafeError) or "budget exceeded" in reason:
                    break
    write(out/"lane.json",{"planId":profile["planId"],"lane":num,"completed":done,"bytes":total,"failures":failures})
    require(not failures,"Incomplete lane: preserved completed witnesses, no release possible.")


FCC_CREDIT = "Source: FCC National Broadband Map, provider-reported mobile availability. State boundaries: U.S. Census Bureau."
FCC_ALASKA_CREDIT = "Map layer based on FCC BDC. Boundaries: U.S. Census Bureau."


def display_model(records):
    models={(r["format"],r["environment"]) for r in records}
    require(models=={("4G LTE","Outdoor stationary")},"Inconsistent radio technology or modeled environment.")
    credits={r["attribution"] for r in records}
    require(credits and credits<={FCC_CREDIT,FCC_ALASKA_CREDIT},"Unrecognized source attribution.")
    return "4G LTE","Outdoor stationary",FCC_CREDIT if FCC_CREDIT in credits else FCC_ALASKA_CREDIT


def assemble(profile,lanes_root,output,materialize=None):
    entries={}
    for lane in profile["lanes"]:
        for e in lane:
            entries[(e["id"],e["region"])]=e
    members={}; rows=[]; total=0
    for i,lane in enumerate(profile["lanes"]):
        work=lanes_root/f"fcc-packed-lane-{i}"
        result=read(work/"lane.json")
        require(result["planId"]==profile["planId"] and result["lane"]==i and not result["failures"]
                and result["completed"]==len(lane),"Incomplete or mismatched lane.")
        expected=set((e["id"],e["region"]) for e in lane)
        observed=set()
        lane_size=0
        for receipt in sorted((work/"receipts").glob("*.json")):
            r=read(receipt)
            key=(r["carrier"],r["region"])
            require(key in expected and key not in members and r["planId"]==profile["planId"]
                    and r["asOf"]==profile["asOf"] and r["retrievedAt"]==profile["retrievedAt"],
                    "Missing, duplicated, unrelated or stale result.")
            e,meta=entries[key],r["metadata"]
            orig=meta["source"]; audit=r["spatial"]; blob=meta["archive"]
            require(meta["id"]==key[1] and orig["records"]==e["recordCount"] and
                    orig["fileId"]==r["fileId"]==audit["fileId"]==e["fileId"] and
                    orig["sha256"]==r["sourceSha256"]==audit["sourceSHA256"] and
                    orig["providerId"]==e["providerId"] and orig["sourceFile"]==e["sourceFile"] and
                    meta["boundary"]["sha256"]==profile["boundary"]["sha256"] and
                    audit["region"]==key[1] and audit["carrier"]==key[0] and
                    sum(audit["matches"].values())>0,"Catalog, boundary or geometry evidence mismatch.")
            relative=Path("archives")/key[0]/(key[1]+".pmtiles")
            asset=work/relative
            require(blob["format"]=="pmtiles-v3" and 127<=blob["bytes"]<100_000_000 and
                    asset.is_file() and not asset.is_symlink() and asset.stat().st_size==blob["bytes"]
                    and file_hash(asset)==blob["sha256"],"Archive content differs from manifest.")
            members[key]=(r,asset)
            rows.append({"carrier":key[0],"region":key[1],"artifact":work.name,"path":relative.as_posix(),
                         "fileId":r["fileId"],"sourceBytes":r["bytes"],"sourceSHA256":r["sourceSha256"],
                         "expandedBytes":r["expanded"],"pmtilesBytes":blob["bytes"],"pmtilesSHA256":blob["sha256"],
                         "records":audit["records"],"downloadSeconds":r["downloadSeconds"],"qualifySeconds":r["qualifySeconds"],
                         "initialFreeBytes":r["initialFreeBytes"],"freeBytesWithQualifiedSource":r["freeBytesWithQualifiedSource"],
                         "sourceAttribution":r["attribution"],"spatial":audit})
            observed.add(key);lane_size+=blob["bytes"]
        require(observed==expected and lane_size==result["bytes"] and lane_size<=LANE_OUTPUT_LIMIT,"Incomplete archive set.")
        require({x.relative_to(work/"archives").as_posix() for x in (work/"archives").rglob("*") if x.is_file()}==
                {f"{c}/{s}.pmtiles" for c,s in expected},"Unexpected or absent lane binary.")
        total+=lane_size
    require(set(members)==set(entries),"Missing eligible public data.")
    tech,env,credit=display_model([r for r,_ in members.values()])
    carriers=[]
    for carrier in sorted(PROVIDERS):
        regions=[members[key][0]["metadata"] for key in sorted(members) if key[0]==carrier]
        if regions: carriers.append({"id":carrier,"regions":regions})
    manifest={"schema":2,"asOf":profile["asOf"],"technology":tech,"environment":env,
              "attribution":credit,"carriers":carriers}
    release=profile["asOf"]+"-"+digest(manifest)[:20]
    manifest.update(release=release,retrievedAt=profile["retrievedAt"])
    output.mkdir(parents=True,exist_ok=False)
    write(output/"manifest.json",manifest)
    write(output/"qualification.json",{"schema":1,"release":release,"asOf":profile["asOf"],"scope":profile["scope"],
          "planId":profile["planId"],"catalogSha256":profile["catalogSha256"],"componentHashes":profile["componentHashes"],
          "sourceCommit":profile["sourceCommit"],"archives":len(rows),"packedBytes":total,
          "explicitlyMissing":profile["missing"],"shards":rows})
    if materialize:
        materialize.mkdir(parents=True,exist_ok=False)
        for (carrier,region),(_,asset) in members.items():
            loc=materialize/release/carrier/(region+".pmtiles")
            loc.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(asset,loc)
        shutil.copyfile(output/"manifest.json",materialize/"manifest.json")
    msg=f"Qualified {release}: {len(rows)} carrier-by-state archives, {total:,} packed bytes; {len(profile['missing'])} documented catalog absences."
    print(msg)
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"],"a") as stream: print(msg,file=stream)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    sub=p.add_subparsers(dest="op",required=True)
    pp=sub.add_parser("plan")
    pp.add_argument("--scope",required=True,choices=["US",*sorted(US)])
    pp.add_argument("--output",type=Path,required=True)
    pa=sub.add_parser("acquire")
    pa.add_argument("--plan",type=Path,required=True); pa.add_argument("--lane",type=int,required=True)
    pa.add_argument("--output",type=Path,required=True)
    ps=sub.add_parser("assemble")
    ps.add_argument("--plan",type=Path,required=True); ps.add_argument("--lanes",type=Path,required=True)
    ps.add_argument("--output",type=Path,required=True); ps.add_argument("--materialize",type=Path)
    x=p.parse_args()
    if x.op=="plan": plan(x.scope,x.output)
    elif x.op=="acquire": acquire(x.plan,x.lane,x.output)
    else: assemble(verify_plan(x.plan),x.lanes,x.output,x.materialize)


if __name__=="__main__":
    main()
