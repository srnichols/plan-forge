---
version: 1
id: pforge-weekly-health
name: "Plan Forge: weekly setup health"
description: Check the Plan Forge installation, setup files and leftover TODO markers. Read-only.
schedule:
  kind: cron
  expression: "0 15 * * 5"
  timeZone: local
---
Use the Plan Forge MCP server.

1. Call forge_smith to check the environment and installation.
2. Call forge_validate to check the setup files.
3. Call forge_sweep to find TODO, FIXME and stub markers.
4. Reply with every failed check and how to fix it, then the sweep markers grouped by file, newest first.

Do not modify files, run pforge update, commit, or push. Report only.
