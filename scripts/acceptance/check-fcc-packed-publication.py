"""Branch-only qualification against pinned FCC artifacts and a disposable local bare Git remote."""
import argparse
import copy
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import publish_fcc_tiles as v1
import fcc_packed_publication as v2


def write(path,value):
    path.write_bytes(v2.canonical(value)+b"\n")


def rid(manifest):
    body={k:v for k,v in manifest.items() if k not in ("retrievedAt","release")}
    return manifest["asOf"]+"-"+hashlib.sha256(v2.canonical(body)).hexdigest()[:20]


def setup(repo,remote):
    def git(cwd,*args):
        subprocess.run(["git",*args],cwd=cwd,check=True,capture_output=True)
    repo.mkdir();remote.mkdir()
    git(remote,"init","--bare")
    git(repo,"init")
    git(repo,"remote","add","origin",str(remote.resolve()))
    git(repo,"-c","user.name=qualification","-c","user.email=local@example.invalid","commit","--allow-empty","-m","local anchor")
    assert v1.git(["remote","get-url","origin"],repo).decode().strip()==str(remote.resolve())


def require_failure(fn,contains=None):
    try:
        fn()
    except (ValueError,KeyError,OSError,subprocess.CalledProcessError) as exc:
        if contains and contains not in str(exc):
            raise
        return
    raise AssertionError("Expected candidate rejection")


def package(repo,work,name):
    d=work/name
    v1.package(repo,d)
    return d


def filesum(root):
    files=[p for p in root.rglob("*") if p.is_file()]
    return len(files),sum(p.stat().st_size for p in files)


def check_ri_archive(packs,xyz_receipt):
    # This standalone prototype predates the national aggregation receipt. Use its real
    # geometry report and packs only to verify the format, with no invented acquisition receipt.
    m=v2.read(packs/"manifest.json")
    geometry=v2.read(xyz_receipt)
    assert geometry["result"]=="PASS"
    seen=set()
    for c in m["carriers"]:
        for reg in c["regions"]:
            path=packs/m["release"]/c["id"]/(reg["id"]+".pmtiles")
            v2.validate_file(path,reg,v2.shape(reg),m)
            check=next(a for a in geometry["checks"] if a["region"]==reg["id"] and a["carrier"]==c["id"])
            assert check["sourceSHA256"]==reg["source"]["sha256"] and check["fileId"]==reg["source"]["fileId"]
            seen.add(c["id"])
    assert seen==set(v2.PROVIDERS)


