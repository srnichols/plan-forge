---
crucibleId: imported-meta-bug-batch-122-127
lane: full
source: human
hardened: true
hardened_by: Claude Opus 4.7 (in-session bug-fix plan)
hardened_at: 2026-04-28
linkedBugs: [117, 122, 124, 126, 127]
---

# Phase-33.2 — Silent-Failure Sweep (Loud-fail the orchestrator and parser)

> **Target release**: v2.67.2
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-33.1 shipped (v2.67.1).
> **Scope**: Make five "system did X different from request, no log, no error" footguns loud. Closes #117, #122, #124, #126, #127.

---

## Specification Source

Five field-reported bugs share one root cause: the orchestrator silently substitutes behavior or schema instead of failing loudly. Each fix is small (XS–S) and isolated.

| Bug | Symptom | Fix surface |
|---|---|---|
| #117 | `forge_run_plan({ planPath })` crashes inside `path.join(undefined)` instead of returning a clean validation error | `pforge-mcp/server.mjs` tool dispatcher |
| #122 | CLI default `quorum="auto"` force-sets `quorumConfig.enabled = true`, ignoring `.forge.json quorum.enabled:false` | `pforge-mcp/orchestrator.mjs` `runPlan` (~line 3331) |
| #124 | `## Slice N` (h2) silently parses to zero slices and the run "succeeds" with 0/0 done | `pforge-mcp/orchestrator.mjs` `parseSlices` regex (~line 405) + zero-slice guard in `runPlan` |
| #126 | `CRUCIBLE_ID_REQUIRED` error mentions `--manual-import` (CLI form) but not `manualImport: true` (MCP body form), and the tool description doesn't surface the bypass | `pforge-mcp/crucible-enforce.mjs` error message + `pforge-mcp/tools.json` description |
| #127 | Plan frontmatter `model:` is parsed but ignored; `.forge.json` config wins silently | `pforge-mcp/orchestrator.mjs` `parsePlan` frontmatter loop + `runPlan` model-resolution log |

**Architecture anchors**: Principle 3 (No silent no-ops), Principle 5 (Loud failure beats silent success), Temper Guard "we'll log it later".

---

## Scope Contract

### In scope

- `pforge-mcp/server.mjs` — `forge_run_plan` handler validates `args.plan` is a non-empty string before any path operation; rejects unknown body fields with a structured error; accepts `planPath` as an alias for `plan` (alias only, `plan` remains canonical).
- `pforge-mcp/orchestrator.mjs`:
  - `runPlan` quorum-resolution block (~line 3329): when `quorum === "auto"`, respect `.forge.json quorum.enabled`. Only force `enabled = true` when the caller explicitly passes `quorum === true` / `"true"` / a preset (`"power"` / `"speed"`).
  - `parseSlices` regex (~line 405): broaden h-level prefix from `#{3,4}` to `#{2,4}` so `## Slice N`, `### Slice N`, and `#### Slice N` are all recognized.
  - `runPlan` post-`parsePlan` zero-slice guard: if `plan.slices.length === 0`, return `{ status: "failed", error: "No slices found in plan…", code: "NO_SLICES" }` BEFORE any worker dispatch. No silent green.
  - `parsePlan` frontmatter loop (~line 281): read frontmatter `model:` into `meta.model`. `runPlan` precedence: explicit `options.model` > `meta.model` > `.forge.json modelRouting.default` > `null`. Emit one log line `[model] resolved=<m> source=<options|frontmatter|config|default>`.
