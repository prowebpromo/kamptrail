#!/usr/bin/env python3
"""Validate, retain and atomically publish bounded FCC XYZ generations."""
import argparse
import contextlib
import hashlib
import json
import math
import os
import re
import shutil
import struct
import subprocess
import tempfile
from datetime import date
from pathlib import Path

DATA_REF = "refs/heads/fcc-mobile-data"
RELEASE = re.compile(r"\d{4}-\d{2}-\d{2}-[0-9a-f]{12,64}")
PNG = re.compile(r"(?:att|t-mobile|verizon)/[A-Z]{2}/\d{1,2}/\d{1,6}/\d{1,6}\.png")
MAX_FILES = 30000
MAX_BYTES = 150 * 1024**2
MAX_TILE = 512 * 1024
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
ROOT = Path(__file__).resolve().parents[1]


def ensure(condition, reason):
    if not condition:
        raise ValueError(reason)


def xyz_x(lon, n):
    return (lon + 180) * n / 360


def xyz_y(lat, n):
    return (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) * n / 2


def load_manifest(file):
    ensure(file.is_file() and not file.is_symlink() and file.stat().st_size <= 512 * 1024,
           "Expected bounded regular manifest.")
    data = json.loads(file.read_text(encoding="utf-8"))
    release = data.get("release", "")
    ensure(data.get("schema") == 1 and RELEASE.fullmatch(release), "Invalid release ID.")
    as_of = date.fromisoformat(data["asOf"])
    ensure(as_of.isoformat() == release[:10] and
           as_of <= date.fromisoformat(data["retrievedAt"]),
           "Invalid filing date or retrieval timestamp.")
    ensure(data["technology"] == "4G LTE" and data["environment"] == "Outdoor stationary"
           and ("FCC" in data["attribution"] or "Federal Communications Commission" in data["attribution"]), "Invalid model metadata.")
    paths, scopes, carriers = set(), set(), set()
    for carrier in data["carriers"]:
        code = carrier["id"]
        ensure(code in {"att","t-mobile","verizon"} and code not in carriers, "Invalid carrier.")
        carriers.add(code)
        for region in carrier["regions"]:
            state = region["id"]
            ensure(re.fullmatch(r"[A-Z]{2}", state) and (code, state) not in scopes, "Invalid region.")
            scopes.add((code,state))
            west,south,east,north = region["bounds"]
            lo, hi = region["minZoom"], region["maxZoom"]
            ensure(-180 <= west < east <= 180 and -85.05112878 <= south < north <= 85.05112878
                   and type(lo) is int and type(hi) is int and 0 <= lo <= hi <= 15,
                   "Invalid extent or native zoom.")
            source = region["source"]
            ensure(str(source["fileId"]).isdigit() and str(source["providerId"]).isdigit()
                   and re.fullmatch(r"[0-9a-f]{64}", source["sha256"])
                   and re.fullmatch(r"[0-9a-f]{64}", region["boundary"]["sha256"]),
                   "Missing source identity.")
            for z in range(lo,hi+1):
                n = 2**z
                a,b = max(0, math.floor(xyz_x(west,n))), min(n, math.ceil(xyz_x(east,n)))
                c,d = max(0, math.floor(xyz_y(north,n))), min(n, math.ceil(xyz_y(south,n)))
                ensure(0 < (b-a)*(d-c) <= MAX_FILES - len(paths), "Tile count exceeds release budget.")
                paths.update(f"{code}/{state}/{z}/{x}/{y}.png" for x in range(a,b) for y in range(c,d))
    ensure(scopes and paths, "No tile scope in manifest.")
    return data, scopes, paths


