# Phase-59: Multi-session Crucible Interview

> **Lane**: full  
> **Source**: human  
> **Status**: finalized

## Raw Idea

Multi-session Crucible Interview

## Problem & Success Metric

**Problem**: Agents lose smelt context when the tab closes; restoring the interview is manual

**Success metric**: Smelt state persists across sessions; interview resumes from last question

## Stack Boundary

Node.js 18+ ESM; no TypeScript build step; PowerShell 7+ and Bash 4+ for entry points

## Data Model

No new tables; smelt state serialised to .forge/crucible/*.json

## API Surface

forge_crucible_resume MCP tool; crucible_session_load CLI flag

## Security Posture

No new secrets or permissions; smelt files are local only

## Scope Contract

**In scope**:

- crucible-store.mjs
- crucible-server.mjs
- crucible-interview.mjs

**Out of scope**:

- Dashboard UI changes
- OpenBrain sync

## Slices

_Estimated: 4 slices. Expand each below during Plan Hardener step._

> Slice template:
>
> ```
> ### Slice N — <name>
> Build command: <cmd>
> Test command:  <cmd>
> Tasks:         <list>
> Files:         <manifest>
> ```

## Validation Gates

{{TBD: validation-gates}}

**Tests**: {{TBD: tests}}

## Stop Conditions

- Validation gate fails and root cause is not identified within 30 minutes
- A slice drifts past its declared Scope Contract
- A forbidden action (see Anti-patterns) is about to be introduced
- Token budget for this phase is exceeded by more than 25%

## Rollback

git revert HEAD~4..HEAD && rm -rf .forge/crucible/

## Anti-patterns & Forbidden Actions

- no TypeScript build step
- no direct writes to .forge/runs/ from a tool

## Change Manifest

- crucible-store.mjs
- crucible-server.mjs
- crucible-interview.mjs

## Interview Log

1. **feature-name** — Multi-session Crucible Interview
2. **user-problem** — Agents lose smelt context when the tab closes; restoring the interview is manual
3. **success-metric** — Smelt state persists across sessions; interview resumes from last question
4. **stack-boundary** — Node.js 18+ ESM; no TypeScript build step; PowerShell 7+ and Bash 4+ for entry points
5. **data-model** — No new tables; smelt state serialised to .forge/crucible/*.json
6. **api-surface** — forge_crucible_resume MCP tool; crucible_session_load CLI flag
7. **security-posture** — No new secrets or permissions; smelt files are local only
8. **scope-in** — crucible-store.mjs
crucible-server.mjs
crucible-interview.mjs
9. **scope-out** — Dashboard UI changes, OpenBrain sync
10. **forbidden-actions** — no TypeScript build step, no direct writes to .forge/runs/ from a tool
11. **slice-count** — 4
12. **rollback-plan** — git revert HEAD~4..HEAD && rm -rf .forge/crucible/
