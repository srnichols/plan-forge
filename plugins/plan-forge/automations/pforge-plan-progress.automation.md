---
version: 1
id: pforge-plan-progress
name: "Plan Forge: plan progress and cost"
description: Summarise plan progress, failed slices and spend. Read-only.
schedule:
  kind: cron
  expression: "0 17 * * *"
  timeZone: local
---
Use the Plan Forge MCP server.

1. Call forge_plan_status and forge_cost_report.
2. For each slice that failed in the most recent runs, call forge_diagnose and summarise the cause in one sentence.
3. Reply with: plans in progress and their next slice, slices that failed and why, and spend for today and this month by model.

Do not start, resume or abort plan runs, and do not modify files. Report only.
