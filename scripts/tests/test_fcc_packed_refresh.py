import copy
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fcc_packed_refresh as refresh
from qualify_fcc_national import CONUS48, PROVIDERS, SCOPE, write


class PackedRefreshTests(unittest.TestCase):
    def selection(self):
        boundary = "8" * 64
        catalog = []
        carriers = []
        for carrier, (provider, _) in PROVIDERS.items():
            regions = []
            for state in sorted(CONUS48):
                file_id = 1000 + len(catalog)
                row = {"id": carrier, "region": state, "fileId": file_id, "providerId": provider,
                       "sourceFile": state + "-" + carrier, "recordCount": file_id + 8}
                catalog.append(row)
                regions.append({"id": state, "source": {"fileId": file_id, "providerId": provider,
                                "sourceFile": row["sourceFile"], "records": row["recordCount"]},
                                "boundary": {"sha256": boundary}})
            carriers.append({"id": carrier, "regions": regions})
        plan = {"lanes": [catalog], "asOf": "2026-06-30", "componentHashes": {"a": "f" * 64},
                "boundary": {"sha256": boundary}}
        release = "2026-06-30-" + "a" * 20
        manifest = {"release": release, "asOf": plan["asOf"], "carriers": carriers}
        report = {"release": release, "scope": SCOPE, "componentHashes": plan["componentHashes"]}
        return plan, manifest, report

    def test_only_unchanged_active_or_quarantined_inputs_skip_rebuild(self):
        plan, manifest, report = self.selection()
        self.assertTrue(refresh.same_inputs(plan, manifest, report))
        for field, value in [("sourceFile", "revised"), ("fileId", 42), ("recordCount", 50)]:
            other = copy.deepcopy(plan)
            other["lanes"][0][0][field] = value
            self.assertFalse(refresh.same_inputs(other, manifest, report))
        self.assertFalse(refresh.same_inputs({**plan, "asOf": "2026-12-31"}, manifest, report))
        self.assertFalse(refresh.same_inputs({**plan, "componentHashes": {"a": "d" * 64}}, manifest, report))
        self.assertFalse(refresh.same_inputs({**plan, "boundary": {"sha256": "3" * 64}}, manifest, report))
        with TemporaryDirectory() as d:
            store = Path(d)
            self.assertTrue(refresh.needs_build(plan, store))
            release = manifest["release"]
            for directory in ("manifests", "receipts"):
                (store / "packed" / directory).mkdir(parents=True)
            write(store / "packed" / "manifests" / (release + ".json"), manifest)
            write(store / "packed" / "receipts" / (release + ".json"), report)
            for active, quarantined in [(release, []), (None, [release])]:
                write(store / "packed/state.json", {"active": active, "generations": [release], "quarantined": quarantined})
                self.assertFalse(refresh.needs_build(plan, store))

    def test_adoption_rejects_another_branch_artifact_checksum_or_expired_result(self):
        source = "b" * 40
        digest = "sha256:" + "c" * 64
        request = {"run": 445, "artifact": 577, "sourceCommit": source, "artifactDigest": digest,
                   "release": "2026-06-30-" + "a" * 20}
        run = {"id": 445, "conclusion": "success", "head_sha": source, "event": "push",
               "repository": {"full_name": "prowebpromo/kamptrail"}, "head_branch": "once/fcc-conus48-20261122",
               "path": ".github/workflows/initial-fcc-conus48.yml"}
        artifact = {"id": 577, "name": "fcc-conus48-candidate", "expired": False,
                    "digest": digest, "workflow_run": {"id": 445, "head_sha": source}}
        refresh.request_identity(request, run, artifact)
        with self.assertRaises(ValueError):
            refresh.request_identity(request, {**run, "head_branch": "main"}, artifact)
        for field, value in [("id", 578), ("digest", "sha256:" + "2" * 64), ("expired", True),
                             ("name", "arbitrary"), ("workflow_run", {"id": 446, "head_sha": source})]:
            with self.assertRaises(ValueError):
                refresh.request_identity(request, run, {**artifact, field: value})

    def test_adopted_generation_must_match_trusted_component_bytes(self):
        source = "3" * 40
        release = "2026-06-30-" + "b" * 20
        q = {"sourceCommit": source, "componentHashes": refresh.current_components(), "release": release,
             "scope": SCOPE, "archives": 144, "explicitlyMissing": []}
        refresh.verify_candidate(q, source, release)
        for altered in [{"sourceCommit": "f" * 40}, {"componentHashes": {}}, {"archives": 143},
                        {"explicitlyMissing": [{}]}, {"release": "2026-06-30-" + "a" * 20}]:
            with self.assertRaises(ValueError):
                refresh.verify_candidate({**q, **altered}, source, release)


if __name__ == "__main__":
    unittest.main()
