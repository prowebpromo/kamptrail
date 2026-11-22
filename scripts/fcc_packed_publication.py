"""Validate and atomically retain packed FCC data beside the legacy XYZ release."""
import gzip
import hashlib
import json
import math
import re
import shutil
import struct
import tempfile
from datetime import date
from pathlib import Path

PROVIDERS = {"att":"130077", "t-mobile":"130403", "verizon":"131425"}
STATE_FIPS = dict(zip("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(),
                      "01 02 04 05 06 08 09 10 11 12 13 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56".split(),strict=True))
STATES = set(STATE_FIPS)
CONTIGUOUS = STATES - {"AK", "HI", "DC"}
PUBLIC_SCOPE = "CONUS48"
RELEASE = re.compile(r"\d{4}-\d\d-\d\d-[a-f0-9]{20}")
SHA = re.compile("[a-f0-9]{64}")
PACK = re.compile(r"(att|t-mobile|verizon)/([A-Z]{2})\.pmtiles")
SOURCE = re.compile(r"bdc_\d{2}_(\d+)_4glte_mobile_broadband_[jd]\d{2}_[a-z0-9_.-]+",re.I)
BOUNDARY = "https://www2.census.gov/geo/tiger/TIGER2025/STATE/tl_2025_us_state.zip"
MAX_PACK = 100_000_000
JSON_LIMIT = 512*1024
FAMILY = "packed"


def require(ok, why):
    if not ok:
        raise ValueError(why)


def canonical(data):
    return json.dumps(data,separators=(",",":"),sort_keys=True).encode()


def read(path, limit=JSON_LIMIT):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= limit, "Invalid metadata file")
    def unique(pairs):
        d = dict(pairs)
        require(len(d) == len(pairs), "Duplicate JSON property")
        return d
    return json.loads(path.read_bytes(),object_pairs_hook=unique)


def file_sha(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f,"sha256").hexdigest()


def shape(reg):
    boxes=reg["footprints"]
    require(isinstance(boxes,list) and len(boxes)==(2 if reg["id"]=="AK" else 1), "Unexpected footprint count")
    spans=set()
    for box in boxes:
        require(len(box)==4 and all(type(n) in (int,float) and math.isfinite(n) for n in box), "Nonfinite bounds")
        west,south,east,north=box
        require(-180<=west<east<=180 and east-west<180 and -85.051129<south<north<85.051129, "Invalid geographic extent")
        if reg["id"]=="AK":
            require(east<=0 or west>=0,"Alaska extent spans the gap")
            spans.add(west>=0)
    if reg["id"]=="AK":
        require(spans=={True,False} and "bounds" not in reg,"Alaska requires separate hemispheres")
    else:
        require(boxes==[reg["bounds"]],"Region bounds and footprint disagree")
    require((reg["minZoom"],reg["maxZoom"])==(6,10),"Unqualified model zooms")
    count=0
    for box in boxes:
        w,s,e,n=box
        for z in range(6,11):
            edge=2**z
            def y(a):
                return edge*(1-math.asinh(math.tan(math.radians(a)))/math.pi)/2
            count+=(math.ceil((e+180)*edge/360)-math.floor((w+180)*edge/360))*(math.ceil(y(s))-math.floor(y(n)))
    return count


