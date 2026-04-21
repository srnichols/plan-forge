---
crucibleId: grandfathered-phase-28.3-self-repair-capture
lane: full
source: human
---

# Phase-28.3 — Self-Repair Capture (v2.62.2)

> **Target release**: v2.62.2
> **Status**: Draft — queued behind Phase-28.2 (do not launch until 28.2 ships v2.62.1)
> **Depends on**: Phase-28.2 tag `v2.62.1` landing on master.
> **Branch strategy**: Direct to `master`. Small, additive changes.
> **Session budget**: 6 slices in **1 session**.
> **Design posture**: Additive feature + one release. New MCP tool + new instruction file + a post-slice advisory. No changes to existing `tempering/bug-adapters/github.mjs` internals — we reuse its `createIssueViaGh` / `createIssueViaRest` primitives.

---

## Specification Source

**User request**: *"I notice that Plan-Forge runs sometime find Plan-Forge system or Plan doc errors/bugs and then fixes itself to keep moving forward. Can we add a capability so if Plan-Forge does do this it will send a GitHub Issues ticket so we can capture the problem they had as well as what they did to fix it. Anyway to help the system to know how to do this, while keeping a clean distinction between a bug found in code it is working on and fixing for the project it is forging."*

**Observed cases over the last two sessions that should have auto-filed meta-issues but didn't:**

1. **Phase-28 Slice 4** — plan gate used `grep -c | tr | { read n; [ "$n" -ge 1 ]; }` (pipe to brace-group); variable was invisible through Windows cmd→bash shim. Worker recognized and rewrote gate inline, slice passed. No record was created — this repro'd again in Slice 7 later.
2. **Phase-28.2 Slice 2** — plan gate `grep -q 'A' file || grep -q 'B' file` didn't match the worker's chosen identifier `isApiOnlyModel`. I hand-fixed the plan (`b8f04a3`) and retried. Same class of brittleness.
3. **Phase-28.1 Slice 6** — `runGate` 120 s timeout killed a 200 s vitest run; worker diagnosed correctly but the orchestrator marked the slice failed. We filed `BUG-gate-timeout-too-short.md` by hand.
4. **Phase-28 api-xai** — Grok worker emitted a TRAJECTORY narrative without writing files; escalation kicked in but no record was made that the entire api-xai worker path was broken. We filed `BUG-api-xai-worker-text-only.md` by hand.

In every case the agent *could* have filed the issue automatically if (a) the tool existed and (b) the instruction file told it when to fire.

---

## Feature Specification

### Problem Statement

Plan Forge already routes project bugs to GitHub Issues via `tempering/bug-adapters/github.mjs` — the scanners create issues in the repo resolved from `git remote get-url origin`. There is no channel for **meta bugs** — defects in Plan Forge itself (plan files, orchestrator, CLI, prompts, instruction files) discovered while Plan Forge is working. When the agent recognizes and works around such a defect, the knowledge is lost at the end of the slice. The next run repeats the mistake.

### Two routing lanes

| Lane | Target repo | Trigger | Label baseline | Who fires |
|---|---|---|---|---|
| **Project bug** (existing, unchanged) | `git remote get-url origin` of workspace | Tempering scanners, `forge_bug_file` | `bug`, severity | Tempering runner, manual tool calls |
| **Meta bug** (NEW) | `.forge.json#meta.selfRepairRepo` → fallback `srnichols/plan-forge` | Explicit `forge_meta_bug_file` tool call | `self-repair`, `plan-forge-internal` | Agent during slice execution |

The `self-repair` label is always applied to meta issues, even when the two repos resolve to the same address (workspace is Plan Forge itself). `gh issue list --label self-repair` always filters cleanly.

### Three canonical meta-bug classes

Workers must fire `forge_meta_bug_file` when one of these is true:

1. **Plan defect** — the plan file was wrong. Brittle validation gate, missing scope entry, wrong file path, over-narrow grep pattern, unsatisfiable dependency. The agent edited the plan or worked around the gate.
2. **Orchestrator / CLI defect** — runtime bug in Plan Forge. Gate timeout too short, spawn ENOENT on Windows, stash not popped after failed retry, estimator recommends a CLI-less model, etc. The agent worked around it or the retry loop papered over it.
3. **Prompt / template defect** — a step-N prompt emitted unsafe output (e.g. step-2 gate portability), an instruction file is missing a rule that would have prevented the problem, or a template placeholder wasn't expanded.

If none of the three apply, it's a **project bug** — use the existing `forge_bug_file` / tempering flow, not this tool.

