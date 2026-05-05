# PHASE-GITHUB-C Dogfood Runbook — "Built with Plan-Forge"

> **Status**: Manual operation. **DO NOT run this as part of `pforge run-plan` autonomous execution.**
> **Target repo**: `srnichols/plan-forge` (LIVE — this dispatches real GitHub Issues)
> **Worker**: Copilot Coding Agent (`gh-copilot` worker, `--worker copilot-coding-agent`)
> **Estimated cost**: $0 (Copilot Enterprise subscription) + N issues + N PRs against the live repo
> **Estimated time**: 30–90 min (depends on Copilot Coding Agent response latency per slice)

---

## Why this is a separate runbook (not a slice)

Phase GITHUB-C Slice 5 was deferred from autonomous execution because **it dispatches real GitHub Issues against the live `srnichols/plan-forge` repo and assigns them to `@copilot`**. Every dispatched slice creates:

- 1 GitHub Issue (titled, assigned, labelled)
- 1 GitHub branch (`copilot/issue-N`)
- 1 GitHub Pull Request (when Copilot Coding Agent finishes the slice)

These artifacts are visible to anyone watching the repo and produce notification emails. They are **not** safe to run from inside an unattended `pforge run-plan` invocation without explicit human review.

---

## Pre-requisites

Before running this runbook:

- [ ] You are sitting at the keyboard with at least 90 minutes available.
- [ ] `pforge github status` reports all-pass (or known-warn) on this repo.
- [ ] `gh auth status` shows you authenticated as the user who owns or has write access to `srnichols/plan-forge`.
- [ ] Working tree is clean (`git status --porcelain` is empty).
- [ ] You have read the existing Section 9 of [docs/manual/plan-forge-on-the-github-stack.html](../manual/plan-forge-on-the-github-stack.html) and understand what artifacts it references.
- [ ] You have a plan to delete the issues + PRs created by this runbook if the dogfood capture fails.

---

## The dogfood plan

The captured artifact for Section 9 is intentionally tiny — one issue, one PR. The point is to demonstrate that the dispatch flow described in Section 3 (Copilot Coding Agent) actually works end-to-end against this repo, not to add real product features.

Recommended dispatch target: **fix a typo in this very runbook**, or **bump a comment in the chapter footer**. Something obviously safe to revert if needed.

Concrete plan file (create as `docs/plans/Phase-GITHUB-C-DOGFOOD-PLAN.md` before running):

```markdown
# Phase GITHUB-C Dogfood — single live dispatch

> **Status**: Created on demand by the dogfood runbook. Single-slice plan.
> **Tracks**: Documentation only — typo fix or comment bump for capture purposes.

## Scope Contract
### Inputs
- docs/manual/plan-forge-on-the-github-stack.html (target: a single comment line)

### Outputs
- 1 modified line in the chapter (purely cosmetic)
- 1 GitHub Issue (created by dispatchSlice)
- 1 GitHub PR (created by Copilot Coding Agent)
- 1 captured trajectory under `.forge/trajectories/Phase-GITHUB-C-DOGFOOD-PLAN/slice-1.md`

### Forbidden Actions
- ❌ Modifying any file outside `docs/manual/plan-forge-on-the-github-stack.html`
- ❌ Modifying the section content (only the dogfood-marker comment)

## Slice Plan

### Slice 1 — Update the dogfood marker comment
**Files in scope**: `docs/manual/plan-forge-on-the-github-stack.html`
**Goal**: Update the comment marker `<!-- DOGFOOD-MARKER: pending -->` to `<!-- DOGFOOD-MARKER: captured <ISO-timestamp> --> ` near Section 9. No content change.
**Validation gate**:
\`\`\`bash
node -e "const html=require('fs').readFileSync('docs/manual/plan-forge-on-the-github-stack.html','utf8'); if(!/DOGFOOD-MARKER: captured \d{4}-/.test(html)){console.error('marker not updated');process.exit(1)} console.log('ok')"
\`\`\`
```

(The marker comment needs to be added to the chapter as a one-line setup step; see "Setup" below.)

---

## Setup (one-time, before first dogfood capture)

1. Add a marker comment to the chapter so the worker has a tiny, well-defined target:

   ```html
   <!-- DOGFOOD-MARKER: pending -->
   ```

   Place it directly above the `<h2 id="built-with-plan-forge">` heading in `docs/manual/plan-forge-on-the-github-stack.html`.

2. Commit the marker:

   ```powershell
   git add docs/manual/plan-forge-on-the-github-stack.html
   git commit -m "chore(dogfood): add DOGFOOD-MARKER comment for Section 9 capture"
   git push origin master
   ```