def qualify_manifest(m):
    require(m.get("schema")==2 and m.get("technology")=="4G LTE" and m.get("environment")=="Outdoor stationary" and
            isinstance(m.get("attribution"),str) and "FCC" in m["attribution"], "Unexpected map type or attribution")
    stamp=date.fromisoformat(m["asOf"])
    require(stamp<=date.fromisoformat(m["retrievedAt"]) and (stamp.month,stamp.day) in ((6,30),(12,31)), "Invalid model dates")
    calculated=m["asOf"]+"-"+hashlib.sha256(canonical({k:v for k,v in m.items() if k not in ("release","retrievedAt")})).hexdigest()[:20]
    require(m["release"]==calculated, "National aggregate release ID mismatch")
    scopes={}
    seen_providers,seen_files=set(),set()
    for carrier in m["carriers"]:
        slug=carrier["id"]
        require(slug in PROVIDERS and slug not in seen_providers and carrier["regions"],"Invalid or duplicate carrier")
        seen_providers.add(slug)
        for r in carrier["regions"]:
            key=(slug,r["id"])
            require(key[1] in STATES and key not in scopes,"Duplicate or unexpected carrier/jurisdiction")
            src,asset,mask=r["source"],r["archive"],r["boundary"]
            name=SOURCE.fullmatch(src["sourceFile"])
            require(src["asOf"]==m["asOf"] and str(src["providerId"])==PROVIDERS[slug] and
                    name and name.group(1)==PROVIDERS[slug] and src["sourceFile"].lower().startswith(
                        f"bdc_{STATE_FIPS[key[1]]}_{PROVIDERS[slug]}_4glte_mobile_broadband_" +
                        ("j" if stamp.month==6 else "d") + stamp.strftime("%y") + "_") and type(src["fileId"]) is int and src["fileId"]>0 and
                    src["fileId"] not in seen_files and type(src["records"]) is int and src["records"]>0 and
                    SHA.fullmatch(src["sha256"]) and mask["source"]==BOUNDARY and SHA.fullmatch(mask["sha256"]),
                    "Unverified or duplicated FCC source identity")
            require(asset["format"]=="pmtiles-v3" and type(asset["bytes"]) is int and 127<asset["bytes"]<MAX_PACK
                    and SHA.fullmatch(asset["sha256"]),"Invalid or oversized packed archive")
            seen_files.add(src["fileId"])
            scopes[key]=(r,shape(r))
    require(scopes,"No packed coverage")
    return scopes


def validate_file(path,reg,native_count,m):
    a=reg["archive"]
    require(path.is_file() and not path.is_symlink() and path.stat().st_size==a["bytes"] and file_sha(path)==a["sha256"],
            "Packed archive size or SHA-256 mismatch")
    with path.open("rb") as f:
        h=f.read(127)
        require(h[:8]==b"PMTiles\x03" and h[97:102]==bytes((2,1,2,6,10)), "Wrong PMTiles encoding or native zoom")
        ro,rl,mo,ml,lo,ll,do,dl,addressed,entries,contents=struct.unpack_from("<11Q",h,8)
        require(ro==127 and 0<rl<=16384-127 and mo==ro+rl and 0<ml<=64*1024 and lo==mo+ml and
                do==lo+ll and dl>0 and do+dl==a["bytes"] and addressed==native_count and
                0<contents<=entries<=addressed, "PMTiles layout, tile count or file length mismatch")
        f.seek(mo)
        import io
        with gzip.GzipFile(fileobj=io.BytesIO(f.read(ml))) as compressed:
            metadata=compressed.read(64*1024+1)
        require(len(metadata)<=64*1024,"Oversize archive metadata")
        d=json.loads(metadata)
        require(d["asOf"]==m["asOf"] and d["footprints"]==reg["footprints"] and isinstance(d.get("attribution"),str) and "FCC" in d["attribution"],
                "PMTiles metadata differs from the qualified footprint or filing date")


def pairs(scope):
    if scope == PUBLIC_SCOPE:
        states = CONTIGUOUS
    elif scope == "US":
        states = STATES
    else:
        require(scope in STATES, "Invalid qualification scope")
        states = {scope}
    return {(slug,state) for state in states for slug in PROVIDERS}