### User Scenarios

1. **Agent mid-slice detects the plan's gate is brittle.** Agent edits the plan inline to fix the gate, runs the fixed gate, slice passes. Before emitting `PFORGE_TRAJECTORY:END`, agent calls `forge_meta_bug_file({ class: "plan-defect", title: "Phase-28.2 Slice 2 gate too narrow", symptom: "...", workaround: "...", slice: "2", plan: "docs/plans/Phase-28.2-...md" })`. Tool creates issue #N in `srnichols/plan-forge` with labels `self-repair` + `plan-defect`. URL appears in the slice result JSON and trajectory footer.

2. **Agent discovers runGate timeout fires before the test suite finishes.** Logs the symptom, escalates to a longer-running retry, slice passes on attempt 2. Agent files a meta-bug with class `orchestrator-defect`. Next time Plan Forge runs a vitest gate, the captured issue guides the next fix.

3. **Workspace `origin` is srnichols/plan-forge** (current situation). Meta lane fires — same repo as project lane. The `self-repair` label distinguishes them: `gh issue list -l bug` ≠ `gh issue list -l self-repair`.

4. **`.forge.json` has `meta.selfRepairRepo: "myteam/plan-forge-fork"`.** Meta issues route there instead of `srnichols/plan-forge`. User maintains a private fork and wants self-repair telemetry to flow to their own tracker.

5. **Agent doesn't recognize a self-repair situation.** Post-slice advisory scans the trajectory text for known markers (`"plan was wrong"`, `"gate pattern"`, `"workaround"`, `"fixed the plan"`, `"brittle gate"`, etc.). If any are present AND no `forge_meta_bug_file` call happened in the slice, a **non-blocking warning** is emitted to `events.log` and the slice result JSON. The agent is reminded. We never auto-file without an explicit call.

6. **Dedupe**: Before creating, the tool runs `gh issue list --label self-repair --search "in:title <stable-hash>"` against the meta repo. Matching open issue → add a comment with the new workaround and slice reference instead of creating a duplicate. 7-day window only; older matches → new issue.

### Acceptance Criteria

- **MUST**: New MCP tool `forge_meta_bug_file({ class, title, symptom, workaround, filePaths, slice, plan, severity })` exists and creates a GitHub issue in the resolved meta repo with the `self-repair` label plus a class-specific label (`plan-defect` | `orchestrator-defect` | `prompt-defect`). Returns `{ ok, issueNumber, url, deduped: bool }`.
- **MUST**: `resolveSelfRepairRepo(config)` helper returns `{ owner, repo }` from `.forge.json#meta.selfRepairRepo` or falls back to `srnichols/plan-forge`. Never infers from git remote — the meta lane is explicit by design.
- **MUST**: Tool dedupes by `sha256(class + normalize(title)).slice(0,12)` hash embedded in the issue title as `[self-repair:<hash>]`. Existing open issue with same hash → comment, not new issue.
- **MUST**: Tool auto-attaches the last 80 lines of the current slice trajectory (if `sliceId` provided) to the issue body under a `## Context` section.
- **MUST**: A **non-blocking** post-slice advisory scans the completed slice's trajectory for self-repair markers. If any hit AND no meta-bug was filed during the slice, write `self-repair-missed` warning to `events.log`. Does NOT fail the slice. Does NOT auto-file.
- **MUST**: New `.github/instructions/self-repair-reporting.instructions.md` with `applyTo: '**'`, priority low. Lists the 3 canonical classes, 3 worked examples from this week's sessions, exact tool signature, when NOT to use it (project bugs).
- **MUST**: `step3-execute-slice.prompt.md` prompt gains a short reminder section pointing at the new tool + instruction file.
- **MUST**: Unit tests covering: `resolveSelfRepairRepo` fallback, hash-based dedupe, trajectory attachment, post-slice marker scan.
- **MUST**: Manual smoke-test recipe documented — fire tool with a canned payload against a test repo, verify issue created.
- **MUST**: `forge_capabilities` lists the new tool and its intent/prerequisites/errors.
- **SHOULD**: Dashboard displays a small badge showing the count of open `self-repair` issues on the meta repo (cached, 1h TTL). Nice-to-have, gated behind tool availability.
- **MAY**: CLI surface `pforge meta-bug file <class> <title>` for manual filing from terminal.

### Out of Scope