def qualify(legacy,ri,ri_evidence,aggregate,lane):
    check_ri_archive(ri,ri_evidence)
    with tempfile.TemporaryDirectory() as tmp:
        work=Path(tmp); repo=work/"repo"
        setup(repo,work/"local-remote")
        v1.publish(repo,legacy)
        v1_id=v2.read(legacy/"manifest.json")["release"]
        first=v1.remote_head(repo)
        candidate=work/"ak";candidate.mkdir()
        m=v2.read(aggregate/"manifest.json")
        q=v2.read(aggregate/"qualification.json",8*1024**2)
        original=q["release"]
        shutil.copytree(lane/"archives",candidate/original)
        write(candidate/"manifest.json",m)
        report=work/"proof.json";write(report,q)
        v2.candidate(candidate,report,v1.MAX_BYTES)
        # Production entry point requires all 50 states plus DC even if a regional QA report is valid.
        require_failure(lambda:v2.edit(v1,repo,"publish",path=candidate,report=report),"scope differs")
        assert v1.remote_head(repo)==first
        p=next(iter((candidate/original).rglob("*.pmtiles")));data=p.read_bytes()
        tampered=bytearray(data);tampered[-1]^=1;p.write_bytes(tampered)
        require_failure(lambda:v2.candidate(candidate,report,v1.MAX_BYTES),"SHA-256")
        p.write_bytes(data)
        q_bad=copy.deepcopy(q);q_bad["shards"][0]["spatial"]["sourceSHA256"]="0"*64
        write(report,q_bad)
        require_failure(lambda:v2.candidate(candidate,report,v1.MAX_BYTES),"receipt disagrees")
        write(report,q)
        require_failure(lambda:v2.candidate(candidate,report,q["packedBytes"]-1),"capacity")
        q_bad=copy.deepcopy(q);q_bad["explicitlyMissing"]=[]
        write(report,q_bad);require_failure(lambda:v2.candidate(candidate,report,v1.MAX_BYTES),"Unaccounted")
        write(report,q)
        unexpected=candidate/"bad"
        unexpected.touch()
        require_failure(lambda:v2.candidate(candidate,report,v1.MAX_BYTES),"Unexpected input tree")
        unexpected.unlink()
        assert v1.remote_head(repo)==first
        regional=lambda:v2.edit(v1,repo,"publish",path=candidate,report=report,expected_scope="AK")
        predicted=v2.measure(v1,repo,candidate,report)
        assert v1.remote_head(repo)==first
        regional()
        head_a=v1.remote_head(repo)
        regional();assert v1.remote_head(repo)==head_a
        site=package(repo,work,"mixed")
        assert (site/"manifest.json").read_bytes()==(legacy/"manifest.json").read_bytes()
        assert v2.read(site/"manifest-v2.json")==m
        for item in (legacy/v1_id).rglob("*.png"):
            assert (site/item.relative_to(legacy)).read_bytes()==item.read_bytes()
        assert predicted["fitsCurrentByteLimits"] and (predicted["packagedFiles"],predicted["packagedBytes"])==filesum(site)
        assert predicted["retainedTreeBytes"]==v1.inspect_tree_entries(repo,head_a)
        print("Measured real NY/RI XYZ plus Alaska packs before writing",predicted,flush=True)

        # A deliberately changed display attribution creates a distinct QA generation with identical real archive bytes.
        m2=copy.deepcopy(m);m2["attribution"]=m2["attribution"]+" (qualification fixture B)"
        b=rid(m2);m2["release"]=b
        (candidate/original).rename(candidate/b);write(candidate/"manifest.json",m2)
        q2=copy.deepcopy(q);q2["release"]=b;write(report,q2)
        with patch.object(v1,"MAX_BYTES",q["packedBytes"]):
            assert not v2.measure(v1,repo,candidate,report)["fitsCurrentByteLimits"]
            require_failure(regional,"capacity")
        assert v1.remote_head(repo)==head_a
        regional()
        head_b=v1.remote_head(repo)
        dual=package(repo,work,"two")
        assert (dual/original).is_dir() and (dual/b).is_dir() and (dual/v1_id).is_dir()
        print("Real XYZ plus two packed generations",filesum(dual),"files/bytes; data Git tree",v1.inspect_tree_entries(repo,head_b),flush=True)
        require_failure(lambda:v2.edit(v1,repo,"rollback",expected=original,target=b),"active release changed")
        assert v1.remote_head(repo)==head_b
        v2.edit(v1,repo,"rollback",expected=b,target=original)
        rollback=package(repo,work,"rolled-back")
        assert v2.read(rollback/"manifest-v2.json")["release"]==original and (rollback/b).is_dir()
        assert v2.read(rollback/"manifest.json")["release"]==v1_id
        require_failure(regional,"quarantined")

        # An ordinary monthly schema-1 refresh must preserve V2 state and both immutable packs.
        legacy2=work/"legacy2";shutil.copytree(legacy,legacy2)
        lm=v2.read(legacy2/"manifest.json");legacy_alt=lm["asOf"]+"-"+"f"*20
        (legacy2/lm["release"]).rename(legacy2/legacy_alt);lm["release"]=legacy_alt;write(legacy2/"manifest.json",lm)
        v1.publish(repo,legacy2)
        cross=package(repo,work,"cross-family")
        assert all((cross/p).is_dir() for p in (v1_id,legacy_alt,original,b))
        assert v2.read(cross/"manifest-v2.json")["release"]==original and v2.read(cross/"manifest.json")["release"]==legacy_alt
        v2.edit(v1,repo,"rollback",expected=original,target=None)
        fallback=package(repo,work,"legacy-fallback")
        assert not (fallback/"manifest-v2.json").exists() and (fallback/original).is_dir() and (fallback/b).is_dir()
        assert v2.read(fallback/"manifest.json")["release"]==legacy_alt
        require_failure(regional,"quarantined")
        print("Two legacy/packed generations retained and quarantined rollback preserved; data Git tree",
              v1.inspect_tree_entries(repo,v1.remote_head(repo)),"bytes",flush=True)


if __name__=="__main__":
    p=argparse.ArgumentParser()
    for k in ("legacy","ri","ri-evidence","aggregate","lane"):
        p.add_argument("--"+k,type=Path,required=True)
    a=p.parse_args()
    qualify(a.legacy,a.ri,a.ri_evidence,a.aggregate,a.lane)
