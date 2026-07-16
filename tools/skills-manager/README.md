# Skills Manager

CLI for updating your custom claude.ai / Anthropic skills programmatically —
no pasting descriptions into the claude.ai settings UI. It drives the
Anthropic **Skills API** (`/v1/skills`, beta `skills-2025-10-02`) via the
official Python SDK.

Built to apply the trigger-description fixes from
[`docs/CLAUDE_SKILLS_AUDIT.md`](../../docs/CLAUDE_SKILLS_AUDIT.md); the 9
fixes ship in [`audit_fixes.json`](audit_fixes.json), keyed to your skill IDs.

## Setup

```bash
pip install anthropic pyyaml
export ANTHROPIC_API_KEY=sk-ant-...   # from console.anthropic.com, same account as claude.ai
```

## Apply the audit fixes

```bash
# 1. Verify the API sees your skills (IDs should match audit_fixes.json)
python skills_manager.py list

# 2. Preview — downloads each skill, patches SKILL.md in memory, uploads nothing
python skills_manager.py apply-audit --dry-run

# 3. Apply — creates one new skill version per fixed skill
python skills_manager.py apply-audit
```

Each update downloads the skill's latest version bundle, rewrites **only** the
`description:` field in SKILL.md's frontmatter (validated to parse cleanly,
leave every other frontmatter key untouched, and stay under the 1024-character
limit), and uploads it as a new version. Skill bodies and reference files are
carried over byte-for-byte. Old versions remain available for rollback via the
Skills API.

## Other commands

```bash
python skills_manager.py pull skill_01HKBLk7Ahrfomf24GzGhSXh          # download files (also how you export bodies for a future audit)
python skills_manager.py update-description SKILL_ID --file new-desc.txt
python skills_manager.py update-description SKILL_ID --text "..." --dry-run
```

## Troubleshooting

- **`list` returns nothing / apply-audit reports "not found":** the Skills API
  serves the organization your API key belongs to. If your custom skills were
  uploaded through claude.ai and your Console org is separate, the API can't
  see them — create the key under the same account/org as your claude.ai
  workspace. If they still don't appear, the claude.ai Settings → Capabilities
  → Skills UI is the fallback; the exact texts to paste are in
  `docs/CLAUDE_SKILLS_AUDIT.md`.
- **ID drift:** `apply-audit` matches by skill ID first and falls back to the
  skill name from the live listing, so re-uploaded skills with new IDs still
  resolve.
