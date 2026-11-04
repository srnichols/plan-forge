# Phase GITHUB-C Dogfood — single live Copilot Coding Agent dispatch

> **Status**: Live dispatch plan. Created on demand by [the dogfood runbook](PHASE-GITHUB-C-DOGFOOD-RUNBOOK.md).
> **Single slice**: dispatches one issue against the live `srnichols/plan-forge` repo and waits for Copilot Coding Agent to open the resulting PR.
> **Risk**: LOW — the slice modifies a one-line HTML comment marker in the chapter footer. Reverting is a one-line revert.

---

## Feature Specification

### Problem Statement

Section 9 of [Appendix H — Plan Forge on the GitHub Stack](../manual/plan-forge-on-the-github-stack.html) claims "this chapter was written by Plan-Forge dispatching to Copilot Coding Agent." That claim needs to be backed by a captured artifact (issue + PR + trajectory) on the live repo, not just placeholder text. This single-slice plan exists to produce that artifact.

### User Scenario

1. The maintainer runs `pforge run-plan docs/plans/Phase-GITHUB-C-DOGFOOD-PLAN.md --worker copilot-coding-agent`.
2. Plan-Forge calls `gh issue create` with the slice goal as the issue body, assigning to `@copilot`.
3. Copilot Coding Agent picks up the issue, opens a branch `copilot/issue-N`, makes the one-line edit, and opens a PR.
4. Plan-Forge polls `gh pr list` until the PR appears, captures issue/PR numbers into the trajectory.
5. The maintainer reviews and merges the PR via the GitHub UI.
6. Section 9 of the chapter gets updated to link to the captured trajectory + issue + PR.

### Acceptance Criteria

- [ ] **MUST**: Exactly one GitHub Issue is created on `srnichols/plan-forge` with `@copilot` assigned.
- [ ] **MUST**: A trajectory artifact appears at `.forge/trajectories/Phase-GITHUB-C-DOGFOOD-PLAN/slice-1.md` containing the github block (issueNumber, issueUrl, prNumber, prUrl, prStatus).
- [ ] **MUST**: The DOGFOOD-MARKER comment in `docs/manual/plan-forge-on-the-github-stack.html` updates from `<!-- DOGFOOD-MARKER: pending -->` to `<!-- DOGFOOD-MARKER: captured <ISO-timestamp> -->`.
- [ ] **MUST**: The PR opened by Copilot Coding Agent is reviewable in the standard GitHub UI before merge.
- [ ] **SHOULD**: Total wall-clock from dispatch to PR-opened ≤ 30 minutes (the default poll timeout).

### Out of Scope

- Modifying any other file. The DOGFOOD-MARKER line is the only target.
- Auto-merging the PR. Human review remains required per Plan-Forge architecture-principles.
- Adding tests. The marker change is a one-line HTML comment; no behaviour change to test.

---

## Scope Contract

### Inputs
- `docs/manual/plan-forge-on-the-github-stack.html` — single line: `<!-- DOGFOOD-MARKER: pending -->`

### Outputs
- 1 GitHub Issue on `srnichols/plan-forge` (created by `dispatchSlice`)
- 1 GitHub PR on `srnichols/plan-forge` (opened by Copilot Coding Agent)
- 1 trajectory file at `.forge/trajectories/Phase-GITHUB-C-DOGFOOD-PLAN/slice-1.md`
- 1 modified line in the target HTML file (cosmetic comment update)

### Forbidden Actions
- ❌ Modifying any file outside `docs/manual/plan-forge-on-the-github-stack.html`
- ❌ Modifying any line in the chapter other than the DOGFOOD-MARKER comment
- ❌ Auto-merging the PR (human review required)
- ❌ Skipping the pre-flight `inspectGithubStack` check

---

## Slice Plan

### Slice 1 — Update the DOGFOOD-MARKER comment
**Files in scope**: `docs/manual/plan-forge-on-the-github-stack.html`
**Goal**: Update the single comment line `<!-- DOGFOOD-MARKER: pending -->` (located directly above the `<h2 id="built-with-plan-forge">` heading) to `<!-- DOGFOOD-MARKER: captured 2026-05-05T<HH:MM>Z -->`. Use the current UTC timestamp at minute precision. **Do not** modify any other line in the file — not the section title, not the table, not any prose. The change must be exactly one line of diff.
**Validation gate**:
```bash
node -e "const html=require('fs').readFileSync('docs/manual/plan-forge-on-the-github-stack.html','utf8'); if(!/DOGFOOD-MARKER: captured \d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(html)){console.error('marker not updated to captured timestamp');process.exit(1)} if(/DOGFOOD-MARKER: pending/.test(html)){console.error('pending marker still present');process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0 (Copilot Enterprise subscription)

---

## Branch Strategy

- The Copilot Coding Agent worker will create branch `copilot/issue-<N>` automatically.
- The PR targets `master`.
- After merge, the maintainer manually deletes the `copilot/issue-<N>` branch via the GitHub UI (or `gh pr merge --delete-branch`).

## Rollback Plan

If anything goes wrong:

```powershell
# 1. Close the issue without merging
gh issue close <N> --comment "dogfood capture aborted"

# 2. Close the PR (deletes branch)
gh pr close <M> --delete-branch

# 3. Revert the marker commit if needed
git revert <marker-commit-sha>
git push origin master
```

The DOGFOOD-MARKER line is a comment; reverting it has no behavioural impact on the chapter.