- `pforge-mcp/crucible-enforce.mjs` — `CrucibleEnforcementError` message includes both bypass forms: CLI (`--manual-import`) and MCP (`manualImport: true` body field).
- `pforge-mcp/tools.json` — `forge_run_plan` description gains a one-line note that `manualImport: true` (with optional `manualImportSource` / `manualImportReason`) bypasses the Crucible gate.
- New tests:
  - `pforge-mcp/tests/server-run-plan-validation.test.mjs` (#117).
  - `pforge-mcp/tests/quorum-config-precedence.test.mjs` (#122).
  - `pforge-mcp/tests/parser-h2-slice-and-zero-guard.test.mjs` (#124).
  - `pforge-mcp/tests/crucible-error-message.test.mjs` (#126).
  - `pforge-mcp/tests/frontmatter-model-precedence.test.mjs` (#127).
- `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`, `ROADMAP.md` — release v2.67.2.

### Out of scope

- Any change to the worker spawn path, ENOBUFS handling, focus-stealing, or auto-commit determinism (Phase-33.3 territory).
- Any change to the cost-estimator pricing tables (Phase-34 territory).
- Any change to Crucible draft generation quality (Phase-35 territory).
- Any change to project-root resolution (Phase-33.4 territory).
- Any change to `--resume-from`, `--only-slices`, `--strict-gates`, `--no-quorum` parsing or behavior beyond the precedence fix in #122.
- Any new MCP tool. Schema changes are description-only (#126) and field-aliasing (#117).
- No test framework change. Vitest only. No Playwright, no Jest.

### Forbidden actions

- Do NOT add a new dependency. Node built-ins only.
- Do NOT change the slice header regex character class beyond the prefix count `#{3,4}` → `#{2,4}`. Title parsing, alpha-suffix support (e.g. `5A`), separator chars, and tag stripping MUST remain byte-identical.
- Do NOT auto-correct h2 slice headers in plan files (no rewrites). Detection only — broaden the regex so they're parsed correctly going forward.
- Do NOT silently accept `planPath` without also recording the alias usage. The handler MUST log a one-time deprecation warning per process when `planPath` is used (`[forge_run_plan] 'planPath' is an alias; prefer 'plan'`).
- Do NOT remove the existing CLI-form bypass message; ADD the MCP-form bypass note alongside it.
- Do NOT silently accept frontmatter `model:` values that aren't strings. Non-string / empty values are ignored with a one-line warn (`[model] frontmatter model: ignored — not a string`).
- Do NOT change the default behavior when `quorum.enabled` is absent from `.forge.json` and CLI default `"auto"` is used. Absent ≙ legacy default ≙ enabled=true. Only an explicit `quorum.enabled: false` flips the default.
- Do NOT introduce any new env var. Reuse existing config and option surfaces.
- Do NOT modify `parsePlan`'s behavior when frontmatter is absent, malformed, or lacks a `model:` key. Default model resolution path stays untouched.
- Do NOT touch `pforge-mcp/dashboard/*` in this phase.

---

## Acceptance Criteria

### Criteria for Slice 1 — Bug #117: `forge_run_plan` body validation + `planPath` alias

- **MUST**: `pforge-mcp/server.mjs` `forge_run_plan` handler validates `args.plan` (or `args.planPath` alias) is a non-empty string. If both `args.plan` and `args.planPath` are absent or empty, return `{ content: [{ type: "text", text: "forge_run_plan: 'plan' is required (string path to plan markdown)" }], isError: true }` BEFORE any `resolve()` / `path.join()` call.
- **MUST**: When `args.plan` is missing but `args.planPath` is present and a non-empty string, the handler treats `args.planPath` as `args.plan` AND emits a one-time-per-process `console.warn("[forge_run_plan] 'planPath' is an alias; prefer 'plan'")` warning.
- **MUST**: When neither alias is a string (e.g., a number, an object, an array), the handler returns the structured validation error described above. No throw, no `path.join(undefined)`.
- **MUST**: `pforge-mcp/tests/server-run-plan-validation.test.mjs` (NEW) contains tests covering: (a) missing `plan` → validation error not crash; (b) `planPath` alias accepted; (c) non-string `plan` (number) → validation error; (d) one-shot deprecation warn observed via a `console.warn` spy. At least 4 tests.
- **GATE**: `npx vitest run pforge-mcp/tests/server-run-plan-validation.test.mjs --reporter=basic`

### Criteria for Slice 2 — Bug #122: Quorum precedence respects `.forge.json`

- **MUST**: In `pforge-mcp/orchestrator.mjs` `runPlan`, the quorum-config block (~line 3329) only force-sets `quorumConfig.enabled = true` when `quorum === true` or `quorum === "true"` or `quorumPreset` is non-null. When `quorum === "auto"` (the CLI default), `quorumConfig.enabled` is preserved from `loadQuorumConfig(cwd, ...)` (which already reads `.forge.json`).
- **MUST**: When `.forge.json` contains `{ quorum: { enabled: false } }` AND the CLI default `quorum === "auto"` is used, `runPlan` produces `quorumConfig.enabled === false` and skips the model-availability probe entirely (no `[quorum] no available models` error path).
- **MUST**: When `.forge.json` is absent OR has no `quorum.enabled` key AND `quorum === "auto"`, the resolved `quorumConfig.enabled` is `true` (unchanged legacy default — absence ≙ enabled).
- **MUST**: When the caller passes `quorum === true` / `"true"` / `"power"` / `"speed"`, `quorumConfig.enabled` is `true` regardless of `.forge.json` (caller wins for explicit on).
- **MUST**: When the caller passes `quorum === false` / `"false"`, the entire quorum block is skipped (existing behavior — must remain byte-identical).
- **MUST**: A single log line emitted at quorum resolution: `[quorum] enabled=<bool> auto=<bool> source=<cli|config|default>`.
- **MUST**: `pforge-mcp/tests/quorum-config-precedence.test.mjs` (NEW) contains at least 6 tests: (a) `.forge.json enabled:false` + `quorum:"auto"` → enabled=false; (b) absent `.forge.json` + `quorum:"auto"` → enabled=true; (c) `quorum:true` overrides `.forge.json enabled:false` → enabled=true; (d) `quorum:"power"` overrides config → enabled=true; (e) `quorum:false` short-circuits → quorumConfig stays null; (f) log-line source tag is correct in all four enabled cases.
- **GATE**: `npx vitest run pforge-mcp/tests/quorum-config-precedence.test.mjs --reporter=basic`

### Criteria for Slice 3 — Bug #124: h2 slice headers + zero-slice guard

- **MUST**: `pforge-mcp/orchestrator.mjs` `parseSlices` slice-header regex (~line 406) prefix changes from `^#{3,4}\s+slice\s+...` to `^#{2,4}\s+slice\s+...`. All other elements of the regex (slice id capture, separator chars, title capture, tag stripping, flags) are byte-identical.
- **MUST**: A plan with `## Slice 1: Foo` and `## Slice 2: Bar` (h2 headers) parses to `result.slices.length === 2` with correct numbers and titles.
- **MUST**: `pforge-mcp/tests/parser-h2-slice-and-zero-guard.test.mjs` (NEW) covers: (a) h2 slice headers parsed; (b) h3 slice headers still parsed (no regression); (c) h4 slice headers still parsed (no regression); (d) h1 (`# Slice 1`) is NOT matched; (e) h5 (`##### Slice 1`) is NOT matched.
- **MUST**: In `runPlan` (after `const plan = parsePlan(planPath, cwd)` ~line 3168, AFTER the `enforceCrucibleId` block, BEFORE the `estimate` and `dryRun` branches), if `plan.slices.length === 0`, return `{ status: "failed", error: "No slices found in plan — expected '### Slice N: …' headers (h2/h3/h4 accepted)", code: "NO_SLICES", planPath }`. No worker dispatch. No `run-completed` event.
- **MUST**: The zero-slice guard fires for `estimate: true` AND `dryRun: true` AND normal runs (it's positioned BEFORE both branches).
- **MUST**: `pforge-mcp/tests/parser-h2-slice-and-zero-guard.test.mjs` covers: (f) a plan with no slice headers → `runPlan` returns `{ status: "failed", code: "NO_SLICES" }` synchronously; (g) the same for `dryRun: true`; (h) the same for `estimate: true`. Use temp-dir plan fixtures with crucibleId frontmatter so enforcement passes.
- **GATE**: `npx vitest run pforge-mcp/tests/parser-h2-slice-and-zero-guard.test.mjs pforge-mcp/tests/parser.test.mjs --reporter=basic`

### Criteria for Slice 4 — Bug #126: Surface MCP bypass form in error + tool description

- **MUST**: `pforge-mcp/crucible-enforce.mjs` `CrucibleEnforcementError`'s message reads (verbatim) `"Plan missing crucibleId — run it through Crucible first (forge_crucible_submit), or bypass: CLI '--manual-import' / MCP body { manualImport: true, manualImportSource?, manualImportReason? }. Bypass is logged."`.
- **MUST**: `pforge-mcp/tools.json` `forge_run_plan` `description` field has, appended to the existing string with a leading space, the literal sentence: `"Plans without crucibleId frontmatter are rejected — pass manualImport:true (with optional manualImportSource / manualImportReason) to bypass the Crucible gate; bypasses are logged to .forge/crucible/manual-imports.jsonl."`.
- **MUST**: `pforge-mcp/tests/crucible-error-message.test.mjs` (NEW) asserts: (a) the error message string contains both `"--manual-import"` and `"manualImport: true"` substrings; (b) the error `code` is still `"CRUCIBLE_ID_REQUIRED"`; (c) `tools.json`'s `forge_run_plan.description` contains the substring `"manualImport:true"`.
- **MUST**: No change to the throw site, `code` value, `planPath` field, or audit-log format.
- **GATE**: `npx vitest run pforge-mcp/tests/crucible-error-message.test.mjs pforge-mcp/tests/crucible.test.mjs --reporter=basic`

### Criteria for Slice 5 — Bug #127: Frontmatter `model:` precedence + resolution log

- **MUST**: `pforge-mcp/orchestrator.mjs` `parsePlan` frontmatter loop (~line 283) reads `model:` into `meta.model` when the value is a non-empty string. Non-string / empty values are NOT assigned to `meta.model` AND emit a single `console.warn("[model] frontmatter model: ignored — not a string")`.
- **MUST**: `runPlan` model-resolution (~line 3141) replaces the current line `const effectiveModel = model || modelRouting.default || null` with the precedence chain: `options.model` (caller) > `plan.meta.model` (frontmatter) > `modelRouting.default` (config) > `null`. The first non-null/non-empty wins.
- **MUST**: `runPlan` emits exactly one log line at resolution: `[model] resolved=<m> source=<options|frontmatter|config|default>` where `default` is used only when all three sources are empty (resulting model is `null` / orchestrator-default).
- **MUST**: When the caller passes `options.model`, the source tag is `options` regardless of frontmatter or config.
- **MUST**: `pforge-mcp/tests/frontmatter-model-precedence.test.mjs` (NEW) covers: (a) `options.model` wins over frontmatter; (b) frontmatter wins over `.forge.json modelRouting.default`; (c) `.forge.json` wins when frontmatter absent; (d) all empty → `effectiveModel === null`, source `default`; (e) frontmatter `model: 123` (non-string) is ignored AND a warn is observed; (f) the `[model] resolved=...` log line is emitted with the correct source tag in (a)–(d).
- **GATE**: `npx vitest run pforge-mcp/tests/frontmatter-model-precedence.test.mjs pforge-mcp/tests/parser.test.mjs --reporter=basic`

### Criteria for Slice 6 — Release v2.67.2

- **MUST**: `VERSION` contains `2.67.2`.
- **MUST**: `pforge-mcp/package.json` `"version"` field is `"2.67.2"`.
- **MUST**: `CHANGELOG.md` has a `[2.67.2] — 2026-04-28` (or current ship date) section under `[Unreleased]`, headlined with the phrase `"silent-failure sweep"` AND containing one bullet for each of #117, #122, #124, #126, #127 (each must reference the issue number).
- **MUST**: `ROADMAP.md` reflects v2.67.2 as shipped.
- **MUST**: Git tag `v2.67.2` exists on the Slice 6 release commit.
- **MUST**: `pforge-mcp/tests/version-2-67-2.test.mjs` (NEW) asserts: (a) `VERSION` reads `2.67.2`; (b) `pforge-mcp/package.json` version is `"2.67.2"`; (c) `CHANGELOG.md` contains `[2.67.2]`; (d) `CHANGELOG.md` contains the substring `"silent-failure sweep"`; (e) `CHANGELOG.md` references each of `#117`, `#122`, `#124`, `#126`, `#127`.
- **GATE**: `npx vitest run pforge-mcp/tests/version-2-67-2.test.mjs --reporter=basic`

### Quality bar

- **SHOULD**: Slice 1 commit message: `fix(server): validate forge_run_plan body, accept planPath alias (#117)`.
- **SHOULD**: Slice 2 commit message: `fix(orchestrator): respect .forge.json quorum.enabled with CLI auto (#122)`.
- **SHOULD**: Slice 3 commit message: `fix(parser): accept h2 slice headers, hard-fail on zero slices (#124)`.
- **SHOULD**: Slice 4 commit message: `fix(crucible): surface MCP bypass form in error + tool desc (#126)`.
- **SHOULD**: Slice 5 commit message: `fix(orchestrator): honor frontmatter model: with resolution log (#127)`.
- **SHOULD**: Slice 6 commit message: `chore(release): v2.67.2 — silent-failure sweep`.

---

## Slice Plan

### Slice 1 — Bug #117: forge_run_plan body validation + planPath alias
**Files**: `pforge-mcp/server.mjs`, `pforge-mcp/tests/server-run-plan-validation.test.mjs`
**Validation gate**: `npx vitest run pforge-mcp/tests/server-run-plan-validation.test.mjs --reporter=basic`

```bash
npx vitest run pforge-mcp/tests/server-run-plan-validation.test.mjs --reporter=basic
```

### Slice 2 — Bug #122: Quorum precedence respects .forge.json
**Files**: `pforge-mcp/orchestrator.mjs`, `pforge-mcp/tests/quorum-config-precedence.test.mjs`
**Validation gate**: `npx vitest run pforge-mcp/tests/quorum-config-precedence.test.mjs --reporter=basic`

```bash
npx vitest run pforge-mcp/tests/quorum-config-precedence.test.mjs --reporter=basic
```

### Slice 3 — Bug #124: h2 slice headers + zero-slice guard
**Files**: `pforge-mcp/orchestrator.mjs`, `pforge-mcp/tests/parser-h2-slice-and-zero-guard.test.mjs`
**Validation gate**: `npx vitest run pforge-mcp/tests/parser-h2-slice-and-zero-guard.test.mjs pforge-mcp/tests/parser.test.mjs --reporter=basic`

```bash
npx vitest run pforge-mcp/tests/parser-h2-slice-and-zero-guard.test.mjs pforge-mcp/tests/parser.test.mjs --reporter=basic
```

### Slice 4 — Bug #126: Crucible bypass surfaced in error + description
**Files**: `pforge-mcp/crucible-enforce.mjs`, `pforge-mcp/tools.json`, `pforge-mcp/tests/crucible-error-message.test.mjs`
**Validation gate**: `npx vitest run pforge-mcp/tests/crucible-error-message.test.mjs pforge-mcp/tests/crucible.test.mjs --reporter=basic`

```bash
npx vitest run pforge-mcp/tests/crucible-error-message.test.mjs pforge-mcp/tests/crucible.test.mjs --reporter=basic
```

### Slice 5 — Bug #127: Frontmatter model: precedence + resolution log
**Files**: `pforge-mcp/orchestrator.mjs`, `pforge-mcp/tests/frontmatter-model-precedence.test.mjs`
**Validation gate**: `npx vitest run pforge-mcp/tests/frontmatter-model-precedence.test.mjs pforge-mcp/tests/parser.test.mjs --reporter=basic`

```bash
npx vitest run pforge-mcp/tests/frontmatter-model-precedence.test.mjs pforge-mcp/tests/parser.test.mjs --reporter=basic
```

### Slice 6 — Release v2.67.2
**Files**: `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`, `ROADMAP.md`, `pforge-mcp/tests/version-2-67-2.test.mjs`
**Validation gate**: `npx vitest run pforge-mcp/tests/version-2-67-2.test.mjs --reporter=basic`

```bash
npx vitest run pforge-mcp/tests/version-2-67-2.test.mjs --reporter=basic
```

---

## Risk Notes

- **Quorum precedence flip (Slice 2)**: Users running with `.forge.json quorum.enabled:false` who relied on the `--quorum=auto` CLI default forcing it back on will lose that emergent behavior. They must now pass `--quorum=true` explicitly. Documented in CHANGELOG.
- **h2 regex broadening (Slice 3)**: Any plan that uses `## Slice N` as a non-slice section header (extremely unlikely — "Slice" is reserved vocabulary) will now be parsed as a slice. Mitigation: titles still need to match the `Slice N:` pattern exactly.
- **Frontmatter model: precedence (Slice 5)**: Users who set `model:` in plan frontmatter without intent will see a model change. Mitigation: the resolution log line makes the chosen model + source explicit.
