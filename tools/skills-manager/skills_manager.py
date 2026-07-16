#!/usr/bin/env python3
"""Manage claude.ai / Anthropic API custom skills from the command line.

Built to apply the fixes from docs/CLAUDE_SKILLS_AUDIT.md without pasting
descriptions into the claude.ai UI by hand, but general enough for any
skill-description update.

Commands:
  list                                List skills visible to your API org
  pull SKILL_ID [--out DIR]           Download a skill version's files
  update-description SKILL_ID         Set a new SKILL.md frontmatter description
      (--text "..." | --file PATH) [--version V] [--dry-run]
  apply-audit [--fixes PATH] [--dry-run]
                                      Apply every fix in audit_fixes.json

Auth: reads ANTHROPIC_API_KEY (or an `ant auth login` profile).

Requires: pip install anthropic pyyaml
"""

import argparse
import io
import json
import re
import sys
import zipfile
from pathlib import Path

import yaml
from anthropic import Anthropic, NotFoundError

MAX_DESCRIPTION_CHARS = 1024
DEFAULT_FIXES = Path(__file__).parent / "audit_fixes.json"


def client() -> Anthropic:
    return Anthropic()


def fail(msg: str) -> "NoReturn":  # noqa: F821
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------- list

def cmd_list(args):
    c = client()
    rows = []
    for s in c.beta.skills.list(source=args.source):
        rows.append(s)
        latest = getattr(s, "latest_version", None) or "?"
        title = getattr(s, "display_title", None) or getattr(s, "name", "?")
        print(f"{s.id}  v{latest}  {title}")
    if not rows:
        print(
            "No skills returned. If your skills were created in claude.ai and\n"
            "don't appear here, this API key's organization is not the one\n"
            "backing your claude.ai account — see README.md § Troubleshooting.",
            file=sys.stderr,
        )


# ---------------------------------------------------------------- pull

def _latest_version(c: Anthropic, skill_id: str) -> str:
    skill = c.beta.skills.retrieve(skill_id)
    latest = getattr(skill, "latest_version", None)
    if latest:
        return str(latest)
    versions = list(c.beta.skills.versions.list(skill_id, limit=1))
    if not versions:
        fail(f"skill {skill_id} has no versions")
    return str(versions[0].version)


def _download_files(c: Anthropic, skill_id: str, version: str) -> dict[str, bytes]:
    """Return {path_inside_zip: content} for a skill version."""
    blob = c.beta.skills.versions.download(version, skill_id=skill_id)
    files: dict[str, bytes] = {}
    with zipfile.ZipFile(io.BytesIO(blob.read())) as zf:
        for info in zf.infolist():
            if not info.is_dir():
                files[info.filename] = zf.read(info)
    if not files:
        fail(f"version {version} of {skill_id} contained no files")
    return files