def validate(directory, manifest):
    data, scopes, expected = load_manifest(manifest)
    tiles = directory / data["release"]
    ensure(tiles.is_dir() and not tiles.is_symlink(), "Missing generation.")
    h = hashlib.sha256()
    size = count = 0
    for path in sorted(tiles.rglob("*")):
        ensure(not path.is_symlink(), "Symlink in generation.")
        if path.is_dir():
            continue
        rel = path.relative_to(tiles).as_posix()
        ensure(rel in expected and path.is_file(), "Unexpected tile path.")
        expected.remove(rel)
        length = path.stat().st_size
        size += length
        ensure(45 <= length <= MAX_TILE and size <= MAX_BYTES, "Tile size exceeds release budget.")
        raw = path.read_bytes()
        ensure(raw[:8] == PNG_MAGIC and raw[12:16] == b"IHDR" and
               struct.unpack(">II", raw[16:24]) == (256,256) and
               raw[-12:] == bytes.fromhex("0000000049454e44ae426082"),
               "Invalid or truncated 256px PNG.")
        h.update(rel.encode("ascii") + b"\x00" + hashlib.sha256(raw).digest())
        count += 1
    ensure(not expected, "Incomplete XYZ generation.")
    return data, scopes, h.hexdigest(), count


def validate_candidate(directory):
    current = directory / "manifest.json"
    data, scopes, digest, count = validate(directory, current)
    ensure({p.name for p in directory.iterdir()} == {data["release"], current.name},
           "Unexpected candidate artifact files.")
    return data, scopes, digest, count


def git(args, cwd, **kwargs):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, **kwargs).stdout


def remote_head(repo):
    result = subprocess.run(["git","ls-remote","--exit-code","origin",DATA_REF],
                            cwd=repo,capture_output=True,text=True)
    if result.returncode == 2:
        return None
    ensure(result.returncode == 0, "Could not resolve the last data release.")
    head, ref = result.stdout.strip().split()
    ensure(re.fullmatch(r"[a-f0-9]{40}",head) and ref == DATA_REF,"Invalid data ref.")
    git(["fetch","--no-tags","--depth=1","origin",DATA_REF],repo)
    ensure(git(["rev-parse","FETCH_HEAD"],repo).decode().strip() == head,"Data branch advanced; retry safely.")
    return head


@contextlib.contextmanager
def checked_tree(repo, head, work):
    # Validate Git modes, names and total bytes before creating files.
    listings = git(["ls-tree","-r","-l","-z",head],repo).split(b"\x00")
    ensure(len(listings) <= 2*MAX_FILES + 5, "Data branch exceeds retained file budget.")
    total = 0
    for entry in filter(None,listings):
        metadata, name = entry.decode("ascii").split("\t",1)
        mode, kind, sha, size = metadata.split()
        total += int(size)
        parts = name.split("/")
        allowed = (name=="manifest.json" or (len(parts)==2 and parts[0]=="manifests"
                    and parts[1].endswith(".json") and RELEASE.fullmatch(parts[1][:-5]))
                   or (RELEASE.fullmatch(parts[0]) and PNG.fullmatch("/".join(parts[1:]))))
        ensure(mode=="100644" and kind=="blob" and allowed and int(size)<=MAX_TILE
               and total<=2*MAX_BYTES+2*1024**2, "Unexpected public data file.")
    checkout = work / "prior"
    git(["worktree","add","--detach",str(checkout),head],repo)
    try:
        active, scopes, digest, count = validate(checkout,checkout/"manifest.json")
        manifests = list((checkout/"manifests").glob("*.json"))
        ensure(1 <= len(manifests) <= 2 and
               (checkout/"manifests"/(active["release"]+".json")).read_bytes() == (checkout/"manifest.json").read_bytes(),
               "Invalid retained generation index.")
        retained = set()
        for m in manifests:
            if m.stem != active["release"]:
                other = validate(checkout,m)[0]
                ensure(other["release"] == m.stem, "Incorrect historical manifest.")
            retained.add(m.stem)
        ensure({p.name for p in checkout.iterdir()} == retained|{".git","manifests","manifest.json"},"Unexpected retained release.")
        yield checkout, active, scopes, digest
    finally:
        git(["worktree","remove","--force",str(checkout)],repo)