- **Auto-filing without explicit tool call.** The post-slice advisory is warning-only, intentionally. False-positive auto-fires would be worse than occasional misses.
- **Retroactive filing** of the 6 BUG-*.md files already hand-written this week. They stay as manual records — mentioned in the new instruction file as historical examples.
- **Changes to existing tempering adapters.** They keep working exactly as today for project bugs. The meta tool is a new, parallel path using the same primitives.
- **Cross-repo issue mirroring** (e.g. close project bug when meta bug closes). Out of scope.
- **Dashboard issue-management UI.** Badge-only for now.

---

## Executable Slices (6 Slices · 1 Session · ~45 min · Budget ≤ $5)

All slices `[sequential]` — they build on each other in `tempering/bug-adapters/github.mjs` and `server.mjs`.

---

#### Slice 1: Meta repo resolver + class schema [sequential] {#slice-1}

**Goal**: Add `resolveSelfRepairRepo(config)` and the class/label schema as exported constants. Pure functions, no side effects.

**Files**:
- `pforge-mcp/tempering/bug-adapters/github.mjs` — append:
  - `export const META_BUG_CLASSES = ["plan-defect", "orchestrator-defect", "prompt-defect"]`
  - `export const SELF_REPAIR_LABELS = ["self-repair", "plan-forge-internal"]`
  - `export function resolveSelfRepairRepo(config)` — reads `config?.meta?.selfRepairRepo`, falls back to `"srnichols/plan-forge"`. Returns `{ owner, repo }`. Validates `owner/repo` shape; returns fallback on malformed input.
- `pforge-mcp/tests/meta-bug-resolver.test.mjs` — new:
  1. Default fallback returns `srnichols/plan-forge`.
  2. Valid `config.meta.selfRepairRepo = "a/b"` → `{ owner: "a", repo: "b" }`.
  3. Malformed (`"foo"` no slash) → fallback.
  4. Empty/missing config → fallback.
  5. `META_BUG_CLASSES` contains exactly the 3 canonical classes.

**Depends on**: Phase-28.2 `v2.62.1` tag.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/tempering/bug-adapters/github.mjs:75-96` — existing `resolveGitHubRepo` for shape reference.

**Traces to**: MUST (resolver exists; class schema exported; tests cover).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/meta-bug-resolver.test.mjs"
bash -c "grep -Eq 'resolveSelfRepairRepo|META_BUG_CLASSES' pforge-mcp/tempering/bug-adapters/github.mjs"
```

---

#### Slice 2: Meta-bug filer with dedupe [sequential] {#slice-2}

**Goal**: New `fileMetaBug(params, config, deps)` function in `tempering/bug-adapters/github.mjs`. Reuses existing `createIssueViaGh` / `createIssueViaRest` / `addComment` helpers. Dedupe via title hash.

**Files**:
- `pforge-mcp/tempering/bug-adapters/github.mjs` — append `fileMetaBug({ class, title, symptom, workaround, filePaths, slice, plan, severity, trajectoryExcerpt }, config, { execSync, fetch, cwd })`:
  - Computes stable hash: `sha256(class + ":" + title.toLowerCase().replace(/\s+/g," ").trim()).slice(0,12)`.
  - Assembles issue title: `"[self-repair:<hash>] [${class}] ${title}"`.
  - Assembles body with sections: Class, Symptom, Workaround Applied, Files, Slice/Plan reference, Context (trajectory excerpt).
  - Labels: `["self-repair", "plan-forge-internal", class, severity || "medium"]`.
  - Dedupe step: `gh issue list --repo <owner>/<repo> --label self-repair --state open --search "<hash>" --json number,url,title` (or REST equivalent). If match → `addComment` with workaround + slice ref, return `{ ok: true, issueNumber, url, deduped: true }`.
  - Otherwise → `createIssueViaGh` → REST fallback → return `{ ok: true, issueNumber, url, deduped: false }`.
  - All errors return structured `{ ok: false, error }` — never throw.
- `pforge-mcp/tests/meta-bug-filer.test.mjs` — new:
  1. Hash is stable across calls with same class+title.
  2. New-issue path calls `createIssueViaGh` with correct title+labels.
  3. Dedupe path calls `addComment` when a matching open issue exists.
  4. No token → `{ ok: false, error: "NO_TOKEN" }`.
  5. Trajectory excerpt appears in body under `## Context`.

