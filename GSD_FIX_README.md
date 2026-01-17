# Get Shit Done (GSD) Installation Fix

## Problem
After running `npx get-shit-done-cc --global`, the installation appeared successful but accessing `/gsd:help` at `https://claude.ai/code/gsd:help` resulted in a "failed to load session" error.

## Root Cause
The issue had two parts:
1. The `--global` installation installs to `~/.claude/` which is only accessible to the CLI version of Claude Code running locally
2. The **web version** of Claude Code at `claude.ai/code` requires GSD to be installed **locally** in the project's `./.claude/` directory and committed to the git repository for the web interface to access it

## Solution
For the **web version** of Claude Code, GSD must be installed **locally** in the project:

```bash
npx get-shit-done-cc@latest --local
```

This installs GSD to `./.claude/` in your project directory, which can then be committed to git and accessed by the web version.

### Installation created 92 files in `.claude/`:

### Installed Components

1. **Commands** (`.claude/commands/gsd/`):
   - help.md
   - new-project.md
   - plan-phase.md
   - execute-phase.md
   - verify-work.md
   - And 19 other command files

2. **Agents** (`.claude/agents/`):
   - gsd-planner.md
   - gsd-executor.md
   - gsd-debugger.md
   - gsd-verifier.md
   - And 6 other specialized agents

3. **Hooks** (`.claude/hooks/`):
   - gsd-check-update.js (SessionStart hook)
   - statusline.js (Status line display)

4. **Templates & Workflows** (`.claude/get-shit-done/`):
   - Project templates
   - Research templates
   - Workflow definitions

5. **Configuration Updates** (`.claude/settings.json`):
   - Added SessionStart hook for update checks
   - Configured status line integration

## Verification
To verify the installation is working:

```bash
# Check for GSD files in project directory
ls -la .claude/commands/gsd/
ls -la .claude/agents/
ls -la .claude/get-shit-done/

# Check version
cat .claude/get-shit-done/VERSION

# Verify files are committed
git status
```

## Usage
After the `.claude/` directory is committed and pushed, you can use GSD commands in the web version of Claude Code:

1. Go to `https://claude.ai/code` and open your kamptrail repository
2. Run GSD commands:
   - `/gsd:help` - Show all available commands
   - `/gsd:new-project` - Initialize a new project
   - `/gsd:plan-phase N` - Plan a specific phase
   - `/gsd:execute-phase N` - Execute a phase
   - `/gsd:whats-new` - Check for updates

## Important Notes

### Web vs CLI Versions

- **Web Version** (`claude.ai/code`): Use `--local` installation, commit `.claude/` to git
- **CLI Version** (terminal): Use `--global` installation to `~/.claude/`

### For Web Users

1. **The `.claude/` directory must be committed** to your git repository for the web version to access it
2. **Changes sync via git**: If you update GSD files, commit and push them
3. **No restart needed**: The web version picks up changes when you reload the page or start a new session

### Updates

To update GSD in the future for the web version:
```bash
npx get-shit-done-cc@latest --local
git add .claude/
git commit -m "Update GSD to latest version"
git push
```

## Version
- GSD Version: 1.6.3
- Installation Date: 2026-01-17

## References
- [GSD GitHub Repository](https://github.com/glittercowboy/get-shit-done)
- [Claude Code Documentation](https://code.claude.com/docs)
