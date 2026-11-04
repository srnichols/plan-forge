---
crucibleId: imported-step0-2026-05-13-crucible-import-cli
lane: full
source: human
---

# Phase CRUCIBLE-IMPORT-CLI: Spec Kit Importer — CLI + MCP Tool

> **Status**: Slices 0–1 executed manually in chat. Slices 2–8 to be executed by `pforge run-plan --resume-from 2`.
> **Pipeline note**: This plan was drafted at Step 0 with already-tight gates and is being run without formal Step 1 / Step 2 hardening — author accepts the risk, gates were authored by hand to match Plan Forge gate-portability rules.
> **Tracks**: Code (new `pforge crucible` subcommand + `forge_crucible_import` MCP tool + deterministic importer module) + Docs (rewrite `spec-kit-interop.html` to match shipping behavior)
> **Estimated cost**: $2.50–$4.50 (8 slices, mostly small code, one fragile prompt refactor)
> **Pipeline**: Specify (this doc) → Pre-flight → Harden → Execute → Sweep → Review → Ship

---

## Feature Specification: Spec Kit Importer — CLI + MCP Tool

### Problem Statement

Plan Forge's manual page [docs/manual/spec-kit-interop.html](../manual/spec-kit-interop.html) documents a Spec Kit import flow that doesn't exist in shipping form. It promises:

- `pforge crucible import --from=spec-kit` (CLI subcommand)
- `forge_crucible_import({...})` (MCP tool)
- `pforge crucible export --to=spec-kit` (reverse direction)
- `pforge crucible status` (smelt browser)
- `--sync-principles` flag (constitution.md → PROJECT-PRINCIPLES.md)

What actually ships is a `/step0-specify-feature` Copilot Chat slash command that reads Spec Kit `.md` files and emits a Phase Plan with `crucibleId: imported-speckit-<uuid>` frontmatter. That works, but only for users inside Copilot Chat. It strands three audiences:

1. **Cursor / Claude Code / Codex users** — they have Plan Forge installed via `setup.ps1 -Agent cursor|claude|codex` but cannot invoke a Copilot-only slash command. Today they have no Spec Kit import path.
2. **CI pipelines** — teams that want to script "import the latest `spec.md` into Plan Forge nightly" cannot, because slash commands aren't scriptable.
3. **The Spec Kit community itself** — Spec Kit is a CLI-first tool. Every other Spec Kit integration in their ecosystem is a CLI hook. A documented `pforge crucible import` is the interop contract they expect.

This phase closes the gap by building the deterministic importer the manual already documents — as a Node module called by both the new CLI subcommand and the new MCP tool. The existing slash command is then refactored to *call* the importer instead of doing field-mapping in a prompt, eliminating the probabilistic-mapper risk.

The work is **purely additive** for native Plan Forge users. Their existing flow (`/step0-specify-feature` for fresh specs, write Phase Plan, `pforge run-plan`) is unchanged. Nothing they use today gets renamed or removed.

### User Scenarios

**Scenario 1: Cursor user with a Spec Kit project**
1. User has a Spec Kit project at `~/projects/my-feature/` containing `specs/`, `memory/constitution.md`.
2. They run `setup.ps1 -Agent cursor` to install Plan Forge. Setup auto-detects Spec Kit artifacts and writes `speckit: true` to `.forge.json` (this already works today).
3. They run `pforge crucible import --from=spec-kit`. The importer scans default Spec Kit paths, maps fields into a Crucible smelt, writes the smelt under `.forge/crucible/smelt-<uuid>.json`, and emits a Phase Plan at `docs/plans/Phase-<NAME>-PLAN.md` with the `crucibleId` + `source: speckit` frontmatter.
4. They run `pforge run-plan docs/plans/Phase-<NAME>-PLAN.md`. The Crucible enforcement gate accepts the plan (frontmatter present), execution proceeds.
5. Outcome: Cursor user gets identical Plan Forge value to a Copilot user, no Copilot Chat required.

