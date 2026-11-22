#!/usr/bin/env python3
"""Compare selected FCC source versions and authenticate a cross-run adoption."""
import argparse
import os
from pathlib import Path
import re

from qualify_fcc_national import COMPONENTS, CONUS48, PROVIDERS, SCOPE, file_hash, read, require

SCRIPT = Path(__file__).resolve().parent
RELEASE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-f0-9]{20}")
SHA = re.compile(r"[0-9a-f]{40}")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")


def current_components():
    return {path: file_hash(SCRIPT / path) for path in COMPONENTS}


def selected_sources(manifest):
    return {(carrier["id"], region["id"]): region for carrier in manifest["carriers"]
            for region in carrier["regions"]}


def same_inputs(plan, manifest, report):
    if manifest["asOf"] != plan["asOf"] or report["scope"] != SCOPE:
        return False
    if report["componentHashes"] != plan["componentHashes"]:
        return False
    old = selected_sources(manifest)
    expected = {(carrier, state) for carrier in PROVIDERS for state in CONUS48}
    planned = {(row["id"], row["region"]): row for lane in plan["lanes"] for row in lane}
    require(set(planned) == expected, "Incomplete lower-48 source plan.")
    if set(old) != expected:
        return False
    for key, row in planned.items():
        region = old[key]
        source = region["source"]
        if (source["fileId"], source["providerId"], source["sourceFile"], source["records"]) != (
                row["fileId"], row["providerId"], row["sourceFile"], row["recordCount"]):
            return False
        if region["boundary"]["sha256"] != plan["boundary"]["sha256"]:
            return False
    return True


def needs_build(plan, store):
    state_path = store / "packed" / "state.json"
    if not state_path.exists():
        return True
    state = read(state_path)
    retained = state["generations"]
    require(all(RELEASE.fullmatch(release) for release in retained), "Invalid retained release ID.")
    require(state["active"] is None or state["active"] in retained, "Unexpected active release.")
    for release in retained:
        if release != state["active"] and release not in state["quarantined"]:
            continue
        manifest = read(store / "packed" / "manifests" / (release + ".json"))
        report = read(store / "packed" / "receipts" / (release + ".json"))
        require(manifest["release"] == report["release"] == release, "Retained source identity mismatch.")
        if same_inputs(plan, manifest, report):
            print("The selected catalog, boundary and builder match a retained active or quarantined filing.")
            return False
    return True


def request_identity(request, run, artifact):
    require(type(request["run"]) is int and request["run"] > 0 and
            type(request["artifact"]) is int and request["artifact"] > 0 and
            SHA.fullmatch(request["sourceCommit"]) and DIGEST.fullmatch(request["artifactDigest"]) and
            RELEASE.fullmatch(request["release"]), "Invalid adoption request.")
    require(run["id"] == request["run"] and run["conclusion"] == "success" and
            run["head_sha"] == request["sourceCommit"] and run["repository"]["full_name"] == "prowebpromo/kamptrail"
            and run["path"] == ".github/workflows/initial-fcc-conus48.yml"
            and run["event"] == "push" and run["head_branch"] == "once/fcc-conus48-20261122",
            "Adoption does not refer to the approved successful producer.")
    require(artifact["id"] == request["artifact"] and artifact["name"] == "fcc-conus48-candidate"
            and not artifact["expired"] and artifact["digest"] == request["artifactDigest"]
            and artifact["workflow_run"]["id"] == run["id"]
            and artifact["workflow_run"]["head_sha"] == run["head_sha"],
            "Adoption artifact does not match the exact producer and digest.")


def verify_candidate(report, source_commit, release=None):
    require(SHA.fullmatch(source_commit) and report["sourceCommit"] == source_commit,
            "Qualification was produced by a different commit.")
    require(report["componentHashes"] == current_components(),
            "Qualification source or rendering code has changed. Build a fresh candidate.")
    require(report["scope"] == SCOPE and not report["explicitlyMissing"] and report["archives"] == 144,
            "Candidate is outside the complete lower-48 scope.")
    if release:
        require(RELEASE.fullmatch(release) and report["release"] == release, "Unexpected adoption release.")


def outputs(**values):
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
        for key, value in values.items():
            print(f"{key}={value}", file=stream)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    changed = subs.add_parser("changed")
    changed.add_argument("plan", type=Path)
    changed.add_argument("store", type=Path)
    adoption = subs.add_parser("adopt")
    adoption.add_argument("request", type=Path)
    adoption.add_argument("run", type=Path)
    adoption.add_argument("artifact", type=Path)
    verify = subs.add_parser("verify")
    verify.add_argument("qualification", type=Path)
    verify.add_argument("--source-commit", required=True)
    verify.add_argument("--release", default="")
    args = parser.parse_args()
    if args.command == "changed":
        changed = needs_build(read(args.plan), args.store)
        outputs(changed="true" if changed else "false")
    elif args.command == "adopt":
        request = read(args.request)
        request_identity(request, read(args.run), read(args.artifact))
        outputs(run=request["run"], artifact=request["artifact"],
                source=request["sourceCommit"], release=request["release"])
    else:
        verify_candidate(read(args.qualification), args.source_commit, args.release)


if __name__ == "__main__":
    main()
