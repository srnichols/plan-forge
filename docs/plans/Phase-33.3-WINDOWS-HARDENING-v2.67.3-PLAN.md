---
phase: 33.3
version: 2.67.3
crucibleId: imported-meta-bug-batch-119-121-123
lane: bug-fix
source: github-issues
linkedBugs: [119, 121, 123]
manualImport: true
manualImportSource: meta-bug-roadmap
manualImportReason: Three Windows / autonomous-loop reliability bugs surfaced by Rummag field test (v2.81.0). Each is a small surgical fix in orchestrator.mjs; batched into one v2.67.3 release.
model: claude-sonnet-4.6
---

# Phase-33.3 — Windows Hardening & Auto-Commit Determinism (v2.67.3)

## Goal

Eliminate three Windows / autonomous-loop reliability defects that survived Phase-33.2:

| Bug | Class | Symptom | Fix surface |
|-----|-------|---------|------------|
| #119 | orchestrator-defect | `runAutoSweep` ENOBUFS on large repos (default 1MB execSync buffer) | `pforge-mcp/orchestrator.mjs` `runAutoSweep` |
| #121 | orchestrator-defect | `spawnWorker` flashes a console window on Windows + can hang on `git commit` waiting for an editor | `pforge-mcp/orchestrator.mjs` `spawnWorker` spawn options |
| #123 | orchestrator-defect | After a passing slice the worker sometimes forgets to `git commit` — orchestrator silently leaves dirty tree, breaking the autonomous-loop atomicity guarantee | `pforge-mcp/orchestrator.mjs` `runSliceLoop` post-pass section |

## Forbidden Actions