**Scenario 2: CI pipeline imports a nightly spec.md**
1. Team's GitHub Action runs nightly: `pforge crucible import --from=spec-kit --dir=specs/v2 --json > /tmp/import-result.json`.
2. The action parses `import-result.json` for `{ ok, smeltId, planPath, mappedFields[], missingFields[] }`. If `ok=false`, it opens an issue listing `missingFields`. If `ok=true`, it commits the new Phase Plan and tags `@speckit-import-bot` for review.
3. Outcome: Spec Kit becomes a scriptable upstream for Plan Forge plans.

**Scenario 3: Spec Kit community member evaluates Plan Forge**
1. Reads our blog post + manual page. Sees `pforge crucible import --from=spec-kit` documented.
2. Tries it. It works. Documentation matches reality.
3. Outcome: trust preserved. Today this scenario *fails* — the documented command doesn't exist, and the user concludes Plan Forge ships vapor.

**Scenario 4: Copilot user with a Spec Kit project (existing flow, must not regress)**
1. User opens Copilot Chat in a Spec-Kit-enabled repo.
2. Runs `/step0-specify-feature`.
3. The slash command detects Spec Kit artifacts and offers "Import" as today.
4. **Behind the scenes**, the prompt now invokes `pforge crucible import --from=spec-kit --dry-run --json` via a tool call to validate, then `pforge crucible import --from=spec-kit` to commit. The user sees the same chat experience but the field-mapping is now deterministic.
5. Outcome: existing Copilot flow preserved, but probabilistic mapping in the prompt is replaced with a tool call to the deterministic importer. One source of truth for Spec Kit field semantics.

**Scenario 5: User wants to inspect a smelt before hardening**
1. After import, they run `pforge crucible status`.
2. Output: list of smelts under `.forge/crucible/`, with status (`draft`, `imported`, `hardened`, `executed`), source (`speckit`, `human`, etc.), and creation timestamp.
3. They run `pforge crucible status <smelt-id>` to see the full mapped fields and any warnings.
4. Outcome: the audit trail Plan Forge already keeps becomes browseable from the CLI, not just from `pforge smith` summary counts.

### Acceptance Criteria

#### Importer module (deterministic, library-style)

- [ ] **MUST**: New file `pforge-mcp/crucible-import.mjs` exports `importSpeckit({ projectRoot, dir?, dryRun?, syncPrinciples? })` returning `{ ok, smeltId, planPath, mappedFields: [{source, target, value}], missingFields: [{file, field, severity}], warnings: [string] }`.
- [ ] **MUST**: All four source files (`spec.md`, `plan.md`, `tasks.md`, `constitution.md`) are parsed with deterministic markdown parsers — no LLM calls inside the importer. Hardener picks the parser library (recommend `remark` + `remark-frontmatter`).
- [ ] **MUST**: Field mapping matches the table in [docs/manual/spec-kit-interop.html](../manual/spec-kit-interop.html) Field Mapping Reference section. Hardener verifies one-to-one against shipping manual prose at Step 2.
- [ ] **MUST**: Required-field absence (e.g. `spec.md` missing `title`, `plan.md` missing `scope`) produces `{ ok: false }` with `missingFields[]` populated. No partial smelt is written. Error code: `SPECKIT_IMPORT_MISSING_FIELD`.
- [ ] **MUST**: Successful import writes the smelt to `.forge/crucible/smelt-<uuid>.json` and the generated Phase Plan to `docs/plans/Phase-<NAME>-PLAN.md`. Phase plan carries `crucibleId: imported-speckit-<uuid>`, `lane: full`, `source: speckit` frontmatter (matches the format `/step0-specify-feature` writes today — see line 67 of the prompt).
- [ ] **MUST**: Audit trail entry appended to `.forge/crucible/manual-imports.jsonl` with `{ timestamp, planPath, source: "speckit", reason: "auto-import via pforge crucible import", crucibleId, mappedFieldCount, missingFieldCount }`. (Reuses existing append target — see `crucible-enforce.mjs` lines 16–22.)
- [ ] **MUST**: `dryRun: true` returns the same shape but writes nothing to disk. Useful for validation in CI.
- [ ] **MUST**: `syncPrinciples: true` additionally writes `constitution.md` content (transformed) to `docs/plans/PROJECT-PRINCIPLES.md`. If the file already exists, the importer prompts (CLI) or returns `{ ok: false, error: "PROJECT_PRINCIPLES_EXISTS" }` (MCP) — no silent overwrite.
- [ ] **MUST**: Vitest test file `pforge-mcp/tests/crucible-import.test.mjs` covers all four parsers, all error codes, dry-run, sync-principles, and the happy-path round-trip. ≥ 90% line coverage of `crucible-import.mjs`.
- [ ] **MUST**: Test fixtures live at `pforge-mcp/tests/fixtures/speckit/` and contain at least three pinned snapshots: `green/` (all four files present, complete), `partial/` (missing `tasks.md`), `invalid/` (missing required fields). Fixtures are **real Spec Kit output** captured during Slice 0 from a one-time run of `github/spec-kit` against a sample feature, not hand-crafted markdown.

