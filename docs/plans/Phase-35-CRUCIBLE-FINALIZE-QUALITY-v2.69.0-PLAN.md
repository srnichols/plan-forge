---
phase: 35
version: 2.69.0
crucibleId: imported-meta-bug-118
lane: feature
source: github-issues
linkedBugs: [118]
manualImport: true
manualImportSource: meta-bug-roadmap
manualImportReason: Crucible finalize emits TBD-laden drafts that orchestrator rubber-stamps. Behavior-changing: adds inference + refuse-on-gaps gate. Minor bump.
model: claude-sonnet-4.6
---

# Phase-35 — Crucible Finalize Quality (v2.69.0)

## Goal

Fix bug #118 — `forge_crucible_finalize` emits drafts with TBD placeholders for Build command, Test command, scope paths, Forbidden Actions, and concrete Acceptance Criteria. The orchestrator then "passes" these slices without doing real work. After this phase, finalize must either:

1. Produce an executable plan: at least one concrete `### Slice 1` with Build command, Test command, Files manifest, and Acceptance Criteria checklist with non-TBD content; **or**
2. Refuse to finalize, returning a structured `unresolvedFields` list and an HTTP-friendly error so the operator runs another interview round.

## Forbidden Actions

- Do not invent file paths the user hasn't declared. When `scope-files` is empty, refuse — never hallucinate.
- Do not invent test/build commands when the repo has no recognizable manifest. Surface the gap instead.
- Do not bypass the existing `{{TBD: ...}}` rendering for fields that genuinely have no answer — only synthesize when an answer or repo signal exists.
- Do not change the `forge_crucible_finalize` tool name or top-level return shape — only enrich it (add `unresolvedFields`, `inferred`, `refused` keys).
- Do not modify `crucible-store.mjs` schema fields without migrating existing on-disk smelts.

## Acceptance Criteria

### Criteria for Slice 1 — Repo command inference helper

- New exported function `inferRepoCommands(cwd)` in `pforge-mcp/crucible-draft.mjs` (or new `pforge-mcp/crucible-infer.mjs`) returns `{ buildCommand, testCommand, manifestFile, source }` where:
  - Detection order:
    1. `package.json` with `scripts.build` / `scripts.test` → `{ buildCommand: "npm run build", testCommand: "npm test", manifestFile: "package.json" }` (or `pnpm` / `yarn` if `pnpm-lock.yaml` / `yarn.lock` present).
    2. Any `*.csproj` or `*.sln` → `dotnet build` / `dotnet test`.
    3. `Cargo.toml` → `cargo build` / `cargo test`.
    4. `pyproject.toml` or `setup.py` → infer pytest if `pytest` in deps else `python -m unittest discover`; build = `python -m build` if `pyproject.toml`.
    5. `go.mod` → `go build ./...` / `go test ./...`.
  - When no manifest matches: returns `{ buildCommand: null, testCommand: null, manifestFile: null, source: "none" }`.
  - `source` is the manifest filename (e.g., `"package.json"`) or `"none"`.
- Unit test `pforge-mcp/tests/crucible-infer.test.js` covers package.json (npm), package.json + pnpm-lock, dotnet, cargo, pyproject pytest, go.mod, and the no-manifest case using temp-dir fixtures.
- Validation gate: `npx vitest run pforge-mcp/tests/crucible-infer.test.js --reporter=basic`.

### Criteria for Slice 2 — Slice synthesis from interview answers

- New exported function `synthesizeSliceBlock({ smelt, repoCommands })` in `pforge-mcp/crucible-draft.mjs` returns either:
  - A markdown string starting with `### Slice 1 — <title>` containing **Build command:**, **Test command:**, **Files:**, **Acceptance Criteria:** sections — only when `scope-files`/`scope-in` answer is present AND `repoCommands.buildCommand && repoCommands.testCommand` are non-null; **or**
  - `null` when prerequisites aren't met (caller falls back to existing template comment).
- Acceptance Criteria are derived from the interview's `validation-gates` answer split into bullet checkboxes (`- [ ] ...`). If absent, the function returns `null`.
- The slice title is taken from `feature-name` answer (truncated to 60 chars) or first 60 chars of the rawIdea.
- `renderDraft(smelt, { cwd })` accepts an optional second argument carrying `cwd`; when supplied, it calls `inferRepoCommands(cwd)` and `synthesizeSliceBlock` and replaces the existing `> Slice template:` block when synthesis succeeds. Backward-compat: existing callers without `cwd` get the unchanged template behavior.
- Tests in `pforge-mcp/tests/crucible-synthesize.test.js`:
  - With package.json scripts + scope-files + validation-gates answers → output contains `### Slice 1 —`, `Build command: npm`, `Test command: npm`, and a `- [ ]` checkbox.
  - Missing scope-files → returns null, draft falls through to template comment + `{{TBD: scope-files}}`.
  - Missing repoCommands → returns null.