def receipt(m,scopes,q):
    require(q["schema"]==1 and q["asOf"]==m["asOf"] and q["release"]==m["release"] and
            q["archives"]==len(scopes)==len(q["shards"]) and SHA.fullmatch(q["planId"]) and SHA.fullmatch(q["catalogSha256"])
            and re.fullmatch("[a-f0-9]{40}",q["sourceCommit"]), "Qualification identity mismatch")
    components = q["componentHashes"]
    expected_components = {"acceptance/check-fcc-tiles.py", "pack_fcc_tiles.py", "qualify_fcc_national.py",
                           "build_fcc_tiles.py", "fcc_download.py", "prepare_fcc_refresh.py",
                           "requirements-fcc-pmtiles.txt"}
    if q["scope"] != PUBLIC_SCOPE:
        expected_components.add("build_fcc_alaska_tiles.py")
    require(set(components) == expected_components and all(SHA.fullmatch(v) for v in components.values()),
            "Missing qualification component provenance")
    missing=[(x["carrier"],x["region"]) for x in q["explicitlyMissing"]]
    require(all(x.get("reason")=="No raw LTE entry for this provider in this filing." for x in q["explicitlyMissing"])
            and len(missing)==len(set(missing)) and set(missing).isdisjoint(scopes) and
            set(scopes)|set(missing)==pairs(q["scope"]),"Unaccounted or unsupported carrier/jurisdiction")
    if q["scope"] == PUBLIC_SCOPE:
        require(not missing and set(scopes) == pairs(PUBLIC_SCOPE),
                "All three carriers must qualify in each of the lower 48 states")
    if q["scope"]=="US" and q["asOf"]=="2026-06-30":
        require(set(missing)<={("t-mobile","AK")},"Missing previously verified June filing")
    seen=set();verified=[]
    for row in q["shards"]:
        key=(row["carrier"],row["region"])
        require(key in scopes and key not in seen,"Duplicate or extra qualification shard")
        seen.add(key)
        r=scopes[key][0];a=r["archive"];src=r["source"];sp=row["spatial"]
        matches=sp["matches"]
        require(type(matches) is dict and set(matches)<={"covered","uncovered","missing"} and
                all(type(v) is int and v>=0 for v in matches.values()) and sum(matches.values())>0 and
                type(sp["tilesCompared"]) is int and sp["tilesCompared"]>0,"Missing independent geometric evidence")
        require(row["fileId"]==sp["fileId"]==src["fileId"] and row["sourceSHA256"]==sp["sourceSHA256"]==src["sha256"]
                and row["records"]==sp["records"]==src["records"] and row["pmtilesSHA256"]==a["sha256"] and
                row["pmtilesBytes"]==a["bytes"] and (sp["carrier"],sp["region"])==key,
                "Source, archive or independent spatial receipt disagrees")
        if key[1]=="AK":
            require(all(sp.get("stableSamplesByHemisphere",{}).get(h,0)>0 for h in ("east","west")),"Incomplete Alaska hemisphere checks")
        verified.append({k:row[k] for k in ("carrier","region","fileId","sourceSHA256","pmtilesSHA256","pmtilesBytes","records")})
        # Only scientific provenance is retained; runner metrics and coordinates need not be published.
        verified[-1]["spatial"]={k:sp[k] for k in ("fileId","sourceSHA256","records","carrier","region","matches","tilesCompared","stableSamplesByHemisphere") if k in sp}
    require(seen==set(scopes) and q["packedBytes"]==sum(r["pmtilesBytes"] for r in verified), "Missing packed receipt")
    result={k:q[k] for k in ("schema","release","asOf","scope","planId","catalogSha256","componentHashes","sourceCommit","archives","packedBytes","explicitlyMissing")}
    result["shards"]=sorted(verified,key=lambda r:(r["carrier"],r["region"]))
    return result


def generation(directory,m,q,limit):
    scopes=qualify_manifest(m)
    checked=receipt(m,scopes,q)
    require(checked["packedBytes"]<=limit,"Packed generation exceeds configured capacity")
    root=directory/m["release"]
    require(root.is_dir() and not root.is_symlink(),"Missing packed generation")
    expected={f"{c}/{s}.pmtiles" for c,s in scopes}
    seen=set()
    for p in root.rglob("*"):
        require(not p.is_symlink(),"Symlink in packed release")
        rel=p.relative_to(root).as_posix()
        if p.is_dir():
            require(rel in PROVIDERS and any(c==rel for c,s in scopes),"Unexpected directory")
            continue
        require(rel in expected,"Unexpected file in packed release")
        c,state=PACK.fullmatch(rel).groups()
        validate_file(p,*scopes[c,state],m)
        seen.add(rel)
    require(seen==expected,"Missing packed archive")
    return scopes,checked


def candidate(path,report,limit,expected_scope=None):
    m=read(path/"manifest.json")
    require({p.name for p in path.iterdir()}=={"manifest.json",m["release"]},"Unexpected input tree")
    qualification = read(report, 8 * 1024**2)
    if expected_scope is not None:
        require(qualification["scope"] == expected_scope, "Qualification scope differs from required scope")
    scopes,checked=generation(path,m,qualification,limit)
    return m,scopes,checked


