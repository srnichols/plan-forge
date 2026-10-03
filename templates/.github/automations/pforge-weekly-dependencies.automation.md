---
version: 1
id: pforge-weekly-dependencies
name: "Plan Forge: weekly dependency check"
description: List vulnerable and outdated dependencies with suggested versions. Read-only.
schedule:
  kind: cron
  expression: "30 9 * * 1"
  timeZone: local
---
Use the Plan Forge MCP server. First call forge_tool_profile with {"load": ["liveguard"]}.

1. Call forge_dep_watch.
2. Reply with a table of vulnerable dependencies (package, current version, fixed version, advisory, severity), then outdated dependencies grouped by major, minor and patch updates.
3. Suggest an upgrade order, starting with security fixes that do not change the major version.

Do not change dependency manifests or lockfiles, commit, push, or open pull requests. Report only.
