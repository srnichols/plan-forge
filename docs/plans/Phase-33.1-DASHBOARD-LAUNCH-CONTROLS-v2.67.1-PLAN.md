---
lane: full
source: human
hardened: true
hardened_by: Claude Opus 4.7 (in-session feature plan)
hardened_at: 2026-04-28
---

# Phase-33.1 — Dashboard Launch Controls (slice picker + tempering toggle)

> **Target release**: v2.67.1
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-33 shipped (v2.67.0 — GitHub Models provider, dashboard launch modal with `--resume-from` and `--dry-run`)
> **Scope**: Add two CLI flags (`--only-slices`, `--no-tempering`) and surface them in the dashboard Launch modal. Release v2.67.1.

---

## Specification Source

- **Field input**: In-session audit of dashboard Launch modal (Phase-33 polish round). User asked for a slice multi-picker and a "skip tempering" checkbox. Both were declined at the time because the orchestrator's `--run` CLI parser does not implement them — adding them to the dashboard alone would silently no-op. This phase closes that gap end-to-end: add the flags to the orchestrator, plumb them through `pforge.ps1` / `pforge.sh`, then expose them in the dashboard.
- **Existing surface (verified)**: `pforge-mcp/orchestrator.mjs` `--run` block at line 10561 already parses `--resume-from`, `--dry-run`, `--estimate`, `--strict-gates`, `--no-quorum`, `--quorum=...`, `--quorum-threshold`, `--manual-import*`. Missing: `--only-slices`, `--no-tempering`.
- **Existing tempering hook**: `runPostSliceTemperingHook` exported from `pforge-mcp/orchestrator.mjs` line 6132. The hook is invoked externally (MCP server post-commit), not from inside `runPlan`. Disabling tempering for a single run therefore needs a runtime signal the hook will respect — env var written by the orchestrator entrypoint is the cheapest correct path.
- **Architecture anchor**: Principle 3 (No silent no-ops) — UI affordances must map to behavior the system actually performs. Principle 10 (Keep Gates Boring) — slice filtering belongs in one place (the orchestrator's slice-loop guard), not duplicated in three layers.

---

## Scope Contract

### In scope

- `pforge-mcp/orchestrator.mjs`:
  - `runPlan(...)` options: add `onlySlices: number[] | null` and `noTempering: boolean`.
  - Slice-loop guard inside `runPlan` (current resumeFrom block ~line 2433/2698): when `onlySlices` is non-null, skip any slice whose id is not in the set. `resumeFrom` and `onlySlices` MUST be mutually exclusive (error if both supplied).
  - `--run` argv parser (~line 10561): parse `--only-slices <expr>` (comma list and dash ranges, e.g. `2,4-6`) into `number[]`; parse `--no-tempering` into boolean.
  - When `noTempering === true`, set `process.env.PFORGE_DISABLE_TEMPERING = "1"` before the slice loop (so the externally invoked post-slice tempering hook can read it).
  - `runPostSliceTemperingHook(...)` (~line 6132): early-return `{ skipped: true, reason: "PFORGE_DISABLE_TEMPERING" }` if `process.env.PFORGE_DISABLE_TEMPERING === "1"`. No tempering side effects.
- `pforge-mcp/tests/orchestrator-launch-controls.test.mjs` — NEW unit tests for: slice-set parsing (`"2,4-6"` → `[2,4,5,6]`), mutual-exclusion error, hook env-var skip path, slice-loop filtering.
- `pforge.ps1` and `pforge.sh` — pass `--only-slices <expr>` and `--no-tempering` through to `node orchestrator.mjs --run ...`. Update the usage line and `run-plan` example block.
- `pforge-mcp/dashboard/index.html` — Launch modal: add a text input `#launch-only-slices` (placeholder `"e.g. 2,4-6"`) and a checkbox `#launch-no-tempering`, both with tooltips mapping to the CLI flag.
- `pforge-mcp/dashboard/app.js` — `submitLaunch(...)` reads the two new inputs and appends `--only-slices <expr>` / `--no-tempering` to the args list. Disable `#launch-only-slices` when `#launch-resume-from` has a value (mutual exclusion mirrored in UI). Update the confirm summary lines.
- `pforge-mcp/server.mjs` — `/api/tool/run-plan` allowlist: extend the accepted-flag set to include `--only-slices` and `--no-tempering` (and accept the value token after `--only-slices`).
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — release metadata for v2.67.1.
- `.github/copilot-instructions.md` quick-commands block — add a `--only-slices` example.

### Out of scope

- Any change to how tempering itself runs when enabled (no behavior change for the default path).
- Any change to the tempering post-slice hook signature or its dispatch in MCP/server code beyond the env-var early return.
- Any new dashboard UI beyond the two inputs and their wiring (no plan-tree slice checkboxes — the text expression is sufficient and matches CLI syntax).
- Any change to `--resume-from` semantics or its existing tests.
- Any change to quorum, manual-import, strict-gates, or estimate flags.
- Any change to non-Windows / non-Linux dispatch paths.
- Any new MCP tool. The `forge_run_plan` MCP tool already accepts `extraArgs`; no schema change needed.

### Forbidden actions

- Do NOT add a new dependency. Node built-ins only.
- Do NOT remove or weaken the existing `GATE_ALLOWED_PREFIXES` / `--strict-gates` / `--no-quorum` / `--manual-import` parsing — those branches must remain byte-identical.
- Do NOT introduce a new CLI flag spelling. Use exactly `--only-slices` (not `--slices`, not `--only`) and exactly `--no-tempering` (not `--skip-tempering`, not `--disable-tempering`).
- Do NOT silently allow `--resume-from <N> --only-slices <expr>` together. The orchestrator entry MUST emit a non-zero exit and a one-line error to stderr containing the phrase `"--resume-from and --only-slices are mutually exclusive"`.
- Do NOT mutate `process.env.PFORGE_DISABLE_TEMPERING` outside the `--run` entry path (no test fixtures should leak the value — set-and-restore or use an injected env in tests).
- Do NOT change tempering default behavior — `runPostSliceTemperingHook` MUST behave exactly as before when the env var is absent or any value other than `"1"`.
- Do NOT block the run when an `onlySlices` entry references a non-existent slice id. Log a warn line `"Slice <id> requested via --only-slices was not found in plan"` and continue with the matched subset.
- Do NOT add slice multi-select checkboxes to the dashboard plan browser this phase. Text expression only.

---

## Acceptance Criteria

### Criteria for Slice 1 (orchestrator CLI parsing + slice filter + tempering env)

- **MUST**: `pforge-mcp/orchestrator.mjs` exports a pure helper `parseOnlySlicesExpr(expr: string): number[]` that parses comma lists and dash ranges. `"2,4-6"` → `[2,4,5,6]`. `"3"` → `[3]`. Empty / whitespace input → `[]`. Invalid token (non-numeric, descending range) → throws `Error` with message containing `"invalid --only-slices expression"`.
- **MUST**: `runPlan(...)` accepts `onlySlices: number[] | null` (default `null`) and `noTempering: boolean` (default `false`). When `onlySlices` is a non-empty array, the slice loop in `runPlan` filters slices to only those whose numeric id is in the set; slices outside the set are skipped with a status log line containing the phrase `"skipped (not in --only-slices)"`. When `onlySlices` is `null`, behavior is unchanged.
- **MUST**: When `runPlan` is called with both `resumeFrom != null` AND `onlySlices != null && onlySlices.length > 0`, it throws an `Error` whose message contains `"--resume-from and --only-slices are mutually exclusive"`. No work performed.
- **MUST**: When `noTempering === true`, the orchestrator sets `process.env.PFORGE_DISABLE_TEMPERING = "1"` before the slice loop runs. When `noTempering === false`, the env var is left untouched (not cleared, not set).
- **MUST**: `runPostSliceTemperingHook(...)` (~line 6132 of `pforge-mcp/orchestrator.mjs`) returns `{ skipped: true, reason: "PFORGE_DISABLE_TEMPERING" }` immediately (before any side effect, before reading state, before invoking `runTemperingRun`) when `process.env.PFORGE_DISABLE_TEMPERING === "1"`. Any other value, including unset, falls through to existing behavior.
- **MUST**: The `--run` argv block in `pforge-mcp/orchestrator.mjs` (~line 10561) parses `--only-slices <expr>` via `parseOnlySlicesExpr` and `--no-tempering` as a boolean. Both are passed into the existing `runPlan({...})` options object alongside `resumeFrom`, `dryRun`, `estimate`.
- **MUST**: `pforge-mcp/tests/orchestrator-launch-controls.test.mjs` contains at least 7 tests covering: (a) `parseOnlySlicesExpr` happy path (comma + range), (b) `parseOnlySlicesExpr` invalid token throws, (c) `parseOnlySlicesExpr` descending range throws, (d) `runPlan` with `onlySlices` skips non-matching slices in the loop (use a mock plan with 3 slices), (e) `runPlan` with both `resumeFrom` and `onlySlices` rejects, (f) `runPostSliceTemperingHook` early-returns with the correct reason when env var is `"1"`, (g) `runPostSliceTemperingHook` falls through when env var is unset (existing tests must still pass — no regressions).
- **GATE**: `npx vitest run pforge-mcp/tests/orchestrator-launch-controls.test.mjs --reporter=basic` exits 0.
- **GATE**: `npx vitest run pforge-mcp/tests/tempering-post-slice-hook.test.mjs --reporter=basic` exits 0 (regression check on the existing tempering tests).

### Criteria for Slice 2 (pforge wrappers + dashboard wiring + server allowlist)

- **MUST**: `pforge.ps1` `Invoke-RunPlan` parses `--only-slices` (consumes the next arg as its value) and `--no-tempering` (boolean) from `$Arguments` and appends them to `$nodeArgs` in the existing `if ($estimate) { ... }` style block. Order in the appended args is: existing flags, then `--only-slices <val>` (when set), then `--no-tempering` (when true).
- **MUST**: `pforge.ps1`'s usage string at line 4027 includes `[--only-slices <expr>]` and `[--no-tempering]` in the documented signature.
- **MUST**: `pforge.sh` `cmd_run_plan` (or the equivalent `run-plan` branch — match the existing flag-passthrough pattern used for `--resume-from`) parses both flags identically. Usage / help text updated.
- **MUST**: `pforge-mcp/dashboard/index.html` Launch modal adds:
  - A text input `<input id="launch-only-slices" type="text" placeholder="e.g. 2,4-6">` with an associated label `"Only slices"` and a `title` attribute mapping to `--only-slices <expr>`.
  - A checkbox `<input id="launch-no-tempering" type="checkbox">` with label `"Skip tempering"` and a `title` attribute mapping to `--no-tempering`.
  - Both controls live in the existing toggles flex-wrap row alongside `#launch-estimate` and `#launch-dry-run`.
- **MUST**: `pforge-mcp/dashboard/app.js` `submitLaunch(estimateOnly)` reads `#launch-only-slices` and `#launch-no-tempering`. When the slices input has a non-empty trimmed value, it appends `"--only-slices"` and the trimmed value to the args array. When the checkbox is checked, it appends `"--no-tempering"`. The confirm summary string includes a line for each non-default value.
- **MUST**: When the user types a value into `#launch-resume-from`, `#launch-only-slices` is disabled (and vice versa) — mutual exclusion enforced in the UI before the args reach the server. Implemented via a single `input` event listener registered when the modal mounts.
- **MUST**: `pforge-mcp/server.mjs` `/api/tool/run-plan` accepts `--only-slices <expr>` and `--no-tempering` in its arg allowlist. The value following `--only-slices` is validated to match the regex `/^[0-9](?:[0-9,\- ]*[0-9])?$/` before being forwarded; on mismatch the endpoint returns HTTP 400 with `{ error: "invalid --only-slices value" }`.
- **MUST**: `pforge-mcp/tests/server-run-plan-route.test.mjs` (extend or add) contains tests for: (a) `--only-slices "2,4-6"` accepted, (b) `--only-slices "; rm -rf"` rejected with 400, (c) `--no-tempering` accepted as a bare flag.
- **GATE**: `npx vitest run pforge-mcp/tests/server-run-plan-route.test.mjs pforge-mcp/tests/dashboard-launch-controls.test.mjs --reporter=basic` exits 0.
- **MUST**: `pforge-mcp/tests/dashboard-launch-controls.test.mjs` (NEW) contains at least 2 tests asserting that (a) `pforge-mcp/dashboard/index.html` contains both `launch-only-slices` and `launch-no-tempering` substrings, (b) `pforge-mcp/dashboard/app.js` contains both `--only-slices` and `--no-tempering` substrings. Both tests use `readFileSync` against the real files (no mocks).

### Criteria for Slice 3 (release v2.67.1)

- **MUST**: `VERSION` contains `2.67.1`.
- **MUST**: `pforge-mcp/package.json` `"version"` field is `"2.67.1"`.
- **MUST**: `CHANGELOG.md` has a `[2.67.1] — 2026-04-28` (or current ship date) section under `[Unreleased]`, headlined with the phrase `"dashboard launch controls"` AND containing a bullet that mentions both `--only-slices` and `--no-tempering`.
- **MUST**: `ROADMAP.md` reflects v2.67.1 as shipped.
- **MUST**: `.github/copilot-instructions.md` Quick Commands block contains a line showing `pforge run-plan --only-slices 2,4-6 <plan-file>` as an example.
- **MUST**: Git tag `v2.67.1` exists on the Slice 3 release commit.

### Quality bar

- **SHOULD**: Slice 1 commit message: `feat(orchestrator): add --only-slices and --no-tempering CLI flags`.
- **SHOULD**: Slice 2 commit message: `feat(dashboard): launch modal exposes slice picker and tempering toggle`.
- **SHOULD**: Slice 3 commit message: `chore(release): v2.67.1 — dashboard launch controls`.
- **SHOULD**: All new tests use the existing `vitest` patterns and tempfs helpers from `pforge-mcp/tests/server.test.mjs`.

---

## Slice Plan

### Slice 1 — Orchestrator CLI flags + tempering env-var early-return
**Files**: `pforge-mcp/orchestrator.mjs`, `pforge-mcp/tests/orchestrator-launch-controls.test.mjs`
**Validation gate**: `npx vitest run pforge-mcp/tests/orchestrator-launch-controls.test.mjs pforge-mcp/tests/tempering-post-slice-hook.test.mjs --reporter=basic`

### Slice 2 — Wrappers + dashboard + server allowlist
**Files**: `pforge.ps1`, `pforge.sh`, `pforge-mcp/dashboard/index.html`, `pforge-mcp/dashboard/app.js`, `pforge-mcp/server.mjs`, `pforge-mcp/tests/server-run-plan-route.test.mjs`, `pforge-mcp/tests/dashboard-launch-controls.test.mjs`
**Validation gate**: `npx vitest run pforge-mcp/tests/server-run-plan-route.test.mjs pforge-mcp/tests/dashboard-launch-controls.test.mjs --reporter=basic`

### Slice 3 — Release v2.67.1
**Files**: `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`, `ROADMAP.md`, `.github/copilot-instructions.md`, `pforge-mcp/tests/version-2-67-1.test.mjs`
**Validation gate**: `npx vitest run pforge-mcp/tests/version-2-67-1.test.mjs --reporter=basic`

> Slice 3 ships a tiny one-shot test asserting `VERSION` and `pforge-mcp/package.json` both report `2.67.1`. Keeping the gate as a vitest invocation matches Slices 1 and 2 and avoids inline `node -e` parsing edge cases.

---

## Risk Notes

- **Tempering env var pollution**: A test that sets `PFORGE_DISABLE_TEMPERING` must restore the prior value in `afterEach`. Use `const prior = process.env.PFORGE_DISABLE_TEMPERING; ... afterEach(() => { if (prior === undefined) delete process.env.PFORGE_DISABLE_TEMPERING; else process.env.PFORGE_DISABLE_TEMPERING = prior; })`.
- **Slice id parsing collisions with quorum threshold**: `--only-slices` and `--quorum-threshold` both expect a numeric next-arg. The orchestrator's `getArg` helper is positional-by-name so there is no collision, but verify in tests that `--quorum-threshold 7 --only-slices 2,4-6` parses both correctly.
- **Dashboard mutual-exclusion UX**: If the user has values in BOTH inputs and clicks Launch, the disabled-attribute approach prevents that — but if the modal is reopened with state preserved, ensure the mount listener re-evaluates which side is disabled. Keep the listener attached for the modal lifetime.
- **Server allowlist regex**: The regex `/^[0-9](?:[0-9,\- ]*[0-9])?$/` accepts spaces inside the expression. The orchestrator parser must `.trim().split(/[\s,]+/)` accordingly, OR the regex tightens to disallow spaces. Pick one and document it in `parseOnlySlicesExpr` jsdoc.