def allowed_git_file(name,size):
    p=name.split("/")
    if p==[FAMILY,"state.json"]:
        return size<=JSON_LIMIT
    if len(p)==3 and p[1] in ("manifests","receipts") and p[2].endswith(".json"):
        return bool(RELEASE.fullmatch(p[2][:-5])) and size<=JSON_LIMIT
    return len(p)==4 and RELEASE.fullmatch(p[1]) and PACK.fullmatch("/".join(p[2:])) and 127<size<MAX_PACK


def source_signature(manifest, receipt):
    # Archive encoders may emit different gzip timestamps for otherwise identical
    # files. A rolled-back input must stay quarantined until the sources or their
    # transformation change, even when its packed release ID changes.
    sources = []
    for (carrier, state), (region, _) in sorted(qualify_manifest(manifest).items()):
        source = region["source"]
        sources.append([carrier, state, source["fileId"], source["sha256"], region["boundary"]["sha256"]])
    return hashlib.sha256(canonical([manifest["asOf"], sources, receipt["componentHashes"]])).hexdigest()


def inspect(checkout,limit):
    root=checkout/FAMILY
    if not root.exists():
        return {"active":None,"generations":[],"quarantined":[]}
    require(root.is_dir() and not root.is_symlink(),"Invalid packed store")
    state=read(root/"state.json")
    generations=state["generations"];bad=state["quarantined"];active=state["active"]
    require(0<len(generations)<=2 and len(generations)==len(set(generations)) and len(bad)==len(set(bad)) and
            all(RELEASE.fullmatch(x) for x in generations+bad) and
            (active is None or (active in generations and active not in bad)), "Invalid packed generation index")
    signatures = state.get("quarantinedInputs", {})
    require(isinstance(signatures, dict) and set(signatures) <= set(bad) and
            all(isinstance(value, str) and SHA.fullmatch(value) for value in signatures.values()),
            "Invalid quarantined input signatures")
    require({p.name for p in root.iterdir()}==set(generations)|{"state.json","manifests","receipts"},"Unexpected packed data")
    for name in ("manifests","receipts"):
        require({p.name for p in (root/name).iterdir()}=={g+".json" for g in generations},"Unexpected packed history")
    for g in generations:
        m=read(root/"manifests"/(g+".json"))
        require(m["release"]==g,"Incorrect retained packed release")
        generation(root,m,read(root/"receipts"/(g+".json")),limit)
    return state


def put_blob(git,repo,env,path,data):
    b=git(["hash-object","-w","--stdin"],repo,input=data).decode().strip()
    git(["update-index","--add","--cacheinfo","100644,"+b+","+path],repo,env=env)


def write_change(core,repo,head,env,state,message):
    put_blob(core.git,repo,env,FAMILY+"/state.json",canonical(state)+b"\n")
    tree=core.git(["write-tree"],repo,env=env).decode().strip()
    core.inspect_tree_entries(repo,tree)
    commit=core.git(["commit-tree",tree,"-p",head,"-m",message],repo,env=env).decode().strip()
    # Verify the exact staged Git bytes, not a source path that could change while staging.
    with tempfile.TemporaryDirectory() as scratch:
        with core.checked_tree(repo,commit,Path(scratch)):
            pass
    core.push_data_ref(repo, commit, head)