3. Create the plan file from the template above at `docs/plans/Phase-GITHUB-C-DOGFOOD-PLAN.md`.

4. Verify the plan parses cleanly:

   ```powershell
   pforge analyze docs/plans/Phase-GITHUB-C-DOGFOOD-PLAN.md
   ```

---

## Capture procedure

1. **Open the dashboard** so you can watch the dispatch in real time:

   ```powershell
   start http://localhost:3100/dashboard/
   ```

   Make sure the MCP server is running (`node pforge-mcp/server.mjs --dashboard-only` if not).

2. **Estimate first** (no dispatch yet):

   ```powershell
   pforge run-plan docs/plans/Phase-GITHUB-C-DOGFOOD-PLAN.md --estimate `
     --worker copilot-coding-agent `
     --manual-import --manual-import-source human `
     --manual-import-reason "Phase C Section 9 dogfood capture"
   ```

   Confirm the output reports `1 issue + 1 PR; $0 API cost (subscription)`.

3. **Dispatch live**:

   ```powershell
   pforge run-plan docs/plans/Phase-GITHUB-C-DOGFOOD-PLAN.md `
     --worker copilot-coding-agent `
     --confirm-live-dispatch `
     --manual-import --manual-import-source human `
     --manual-import-reason "Phase C Section 9 dogfood capture"
   ```

   The `--confirm-live-dispatch` flag is required for the `copilot-coding-agent` worker. Without it, the dispatcher refuses to call `gh issue create`.

4. **Monitor** the dashboard's Runs tab. Each slice shows:
   - Issue URL (clickable)
   - PR URL (appears when Copilot Coding Agent opens it)
   - PR status (open / merged / closed)
   - Trajectory link

5. **Wait for the PR to materialize.** Copilot Coding Agent typically opens a PR within 5–15 minutes of issue creation. If polling times out (default 30 min), the trajectory will mark the slice failed; the issue and any partial branch remain on the repo for manual cleanup.

6. **Review the PR** in the GitHub UI before merging. The dogfood is a typo fix; the PR should be a 1-line diff.

7. **Merge the PR** via the GitHub UI (or `gh pr merge <N> --squash`).

8. **Capture the trajectory link.** Copy the trajectory URL from the dashboard (or from `.forge/runs/<timestamp>/run.json` → `sliceResults[0].trajectoryPath`).

---

## After the capture

1. Update Section 9 of the chapter (currently links to `<em>captured at run time</em>`) to point at the real trajectory artifact:

   ```html
   <!-- replace -->
   <em>captured at run time — see runbook for the trajectory link</em>
   <!-- with -->
   <a href=".forge/trajectories/Phase-GITHUB-C-DOGFOOD-PLAN/slice-1.md" class="text-amber-400 hover:underline">slice-1.md</a> · Issue <a href="https://github.com/srnichols/plan-forge/issues/<N>">#<N></a> · PR <a href="https://github.com/srnichols/plan-forge/pull/<M>">#<M></a>
   ```

2. Commit the update:

   ```powershell
   git add docs/manual/plan-forge-on-the-github-stack.html
   git commit -m "docs(github-stack): Section 9 — link captured dogfood trajectory"
   git push origin master
   ```

3. Update VERSION (next patch bump) and CHANGELOG entry.

---

## Rollback procedure

If the capture fails or you want to undo:

1. **Close the GitHub Issue** without merging:

   ```powershell
   gh issue close <N> --comment "dogfood capture aborted"
   ```

2. **Delete the Copilot branch** if it was created:

   ```powershell
   gh api -X DELETE repos/srnichols/plan-forge/git/refs/heads/copilot/issue-<N>
   ```

3. **Close the PR** if it was opened:

   ```powershell
   gh pr close <M> --delete-branch
   ```

4. **Revert the marker commit** if you want to start clean:

   ```powershell
   git revert <marker-commit-sha>
   git push origin master
   ```

5. The trajectory under `.forge/trajectories/` can be deleted directly:

   ```powershell
   Remove-Item -Recurse .forge/trajectories/Phase-GITHUB-C-DOGFOOD-PLAN
   ```

---

## What success looks like

- 1 GitHub Issue closed (merged via PR) with `@copilot` as the assignee on the original
- 1 GitHub PR merged with a 1-line typo fix
- 1 trajectory file in `.forge/trajectories/Phase-GITHUB-C-DOGFOOD-PLAN/slice-1.md` showing the full dispatch flow
- 1 dashboard screenshot (optional) of the Runs tab with the green slice and clickable issue/PR links
- Section 9 of the chapter updated with real links instead of placeholder text

The total artifact footprint on the repo is intentionally small. The point is to demonstrate the dispatch pipeline works, not to add product features.
