"""Capture replayable public KampTrail responses; retain exact request targets and body hashes."""
import argparse
import hashlib
import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument("destination", type=Path)
args = parser.parse_args()
root = args.destination
root.mkdir(parents=True, exist_ok=True)
base = "https://kamptrail.com"
records = {}

def get(path):
    parts = urlsplit(path)
    assert path.startswith("/") and not parts.netloc and ".." not in path
    key = hashlib.sha256(path.encode()).hexdigest()
    body = root / key
    result = subprocess.check_output(["curl", "--silent", "--show-error", "--fail", "--retry", "2",
        "--max-time", "90", "--compressed", "--output", str(body), "--write-out", "%{http_code}", base + path], text=True)
    if result != "200":
        raise ValueError((path, result))
    raw = body.read_bytes()
    records[path] = dict(file=key, bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(), http=200)
    return raw

page = get("/").decode()
states = json.loads(get("/data/campsites/index.json"))["states"]
agency = json.loads(get("/data/campsites/agency/index.json"))["states"]
paths = {"/"+p for p in re.findall(r'<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"',page) if not urlsplit(p).scheme}
paths.update("/data/campsites/"+s["state"]+"_merged.geojson" for s in states)
paths.update("/data/campsites/agency/"+s+".geojson" for s in agency)
paths.update("/data/campsites/"+n+".json" for n in ("identity-hosts","search-index","ridb-sites","ridb-amenities","usfs-site-amenities"))
paths.add("/release.json")
with ThreadPoolExecutor(max_workers=6) as pool:
    for _ in pool.map(get,sorted(paths)):
        pass
(root / "manifest.json").write_text(json.dumps(dict(sorted(records.items())),indent=2)+"\n")
print(len(records),"GETs",sum(r['bytes'] for r in records.values()),"bytes")