- Validation gate: `npx vitest run pforge-mcp/tests/crucible-synthesize.test.js --reporter=basic`.

### Criteria for Slice 3 — Refuse-on-gaps finalize gate

- `handleFinalize({ id, projectDir, hub })` in `pforge-mcp/crucible-server.mjs`:
  - After rendering the draft, scans the output for unresolved `{{TBD: <field>}}` markers via the existing `extractUnresolvedFields` helper.
  - Computes `criticalGaps`: the subset of unresolved fields ∈ `["scope-in", "scope-files", "validation-gates", "validation", "forbidden-actions"]`.
  - When `criticalGaps.length > 0`: throws `CrucibleFinalizeRefusedError` with `{ id, criticalGaps, hint: "Run forge_crucible_ask with these question IDs to fill the gaps before finalizing." }`. Smelt status remains `in-progress`. No `Phase-NN.md` is written.
  - When `criticalGaps.length === 0`: existing finalize path runs unchanged + the returned object includes `unresolvedFields: [...]` (non-critical TBDs only, e.g., rollback) and `inferred: { buildCommand, testCommand, manifestFile }` from the inference step.
- New test `pforge-mcp/tests/crucible-finalize-refuse.test.js`:
  - Smelt with `scope-files` answered, `validation-gates` answered, `forbidden-actions` answered, in a tempdir with package.json → finalize succeeds, returned object includes `inferred.buildCommand === "npm run build"`.
  - Smelt missing `validation-gates` → finalize throws `CrucibleFinalizeRefusedError` with `criticalGaps` containing `"validation-gates"`. No file is written under `docs/plans/`.
- Validation gate: `npx vitest run pforge-mcp/tests/crucible-finalize-refuse.test.js --reporter=basic`.

### Criteria for Slice 4 — Tool surface + docs

- `pforge-mcp/tools.json` `forge_crucible_finalize` description appended with: `Refuses to finalize when critical fields (scope-in/scope-files, validation-gates, forbidden-actions) are unresolved. Returns inferred build/test commands when a recognized manifest (package.json, *.csproj, Cargo.toml, pyproject.toml, go.mod) is present.`
- The MCP server's `forge_crucible_finalize` tool handler maps the new `CrucibleFinalizeRefusedError` to a structured response: `{ ok: false, refused: true, criticalGaps, hint }` instead of a raw error.
- New test `pforge-mcp/tests/crucible-finalize-tool-surface.test.js` asserts the structured-refusal shape from the MCP entry point.
- Validation gate: `npx vitest run pforge-mcp/tests/crucible-finalize-tool-surface.test.js --reporter=basic`.

### Criteria for Slice 5 — Release v2.69.0

- `pforge-mcp/package.json` and `package.json` versions bumped to `2.69.0`.
- `CHANGELOG.md` has a new `## 2.69.0` section with: `feat(crucible): finalize emits executable plans (#118) — infers build/test from package.json/dotnet/cargo/pyproject/go, synthesizes Slice 1 from interview answers, refuses with criticalGaps when scope/validation/forbidden are unresolved`.
- A git tag `v2.69.0` is created on the resulting commit.
- Validation gate: `node -e "const p=require('./pforge-mcp/package.json'); if(p.version!=='2.69.0'){process.exit(1)}; const fs=require('fs'); if(!fs.readFileSync('CHANGELOG.md','utf8').includes('## 2.69.0')){process.exit(1)}"`.

## Slice Plan

### Slice 1 — Repo command inference helper

- Create `pforge-mcp/crucible-infer.mjs` exporting `inferRepoCommands(cwd)`.
- Detection helpers (each returns null if no match):
  - `detectNode(cwd)`: read `package.json`. Pick package manager from lockfile (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm). Build = `<pm> run build` if `scripts.build` exists, else null. Test = `<pm> test` if `scripts.test` exists, else null.
  - `detectDotnet(cwd)`: glob for `*.sln` then `*.csproj`. Returns `dotnet build` / `dotnet test` if any.
  - `detectCargo(cwd)`: existsSync `Cargo.toml`.
  - `detectPython(cwd)`: existsSync `pyproject.toml` || `setup.py`. Build = `python -m build` if pyproject. Test = `pytest` if `pytest` is in `[project.optional-dependencies.dev]`/`[tool.pytest]` block, else `python -m unittest discover`.
  - `detectGo(cwd)`: existsSync `go.mod`.
