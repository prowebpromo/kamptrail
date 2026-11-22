#!/usr/bin/env python3
"""Verify every public lower-48 archive against independently qualified bytes and pixels."""
import argparse
import hashlib
import io
import json
import math
import time
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image
from pmtiles.reader import Reader

STATES = "AL AR AZ CA CO CT DE FL GA IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY".split()
CARRIERS = ["att", "t-mobile", "verizon"]
PALETTE = {(24, 96, 176, 255): "covered", (112, 112, 112, 255): "uncovered", (0, 0, 0, 0): "missing"}
SAMPLES = {"RI": CARRIERS, "NY": CARRIERS, "CO": ["att"], "TX": ["t-mobile"], "CA": ["verizon"]}
PREFIX = "data/fcc-coverage/"


def hash_bytes(data):
    return hashlib.sha256(data).hexdigest()


def get(url, byte_range=None):
    headers = {"User-Agent": "KampTrail release acceptance", "Accept-Encoding": "identity"}
    if byte_range is not None:
        headers["Range"] = "bytes=%d-%d" % byte_range
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers=headers), timeout=55) as response:
                assert response.geturl() == url, "Unexpected redirect: " + url
                return response.status, response.headers, response.read()
        except HTTPError as exc:
            if exc.code not in (429, 503) or attempt == 2:
                raise
            value = exc.headers.get("Retry-After", "")
            if value.isdigit():
                backoff = int(value)
            elif value:
                backoff = max(0, parsedate_to_datetime(value).timestamp() - time.time())
            else:
                backoff = 60 * (attempt + 1)
            print(f"Server requested a pause ({exc.code}), waiting {backoff:g} seconds.", flush=True)
            time.sleep(backoff)


def read_json(url):
    status, _, content = get(url)
    assert status == 200, url
    return json.loads(content)


def read_archive(url, size, delay, policies=None):
    chunks = []
    for start, end in [(0, 126), (127, size - 1)]:
        time.sleep(delay)
        status, headers, data = get(url, (start, end))
        assert status == 206, f"{url}: expected HTTP 206, received {status}"
        assert headers["Content-Range"] == f"bytes {start}-{end}/{size}", (url, headers["Content-Range"])
        assert int(headers["Content-Length"]) == len(data) == end - start + 1, url
        assert headers.get("Content-Encoding", "identity").lower() == "identity", url
        if policies is not None:
            policies.append({"cacheControl": headers.get("Cache-Control", ""), "contentType": headers.get_content_type()})
        chunks.append(data)
    assert chunks[0][:8] == b"PMTiles\x03", url
    return b"".join(chunks)