def publish(repo,candidate):
    current, scopes, digest, count = validate_candidate(candidate)
    head = remote_head(repo)
    with tempfile.TemporaryDirectory() as temp, contextlib.ExitStack() as ctx:
        work = Path(temp)
        index = work/"index"
        env = {**os.environ,"GIT_INDEX_FILE":str(index),"GIT_AUTHOR_NAME":"github-actions[bot]",
               "GIT_COMMITTER_NAME":"github-actions[bot]","GIT_AUTHOR_EMAIL":"41898282+github-actions[bot]@users.noreply.github.com",
               "GIT_COMMITTER_EMAIL":"41898282+github-actions[bot]@users.noreply.github.com"}
        git(["read-tree","--empty"],repo,env=env)
        prior = None
        if head:
            checkout, prior, old_scopes, old_digest = ctx.enter_context(checked_tree(repo,head,work))
            if prior["release"] == current["release"]:
                prior_metadata={k:v for k,v in prior.items() if k!="retrievedAt"}
                new_metadata={k:v for k,v in current.items() if k!="retrievedAt"}
                ensure(digest==old_digest and new_metadata==prior_metadata, "Immutable release changed.")
                print("Identical validated FCC release already published.")
                return
            ensure(current["asOf"] >= prior["asOf"] and old_scopes <= scopes,
                   "Proposed release regresses date or advertised scope; previous generation preserved.")
        # Build the candidate index using only this validated staging directory.
        git(["--work-tree="+str(candidate),"add","--force","--all","--","."],repo,env=env)
        new_blob=git(["rev-parse",":manifest.json"],repo,env=env).decode().strip()
        git(["update-index","--add","--cacheinfo","100644,"+new_blob+",manifests/"+current["release"]+".json"],repo,env=env)
        if prior:
            old_id=prior["release"]
            git(["read-tree","--prefix="+old_id+"/",head+":"+old_id],repo,env=env)
            old_blob=git(["rev-parse",head+":manifest.json"],repo).decode().strip()
            git(["update-index","--add","--cacheinfo","100644,"+old_blob+",manifests/"+old_id+".json"],repo,env=env)
        tree=git(["write-tree"],repo,env=env).decode().strip()
        commit=git(["commit-tree",tree,*(["-p",head] if head else []),"-m","Publish FCC LTE "+current["release"]],repo,env=env).decode().strip()
        # Parent equals the previously read ref. A competing writer causes a safe rejection.
        git(["push","origin",commit+":"+DATA_REF],repo)
        print(f"Published {count} validated tiles for {current['release']}.")


def package(repo,destination):
    head=remote_head(repo)
    if not head:
        # A missing branch is normal before the first qualified data release.
        # If the last site already advertised FCC tiles, preserve it and stop.
        result=subprocess.run(["git","ls-remote","--exit-code","origin","refs/heads/hostinger"],cwd=repo,capture_output=True)
        ensure(result.returncode in (0,2), "Could not inspect previous site release.")
        if result.returncode==0:
            git(["fetch","--no-tags","--depth=1","origin","refs/heads/hostinger"],repo)
            ensure(not git(["ls-tree","FETCH_HEAD","data/fcc-coverage"],repo).strip(), "Previously public FCC data disappeared.")
        print("No validated FCC generation published yet.")
        return
    ensure(not destination.exists(), "FCC release destination already exists.")
    with tempfile.TemporaryDirectory() as temp:
        with checked_tree(repo,head,Path(temp)) as (checkout,active,scopes,_):
            destination.mkdir(parents=True)
            for m in sorted((checkout/"manifests").glob("*.json")):
                shutil.copytree(checkout/m.stem,destination/m.stem)
            shutil.copyfile(checkout/"manifest.json",destination/"manifest.json")
            print(f"Packaged FCC {active['release']} for {len(scopes)} carrier-region pairs.")


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action",choices=("validate","publish","package"))
    parser.add_argument("path",type=Path)
    args=parser.parse_args()
    if args.action=="package":
        package(ROOT,args.path.resolve())
    elif args.action=="publish":
        publish(ROOT,args.path.resolve())
    else:
        result=validate_candidate(args.path.resolve())
        print(f"Verified {result[3]} XYZ tiles; tree digest {result[2]}.")