def cmd_pull(args):
    c = client()
    version = args.version or _latest_version(c, args.skill_id)
    files = _download_files(c, args.skill_id, version)
    out = Path(args.out or f"{args.skill_id}-v{version}")
    for name, content in files.items():
        dest = (out / name).resolve()
        if not dest.is_relative_to(out.resolve()):
            fail(f"zip entry escapes output dir: {name}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)
    print(f"pulled {len(files)} file(s) from {args.skill_id} v{version} -> {out}/")


# ------------------------------------------------- update-description

def _skill_md_path(files: dict[str, bytes]) -> str:
    """SKILL.md sits at the root of the single top-level directory (or bare)."""
    candidates = [p for p in files if p.count("/") <= 1 and p.endswith("SKILL.md")]
    if not candidates:
        fail(f"no root SKILL.md found among: {sorted(files)[:10]}")
    return sorted(candidates, key=lambda p: p.count("/"))[0]


def _replace_description(skill_md: str, new_description: str) -> str:
    """Rewrite the frontmatter `description:` value, leaving everything else
    byte-identical. The new value is written as a YAML block literal so
    quotes/colons in the text can't corrupt the frontmatter."""
    m = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n", skill_md, re.DOTALL)
    if not m:
        fail("SKILL.md has no YAML frontmatter block")
    front = m.group(1)

    meta = yaml.safe_load(front)
    if not isinstance(meta, dict) or "description" not in meta:
        fail("frontmatter has no `description` key")

    # Span of the description entry: from its key line to the next top-level key.
    key_re = re.compile(r"^description:.*$", re.MULTILINE)
    km = key_re.search(front)
    if not km:
        fail("could not locate the `description:` line in frontmatter")
    next_key = re.compile(r"^[A-Za-z0-9_-]+:", re.MULTILINE).search(front, km.end())
    span_end = next_key.start() if next_key else len(front)

    indented = "\n".join(f"  {line}" if line else "" for line in new_description.splitlines())
    replacement = f"description: |-\n{indented}\n"
    new_front = front[: km.start()] + replacement + front[span_end:]

    # Verify the rebuilt frontmatter parses and carries exactly the new text.
    new_meta = yaml.safe_load(new_front)
    if new_meta.get("description") != new_description:
        fail("frontmatter rewrite failed validation; aborting without uploading")
    for key in meta:
        if key != "description" and new_meta.get(key) != meta.get(key):
            fail(f"frontmatter rewrite altered `{key}`; aborting without uploading")

    return "---\n" + new_front + "\n---\n" + skill_md[m.end():]


def _update_description(c: Anthropic, skill_id: str, new_description: str,
                        version: str | None, dry_run: bool) -> None:
    new_description = new_description.strip()
    if not new_description:
        fail("new description is empty")
    if len(new_description) > MAX_DESCRIPTION_CHARS:
        fail(f"description is {len(new_description)} chars (limit {MAX_DESCRIPTION_CHARS})")

    version = version or _latest_version(c, skill_id)
    files = _download_files(c, skill_id, version)
    md_path = _skill_md_path(files)
    old_md = files[md_path].decode("utf-8")
    new_md = _replace_description(old_md, new_description)

    if new_md == old_md:
        print(f"{skill_id}: description already up to date; no new version created")
        return
    if dry_run:
        print(f"{skill_id}: would create new version updating {md_path} "
              f"({len(new_description)} chars). Dry run — nothing uploaded.")
        return

    files[md_path] = new_md.encode("utf-8")
    upload = [(name, content) for name, content in sorted(files.items())]
    resp = c.beta.skills.versions.create(skill_id, files=upload)
    print(f"{skill_id}: created version {getattr(resp, 'version', '?')} "
          f"(from v{version}, {len(upload)} file(s))")


def cmd_update_description(args):
    if bool(args.text) == bool(args.file):
        fail("pass exactly one of --text or --file")
    text = args.text if args.text else Path(args.file).read_text(encoding="utf-8")
    _update_description(client(), args.skill_id, text, args.version, args.dry_run)


# ---------------------------------------------------------- apply-audit

def cmd_apply_audit(args):
    fixes_path = Path(args.fixes or DEFAULT_FIXES)
    fixes = json.loads(fixes_path.read_text(encoding="utf-8"))
    c = client()

    by_name = {}
    for s in c.beta.skills.list(source="custom"):
        title = getattr(s, "display_title", None) or getattr(s, "name", "")
        by_name[title] = s.id

    failures = []
    for fix in fixes:
        name, skill_id = fix["name"], fix.get("id")
        resolved = skill_id if skill_id else by_name.get(name)
        if resolved and skill_id and name in by_name and by_name[name] != skill_id:
            resolved = by_name[name]  # live listing wins over the pinned ID
        if resolved is None:
            failures.append(f"{name}: not found in this org's skill list")
            continue
        try:
            _update_description(c, resolved, fix["description"], None, args.dry_run)
        except NotFoundError:
            if skill_id and name in by_name:
                _update_description(c, by_name[name], fix["description"], None, args.dry_run)
            else:
                failures.append(f"{name}: skill id {resolved} not found via the API")
        except SystemExit:
            raise
        except Exception as e:  # keep going; report at the end
            failures.append(f"{name}: {e}")

    if failures:
        print("\nFailed:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        sys.exit(1)
    print("\nAll audit fixes applied." if not args.dry_run else "\nDry run complete.")


# --------------------------------------------------------------- main

def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("list", help="list skills")
    sp.add_argument("--source", default="custom", choices=["custom", "anthropic"])
    sp.set_defaults(func=cmd_list)

    sp = sub.add_parser("pull", help="download a skill version's files")
    sp.add_argument("skill_id")
    sp.add_argument("--version")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_pull)

    sp = sub.add_parser("update-description", help="update SKILL.md description")
    sp.add_argument("skill_id")
    sp.add_argument("--text")
    sp.add_argument("--file")
    sp.add_argument("--version", help="base version (default: latest)")
    sp.add_argument("--dry-run", action="store_true")
    sp.set_defaults(func=cmd_update_description)

    sp = sub.add_parser("apply-audit", help="apply all fixes from audit_fixes.json")
    sp.add_argument("--fixes")
    sp.add_argument("--dry-run", action="store_true")
    sp.set_defaults(func=cmd_apply_audit)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
