# Hotfix v2.90.4 — Copilot Coding Agent Enablement Detector

> **Status**: Drafted, awaiting hardening (Step 2)
> **Tracks**: Code (introspection check) + Tests + Docs
> **Estimated cost**: $0.10–$0.30 (3 slices)
> **VERSION target**: 2.90.3 → 2.90.4 (patch)
> **Depends on**: None directly

---

## Feature Specification

### Problem Statement

The Phase GITHUB-C dogfood capture (May 5) created a real GitHub Issue (#150) via `gh issue create --assignee @copilot`, but the assignee field came back empty. Copilot Coding Agent didn't pick up the issue. Most likely cause: **Copilot Coding Agent is not enabled at the repository level for the user account**, so `--assignee @copilot` is silently dropped.

The user has no warning of this until they wait for the polling timeout (default 30 min) and see "PR not found". A pre-flight check would catch it immediately.

This hotfix adds a check to `inspectGithubStack()` (the function backing `pforge github status` / `forge_github_status`) that probes whether `@copilot` is an assignable user on the configured remote. If not, returns `warn` with a fix-hint pointing at GitHub's docs for enabling Copilot Coding Agent on a repo.

The probe is **opt-in via `--gh-token`** so it doesn't run on every `pforge github status` invocation (avoids GitHub API calls in the hot path). When the orchestrator's pre-flight runs before a `--worker copilot-coding-agent` dispatch, it always invokes the probe (because at that point the user has clearly committed to using the worker and a 1-API-call cost is acceptable).

### User Scenarios

**Scenario 1: User runs `pforge github status` (no token)**
1. The 8 default checks run (current behavior).
2. The new copilot-coding-agent check returns `na` with detail "skipped — pass --gh-token to probe".
3. No behavior change for users who don't care about the dispatch path.

**Scenario 2: User runs `pforge github status --gh-token`**
1. All 8 default checks run + the new copilot-coding-agent probe.
2. Probe calls `gh api repos/<owner>/<repo>/assignees --jq 'map(select(.login=="copilot")) | length'`.
3. If returns `1` → `pass` ("@copilot is assignable on this repo").
4. If returns `0` → `warn` ("Copilot Coding Agent not enabled — `--assignee @copilot` will be silently dropped"). fixHint: link to GitHub docs.

**Scenario 3: Pre-flight before `pforge run-plan --worker copilot-coding-agent`**
1. Orchestrator's existing pre-flight (Phase B Slice 3) calls `inspectGithubStack(cwd, { ghToken: true })` automatically when worker is `copilot-coding-agent`.
2. The probe runs.
3. If `warn` → orchestrator promotes to `fail` and exits with the fix-hint before any issue is created.

### Acceptance Criteria

- [ ] **MUST**: New check `copilot-coding-agent-assignable` added to `inspectGithubStack` checks array (after `gh-cli`, before extras).
- [ ] **MUST**: Without a token, returns `{ status: "na", detail: "skipped — pass --gh-token to probe" }`.
- [ ] **MUST**: With a token, calls `gh api repos/<owner>/<repo>/assignees` filtering for `login === "copilot"`. Owner/repo extracted from the github-remote URL.
- [ ] **MUST**: Returns `pass` if Copilot is assignable, `warn` if not, `fail` only on API error (not on Copilot-not-enabled — that's a known state, not a tool error).
- [ ] **MUST**: Orchestrator's `--worker copilot-coding-agent` pre-flight ALWAYS calls `inspectGithubStack(cwd, { ghToken: true })` and treats the new check's `warn` as a hard fail (with the fix-hint surfaced).
- [ ] **MUST**: New vitest cases in `pforge-mcp/tests/github-introspect-copilot-agent.test.mjs` cover: pass, warn, na (no token), fail (API error). Use a mock-`gh` from the existing test helpers.
- [ ] **MUST**: Existing `github-introspect.test.mjs` cases still pass.
- [ ] **MUST**: Documentation in the GitHub-stack chapter Section 3 (Dispatching to Copilot Coding Agent) gains a "Pre-flight checks" subsection mentioning the new probe.
- [ ] **SHOULD**: `pforge github status --gh-token --json` includes the new check in its structured output.

### Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Repo not on GitHub | The new check returns `na` (it depends on `github-remote` passing, which it doesn't here). |
| Token lacks `repo` scope | API returns 401/403; check returns `fail` with fix-hint about token scopes. |
| Org-level Copilot subscription not active | API returns 200 but `copilot` not in the assignees list; returns `warn` (the same UX as repo-level disable). |
| Multiple github.com remotes (e.g. fork + upstream) | Probe targets the `origin` remote. Hardener decides if non-origin should also probe. |
| Network failure during probe | `fail` with detail "could not reach GitHub API"; fix-hint suggests retry. |
| User invokes `pforge run-plan --worker copilot-coding-agent` without a `gh` token logged in | `gh-cli` check fails first; the new check never runs. |

### Out of Scope

- Auto-enabling Copilot Coding Agent (requires human consent via GitHub UI).
- Probing other agent platforms (Claude Code, Codex, Cursor) — those don't have an analogous repo-level probe.
- Cache the probe result (the API call is cheap and freshness matters).
- Distinguishing between "Copilot enabled but not assignable to this user" vs "Copilot not enabled at all". The fix-hint covers both.

---

## Scope Contract

### Inputs
- [pforge-mcp/github-introspect.mjs](../../pforge-mcp/github-introspect.mjs) — `inspectGithubStack`
- [pforge-mcp/orchestrator.mjs](../../pforge-mcp/orchestrator.mjs) — pre-flight in copilot-coding-agent dispatch (~line 3626)

### Outputs
- **Modified**: `pforge-mcp/github-introspect.mjs`
- **Modified**: `pforge-mcp/orchestrator.mjs` (pre-flight invocation tweak)
- **New**: `pforge-mcp/tests/github-introspect-copilot-agent.test.mjs`
- **Modified**: `docs/manual/plan-forge-on-the-github-stack.html` (Section 3 subsection)
- **Modified**: `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`

### Forbidden Actions
- ❌ Modifying any other check in `inspectGithubStack`
- ❌ Adding the probe to the no-token default path
- ❌ Caching the probe result

---

## Slice Plan

### Slice 1 — Probe + check integration
**Files in scope**: `pforge-mcp/github-introspect.mjs`
**Validation gate**:
```bash
node -e "const m=await import('./pforge-mcp/github-introspect.mjs'); const r=m.inspectGithubStack('.'); const c=r.checks.find(x=>x.id==='copilot-coding-agent-assignable'); if(!c){console.error('check not registered');process.exit(1)} if(c.status!=='na'){console.error('expected na without token, got '+c.status);process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0.10

### Slice 2 — Orchestrator pre-flight integration + tests
**Files in scope**: `pforge-mcp/orchestrator.mjs`, `pforge-mcp/tests/github-introspect-copilot-agent.test.mjs`
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/github-introspect-copilot-agent.test.mjs
```
**Estimated cost**: $0.15

### Slice 3 — Section 3 docs subsection + version + CHANGELOG
**Files in scope**: `docs/manual/plan-forge-on-the-github-stack.html`, `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`
**Validation gate**:
```bash
node -e "const fs=require('fs'); const v=fs.readFileSync('VERSION','utf8').trim(); const cl=fs.readFileSync('CHANGELOG.md','utf8'); const html=fs.readFileSync('docs/manual/plan-forge-on-the-github-stack.html','utf8'); const checks={version:v==='2.90.4', changelog:/2\.90\.4/.test(cl) && /assignable|copilot-coding-agent-assignable/i.test(cl), section3:/Pre-flight checks/i.test(html) && /assignable/i.test(html)}; const failed=Object.entries(checks).filter(([_,v])=>!v); if(failed.length){console.error('failed:',failed.map(([k])=>k).join(','));process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0.10

---

## Branch Strategy
- Branch: `hotfix/v2.90.4-copilot-agent-probe`
- Base: `master` (after v2.90.3)

## Rollback Plan
- The probe only runs with `--gh-token` — without it, current behavior preserved.
- Pre-flight integration: a single conditional in `runPlan`'s copilot-coding-agent branch.
- Full rollback: `git revert <merge-commit>`.