#### CLI subcommand (PowerShell + bash, mirrored)

- [ ] **MUST**: `pforge crucible import --from=spec-kit [--dir <path>] [--dry-run] [--sync-principles] [--json]` is recognised in both `pforge.ps1` and `pforge.sh`. Implementation routes to `node pforge-mcp/crucible-import.mjs <args>`.
- [ ] **MUST**: `pforge crucible status` lists all smelts under `.forge/crucible/` as a table (id, source, status, created). Exit 0 always (informational).
- [ ] **MUST**: `pforge crucible status <smelt-id>` prints the full smelt JSON (or human-formatted summary) for one smelt. Exit 1 if id not found.
- [ ] **MUST**: `pforge crucible --help` lists the subcommands (`import`, `status`) with one-line descriptions. Calling `pforge crucible` with no subcommand prints help and exits 0.
- [ ] **MUST**: `--json` flag on any subcommand emits structured JSON to stdout, no banner, no ANSI. Exit codes preserved.
- [ ] **MUST**: Both PowerShell and bash entries include the `crucible` case in their main `switch`/`case` dispatch (see `pforge.ps1` line 6234).
- [ ] **MUST**: Existing `pforge run-plan --manual-import --manual-import-source speckit` flow (line 4041 of `pforge.ps1`) is unchanged. The new importer is a fresh path, not a replacement.

#### MCP tool

- [ ] **MUST**: New tool `forge_crucible_import` registered in `pforge-mcp/tools.json` and `pforge-mcp/server.mjs`. Input schema: `{ source: "spec-kit" (enum, required), dir?: string, dryRun?: boolean, syncPrinciples?: boolean }`. Output schema: matches `importSpeckit` return shape exactly.
- [ ] **MUST**: New tool `forge_crucible_status` registered identically. Input: `{ smeltId?: string }` (omitted = list all). Output: `{ smelts: [{...}] }` or single smelt detail.
- [ ] **MUST**: Both tools are listed in [pforge-mcp/capabilities.mjs](../../pforge-mcp/capabilities.mjs) under a new `crucible` capability section so `forge_capabilities` reports them.

#### Slash-command refactor

- [ ] **MUST**: `.github/prompts/step0-specify-feature.prompt.md` Spec Kit branch (lines 40–80 today) is rewritten to invoke `pforge crucible import --from=spec-kit --dry-run --json` via a tool call, present the mapping report to the user, then invoke `pforge crucible import --from=spec-kit` to commit. The prompt no longer does field-mapping itself.
- [ ] **MUST**: The slash command's "Start fresh" / "Skip Spec Kit" branch is preserved unchanged.
- [ ] **MUST**: A regression test at `pforge-mcp/tests/step0-prompt-speckit.test.mjs` greps the prompt file for the new tool-call pattern and the absence of inline field-mapping prose. (Light test — proves the refactor was applied, not that the prompt produces correct output.)

#### Documentation

