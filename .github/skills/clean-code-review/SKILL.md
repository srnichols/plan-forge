---
name: clean-code-review
description: Run a comprehensive Clean Code audit against the codebase — module size, function complexity, long parameter lists, TODO/FIXME markers, commented-out code, duplication (DRY), Boy Scout delta, dead exports, test smells, and ESLint violations — then produce a structured findings report with optional fix suggestions.
argument-hint: "[--scope <glob>] [--fix-suggestions] [--out <path>]"
tools: [read_file, run_in_terminal, file_search, grep_search]
tags: [clean-code-review]
---

# `/clean-code-review` Skill

## Trigger

"Run a clean code review" / "Audit the codebase for Clean Code violations" / "Check code quality" / `/clean-code-review`

## Purpose

Orchestrates the existing audit scripts in `scripts/audit/` plus the custom ESLint config (`scripts/audit/eslint-clean-code.config.mjs`) into a single pass. Produces a structured report covering all six Phase 42 finding categories, with an optional `--fix-suggestions` mode that emits concrete refactoring guidance for each violation.

## Inputs

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--scope <glob>` | No | `pforge-mcp/**/*.mjs,pforge-master/**/*.mjs` | Comma-separated globs limiting the audit scope |
| `--fix-suggestions` | No | off | When present, each finding includes a concrete fix suggestion (extract helper, rename, wrap params in options object, etc.) |
| `--out <path>` | No | stdout (formatted) | Write the full JSON report to this path instead of printing a summary |
| `--severity <level>` | No | `warn` | Minimum severity to report: `error`, `warn`, or `info` |

## Steps

### 1. Run module-size audit

```bash
node scripts/audit/measure-modules.mjs
```

Parse `docs/plans/cleanup-findings/raw/module-metrics.json`. Flag files exceeding the G14 thresholds:

| LOC | Severity | Action |
|-----|----------|--------|
| >3,000 | **error** | Blocking — extract sub-modules |
| 1,000–3,000 | **warn** | Monitor — extract on next feature touch |
| <1,000 | info | No action |

### 2. Run grep-matrix scan

```bash
node scripts/audit/grep-matrix.mjs
```

Parse `docs/plans/cleanup-findings/raw/grep-matrix-report.json`. Report:
- TODO / FIXME / HACK / XXX markers (each is a finding)
- Commented-out code blocks (≥4 consecutive lines of commented code-like patterns)
- `console.log` count (bulk advisory)

### 3. Run long-parameter-list walker

```bash
node scripts/audit/long-param-walker.mjs
```

Parse `docs/plans/cleanup-findings/raw/long-param-report.json`. Flag call sites with >5 positional arguments.

### 4. Run ESLint with clean-code config

```bash
npx eslint --no-eslintrc -c scripts/audit/eslint-clean-code.config.mjs --format json "pforge-mcp/**/*.mjs" "pforge-master/**/*.mjs"
```

Parse ESLint JSON output. Categorise violations:

| Rule | Category | Severity |
|------|----------|----------|
| `complexity-error` | Cyclomatic complexity | error |
| `complexity-warn` | Cyclomatic complexity | warn |
| `max-lines-per-function-error` | Function length | error |
| `max-lines-per-function-warn` | Function length | warn |
| `max-params-error` | Parameter count | error |
| `max-params-warn` | Parameter count | warn |
| `max-depth` | Nesting depth | warn |
| `max-nested-callbacks` | Callback nesting | warn |
| `no-magic-numbers` | Magic numbers | warn |

### 5. Run duplication detection (DRY)

```bash
node scripts/audit/run-jscpd.mjs
```

Parse `docs/plans/cleanup-findings/raw/duplication-report.json`. For each `duplicates[]` entry report:
- First file + line range, second file + line range, token count
- Group by token-count descending; show top 10

> **Why this matters**: The Phase 41 enums centralization existed because the same string literal had been copy-pasted across 50+ files. `jscpd` catches duplicated *code blocks* mechanically; the literal/symbol patterns documented in `clean-code.instructions.md` (DRY section) still require human eyes at review time.

### 6. (Optional) Run architecture scan

```bash
node scripts/audit/scan-architecture.mjs
```

Parse `docs/plans/cleanup-findings/raw/architecture-report.json`. Report:
- Dependency cycles (Tarjan SCC with ≥2 nodes)
- Cross-layer imports (inner circle depending on outer)
- High fan-in volatile modules
- High fan-out unstable modules

### 7. Run Boy Scout delta check

```bash
node scripts/audit/boyscout-delta.mjs
node scripts/audit/boyscout-delta.mjs --base origin/master
node scripts/audit/boyscout-delta.mjs --base HEAD~1 --include "pforge-mcp/**"
```

Parse `docs/plans/cleanup-findings/raw/boyscout-delta-report.json`. For every file changed since the merge-base, report:
- `boy-scout-violation` — file was edited but ESLint violation count did **not** decrease
- `regression` — file was edited and violation count **increased** (treat as error)
- `improved` — violation count decreased (Boy Scout pass; surface as positive signal in summary)

> **Why this matters**: The Boy Scout Rule in [architecture-principles.instructions.md](../../instructions/architecture-principles.instructions.md) says "every commit touching a file must leave it cleaner." Without a delta check the rule is aspirational. This step makes it enforceable — a PR that touches `orchestrator.mjs` for a feature fix must also clean up at least one existing warning in that file.

### 8. Dead-exports scan

```bash
node scripts/audit/dead-exports.mjs
node scripts/audit/dead-exports.mjs --scope "pforge-mcp"
```

Parse `docs/plans/cleanup-findings/raw/dead-exports-report.json`. For every exported name that no other tracked file imports, report:
- `file` — the module that exports the dead symbol(s)
- `deadExports[]` — symbol names with no consumer
- `totalExports` — how many exports the file has total (ratio dead/total signals refactor candidates)

Entry-point modules (`server.mjs`, `*-cli.mjs`, `scripts/audit/*.mjs`) and files consumed via `import *` are skipped automatically. Dynamic `import()` and external-tool consumers are not tracked — apply judgment before deleting.

> **Why this matters**: Dead exports widen the public surface (so `surface-diff` flags more "breaking" candidates to triage), obscure which symbols are real API, and keep dead code paths alive. A high dead-export ratio in a single file (e.g. 8/12) is a strong signal the module's responsibility has drifted — split it or prune.

### 9. Test-smells scan

```bash
node scripts/audit/test-smells.mjs
node scripts/audit/test-smells.mjs --severity error
```

Parse `docs/plans/cleanup-findings/raw/test-smells-report.json`. Findings are categorised by smell:

| Smell | Severity | Meaning |
|-------|----------|---------|
| `FOCUS-LEAK` | error | `.only(` committed — would skip every other test in the file under vitest |
| `TAUTOLOGY` | error | `expect(true).toBe(true)` and similar — asserts nothing |
| `EMPTY-TEST` | error | `it("...", () => {})` empty body |
| `SKIP-LEAK` | warn | `.skip(` / `xit(` / `xtest(` — silently disabled tests |
| `TIME-FLAKE` | warn | `setTimeout` / `Math.random` / `Date.now` without `useFakeTimers` or `+Nms` tolerance comment |
| `CONSOLE-LEAK` | warn | `console.log/error/warn` in tests — debug leftover |
| `TODO-MARKER` | info | `it.todo(` — track in an issue |

The script **exits non-zero** if any error-severity finding is present. Use this as a pre-merge gate.

> **Why this matters**: Phase 41 S5 timeline-core flaked because a `+5ms` tolerance was too tight for the Windows scheduler. The fix was bumping to `+50ms`. `TIME-FLAKE` catches the class of bug — any time-sensitive test without an explicit tolerance comment is a future flake waiting for the worst possible PR to land on.

### 10. Aggregate and report

Merge all findings into a unified report grouped by category:

```
┌─────────────────────────────────────────────┐
│  Clean Code Review — <timestamp>            │
├─────────────────────────────────────────────┤
│  Category           │ Errors │ Warnings     │
│  ───────────────────┼────────┼──────────    │
│  Module size (G14)  │   3    │    5         │
│  Function length    │   2    │   14         │
│  Complexity         │   8    │   22         │
│  Parameter count    │   0    │    6         │
│  Markers (TODO/etc) │   —    │    4         │
│  Commented code     │   —    │    2         │
│  console.log        │   —    │  bulk        │
│  Duplication (DRY)  │   —    │    7         │
│  Architecture       │   1    │    3         │
│  Boy Scout delta    │   N    │    M         │
│  Dead exports       │   —    │    N         │
│  Test smells        │   K    │    L         │
├─────────────────────────────────────────────┤
│  Total: 14 errors, 56 warnings              │
└─────────────────────────────────────────────┘
```

If `--out <path>` is provided, write the full JSON report. Otherwise print the summary table and the top 10 highest-severity findings with file paths and line numbers.

### 11. (Optional) Generate fix suggestions (`--fix-suggestions`)

When `--fix-suggestions` is present, append a concrete remediation for each finding:

| Finding type | Fix suggestion pattern |
|-------------|----------------------|
| Function >300 LOC | "Extract `<identified-block>` into a helper function `<suggested-name>` in the same module" |
| Complexity >20 | "Replace nested conditionals at line N with early-return guard clauses" |
| >6 positional params | "Wrap parameters into an `options` object: `{ paramA, paramB, ... }`" |
| TODO/FIXME marker | "Convert to a tracked issue via `forge_bug_file` or remove if resolved" |
| Commented-out code | "Delete lines N–M; the code is preserved in git history (`git log -p -- <file>`)" |
| Module >3,000 LOC | "Split by responsibility: extract `<cohesive-group>` into `<suggested-file>.mjs`" |
| Magic number | "Extract `<value>` at line N to a named constant: `const <SUGGESTED_NAME> = <value>`" |
| Dependency cycle | "Break cycle by extracting shared interface into a new module depended on by both sides" |
| Duplicated block (jscpd) | "Extract the duplicated block at <file>:<line> into a shared helper in the nearest common module" |
| Boy Scout violation | "You edited <file> without reducing violations. Either fix one existing warning in this file (preferred), or document why this PR explicitly avoids touching unrelated code" |
| Dead export | "Either delete the unused export at <file>:<name> (preferred — git preserves history), or document why it's a public API (e.g. plugin contract) and add a `// @public` comment" |
| Test smell FOCUS-LEAK | "Remove `.only` from <file>:<line> — focused tests skip every other test in the file when committed" |
| Test smell TIME-FLAKE | "Wrap the test in `vi.useFakeTimers()` + `vi.advanceTimersByTime()`, or add an explicit tolerance assertion like `expect(elapsed).toBeLessThan(target + 50)`" |
| Test smell CONSOLE-LEAK | "Remove `console.log/error/warn` at <file>:<line> — if you need debugging output, use `vi.spyOn(console, 'log')` and assert on it" |

Fix suggestions are advisory — they do NOT modify code. The agent or user applies them in a follow-up step.

## Conditional: No audit scripts found

> If `scripts/audit/` does not exist or is empty, tell the user to run `setup.ps1` / `setup.sh` to install Plan Forge, then stop. Do **not** attempt to recreate the audit scripts from memory.

## Conditional: ESLint not available

> If `npx eslint` fails (not installed), skip Step 4 and note "ESLint scan skipped — install eslint to enable complexity/params/function-length checks" in the report. The remaining steps still produce useful output.

## Safety Rules

- **Read-only**: This skill analyses code. It MUST NOT modify any source files.
- **No false positives invented**: Every finding must come from a script output or ESLint result. Do not add findings from general knowledge.
- **Scope-bound**: Only scan files matching `--scope`. Do not expand scope silently.
- **Deterministic**: Running the skill twice on the same codebase must produce the same findings.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "I'll eyeball the code instead of running the scripts" | Misses findings the scripts catch mechanically; inconsistent coverage between runs |
| "Skip ESLint — the other scripts cover enough" | ESLint is the only tool that measures cyclomatic complexity and function length with AST precision; regex approximations miss edge cases |
| "Report all console.log as individual findings" | There are hundreds; the grep-matrix intentionally bulk-triages them as one advisory. Individual reporting floods the report with noise |
| "Generate fix suggestions without `--fix-suggestions` flag" | Unsolicited suggestions clutter the report and distract from triage. The user opts in when ready to remediate |
| "Modify the source code to fix findings" | This is a review skill, not a fix skill. Modifying code without explicit user intent violates read-only safety |

## Warning Signs

- Report shows zero findings in a codebase with known high-severity files — script likely errored silently; check raw JSON outputs
- ESLint reports only warnings but no errors on `orchestrator.mjs` — config may not have loaded; verify `--no-eslintrc -c` path
- `--fix-suggestions` output recommends splitting a file that is <500 LOC — threshold miscalibrated; review against G14 thresholds
- Architecture scan shows no cycles but `scan-architecture.mjs` had madge errors — report the errors, don't suppress them

## Exit Proof

After completing this skill, confirm:

- [ ] All available audit scripts were executed (measure-modules, grep-matrix, long-param-walker, ESLint, run-jscpd, boyscout-delta, dead-exports, test-smells)
- [ ] Findings are grouped by category with error/warning counts
- [ ] If `--fix-suggestions` was requested, each finding has a concrete remediation
- [ ] If `--out` was specified, JSON report exists at the given path
- [ ] No source files were modified during the review

## Relationship to Other Tools

| Tool / Instruction | Relationship |
|-------------------|-------------|
| `.github/instructions/clean-code.instructions.md` | Defines the thresholds and checklist this skill enforces mechanically |
| `.github/instructions/architecture-principles.instructions.md` | Provides the architectural rules the architecture scan validates |
| `scripts/audit/*.mjs` | The actual audit implementations this skill orchestrates |
| `scripts/audit/eslint-clean-code.config.mjs` | Custom ESLint config with aliased clean-code rules |
| `scripts/audit/run-jscpd.mjs` | Duplication detection (jscpd) — wired into Step 5 |
| `scripts/audit/boyscout-delta.mjs` | Boy Scout Rule enforcement — compares per-file violation counts at merge-base vs HEAD; wired into Step 7 |
| `scripts/audit/dead-exports.mjs` | Whole-codebase unused-export scan — wired into Step 8 |
| `scripts/audit/test-smells.mjs` | Test-quality scan (focus leaks, time flakes, tautologies, console leaks) — wired into Step 9 |
| `forge_sweep` | Lighter-weight marker scan (TODO/FIXME only); this skill is the comprehensive version |
| `/code-review` skill | **Run `/clean-code-review` FIRST, then `/code-review`.** This skill is the mechanical/quantitative pass (LOC, complexity, params, duplication, ESLint). `/code-review` is the qualitative/judgment pass (architecture, security, patterns, tests). Mechanical findings clear the noise so the human-judgment review can focus on what actually requires judgment. |
