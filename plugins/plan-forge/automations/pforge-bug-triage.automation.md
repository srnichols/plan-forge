---
version: 1
id: pforge-bug-triage
name: "Plan Forge: bug triage"
description: Propose routing for open bugs in the Plan Forge bug registry. Read-only.
schedule:
  kind: manual
---
Use the Plan Forge MCP server. First call forge_tool_profile with {"load": ["bugs"]}.

1. Call forge_bug_list for open bugs.
2. For each bug that has no owner or route yet, call forge_triage_route.
3. Reply with one line per bug: id, severity, title, and the proposed route with its reason. List duplicates together.

Do not change bug status, assign owners, edit code, or open issues. Report only.