def edit(core,repo,action,*,path=None,report=None,expected_scope=PUBLIC_SCOPE,expected=None,target=None):
    # Uses the same immutable data ref as the legacy publisher. A competing writer invalidates this lease.
    import os
    head=core.remote_head(repo)
    require(head,"A legacy release must exist before a dual-format transition")
    with tempfile.TemporaryDirectory() as tmp:
        work=Path(tmp)
        with core.checked_tree(repo,head,work) as (checkout,old,legacy_scopes,_):
            packed_state=checkout/FAMILY/"state.json"
            state=read(packed_state) if packed_state.exists() else {"active":None,"generations":[],"quarantined":[]}
            active=state["active"];gens=state["generations"]
            env={**os.environ,"GIT_INDEX_FILE":str(work/"index"),"GIT_AUTHOR_NAME":"github-actions[bot]",
                 "GIT_COMMITTER_NAME":"github-actions[bot]","GIT_AUTHOR_EMAIL":"41898282+github-actions[bot]@users.noreply.github.com",
                 "GIT_COMMITTER_EMAIL":"41898282+github-actions[bot]@users.noreply.github.com"}
            core.git(["read-tree",head],repo,env=env)
            if action=="rollback":
                require(active and active==expected and target!=expected and (target is None or target in gens and target not in state["quarantined"]),
                        "Rollback target is unavailable or the active release changed")
                old_manifest = read(checkout / FAMILY / "manifests" / (active + ".json"))
                old_receipt = read(checkout / FAMILY / "receipts" / (active + ".json"))
                state.setdefault("quarantinedInputs", {})[active] = source_signature(old_manifest, old_receipt)
                state["quarantined"].append(active)
                state["active"]=target
                write_change(core,repo,head,env,state,"Roll back packed FCC release "+active)
                return
            m,scopes,q=candidate(path,report,core.MAX_BYTES,expected_scope)
            release=m["release"]
            require(release not in state["quarantined"],"Packed release is quarantined")
            signature = source_signature(m, q)
            require(signature not in state.get("quarantinedInputs", {}).values(),
                    "Packed source inputs are quarantined")
            require(release not in {p.stem for p in (checkout/"manifests").glob("*.json")},"Release ID collides with legacy XYZ")
            require(m["asOf"]>=old["asOf"], "Packed filing predates the legacy release")
            if expected_scope in (PUBLIC_SCOPE, "US"):
                require(legacy_scopes<=set(scopes),"Packed release would remove publicly served carrier coverage")
            if gens:
                guard=active or gens[0]
                previous=read(checkout/FAMILY/"manifests"/(guard+".json"))
                require(m["asOf"]>=previous["asOf"] and set(qualify_manifest(previous))<=set(scopes),"Packed date or scope regressed")
            if active and release != active:
                current_manifest = read(checkout / FAMILY / "manifests" / (active + ".json"))
                current_receipt = read(checkout / FAMILY / "receipts" / (active + ".json"))
                require(signature != source_signature(current_manifest, current_receipt),
                        "Unchanged packed sources produced a different release; check encoding")
            if release in gens:
                prior=read(checkout/FAMILY/"manifests"/(release+".json"))
                require({k:v for k,v in prior.items() if k!="retrievedAt"}=={k:v for k,v in m.items() if k!="retrievedAt"},
                        "Immutable packed manifest changed")
                if release==active:
                    return
                raise ValueError("An inactive retained release must be restored through the reviewed rollback path")
            keep=[release]+([active or gens[0]] if gens else [])
            for g in set(gens)-set(keep):
                core.git(["rm","-rf","--cached","--",f"{FAMILY}/{g}",f"{FAMILY}/manifests/{g}.json",f"{FAMILY}/receipts/{g}.json"],repo,env=env)
            for c,s in scopes:
                relative=f"{release}/{c}/{s}.pmtiles"
                blob=core.git(["hash-object","-w",str(path/relative)],repo).decode().strip()
                require(file_sha(path/relative)==scopes[c,s][0]["archive"]["sha256"],"Candidate changed while staging")
                core.git(["update-index","--add","--cacheinfo","100644,"+blob+","+FAMILY+"/"+relative],repo,env=env)
            put_blob(core.git,repo,env,f"{FAMILY}/manifests/{release}.json",(path/"manifest.json").read_bytes())
            put_blob(core.git,repo,env,f"{FAMILY}/receipts/{release}.json",canonical(q)+b"\n")
            state.update(active=release,generations=keep)
            write_change(core,repo,head,env,state,"Publish qualified packed FCC release "+release)


def package(checkout,destination,legacy_ids,require_contiguous=False):
    root=checkout/FAMILY
    if not root.exists():
        require(not require_contiguous, "First lower-48 coverage release has not been adopted. Current site preserved.")
        return
    state=read(root/"state.json")
    if require_contiguous:
        if state["active"] is None:
            require(state["quarantined"] and state["generations"], "Missing active lower-48 release")
            print("Serving the regional fallback after an explicit packed-data rollback.")
        else:
            proof = read(root / "receipts" / (state["active"] + ".json"))
            require(proof["scope"] == PUBLIC_SCOPE and proof["archives"] == len(pairs(PUBLIC_SCOPE)),
                    "Active packed generation does not cover all lower-48 carrier/state pairs")
    require(not (set(state["generations"]) & legacy_ids),"Packed/legacy immutable path collision")
    for g in state["generations"]:
        shutil.copytree(root/g,destination/g)
    if state["active"]:
        shutil.copyfile(root/"manifests"/(state["active"]+".json"),destination/"manifest-v2.json")