**Depends on**: Slice 1.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/tempering/bug-adapters/github.mjs:240-295` — `createIssueViaGh`, `addComment` for reuse.
- `pforge-mcp/tempering/bug-adapters/github.mjs:298-340` — existing `registerBug` for response-shape reference.

**Traces to**: MUST (filer works; dedupes; structured errors; tests cover).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/meta-bug-filer.test.mjs"
bash -c "grep -q 'fileMetaBug' pforge-mcp/tempering/bug-adapters/github.mjs"
```

---

#### Slice 3: MCP tool `forge_meta_bug_file` [sequential] {#slice-3}

**Goal**: Wire the filer as an MCP tool in `server.mjs` and register it in `capabilities.mjs`.

**Files**:
- `pforge-mcp/server.mjs` — new tool handler for `forge_meta_bug_file`. Input schema: `{ class: enum(META_BUG_CLASSES), title: string, symptom: string, workaround: string, filePaths?: string[], slice?: string, plan?: string, severity?: enum("low","medium","high","critical") }`. Loads config via existing helpers, calls `fileMetaBug`, returns structured result. Include trajectory excerpt auto-pull: if `slice` + a current run dir are available, read last 80 lines of that slice's trajectory from `.forge/trajectories/<plan-stem>/slice-<N>.md`.
- `pforge-mcp/capabilities.mjs` — add tool entry in the same format as existing tools: description, prerequisites (`gh CLI authenticated OR GITHUB_TOKEN`), errors (`NO_TOKEN`, `NO_REPO`, `CREATE_FAILED`, `UNEXPECTED`), example input/output.
- `pforge-mcp/tests/meta-bug-tool.test.mjs` — new:
  1. Tool rejects invalid `class` value.
  2. Tool requires `title` and `symptom`.
  3. Tool returns `{ ok, issueNumber, url }` on success (mock `fileMetaBug`).
  4. Tool auto-attaches trajectory excerpt when `slice` provided and file exists.

**Depends on**: Slice 2.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/server.mjs:2380-2420` — existing `forge_bug_file` handler (for shape reference).
- `pforge-mcp/capabilities.mjs` — existing tool entries around line 800–1100.

**Traces to**: MUST (tool registered; capabilities entry; tests cover).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/meta-bug-tool.test.mjs"
bash -c "grep -q 'forge_meta_bug_file' pforge-mcp/server.mjs"
bash -c "grep -q 'forge_meta_bug_file' pforge-mcp/capabilities.mjs"
```

---

#### Slice 4: Post-slice advisory scanner [sequential] {#slice-4}

**Goal**: Non-blocking scan of each completed slice's trajectory for self-repair markers. Emit `self-repair-missed` warning to `events.log` when markers present but no meta-bug was filed.

**Files**:
- `pforge-mcp/orchestrator.mjs` — in the slice-completion path (where `slice-completed` event is emitted), add `detectSelfRepairMissed(trajectoryPath, sliceResult)`:
  - Reads trajectory file (last 200 lines).
  - Greps for markers: `/plan was wrong|fixed the plan|gate pattern|brittle gate|workaround|hand-fix|plan forge bug|orchestrator bug/i`.
  - Checks if `sliceResult.toolCalls` (or equivalent in result shape — need to read structure) contains `forge_meta_bug_file`.
  - If marker hit AND no meta-bug call → emit event `self-repair-missed` with sliceId + matched markers + suggestion text.
  - This is a pure advisory — does NOT change `slice.status`, does NOT write to bug registry.
- `pforge-mcp/tests/self-repair-advisory.test.mjs` — new:
  1. Trajectory containing "fixed the plan" + no meta-bug call → warning emitted.
  2. Trajectory with markers + meta-bug call → no warning.
  3. Trajectory with no markers → no warning.
  4. Missing trajectory file → no warning, no crash.

**Depends on**: Slice 3.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/orchestrator.mjs` — search for `slice-completed` emit site (around line 6100 per Phase-28.2 context).

**Traces to**: MUST (advisory scans; non-blocking; tests cover).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/self-repair-advisory.test.mjs"
bash -c "grep -q 'self-repair-missed' pforge-mcp/orchestrator.mjs"
```

---

#### Slice 5: Instruction file + prompt update [sequential] {#slice-5}

**Goal**: Teach the agent when to fire the tool. Keep it short — target ~120 lines for the instruction file.