- [ ] **MUST**: [docs/manual/spec-kit-interop.html](../manual/spec-kit-interop.html) is rewritten so every documented command actually exists. Specifically: smelt path corrected from `.forge/smelts/` to `.forge/crucible/`, `pforge harden` reference removed (replaced with `/step2-harden-plan` slash command), `pforge ext status spec-kit-interop` reference removed (no such command), `pforge crucible export --to=spec-kit` either implemented in this phase or moved to a "Roadmap" callout.
- [ ] **MUST**: `CHANGELOG.md` entry under "Added" describing the new CLI + MCP surface and the slash-command refactor.

#### Out-of-scope guards

- [ ] **MUST**: No change to the Crucible enforcement gate (`pforge-mcp/crucible-enforce.mjs`). This phase produces plans that already satisfy it.
- [ ] **MUST**: No change to `pforge run-plan` semantics. The new importer just produces inputs `run-plan` already accepts.
- [ ] **SHOULD**: `pforge crucible export --to=spec-kit` (reverse direction). If included, scope is import-only Spec Kit artifacts (`spec.md`, `plan.md`, `tasks.md`, `constitution.md`), no extension artifacts, and the export is explicitly marked lossy in its output banner. **Recommendation: defer to Phase CRUCIBLE-EXPORT-CLI** — the lossy-export design needs its own scope discussion.
- [ ] **MAY**: A `forge_crucible_export` MCP tool to mirror the `pforge crucible export` CLI. Defer with the export work.

### Edge Cases

| Scenario | Expected Behavior |
|---|---|
| User runs `pforge crucible import --from=spec-kit` with no Spec Kit artifacts in the repo | Exit 1. Message: "No Spec Kit artifacts found at default paths. Try `--dir <path>` or run `setup.ps1` to verify Spec Kit detection." |
| `spec.md` exists but `plan.md` is absent | Importer warns (slices come from `plan.md`), produces a smelt with `slices: []` and `missingFields: [{file: "plan.md", field: "<root>", severity: "warn"}]`. Exit 0 (importable as draft). |
| Both `plan.md` and `spec.md` are absent | Exit 1. Error: "SPECKIT_IMPORT_MISSING_REQUIRED — both spec.md and plan.md absent." |
| `constitution.md` rules conflict with existing `docs/plans/PROJECT-PRINCIPLES.md` | `--sync-principles` not used: warning in output, no merge. `--sync-principles` used: returns `{ ok: false, error: "PROJECT_PRINCIPLES_EXISTS" }` and asks user to remove or rename existing file. |
| User passes `--dir` to a non-existent path | Exit 1. Error: "SPECKIT_IMPORT_DIR_NOT_FOUND". |
| Spec Kit `tasks.md` uses unknown status vocabulary (e.g. `in-review`) | Importer maps known values (`done`, `in-progress`, `pending`), maps everything else to `pending`, and adds a warning per unrecognised value. Already documented in the manual. |
| Two Spec Kit feature directories under `specs/` | Without `--dir`, importer requires user to pick one. Output lists detected dirs and exits 1 with code `SPECKIT_IMPORT_AMBIGUOUS_DIR`. |
| User runs `pforge crucible import` (no `--from`) | Exit 1. Error: "Missing required `--from=<source>`. Currently supported sources: `spec-kit`." |
| Dry-run with `--json` | Output is single-object JSON with `dryRun: true` field. Useful for CI. |
| Slash-command refactor runs in a Cursor / Claude Code session that doesn't have shell tool access | The slash command degrades: detects no shell tool, falls back to documenting "run `pforge crucible import --from=spec-kit` in your terminal" rather than invoking it. |
| Concurrent import (two `pforge crucible import` invocations on the same repo) | Each generates a unique `smelt-<uuid>.json`. The Phase Plan filename includes the feature name from `spec.md` title — collisions append `-2`, `-3`. |

### Out of Scope

