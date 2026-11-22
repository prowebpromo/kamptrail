"""Deterministic publication fixtures. Real FCC files are validated by the refresh workflow."""
import copy
import gzip
import hashlib
import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fcc_packed_publication as packed
import publish_fcc_tiles as publisher
from test_fcc_refresh import A, DATA_DATE, run, stage, tile_bytes


def write(path, value):
    path.write_bytes(packed.canonical(value) + b"\n")


def sample_archive(region, stamp):
    # The publisher validates header semantics, byte identity, and geometry receipts.
    # The qualifier separately reads and compares every addressed tile with its PNG.
    gz = lambda data: gzip.compress(data, mtime=0)
    metadata = gz(packed.canonical({"asOf": stamp, "footprints": region["footprints"], "attribution": "FCC BDC"}))
    image = tile_bytes()
    count = packed.shape(region)
    directory = gz(bytes([1, 0, count, len(image) % 128 + 128, len(image) // 128, 1]))
    header = bytearray(127)
    header[:8] = b"PMTiles\x03"
    ofs = 127 + len(directory)
    struct.pack_into("<11Q", header, 8, 127, len(directory), ofs, len(metadata), ofs + len(metadata), 0,
                     ofs + len(metadata), len(image), count, 1, 1)
    header[97:102] = bytes((2, 1, 2, 6, 10))
    return bytes(header) + directory + metadata + image


COMPONENTS = {"acceptance/check-fcc-tiles.py", "pack_fcc_tiles.py", "qualify_fcc_national.py",
              "build_fcc_tiles.py", "fcc_download.py", "prepare_fcc_refresh.py", "requirements-fcc-pmtiles.txt"}


def make_candidate(parent, states, scope=packed.PUBLIC_SCOPE, revision="1", extra_credit=""):
    path = parent / "candidate"
    staging = path / "staging"
    staging.mkdir(parents=True)
    carriers, rows = [], []
    for carrier, provider in sorted(packed.PROVIDERS.items()):
        regions = []
        (staging / carrier).mkdir()
        for state in sorted(states):
            bounds = [-71.501, 41.601, -71.5009, 41.6011]
            file_id = int(provider) * 100 + int(packed.STATE_FIPS[state])
            source = {"fileId": file_id, "providerId": provider, "asOf": DATA_DATE, "sha256": revision * 64,
                      "sourceFile": f"bdc_{packed.STATE_FIPS[state]}_{provider}_4glte_mobile_broadband_j26_fixture",
                      "records": 1}
            reg = {"id": state, "bounds": bounds, "footprints": [bounds], "minZoom": 6, "maxZoom": 10,
                   "boundary": {"source": packed.BOUNDARY, "sha256": "f" * 64}, "source": source}
            raw = sample_archive(reg, DATA_DATE)
            sha = hashlib.sha256(raw).hexdigest()
            (staging / carrier / (state + ".pmtiles")).write_bytes(raw)
            reg["archive"] = {"format": "pmtiles-v3", "bytes": len(raw), "sha256": sha}
            regions.append(reg)
            spatial = {"region": state, "carrier": carrier, "fileId": file_id, "sourceSHA256": source["sha256"],
                       "matches": {"covered": 1}, "tilesCompared": 1, "records": 1}
            rows.append({"region": state, "carrier": carrier, "fileId": file_id, "sourceSHA256": source["sha256"],
                         "records": 1, "pmtilesBytes": len(raw), "pmtilesSHA256": sha, "spatial": spatial})
        carriers.append({"id": carrier, "regions": regions})
    manifest = {"schema": 2, "technology": "4G LTE", "environment": "Outdoor stationary", "asOf": DATA_DATE,
                "attribution": "FCC BDC" + extra_credit, "carriers": carriers}
    release = DATA_DATE + "-" + hashlib.sha256(packed.canonical(manifest)).hexdigest()[:20]
    manifest.update(release=release, retrievedAt="2026-11-22")
    staging.rename(path / release)
    write(path / "manifest.json", manifest)
    component_names = COMPONENTS if scope == packed.PUBLIC_SCOPE else COMPONENTS | {"build_fcc_alaska_tiles.py"}
    receipt = {"schema": 1, "asOf": DATA_DATE, "release": release, "archives": len(rows), "shards": rows,
               "planId": "c" * 64, "catalogSha256": "d" * 64, "sourceCommit": "e" * 40, "scope": scope,
               "packedBytes": sum(row["pmtilesBytes"] for row in rows), "explicitlyMissing": [],
               "componentHashes": {p: "b" * 64 for p in component_names}}
    report = parent / "qualification.json"
    write(report, receipt)
    return path, report, manifest, receipt


class PackedPublication(unittest.TestCase):
    def test_contiguous_candidate_is_complete_and_hash_checked(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path, report, manifest, receipt = make_candidate(root, packed.CONTIGUOUS)
            _m, scopes, _q = packed.candidate(path, report, publisher.MAX_BYTES, packed.PUBLIC_SCOPE)
            self.assertEqual(len(scopes), 144)
            self.assertEqual(len({state for _, state in scopes}), 48)
            self.assertFalse(set(scopes) & {(c, s) for c in packed.PROVIDERS for s in ("AK", "HI", "DC")})
            with self.assertRaisesRegex(ValueError, "capacity"):
                packed.candidate(path, report, receipt["packedBytes"] - 1)
            bad = copy.deepcopy(receipt)
            bad["shards"][0]["sourceSHA256"] = "0" * 64
            write(report, bad)
            with self.assertRaisesRegex(ValueError, "receipt disagrees"):
                packed.candidate(path, report, publisher.MAX_BYTES)
            write(report, receipt)
            asset = path / manifest["release"] / "att" / "NY.pmtiles"
            original = asset.read_bytes()
            asset.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                packed.candidate(path, report, publisher.MAX_BYTES)

    def test_partial_filing_cannot_shrink_the_rollout(self):
        with tempfile.TemporaryDirectory() as temp:
            path, report, _m, q = make_candidate(Path(temp), {"NY", "RI"})
            q["explicitlyMissing"] = [{"region": s, "carrier": c, "reason": "No raw LTE entry for this provider in this filing."}
                                       for c, s in sorted(packed.pairs(packed.PUBLIC_SCOPE)) if s not in {"NY", "RI"}]
            write(report, q)
            with self.assertRaisesRegex(ValueError, "All three carriers"):
                packed.candidate(path, report, publisher.MAX_BYTES, packed.PUBLIC_SCOPE)

    def test_recovery_preserves_legacy_and_rejects_reencoded_quarantine(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            remote, repo = root / "origin", root / "repo"
            run(root, "git", "init", "--bare", str(remote))
            run(root, "git", "init", str(repo))
            run(repo, "git", "remote", "add", "origin", str(remote))
            run(repo, "git", "-c", "user.name=fixture", "-c", "user.email=fixture@localhost", "commit", "--allow-empty", "-m", "fixture")
            publisher.publish(repo, stage(root / "legacy", A))
            def publish_subset(candidate):
                path, report, manifest, _ = candidate
                packed.edit(publisher, repo, "publish", path=path, report=report, expected_scope="RI")
                return manifest["release"]
            older = publish_subset(make_candidate(root / "a", {"RI"}, "RI"))
            newer = publish_subset(make_candidate(root / "b", {"RI"}, "RI", "2"))
            packed.edit(publisher, repo, "rollback", expected=newer, target=older)
            current = publisher.remote_head(repo)
            with self.assertRaisesRegex(ValueError, "source inputs are quarantined"):
                publish_subset(make_candidate(root / "changed", {"RI"}, "RI", "2", " with different packed metadata"))
            self.assertEqual(publisher.remote_head(repo), current)
            publisher.package(repo, root / "public")
            self.assertEqual(packed.read(root / "public" / "manifest-v2.json")["release"], older)
            self.assertEqual(packed.read(root / "public" / "manifest.json")["release"], A)
            self.assertTrue((root / "public" / newer / "att" / "RI.pmtiles").is_file())

    def test_full_preview_packages_144_archives_without_writing_the_real_data_ref(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            remote, repo = root / "origin", root / "repo"
            run(root, "git", "init", "--bare", str(remote))
            run(root, "git", "init", str(repo))
            run(repo, "git", "remote", "add", "origin", str(remote))
            run(repo, "git", "-c", "user.name=fixture", "-c", "user.email=fixture@localhost", "commit", "--allow-empty", "-m", "fixture")
            publisher.publish(repo, stage(root / "legacy", A))
            head = publisher.remote_head(repo)
            with self.assertRaisesRegex(ValueError, "has not been adopted"):
                publisher.package(repo, root / "unadopted", require_contiguous=True)
            self.assertFalse((root / "unadopted").exists())
            path, report, manifest, _receipt = make_candidate(root, packed.CONTIGUOUS)
            site = root / "preview"
            packed.preview(publisher, repo, path, report, site)
            self.assertEqual(publisher.remote_head(repo), head)
            self.assertEqual(packed.read(site / "manifest-v2.json")["release"], manifest["release"])
            self.assertEqual(packed.read(site / "manifest.json")["release"], A)
            self.assertEqual(len(list(site.rglob("*.pmtiles"))), 144)

    def test_lease_conflicts_retry_and_ordinary_failures_propagate(self):
        failure = subprocess.CalledProcessError(1, ["git", "push"])
        with patch.object(publisher, "git", side_effect=failure), patch.object(publisher, "remote_head", return_value="new"):
            with self.assertRaises(publisher.PublicationConflict):
                publisher.push_data_ref(None, "mine", "old")
            publisher.push_data_ref(None, "new", "old")
        with patch.object(publisher, "git", side_effect=failure), patch.object(publisher, "remote_head", return_value="old"):
            with self.assertRaises(subprocess.CalledProcessError):
                publisher.push_data_ref(None, "mine", "old")
        operation = Mock(side_effect=[publisher.PublicationConflict(), "published"])
        self.assertEqual(publisher.publish_with_retry(operation), "published")
        self.assertEqual(operation.call_count, 2)