**Files**:
- `.github/instructions/self-repair-reporting.instructions.md` — new, `applyTo: '**'`, priority: LOW. Sections:
  - **Two lanes at a glance** (project bug vs meta bug, one-line distinctions).
  - **When to fire `forge_meta_bug_file`** — 3 canonical classes with one-paragraph descriptions.
  - **Three worked examples** — all from the real sessions this week:
    1. Phase-28.2 Slice 2 brittle grep gate → class: `plan-defect`.
    2. Phase-28.1 Slice 6 vitest timeout → class: `orchestrator-defect`.
    3. Phase-28 step-2 bash gate portability → class: `prompt-defect`.
  - **When NOT to fire it** — project code bugs, CI red flags in user code, test failures in features-under-development.
  - **Tool signature reminder** with a ready-to-paste payload template.
  - **Labels and dedupe** — stable title hash, 7-day window, automatic commenting on duplicates.
- `.github/prompts/step3-execute-slice.prompt.md` — append a short section "Self-Repair Reporting" with the one-sentence rule: *"If you had to work around a Plan Forge defect to complete the slice, call `forge_meta_bug_file` before ending. See `.github/instructions/self-repair-reporting.instructions.md`."*
- No tests needed for this slice (doc-only).

**Depends on**: Slice 4.

**Branch**: `master`.

**Context files**:
- `.github/instructions/architecture-principles.instructions.md` — shape reference.
- `.github/prompts/step3-execute-slice.prompt.md` — shape reference.

**Traces to**: MUST (instruction file exists; prompt updated).

**Validation Gate**:
```bash
bash -c "test -f .github/instructions/self-repair-reporting.instructions.md"
bash -c "grep -q 'forge_meta_bug_file' .github/instructions/self-repair-reporting.instructions.md"
bash -c "grep -q 'Self-Repair' .github/prompts/step3-execute-slice.prompt.md"
```

---

#### Slice 6: Ship v2.62.2 [sequential] {#slice-6}

**Goal**: CHANGELOG, VERSION bump, tag, post-release bump. Smoke-test the tool end-to-end against a test issue before tagging.

**Files**:
- `CHANGELOG.md` — new `## [2.62.2]` section with one `### Added` subsection: `forge_meta_bug_file` tool, `self-repair-reporting` instruction file, post-slice advisory.
- `VERSION` — `2.62.2` for the tag, then `2.62.3-dev` post-tag.
- `pforge-mcp/package.json` — version `2.62.2`.
- **Smoke test (manual, recorded in slice log)**: Fire the tool against the live repo with a canned test payload (class `plan-defect`, title `"[smoke-test] please close"`), verify issue created, then close it via `gh issue close <N>`.

**Depends on**: Slice 5 + full vitest green.

**Branch**: `master`.

**Context files**:
- `/memories/repo/release-procedure.md`
- `CHANGELOG.md` — existing `[2.62.1]` entry for format reference.

**Traces to**: MUST (v2.62.2 tag; CHANGELOG entry; smoke test recorded).

**Validation Gate**:
```bash
bash -c "git show v2.62.2:VERSION | grep -q '^2.62.2$'"
bash -c "grep -q '## \\[2.62.2\\]' CHANGELOG.md"
bash -c "cd pforge-mcp && PFORGE_GATE_TIMEOUT_MS=600000 npx vitest run"
```

---

## Forbidden Actions

- No changes to `registerBug`, `updateBugStatus`, or other existing project-bug functions in `tempering/bug-adapters/github.mjs`. The meta lane is additive.
- No auto-filing without an explicit tool call. The post-slice advisory is warning-only.
- No retroactive filing of pre-existing `docs/bugs/BUG-*.md` files.
- No changes to tempering scanners.
- No dashboard UI beyond an optional cached badge count (Slice 6 stretch).

## Rollback Plan

Before Slice 1, create `pre-phase-28.3` tag at current HEAD. On unrecoverable slice failure, `git reset --hard pre-phase-28.3` and file a narrower hotfix.

## Agent Notes

- Slices 1, 2, 3 share `tempering/bug-adapters/github.mjs`. Keep additions in an appended section — do NOT refactor existing functions.
- Slice 2's dedupe query uses `gh issue list --search`. The title hash syntax `[self-repair:<hash>]` is searchable literally because `gh` does substring match. Do not use REGEX or the GitHub search qualifier `in:title` — keep it simple.
- Slice 4's marker list is intentionally small. False-positive warnings are acceptable; false-negatives (missed self-repair) defeat the purpose. Err toward more markers.
- Slice 5's instruction file is LOW priority (loads rarely) — it only needs to be on-hand when an agent suspects a self-repair situation. Keep it focused and scannable.
- Slice 6 smoke-test: open the test issue, verify the `self-repair` label, verify the `[self-repair:<hash>]` prefix in title, close it. Record issue number + close confirmation in slice log.