def measure(core,repo,path,report,expected_scope=PUBLIC_SCOPE):
    """Read the candidate and live data tree; report space required without writing the data ref."""
    m,scopes,q=candidate(path,report,len(STATES)*len(PROVIDERS)*MAX_PACK,expected_scope)
    head=core.remote_head(repo)
    require(head,"No legacy data release available to measure")
    with tempfile.TemporaryDirectory() as tmp:
        with core.checked_tree(repo,head,Path(tmp)) as (checkout,legacy,_,_):
            oldroot=checkout/FAMILY
            state=read(oldroot/"state.json") if oldroot.exists() else {"active":None,"generations":[],"quarantined":[]}
            release=m["release"]
            require(release not in state["quarantined"] and
                    source_signature(m, q) not in state.get("quarantinedInputs", {}).values(),
                    "Proposed release or source inputs are quarantined")
            legacy_rows=[(p.relative_to(checkout),p.stat().st_size) for p in checkout.rglob("*") if p.is_file()
                         and p.relative_to(checkout).parts[0] not in {".git",FAMILY}]
            git_bytes=sum(n for _,n in legacy_rows)
            site_bytes=sum(n for p,n in legacy_rows if p.parts[0]!="manifests")
            site_count=sum(p.parts[0]!="manifests" for p,_ in legacy_rows)
            same=release==state["active"]
            keep=list(state["generations"]) if same else [release]+([state["active"] or state["generations"][0]] if state["generations"] else [])
            require(len(keep)==len(set(keep)), "Candidate is already an inactive retained release")
            for g in keep:
                if g==release and not same:
                    content=q["packedBytes"]
                    manifest_size=(path/"manifest.json").stat().st_size
                    receipt_size=len(canonical(q))+1
                    count=len(scopes)
                else:
                    files=[p for p in (oldroot/g).rglob("*.pmtiles")]
                    content=sum(p.stat().st_size for p in files)
                    count=len(files)
                    manifest_size=(oldroot/"manifests"/(g+".json")).stat().st_size
                    receipt_size=(oldroot/"receipts"/(g+".json")).stat().st_size
                git_bytes+=content+manifest_size+receipt_size
                site_bytes+=content+(manifest_size if g==release else 0)
                site_count+=count+(1 if g==release else 0)
            git_bytes+=len(canonical({**state,"active":release,"generations":keep}))+1
            return {"release":release,"generationBytes":q["packedBytes"],"archives":len(scopes),
                    "dataRef":head,"packagedFiles":site_count,"packagedBytes":site_bytes,"retainedTreeBytes":git_bytes,
                    "generationLimitBytes":core.MAX_BYTES,"retainedLimitBytes":2*core.MAX_BYTES+2*1024**2,
                    "fitsCurrentByteLimits":q["packedBytes"]<=core.MAX_BYTES and git_bytes<=2*core.MAX_BYTES+2*1024**2}

def preview(core, repo, path, report, destination):
    """Run a complete update and package against a disposable copy of the current data."""
    head = core.remote_head(repo)
    require(head, "A legacy release must exist before preview")
    require(not destination.exists(), "FCC preview destination already exists")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        bare, local = work / "data.git", work / "preview"
        core.git(["init", "--bare", str(bare)], work)
        # The checked-out source can be shallow. Seed an orphan commit with the exact
        # public data tree so no history, credentials, or live push target is copied.
        tree = core.git(["rev-parse", head + "^{tree}"], repo).decode().strip()
        seed = core.git(["-c", "user.name=KampTrail preview", "-c", "user.email=preview@localhost",
                         "commit-tree", tree, "-m", "Read-only snapshot of FCC data " + head], repo).decode().strip()
        core.git(["push", str(bare), seed + ":" + core.DATA_REF], repo)
        core.git(["init", str(local)], work)
        core.git(["remote", "add", "origin", str(bare)], local)
        edit(core, local, "publish", path=path, report=report)
        core.package(local, destination, require_contiguous=True)
    candidate = read(path / "manifest.json")
    require(read(destination / "manifest-v2.json")["release"] == candidate["release"],
            "Preview did not package the qualified release")
    print(f"Previewed packed release {candidate['release']} against public data {head}.")
