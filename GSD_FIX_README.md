# Get Shit Done (GSD) Installation Fix

## Problem
After running `npx get-shit-done-cc --global`, the installation appeared successful but the `/gsd:help` command failed with a "failed to load session" error.

## Root Cause
The initial GSD installation did not properly create the required files in the `~/.claude/` directory, despite showing a success message. This caused Claude Code to fail when attempting to load the GSD commands.

## Solution
The GSD package was reinstalled using:

```bash
npx get-shit-done-cc@latest --global
```

This second installation successfully created all required files:

### Installed Components

1. **Commands** (`~/.claude/commands/gsd/`):
   - help.md
   - new-project.md
   - plan-phase.md
   - execute-phase.md
   - verify-work.md
   - And 19 other command files

2. **Agents** (`~/.claude/agents/`):
   - gsd-planner.md
   - gsd-executor.md
   - gsd-debugger.md
   - gsd-verifier.md
   - And 6 other specialized agents

3. **Hooks** (`~/.claude/hooks/`):
   - gsd-check-update.js (SessionStart hook)
   - statusline.js (Status line display)

4. **Templates & Workflows** (`~/.claude/get-shit-done/`):
   - Project templates
   - Research templates
   - Workflow definitions

5. **Configuration Updates** (`~/.claude/settings.json`):
   - Added SessionStart hook for update checks
   - Configured status line integration

## Verification
To verify the installation is working:

```bash
# Check for GSD files
ls -la ~/.claude/commands/gsd/
ls -la ~/.claude/agents/ | grep gsd

# Check version
cat ~/.claude/get-shit-done/VERSION
```

## Usage
Now you can use GSD commands in Claude Code:

- `/gsd:help` - Show all available commands
- `/gsd:new-project` - Initialize a new project
- `/gsd:plan-phase N` - Plan a specific phase
- `/gsd:execute-phase N` - Execute a phase
- `/gsd:whats-new` - Check for updates

## Important Notes

1. **Restart Claude Code**: If you continue to see errors, restart Claude Code to ensure it picks up the new commands.

2. **Container Environments**: If running in a container or non-standard environment, you may need to set the config directory:
   ```bash
   CLAUDE_CONFIG_DIR=/path/to/.claude npx get-shit-done-cc --global
   ```

3. **Updates**: To update GSD in the future:
   ```bash
   npx get-shit-done-cc@latest --global
   ```

## Version
- GSD Version: 1.6.3
- Installation Date: 2026-01-17

## References
- [GSD GitHub Repository](https://github.com/glittercowboy/get-shit-done)
- [Claude Code Documentation](https://code.claude.com/docs)