- Do not change worker prompt content or model defaults.
- Do not introduce new dependencies.
- Do not alter slice-snapshot stash logic (#88 retry path depends on it).
- Do not commit on slice **failure** — only on a passed slice with a dirty tree.
- Auto-commit message must use a deterministic conventional-commit form derived from the slice (no LLM call).
- Do not enable auto-commit for `mode === "assisted"` runs (humans drive those).

## Acceptance Criteria

### Criteria for Slice 1 — Bug #119 runAutoSweep buffer + timeout

- `runAutoSweep` (around line 9963 in `pforge-mcp/orchestrator.mjs`) passes `maxBuffer: 64 * 1024 * 1024` (64 MB) and `timeout: 120_000` to its `execSync` call, and catches `ENOBUFS` / `RangeError` and returns `{ ran: false, clean: false, error: "ENOBUFS: sweep output exceeded 64MB buffer", markerCount: 0, output: "" }` instead of throwing.
- Unit test in `pforge-mcp/tests/auto-sweep.test.js` verifies (a) the success path uses a string with `>1_500_000` chars without throwing, and (b) the `ENOBUFS` path returns `{ ran: false }` with the documented error string.
- Validation gate: `npx vitest run pforge-mcp/tests/auto-sweep.test.js --reporter=basic`.

### Criteria for Slice 2 — Bug #121 spawnWorker windowsHide + git editor

- The `spawn(cmd, args, { ... })` call in `pforge-mcp/orchestrator.mjs` (around line 1835) sets `windowsHide: true` and adds `GIT_EDITOR: "true"`, `GIT_TERMINAL_PROMPT: "0"`, `GIT_SEQUENCE_EDITOR: "true"` to the worker's environment so `git commit` / `git rebase` never block on an editor.
- New test `pforge-mcp/tests/spawn-worker-windows.test.js` asserts those env keys and the `windowsHide: true` flag appear in the spawn options for the next worker invocation (use a `spawn` mock via `vi.mock("node:child_process")`).
- Validation gate: `npx vitest run pforge-mcp/tests/spawn-worker-windows.test.js --reporter=basic`.

### Criteria for Slice 3 — Bug #123 auto-commit determinism

- A new exported helper `autoCommitSliceIfDirty({ slice, cwd, mode, eventBus })` in `pforge-mcp/orchestrator.mjs`:
  - returns `{ committed: false, reason: "assisted-mode" }` when `mode === "assisted"`;
  - returns `{ committed: false, reason: "clean-tree" }` when `git status --porcelain` is empty;
  - otherwise runs `git add -A` and `git commit -m "<conventionalType>(slice-<n>): <slice.title>"` where `conventionalType` is inferred from `slice.title` (`fix` if it begins with `Bug`/`Fix`, `feat` otherwise) and returns `{ committed: true, sha, message }`;
  - emits a `slice-auto-committed` event when it commits and a `slice-dirty-tree-warning` event when an unexpected error prevents committing.
- `runSliceLoop` invokes the helper exactly once after `status === "passed"` is decided, before the slice result is returned, and includes the `committed`/`reason` on the slice result under a new `autoCommit` field.
- New test `pforge-mcp/tests/auto-commit-slice.test.js` covers all three branches (assisted skip, clean-tree skip, dirty-tree commit) using a temp-dir git repo or `execSync` stub.
- Validation gate: `npx vitest run pforge-mcp/tests/auto-commit-slice.test.js --reporter=basic`.

### Criteria for Slice 4 — Release v2.67.3

- `pforge-mcp/package.json` and `package.json` versions bumped to `2.67.3`.
- `CHANGELOG.md` has a new `## 2.67.3` section listing fixes for #119, #121, #123 with one-line descriptions each.
- A git tag `v2.67.3` is created on the resulting commit.
- Validation gate: `node -e "const p=require('./pforge-mcp/package.json'); if(p.version!=='2.67.3'){process.exit(1)}"` (chained with the changelog grep below).

## Slice Plan

### Slice 1 — Bug #119 runAutoSweep buffer + timeout

- Open `pforge-mcp/orchestrator.mjs`, locate `function runAutoSweep(cwd)` (≈ line 9960).
- Add `maxBuffer: 64 * 1024 * 1024` and bump `timeout` to `120_000` on the existing `execSync` call.
- Wrap the `try/catch` so `err.code === "ENOBUFS"` (or `err instanceof RangeError`) returns the documented degraded-but-non-fatal payload. Other errors keep current behavior.
- Add `pforge-mcp/tests/auto-sweep.test.js` exercising both branches via `vi.mock("node:child_process", () => ({ execSync: vi.fn() }))`.
- Validation: `npx vitest run pforge-mcp/tests/auto-sweep.test.js --reporter=basic`.

### Slice 2 — Bug #121 spawnWorker windowsHide + git editor

- In `spawnWorker` (≈ line 1835), extend the existing `env` object with `GIT_EDITOR: "true"`, `GIT_TERMINAL_PROMPT: "0"`, `GIT_SEQUENCE_EDITOR: "true"`.
- Add `windowsHide: true` to the same `spawn` options object.
- Add `pforge-mcp/tests/spawn-worker-windows.test.js` that mocks `child_process.spawn` and asserts the spawn-options shape on a single invocation. Use `runPlanActive: true` and a fake worker matrix so the function stays on the `claude/codex` branch.
- Validation: `npx vitest run pforge-mcp/tests/spawn-worker-windows.test.js --reporter=basic`.

### Slice 3 — Bug #123 auto-commit determinism

- Add `export function autoCommitSliceIfDirty(...)` near `runPostSliceHook` (around line 6140).
  - Read working tree with `execSync("git status --porcelain", { cwd, encoding: "utf-8", timeout: 5000 })`.
  - Infer commit type: `/^(bug\s*#?\d+|fix)/i.test(slice.title) ? "fix" : "feat"`.
  - Sanitize subject: strip leading "Bug #N: " prefix, truncate to 72 chars.
  - Run `git add -A` then `git commit -m <subject>` via `execSync`.
  - Read SHA back via `git rev-parse HEAD`.
  - Catch any `execSync` error and return `{ committed: false, reason: "git-failed", error: err.message }`; emit `slice-dirty-tree-warning`.
- In `runSliceLoop`, immediately after `status === "passed"` is determined and `sliceResult` is being built, call `autoCommitSliceIfDirty(...)` and attach the result to `sliceResult.autoCommit`.
- Add `pforge-mcp/tests/auto-commit-slice.test.js`:
  - Branch A: `mode === "assisted"` → no execSync calls, returns `clean-tree` skip.
  - Branch B: stubbed `git status --porcelain` returns empty → returns `clean-tree`.
  - Branch C: stubbed `git status --porcelain` returns ` M file.ts`, `git commit` succeeds → returns `committed: true` with the inferred commit message.
- Validation: `npx vitest run pforge-mcp/tests/auto-commit-slice.test.js --reporter=basic`.

### Slice 4 — Release v2.67.3

- Bump `pforge-mcp/package.json` and root `package.json` to `2.67.3`.
- Prepend a `## 2.67.3` section to `CHANGELOG.md` with three bullets: `fix(orchestrator): runAutoSweep ENOBUFS on large repos (#119)`, `fix(orchestrator): spawnWorker windowsHide + GIT_EDITOR (#121)`, `fix(orchestrator): deterministic auto-commit after passing slices (#123)`.
- `git add -A && git commit -m "chore(release): v2.67.3 — Windows hardening + auto-commit determinism"` then `git tag v2.67.3`.
- Validation: `node -e "const p=require('./pforge-mcp/package.json'); if(p.version!=='2.67.3'){process.exit(1)}; const fs=require('fs'); if(!fs.readFileSync('CHANGELOG.md','utf8').includes('## 2.67.3')){process.exit(1)}"`.
