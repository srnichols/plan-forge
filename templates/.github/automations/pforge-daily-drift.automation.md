---
version: 1
id: pforge-daily-drift
name: "Plan Forge: daily drift check"
description: Report architecture drift, leaked secrets and environment-variable changes. Read-only.
schedule:
  kind: cron
  expression: "0 9 * * *"
  timeZone: local
---
Use the Plan Forge MCP server. First call forge_tool_profile with {"load": ["liveguard"]}.

1. Call forge_drift_report and note the drift score and how it changed since the previous report.
2. Call forge_secret_scan and forge_env_diff.
3. Reply with a short report: the drift score and trend, each new finding with its severity and file, and the environment keys that differ between environments.
4. If any finding is high or critical severity, start the report with "ACTION NEEDED".

Do not modify project files, commit, push, or open issues. Report only.