def project(lon, lat, z):
    size = 256 * 2**z
    return math.floor((lon + 180) / 360 * size), math.floor((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * size)


def sample(reader, lon, lat, z):
    px, py = project(lon, lat, z)
    tile = reader.get(z, px // 256, py // 256)
    if tile is None:
        return "missing", None
    with Image.open(io.BytesIO(tile)) as image:
        value = PALETTE[image.convert("RGBA").getpixel((px % 256, py % 256))]
    return value, hash_bytes(tile)


def classify(region_map, readers, carrier, lon, lat, z):
    values = []
    for region in region_map[carrier]:
        w, s, e, n = region["bounds"]
        if w <= lon <= e and s <= lat <= n:
            value, _ = sample(readers[carrier, region["id"]], lon, lat, min(z, region["maxZoom"]))
            values.append(value)
    return next((v for v in ["covered", "uncovered"] if v in values), "missing")


def campsite(repo, state):
    path = repo / "data" / "campsites" / (state + "_merged.geojson")
    features = json.loads(path.read_bytes())["features"]
    named = [f for f in features if f.get("geometry", {}).get("type") == "Point"
             and f["properties"].get("id") and "campground" in str(f["properties"].get("name", "")).lower()
             and str(f["properties"].get("name", "")).strip().lower() != "campground"]
    assert named, f"No named campsite available in {state}"
    chosen = min(named, key=lambda f: str(f["properties"]["id"]))
    return {"name": chosen["properties"]["name"], "id": chosen["properties"]["id"],
            "lon": chosen["geometry"]["coordinates"][0], "lat": chosen["geometry"]["coordinates"][1]}


def verify(args):
    base = args.base.rstrip("/") + "/"
    qualification = json.loads((args.evidence / "qualification.json").read_bytes())
    declared = json.loads((args.evidence / "manifest.json").read_bytes())
    release = read_json(base + "release.json?acceptance=" + str(time.time_ns()))
    assert release["source_commit"] == args.commit, release
    manifest_status, pointer_headers, manifest_body = get(base + PREFIX + "manifest-v2.json")
    assert manifest_status == 200
    manifest = json.loads(manifest_body)
    if args.mode == "production":
        assert "no-cache" in pointer_headers.get("Cache-Control", "").lower(), "Packed manifest is expected to revalidate"
    assert manifest == declared and manifest["release"] == qualification["release"], "Publication differs from qualified manifest"
    assert qualification["scope"] == "CONUS48" and not qualification["explicitlyMissing"]
    assert manifest["schema"] == 2 and qualification["archives"] == 144
    region_map = {c["id"]: c["regions"] for c in manifest["carriers"]}
    assert sorted(region_map) == CARRIERS
    for entries in region_map.values():
        assert sorted(r["id"] for r in entries) == sorted(STATES)
    shards = {(r["carrier"], r["region"]): r for r in qualification["shards"]}
    assert len(qualification["shards"]) == len(shards) == 144
    assert set(shards) == {(c, s) for c in CARRIERS for s in STATES}

    readers, checks = {}, []
    for carrier in CARRIERS:
        for region in region_map[carrier]:
            state = region["id"]
            row = shards[carrier, state]
            size = row["pmtilesBytes"]
            archive = region["archive"]
            assert (size, row["pmtilesSHA256"]) == (archive["bytes"], archive["sha256"])
            assert (region["source"]["sha256"], str(region["source"]["fileId"])) == (row["sourceSHA256"], str(row["fileId"]))
            url = base + PREFIX + manifest["release"] + "/" + carrier + "/" + state + ".pmtiles?sha256=" + archive["sha256"]
            policies = []
            data = read_archive(url, size, args.pause, policies)
            if args.mode == "production":
                for policy in policies:
                    directives = set(v.strip().lower() for v in policy["cacheControl"].split(","))
                    assert {"immutable", "no-transform"} <= directives, (url, policy)
                    assert policy["contentType"] == "application/vnd.pmtiles", (url, policy)

            assert hash_bytes(data) == archive["sha256"], "Archive hash mismatch: " + url
            reader = Reader(lambda offset, length, data=data: data[offset:offset+length])
            readers[carrier, state] = reader
            verified = []
            for kind, w in row["spatial"]["witnesses"].items():
                actual, tile_digest = sample(reader, w["lon"], w["lat"], w["zoom"])
                assert actual == kind and tile_digest == w["sha256"], (state, carrier, kind, actual, tile_digest)
                verified.append(kind)
            assert verified, (carrier, state)
            checks.append({"state": state, "carrier": carrier, "bytes": size, "archiveSHA256": archive["sha256"],
                           "sourceFileId": row["fileId"], "sourceWitnesses": verified, "ranges": 2, "delivery": policies[0]})
        print(f"Verified public ranges, bytes and source witnesses for all 48 {carrier} archives.", flush=True)

    browser_samples = []
    camps = {s: campsite(args.repo, s) for s in SAMPLES}
    for state, carriers in SAMPLES.items():
        for carrier in carriers:
            row = shards[carrier, state]
            for kind in ("covered", "uncovered"):
                w = row["spatial"]["witnesses"].get(kind)
                if w:
                    expected = classify(region_map, readers, carrier, w["lon"], w["lat"], w["zoom"])
                    browser_samples.append({"state": state, "carrier": carrier, "kind": "source-" + kind,
                                            "expected": expected, "lon": w["lon"], "lat": w["lat"], "zoom": w["zoom"]})
        site = camps[state]
        carrier = carriers[0]
        expected = classify(region_map, readers, carrier, site["lon"], site["lat"], 10)
        browser_samples.append(dict(site, state=state, carrier=carrier, kind="named-campsite", expected=expected, zoom=10))
    remote = shards["verizon", "MN"]["spatial"]["witnesses"]["covered"]
    offline_point = {"carrier":"verizon", "state":"MN", "lat":remote["lat"], "lon":remote["lon"], "zoom":remote["zoom"]}
    assert classify(region_map, readers, "verizon", remote["lon"], remote["lat"], remote["zoom"]) == "covered"
    assert {r["expected"] for r in browser_samples} >= {"covered", "uncovered"}
    assert len({r["state"] for r in browser_samples if r.get("id")}) == 5
    assert sum(r["bytes"] for r in checks) == qualification["packedBytes"]
    prior = json.loads((args.previous / "qualification.json").read_bytes())
    baseline = {(r["carrier"], r["region"]): r for r in prior["shards"] if r["region"] in STATES}
    assert len(baseline) == 144 and sum(r["pmtilesBytes"] for r in baseline.values()) == 142403276
    changes = [{"carrier": c, "state": s, "priorSourceFile": baseline[c,s]["fileId"], "currentSourceFile": r["fileId"],
                "sourceSHAChanged": r["sourceSHA256"] != baseline[c,s]["sourceSHA256"],
                "archiveSHAChanged": r["pmtilesSHA256"] != baseline[c,s]["pmtilesSHA256"],
                "bytesDelta": r["pmtilesBytes"] - baseline[c,s]["pmtilesBytes"]}
               for (c,s),r in shards.items() if any(r[k] != baseline[c,s][k] for k in ("sourceSHA256", "pmtilesSHA256", "fileId"))]
    comparison = {"priorRun": 44741537700, "priorArtifact": 14631196583, "priorFiling": prior["asOf"],
                  "priorLower48Bytes": 142403276, "bytesDelta": qualification["packedBytes"] - 142403276, "changedArchives": changes}
    return {"result": "PASS", "mode": args.mode, "commit": args.commit, "generation": manifest["release"],
            "priorQualification": comparison,
            "asOf": manifest["asOf"], "navigationRegion": next({k:r[k] for k in ("id","bounds","minZoom","maxZoom")} for r in region_map["att"] if r["id"]=="NY"), "archiveCount": len(checks), "rangeResponses": 2*len(checks),
            "archiveBytes": qualification["packedBytes"], "archiveChecks": checks, "browserSamples": browser_samples, "unvisitedOfflineWitness": offline_point}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--base", required=True)
    p.add_argument("--commit", required=True)
    p.add_argument("--evidence", required=True, type=Path)
    p.add_argument("--repo", required=True, type=Path)
    p.add_argument("--previous", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--pause", type=float, default=0.0)
    p.add_argument("--mode", required=True, choices=["preview", "production"])
    args = p.parse_args()
    result = verify(args)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Verified {result['archiveCount']} archives and {result['archiveBytes']:,} bytes via {result['rangeResponses']} HTTP range responses.")
    for entry in result["archiveChecks"]:
        print("ARCHIVE-CHECK " + json.dumps(entry, separators=(",", ":")))
    print("ARCHIVE-REPORT " + json.dumps({k:v for k,v in result.items() if k not in ("archiveChecks","navigationRegion","browserSamples","unvisitedOfflineWitness")}, separators=(",", ":")))
