import gzip
import json
import os
from pathlib import Path
import subprocess

release = "44643b2ce90a51e59e02d366a592a652feef9737"
source = "5d05505145f916865c90af1b25405c4bfed295d9"
base = "a016d67cb32db8dbf5cd78bc3c1e782ffa00cdd8"
approved = [".github/workflows/fetch-campsite-data.yml","data-loader.js","data-quality.js","scripts/build-identity-hosts.js","scripts/build-listing-history.js","scripts/build-search-index.js","scripts/check-id-continuity.js","scripts/fetch_recreation_gov_data.py","scripts/merge_campsite_data.js","scripts/services_regions.py","scripts/tests/merge-safety.test.js","scripts/tests/test_data_pipeline.py","scripts/tests/test_services_import.py","scripts/tests/test_workflow_safety.py","tests/deterministic-identity.test.js","tests/listing-history.test.js"]
versioned = ["about.html","analytics-bootstrap.js","analytics-settings.js","app.js","beta.js","carrier-coverage.js","clearances.js","community-discovery.js","community.js","consent-analytics.js","consent-controls.js","contributions.js","data-loader.js","data-quality.js","environment.js","feedback.js","filters.js","forecast.js","guides.html","index.html","install.js","layers.js","listing-history.js","locale-es.js","locale-fr.js","locale.js","map-loader.js","mvum.js","offline-maps.js","package-lock.json","package.json","permissions.js","plan.html","record-overrides.js","rest-areas.js","rig-profile.js","route-clearance.js","route-elevation.js","routes.js","safety.js","service-worker.js","services.js","share.js","shell.js","spot-info.js","tools.html","trip-planner.js","updates.html"]
artifact = Path(os.environ["RUNNER_TEMP"]) / "candidate"

def git(*args):
    return subprocess.check_output(["git", *args])

paths = git("diff", "--name-only", base, source).decode().splitlines()
assert sorted(paths) == approved, paths
for name in paths:
    content = git("show", f"{source}:{name}")
    if name in versioned:
        original = git("show", f"{base}:{name}")
        expected = git("show", f"{release}:{name}")
        assert original.replace(b"2.49.0", b"2.50.0") == expected, name
        content = content.replace(b"2.49.0", b"2.50.0")
    else:
        assert git("diff", "--name-only", base, release, "--", name) == b"", name
    Path(name).write_bytes(content)
for name in versioned:
    path = Path(name)
    body = path.read_bytes()
    if name == "service-worker.js":
        assert body.count(b"kt-v95") == 1
        body = body.replace(b"kt-v95", b"kt-v96")
    else:
        assert b"2.50.0" in body, name
    path.write_bytes(body.replace(b"2.50.0", b"2.51.0"))

allowed_sources = ("data/campsites/", "data/opencampingmap/", "data/sources/", "data/rest-areas/", "data/services/")
paths = [line.split("\t")[-1] for line in (artifact / "changed-paths.txt").read_text().splitlines()]
assert paths and all(name.startswith(allowed_sources) or name == "data/health.json" for name in paths)
q = json.loads((artifact / "qualification.json").read_text())
assert q["original_run"] == 45012745211
assert not any(q[k] for k in ("type_changes","owner_changes","restrictive_hold_changes"))
assert not any(q["continuity"][k] for k in ("lost","moved","conflicts"))
verify = set((artifact / "verification.txt").read_text().splitlines())
assert verify == {"production_refresh_gate=success", "both_browser_load_orders=success"}, verify
assert not git("diff", "--name-only", base, release, "--", "data"), "Reconcile newer main data first"
patch = gzip.decompress((artifact / "source-and-snapshot.patch.gz").read_bytes())
subprocess.run(["git","apply","--index","--binary","--whitespace=nowarn","-"],input=patch,check=True)
assert sorted(git("diff","--cached","--name-only").decode().splitlines()) == sorted(paths), "Unexpected data path"
print("Recovered source", q["active_before"], q["active_after"], q["continuity"], flush=True)