- Iterate through detectors in the documented priority order; return first match.
- Tests in `pforge-mcp/tests/crucible-infer.test.js` use `mkdtempSync` + `writeFileSync` to build minimal repos.
- Validation: `npx vitest run pforge-mcp/tests/crucible-infer.test.js --reporter=basic`.

### Slice 2 — Slice synthesis from interview answers

- In `pforge-mcp/crucible-draft.mjs`, add `synthesizeSliceBlock({ smelt, repoCommands })`.
- Implementation:
  - Index answers via existing `indexAnswers`.
  - Pull `scope-files` / `scope-in` answer → split to bullet list of files.
  - Pull `validation-gates` / `validation` answer → split lines, prefix each with `- [ ] `.
  - If either is empty or `repoCommands.buildCommand`/`testCommand` is null → return `null`.
  - Compose the slice block:
    ```
    ### Slice 1 — <title>
    
    Build command: <buildCommand>
    Test command:  <testCommand>
    
    **Files**:
    <files-bulleted>
    
    **Acceptance Criteria**:
    <gates-checkbox>
    ```
- Modify `renderDraft(smelt, options = {})` signature; when `options.cwd` is set, call inference + synthesis and substitute the synthesized block in place of the `> Slice template:` lines.
- Tests in `pforge-mcp/tests/crucible-synthesize.test.js` cover the three documented cases.
- Validation: `npx vitest run pforge-mcp/tests/crucible-synthesize.test.js --reporter=basic`.

### Slice 3 — Refuse-on-gaps finalize gate

- In `pforge-mcp/crucible-server.mjs`, define `class CrucibleFinalizeRefusedError extends Error { constructor(payload) { super(payload.hint || "finalize refused"); this.payload = payload; } }` exported.
- Update `handleFinalize`:
  - After computing `draftBody`, run `extractUnresolvedFields(draftBody)` (existing helper in `crucible-draft.mjs`).
  - Define `CRITICAL_FIELDS = new Set(["scope-in", "scope-files", "validation-gates", "validation", "forbidden-actions"])`.
  - Compute `criticalGaps = unresolvedFields.filter(f => CRITICAL_FIELDS.has(f))`.
  - If `criticalGaps.length > 0`: throw `new CrucibleFinalizeRefusedError({ id, criticalGaps, hint: "..." })`. Do not write the plan file.
  - Otherwise: pass `cwd: projectDir` into `renderDraft` so synthesis runs; include `unresolvedFields` (non-critical) and `inferred` (from `inferRepoCommands(projectDir)`) on the return object.
- Tests in `pforge-mcp/tests/crucible-finalize-refuse.test.js` use a mocked smelt store + tempdir.
- Validation: `npx vitest run pforge-mcp/tests/crucible-finalize-refuse.test.js --reporter=basic`.

### Slice 4 — Tool surface + docs

- Append the documented sentence to `forge_crucible_finalize.description` in `pforge-mcp/tools.json`.
- In `pforge-mcp/server.mjs`, find the `forge_crucible_finalize` handler. Wrap the call in `try/catch` that detects `err instanceof CrucibleFinalizeRefusedError` (import the class) and returns `{ ok: false, refused: true, criticalGaps: err.payload.criticalGaps, hint: err.payload.hint }` instead of re-throwing.
- New test `pforge-mcp/tests/crucible-finalize-tool-surface.test.js` exercises the handler directly with a stubbed smelt.
- Validation: `npx vitest run pforge-mcp/tests/crucible-finalize-tool-surface.test.js --reporter=basic`.

### Slice 5 — Release v2.69.0

- Bump `pforge-mcp/package.json` and root `package.json` to `2.69.0`.
- Prepend `## 2.69.0` to `CHANGELOG.md` with the documented entry.
- Commit `chore(release): v2.69.0 — Crucible finalize quality (#118)` and tag `v2.69.0`.
- Validation: `node -e "const p=require('./pforge-mcp/package.json'); if(p.version!=='2.69.0'){process.exit(1)}; const fs=require('fs'); if(!fs.readFileSync('CHANGELOG.md','utf8').includes('## 2.69.0')){process.exit(1)}"`.