- **Reverse export** (`pforge crucible export --to=spec-kit`) — defer to Phase CRUCIBLE-EXPORT-CLI. Lossy direction needs its own scope discussion (which gates do we drop, how do we represent forbidden-actions in Spec Kit's `plan.md` shape).
- **Spec Kit extension artifacts** (security spec, database schema spec, etc. — see manual Section "Ecosystem Extensions") — defer to a follow-on phase. This phase covers only the four core files.
- **`pforge crucible status` rich UI** — this phase implements a flat table. Dashboard tab is a future phase.
- **`pforge crucible abandon` / `pforge crucible resume`** — the manual references these (see line 3802 of `pforge.ps1`) as MCP tools. CLI surface for them is out of scope.
- **Plan Forge → Spec Kit live sync** (bidirectional watching) — out of scope. Imports are one-shot.
- **Backporting the importer to v2.36 or earlier** — current main only.
- **Changing how `pforge run-plan --manual-import` works** — that's the human-bypass path, untouched.

### Open Questions

1. **Markdown parser dependency**: `remark` + `remark-frontmatter` adds two npm deps. Alternative: hand-rolled regex parser (matches existing `crucible-enforce.mjs` style, line 31). Hardener decides. Recommend `remark` for robustness against Spec Kit's evolving markdown shape.
2. **`pforge crucible export` in this phase or deferred?** Recommend defer — the import alone is one phase of work, and export needs its own design discussion.
3. **`forge_crucible_status` MCP tool — same phase or defer?** Recommend include. It's a thin wrapper over the same data the CLI reads. Marginal cost.
4. **Phase Plan filename derivation**: from `spec.md` title (slugified) or user-provided `--name`? Recommend slugified title with `--name` as override.
5. **Slash-command refactor scope**: full rewrite, or minimal change to just call the importer at the end? Recommend minimal — preserve the existing UX (interview, coverage table, gap-filling), only swap the field-mapping step.
6. **Spec Kit fixture provenance**: do we vendor the fixtures from a real `github/spec-kit` run (and pin a Spec Kit version), or hand-craft them to match the documented schema? Recommend real fixtures from a pinned Spec Kit version, captured in Slice 0 and committed to `tests/fixtures/speckit/README.md` with the source command and Spec Kit SHA.
7. **`--sync-principles` behavior on first import vs subsequent**: first run writes the file. Subsequent runs — overwrite? merge? error? Recommend error with clear message; merging is a Phase X follow-up.

### Complexity Estimate

- **Estimated effort**: Medium-Large (8 slices, mostly code. Slice 0 fixture capture and Slice 6 prompt refactor are the highest-risk pieces.)
- **Estimated files**: ~12 (1 new importer module, 1 test file + fixture tree, 2 CLI dispatcher updates, 2 MCP server updates, 1 capabilities update, 1 prompt refactor, 1 doc rewrite, VERSION + CHANGELOG)
- **Recommended pipeline**: **Standard pipeline** — Steps 0–6. Step 5 Review must specifically check that the prompt refactor (Slice 6) hasn't regressed the Copilot Chat UX.

---

## Scope Contract

### Inputs

- Existing CLI dispatchers: [pforge.ps1](../../pforge.ps1), [pforge.sh](../../pforge.sh)
- Existing MCP server: [pforge-mcp/server.mjs](../../pforge-mcp/server.mjs), [pforge-mcp/tools.json](../../pforge-mcp/tools.json)
- Existing capabilities surface: [pforge-mcp/capabilities.mjs](../../pforge-mcp/capabilities.mjs)
- Existing Crucible enforcement (read-only reference): [pforge-mcp/crucible-enforce.mjs](../../pforge-mcp/crucible-enforce.mjs)
- Existing slash command (refactor target): [.github/prompts/step0-specify-feature.prompt.md](../../.github/prompts/step0-specify-feature.prompt.md)
- Existing manual page (rewrite target): [docs/manual/spec-kit-interop.html](../manual/spec-kit-interop.html)
- External: `github/spec-kit` repo at a pinned SHA (for fixture capture in Slice 0)

### Outputs

**New files** (~6):
- `pforge-mcp/crucible-import.mjs` — deterministic importer
- `pforge-mcp/tests/crucible-import.test.mjs` — vitest coverage
- `pforge-mcp/tests/fixtures/speckit/{green,partial,invalid}/` — pinned Spec Kit fixtures (4 files each)
- `pforge-mcp/tests/fixtures/speckit/README.md` — fixture provenance: which Spec Kit SHA produced these and what command was run
- `pforge-mcp/tests/step0-prompt-speckit.test.mjs` — regression test for slash-command refactor

**Modified files** (~8):
- `pforge.ps1` — adds `Invoke-Crucible` function and `'crucible'` switch case
- `pforge.sh` — mirror in bash
- `pforge-mcp/server.mjs` — registers `forge_crucible_import` and `forge_crucible_status` handlers
- `pforge-mcp/tools.json` — schemas for both new tools
- `pforge-mcp/capabilities.mjs` — surfaces both tools under a new `crucible` capability section
- `.github/prompts/step0-specify-feature.prompt.md` — Spec Kit branch refactored to invoke the importer
- `docs/manual/spec-kit-interop.html` — full rewrite to match shipping behavior
- `VERSION`, `CHANGELOG.md`

### Forbidden Actions

- ❌ Modifying [pforge-mcp/crucible-enforce.mjs](../../pforge-mcp/crucible-enforce.mjs) — the enforcement gate is intentionally untouched
- ❌ Modifying any existing `Invoke-*` function in `pforge.ps1` other than the main `switch` dispatch
- ❌ Changing the semantics of `pforge run-plan --manual-import` — that's the human-bypass path
- ❌ Renaming `.forge/crucible/manual-imports.jsonl` (existing audit log; importer appends to it)
- ❌ Removing the "Start fresh" / "Skip Spec Kit" branch from the slash command
- ❌ Adding any LLM call inside `crucible-import.mjs` (the whole point is determinism)
- ❌ Hand-crafting Spec Kit fixtures rather than capturing them from a real `github/spec-kit` run
- ❌ Bumping VERSION until Slice 8
- ❌ Implementing `pforge crucible export` in this phase (deferred)

---

## Slice Plan

> **Note for Hardener**: All gates use `bash -c "..."` for portability. Memory note `plan-gate-command-rules.md` applies. Slice 0 must complete before any other slice runs (fixtures are required by Slice 1 tests).

### Slice 0 — Fixture capture (prerequisite, manual one-time work)
**Files in scope**: `pforge-mcp/tests/fixtures/speckit/{green,partial,invalid}/*`, `pforge-mcp/tests/fixtures/speckit/README.md`
**Goal**: From a pinned `github/spec-kit` SHA, run the Spec Kit CLI against a sample feature to produce real `spec.md`, `plan.md`, `tasks.md`, `constitution.md`. Commit as `green/`. Hand-derive `partial/` (delete `tasks.md`) and `invalid/` (corrupt `spec.md` to drop `title`). README.md records the Spec Kit SHA, the command used, and how to regenerate.
**Validation gate**:
```bash
bash -c "test -f pforge-mcp/tests/fixtures/speckit/green/spec.md && test -f pforge-mcp/tests/fixtures/speckit/green/plan.md && test -f pforge-mcp/tests/fixtures/speckit/green/tasks.md && test -f pforge-mcp/tests/fixtures/speckit/green/constitution.md"
bash -c "grep -q 'spec-kit SHA' pforge-mcp/tests/fixtures/speckit/README.md"
```
**Estimated cost**: $0.10 (mostly manual — agent verifies presence)

### Slice 1 — Importer module + unit tests
**Files in scope**: `pforge-mcp/crucible-import.mjs`, `pforge-mcp/tests/crucible-import.test.mjs`
**Goal**: Implement `importSpeckit(opts)` per Acceptance Criteria. All four parsers, error codes, dry-run, sync-principles guard. Vitest coverage ≥ 90%.
**Validation gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/crucible-import.test.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/crucible-import.test.mjs --coverage --reporter=json | node -e \"let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{ const j=JSON.parse(d); const f=j.coverageMap['crucible-import.mjs']; if(!f||f.lines.pct<90)process.exit(1); })\""
```
**Estimated cost**: $0.60

### Slice 2 — `pforge crucible` CLI dispatch (PowerShell)
**Files in scope**: `pforge.ps1`
**Goal**: Add `Invoke-Crucible` function with `import` and `status` subcommands. `import` shells out to `node pforge-mcp/crucible-import.mjs` with mapped flags. `status` reads `.forge/crucible/*.json` and prints a table. Add `'crucible'` case to main dispatcher (line 6234).
**Validation gate**:
```bash
bash -c "pwsh -NoProfile -File pforge.ps1 crucible --help | grep -q import"
bash -c "pwsh -NoProfile -File pforge.ps1 crucible --help | grep -q status"
bash -c "pwsh -NoProfile -File pforge.ps1 crucible status --json | grep -q '\"smelts\"'"
```
**Estimated cost**: $0.25

### Slice 3 — `pforge crucible` CLI dispatch (bash)
**Files in scope**: `pforge.sh`
**Goal**: Mirror Slice 2 in bash. Same subcommands, same flags, same exit codes, same `--json` output shape. Memory note `setup-update-invariants.md` applies — keep in lockstep with Slice 2.
**Validation gate**:
```bash
grep -q 'cmd_crucible' pforge.sh
grep -q '"crucible"' pforge.sh
grep -qE 'crucible.*\)\s*cmd_crucible' pforge.sh
```
**Estimated cost**: $0.20

### Slice 4 — MCP tool registration
**Files in scope**: `pforge-mcp/server.mjs`, `pforge-mcp/tools.json`, `pforge-mcp/capabilities.mjs`
**Goal**: Register `forge_crucible_import` and `forge_crucible_status` handlers. Both wrap the same module functions used by the CLI. Update `capabilities.mjs` to surface them under a new `crucible` section.
**Validation gate**:
```bash
grep -q 'forge_crucible_import' pforge-mcp/tools.json
grep -q 'forge_crucible_status' pforge-mcp/tools.json
grep -q 'forge_crucible_import' pforge-mcp/server.mjs
grep -q 'forge_crucible_import' pforge-mcp/capabilities.mjs
```
**Estimated cost**: $0.30

### Slice 5 — End-to-end integration test
**Files in scope**: `pforge-mcp/tests/crucible-import.e2e.test.mjs`
**Goal**: New vitest suite that copies the `green/` fixture into a tmpdir, shells out to `node pforge-mcp/crucible-import.mjs --project <tmp>`, asserts a smelt was written under `.forge/crucible/`, asserts a Phase Plan was written under `docs/plans/` with the correct frontmatter, asserts the audit-log entry was appended.
**Validation gate**:
```bash
test -f pforge-mcp/tests/crucible-import.e2e.test.mjs
bash -c "cd pforge-mcp && npx vitest run tests/crucible-import.e2e.test.mjs"
```
**Estimated cost**: $0.40

### Slice 6 — Slash-command refactor (high risk — fragile)
**Files in scope**: `.github/prompts/step0-specify-feature.prompt.md`, `pforge-mcp/tests/step0-prompt-speckit.test.mjs`
**Goal**: Refactor lines 40–80 of the prompt so the Spec Kit branch invokes `pforge crucible import --from=spec-kit --dry-run --json` (tool call), shows the user the mapping report, then invokes the non-dry-run command on confirmation. Preserve interview UX, "Start fresh" branch, and the `crucibleId` frontmatter format. Regression test greps for the new tool-call pattern.
**Validation gate**:
```bash
grep -q 'pforge crucible import' .github/prompts/step0-specify-feature.prompt.md
test -f pforge-mcp/tests/step0-prompt-speckit.test.mjs
bash -c "cd pforge-mcp && npx vitest run tests/step0-prompt-speckit.test.mjs"
```
**Estimated cost**: $0.40

### Slice 7 — Documentation rewrite
**Files in scope**: `docs/manual/spec-kit-interop.html`
**Goal**: Rewrite to match shipping behavior. Fix smelt path (`.forge/crucible/`), remove `pforge harden` (use `/step2-harden-plan`), remove `pforge ext status spec-kit-interop` (no such command), move `pforge crucible export` references to a "Roadmap" callout. Verify every documented command exists by greppping the codebase.
**Validation gate**:
```bash
grep -q 'pforge crucible import' docs/manual/spec-kit-interop.html
bash -c "! grep -q '\\.forge/smelts/' docs/manual/spec-kit-interop.html"
bash -c "! grep -q 'pforge harden' docs/manual/spec-kit-interop.html"
bash -c "! grep -q 'pforge ext status' docs/manual/spec-kit-interop.html"
```
**Estimated cost**: $0.20

### Slice 8 — Version bump + CHANGELOG
**Files in scope**: `VERSION`, `CHANGELOG.md`
**Goal**: Minor bump (new public surface). CHANGELOG entry under "Added" describing CLI subcommand, MCP tools, slash-command refactor.
**Validation gate**:
```bash
grep -qE '^[0-9]+\.[0-9]+\.[0-9]+' VERSION
grep -q 'pforge crucible' CHANGELOG.md
grep -q 'forge_crucible_import' CHANGELOG.md
```
**Estimated cost**: $0.05

---

## Branch Strategy

- Branch name: `feat/crucible-import-cli`
- Base: `master`
- Merge strategy: Squash merge after all 8 slices pass and Step 5 Review is clean (with explicit attention to Slice 6's prompt refactor)

## Rollback Plan

- **Slices 1–5** (importer module, CLI, MCP tool, integration test): rollback via `git revert <merge-commit>`. The importer is a self-contained module; CLI and MCP entries are additive. Removing them only loses the `pforge crucible` subcommand and the two MCP tools — no other Plan Forge surface depends on them.
- **Slice 6** (prompt refactor): the highest-risk rollback point. If the prompt refactor regresses Copilot Chat UX, revert just the prompt file. The importer module + CLI + MCP tools remain functional standalone; only the slash-command convenience is lost. Ship the rest, file a follow-up bug.
- **Slice 7** (doc rewrite): trivial git revert.
- **Slice 8** (version + CHANGELOG): trivial revert, re-bump if needed.
- No data migrations. No DB changes. The `.forge/crucible/manual-imports.jsonl` audit log is append-only — old entries unaffected by rollback.

---

## Open Decisions (resolve during Step 2 hardening)

1. **Markdown parser**: `remark` + `remark-frontmatter` (robust, +2 deps) vs hand-rolled regex (matches existing `crucible-enforce.mjs` style, no deps). Recommend `remark`.
2. **`pforge crucible export` in this phase or deferred?** Recommend defer (Phase CRUCIBLE-EXPORT-CLI).
3. **Phase Plan filename source**: slugified `spec.md` title vs user-provided `--name` flag. Recommend slugified title with `--name` override.
4. **Slash-command refactor scope**: full rewrite vs minimal "swap the mapping call". Recommend minimal.
5. **`--sync-principles` on existing PROJECT-PRINCIPLES.md**: error vs merge vs prompt. Recommend error this phase, merge in a follow-up.
6. **Fixture provenance**: real `github/spec-kit` run (recommended, pin SHA) vs hand-crafted (lighter, less honest).
7. **MCP tool naming**: `forge_crucible_import` vs `forge_crucible_speckit_import`. Recommend the shorter form since `source: "spec-kit"` is in the schema.

---

## References

- Existing slash command (refactor target): [.github/prompts/step0-specify-feature.prompt.md](../../.github/prompts/step0-specify-feature.prompt.md) lines 40–80
- Existing Crucible enforcement (read-only): [pforge-mcp/crucible-enforce.mjs](../../pforge-mcp/crucible-enforce.mjs)
- Existing manual-import bypass (untouched): `pforge run-plan --manual-import --manual-import-source speckit` — see [pforge.ps1](../../pforge.ps1) line 4041
- Manual page being rewritten: [docs/manual/spec-kit-interop.html](../manual/spec-kit-interop.html)
- Plan Forge format reference: [Phase-GITHUB-A-INTROSPECTION-PLAN.md](Phase-GITHUB-A-INTROSPECTION-PLAN.md) (similar shape: new CLI subcommand + MCP tool + doc + tests)
- Memory note: `/memories/repo/plan-gate-command-rules.md` — gate portability rules
- Memory note: `/memories/repo/setup-update-invariants.md` — keeping ps1 + sh in lockstep
- External: [github/spec-kit](https://github.com/github/spec-kit) — pin a SHA for fixture capture
