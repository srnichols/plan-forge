# Phase 42 — CLEAN-CODE-AUDIT — Read-only Clean Code audit + cleanup queue

> **Status**: **DRAFT — pending Step-2 harden**. Do NOT execute. Sign-off needed on §"Scope Contract" + §"Resolved Decisions" before running `step2-harden-plan.prompt.md`.
> **Source**: Carryover from Phase 41 (ENUMS-CENTRALIZATION) planning. User asked whether the cleanup phase should look for more things like those covered in Clean Code (Robert C. "Uncle Bob" Martin, 2nd Edition, 2025). The answer was "audit, then targeted fix phases" — this is the audit.
> **Tracks**: `docs/plans/cleanup-findings/` (NEW directory — only output), tooling-only changes to `scripts/audit/`, no production code touched.
> **Estimated cost**: low. Zero LLM-cost surfaces. Mostly ESLint rule pack + grep + cloc + jscpd.
> **Pipeline**: Specify ✅ → Harden ⏳ → HOLD → Execute → S5 retro. **No QA/E2E slice** because this phase produces no behavior change; the "QA" is reviewing the catalog for false positives.
> **Recommended starting slice**: **S0 → S1 → S2** (tooling → run → triage). Worst case S3 (phase stub drafting) reveals the catalog is too granular and we re-triage.
> **Session budget**: 6 slices. Recommend one session — phase is bounded and read-only, low cognitive overhead per slice.

---

## Execution Hold

Hardened plan MUST NOT execute until:

- [ ] **Phase 41 (ENUMS-CENTRALIZATION) has shipped**. Without enums, the audit would re-catalog the same duplication that enums eliminated (false positives in the G5 category).
- [ ] `master` is clean
- [ ] `lockHash` (added in Step-2 harden) matches plan body at run time
- [ ] No competing in-flight plan is restructuring `pforge-mcp/`, `pforge-master/`, or the root CLIs. (Audit measures a moving target if the codebase is mid-refactor.)

**To resume**: change Status to `HARDENED — cleared for execution YYYY-MM-DD` and run `pforge run-plan docs/plans/Phase-42-CLEAN-CODE-AUDIT-PLAN.md`.

---

## Why this phase exists

Phase 41 centralized stable identifiers — one specific category of duplication (Clean Code G5). The planning conversation surfaced the broader question: **what else needs cleanup that follows the same "stable, code-quality, no functionality change" pattern?**

Rather than expand Phase 41 into an open-ended refactor (Temper Guard violation: "we'll also clean up X while we're here"), this phase produces a **read-only catalog of findings** mapped to Clean Code 2nd Edition chapters and heuristics. The output feeds a prioritized queue of focused fix phases (Phase 43+) — each with its own tight Scope Contract.

The phase deliberately does **not** fix anything. Fixes are scoped, prioritized, and funded individually.

---

## Scope Contract

### In Scope

**S0 — Tooling setup**:
- `scripts/audit/` directory (NEW) — all audit tooling lives here
- `scripts/audit/eslint-clean-code.config.mjs` — ESLint config with rule pack targeting measurable Clean Code heuristics:
  - `max-lines-per-function` (warn at 50, error at 150) — Clean Code F3
  - `max-params` (warn at 4) — Clean Code F4
  - `complexity` (cyclomatic, warn at 10) — Clean Code G16
  - `max-depth` (warn at 4) — Clean Code G34
  - `max-nested-callbacks` (warn at 3) — Clean Code G34
  - `no-magic-numbers` (warn, with sensible ignores) — Clean Code G25
- `scripts/audit/run-jscpd.mjs` — duplicate-code detector wrapper (jscpd npm pkg), threshold 50 tokens, scoped to `pforge-mcp/**`, `pforge-master/**`, `pforge.ps1`, `pforge.sh`
- `scripts/audit/grep-matrix.mjs` — custom grep sweep for non-AST patterns: dead/lying comments (`// TODO:` older than 90 days via git blame), commented-out code blocks (>3 consecutive comment lines containing code-like syntax), `console.log` in production paths, `// HACK` / `// XXX` markers
- `scripts/audit/measure-modules.mjs` — emits per-file line counts, function counts, export counts (cloc wrapper) — feeds the G14 (God module) detector
- `scripts/audit/long-param-walker.mjs` — AST walk for >5-param call sites
- `package.json` — new devDependencies (`jscpd`, `eslint`, `@typescript-eslint/parser` for JS too, `cloc`)
- `scripts/audit/README.md` — how to run, how to interpret, false-positive triage guide

**S1 — Run the audit toolchain**:
- Execute every tool in `scripts/audit/`; emit raw findings to `docs/plans/cleanup-findings/raw/`:
  - `eslint-report.json` — full ESLint output
  - `duplication-report.json` — jscpd output
  - `grep-matrix-report.json` — custom grep findings
  - `module-metrics.json` — per-file line/function/export counts
  - `long-param-report.json` — call sites with >5 args
- Capture tool versions and commit hash at run time into `docs/plans/cleanup-findings/raw/RUN-CONTEXT.md` so the audit is reproducible

**S2 — Triage & categorize**:
- New `docs/plans/cleanup-findings/CATALOG.md` — for each raw finding:
  - Map to Clean Code chapter or heuristic (e.g. `G5`, `F3`, `N1`, `T9`)
  - Assign severity: **high** (architectural debt, hot path), **medium** (maintainability friction), **low** (cosmetic)
  - Assign effort estimate: **S** (<1 day), **M** (1-3 days), **L** (>3 days)
  - Record file:line anchors
  - Note any **false positives** with reason (e.g. "the long parameter list in `runPlan()` is justified — each arg is independently configurable") — false-positive entries STAY in the catalog with a rationale so future audits don't re-flag
- New `docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md` — pivot table: category × severity × count, ordered by total severity weight

**S3 — Draft phase stubs for high-severity categories**:
- For each category that has ≥3 high-severity findings OR ≥1 high-severity finding with effort ≥M:
  - Create a 1-page stub at `docs/plans/cleanup-findings/proposed-phases/Phase-PROPOSED-<CATEGORY>-STUB.md`
  - Stub MUST include: provisional Scope Contract sketch (In Scope / Out of Scope / Forbidden Actions), estimated slice count, dependencies on other proposed phases, sample findings (3-5 file:line anchors)
  - Stub is NOT a full plan — it's the source material for Step-0 (Specify) to generate the real plan when a fix phase is funded
- Stubs are **proposals**, not commitments. Human review decides which to promote to numbered Phase 43+.

**S4 — Update guardrails to prevent regression**:
- `.github/instructions/architecture-principles.instructions.md` Temper Guards table — add 1–3 new entries derived from the highest-frequency Clean Code violations found (e.g. if F3 long-function dominates the catalog, add "Adding a 100-line function? STOP, decompose first")
- `.github/instructions/architecture-principles.instructions.md` Warning Signs section — add observable patterns matching the catalog's high-severity categories
- These additions are the **only** modifications to non-audit files this phase makes. They are guardrails against re-introducing the patterns we just catalogued.

**S5 — Retro + roadmap update**:
- `docs/plans/testbed-findings/Phase-42-CLEAN-CODE-AUDIT-retro.md` — what the audit found vs expected, which proposed phases got promoted, friction in the triage process, recommendations for the next audit (frequency, tooling improvements)
- `docs/plans/DEPLOYMENT-ROADMAP.md` — add promoted proposed phases as new numbered entries in Planned section
- `CHANGELOG.md` — one entry under `[Unreleased]`: `### Added — Clean Code audit catalog (read-only; no behavior change)`

### Out of Scope

- **Any code change in `pforge-mcp/`, `pforge-master/`, `pforge.ps1`, `pforge.sh`, or any production file.** The only allowed file modifications are: `scripts/audit/**`, `docs/plans/cleanup-findings/**`, `docs/plans/DEPLOYMENT-ROADMAP.md`, `.github/instructions/architecture-principles.instructions.md` (S4 guardrails only), `CHANGELOG.md`, `package.json` (devDependency additions only).
- **Fixing any finding.** Fixes belong to follow-up phases drafted from the S3 stubs.
- **Renaming, function decomposition, dead-code removal.** All Clean Code G/F/N category fixes.
- **Test refactoring.** T-category fixes belong to a separate phase if promoted.
- **Re-architecting any module.** G14 (God module) fixes are notoriously expensive and need their own multi-phase decomposition.
- **Linting auto-fix application.** ESLint runs in report mode only — `eslint --fix` is forbidden in this phase.
- **Subjective findings without measurable criteria.** "Code feels messy" is not a finding; "function exceeds 150 lines" is. Audit tools enforce this.
- **Changes to consumer-facing instruction files beyond the architecture-principles Temper Guards / Warning Signs additions** (S4 explicitly scoped).
- **Performance findings.** Performance is its own phase track (out of Clean Code's scope, in dedicated profiling work).
- **Security findings.** Security is its own phase track (`forge_secret_scan`, `forge_liveguard_run`, OWASP-driven audits live elsewhere).
- **Concurrency findings beyond noting them in the catalog.** Concurrency (Clean Code Ch.13) is risky to fix mechanically; flag but do not propose mechanical fix phases — those need senior eyes.
- Touching `pforge-sdk/`, `extensions/`, `presets/` (universal carveouts)
- Cross-repo audit (consuming projects) — single-repo only this phase

### Forbidden Actions

- **Do NOT run `eslint --fix`** at any point. Audit is read-only. Auto-fix would (a) silently change code, (b) prevent the human review the catalog exists to enable, (c) violate the no-behavior-change invariant.
- **Do NOT** modify any file under `pforge-mcp/`, `pforge-master/`, `pforge.ps1`, `pforge.sh`. The only `pforge-*` change permitted is `package.json` devDependency additions for ESLint/jscpd/cloc.
- **Do NOT** open any fix PR or fix commit during this phase, even for "trivially obvious" findings. Trivially obvious findings still need a fix phase Scope Contract — even a single-slice one — to maintain plan-disciplined execution.
- **Do NOT** include subjective findings ("this name is ugly", "this looks complicated"). Every catalog entry must trace to a measurable rule output or a verifiable grep match.
- **Do NOT** delete or rewrite anything in `docs/plans/cleanup-findings/raw/` after S1 emits it. Raw output is the audit's evidence trail; later slices add interpretation in adjacent files.
- **Do NOT** auto-prioritize stubs based on severity alone. Severity × effort × strategic value is a human decision. S3 stubs are proposals; promotion to Phase 43+ is explicit.
- **Do NOT** bundle slices. Each slice = one commit. S0 / S5 also each = one commit.
- **Do NOT** modify `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` (universal tripwire). (Mentioned for completeness even though this phase touches nothing in `pforge-mcp/`.)
- **Do NOT** include vendor model IDs, plan slice IDs, or extension names in the audit's "duplication" findings — these are intentionally distributed per existing architecture.
- **Do NOT** add new ESLint rules in S4. S4's allowed modification to architecture-principles is Temper Guards / Warning Signs text only. New ESLint rules are a separate phase.

---

## Resolved Decisions

Decisions locked at draft time; Step-2 hardener may sharpen but should not re-litigate.

1. **Read-only audit** — zero production code change. Fixes are downstream phases with their own Scope Contracts. This is the entire premise.
2. **Measurable criteria only** — every catalog entry traces to ESLint rule output, jscpd duplication block, custom grep match, or AST walk hit. Subjective findings (style, naming "ugliness") are explicitly out.
3. **Clean Code 2nd ed. as the rubric** — the catalog uses CC2 chapter + heuristic IDs (G1–G36, N1–N7, C1–C5, F1–F4, J1–J3, T1–T9) so future audits use the same taxonomy.
4. **False positives stay in the catalog** — with a rationale. This prevents re-flagging in future audits and documents architectural decisions ("this long parameter list is justified because…").
5. **Phase stubs ≠ committed phases** — S3 produces *proposals*. Promotion to numbered phases is a separate human decision in S5 or later.
6. **Guardrail update is the only side effect** — S4's Temper Guards / Warning Signs additions are the leverage: catching the pattern at write-time is more valuable than the audit itself.
7. **Concurrency findings flagged, not fixed-by-proposal** — Clean Code Ch.13 fixes require senior judgment; this phase flags them in the catalog but does NOT generate phase stubs for mechanical concurrency rewrites.
8. **No audit-frequency commitment** — S5 retro recommends cadence but the actual schedule is a roadmap decision, not a phase deliverable.
9. **Single-repo scope** — auditing consuming projects is out. Cross-repo audit would need entirely different tooling.
10. **Catalog format is durable** — `docs/plans/cleanup-findings/CATALOG.md` is a long-lived artifact. Future audits append rather than overwrite (use date-stamped sections).

---

## Slice Decomposition

### S0 — Tooling setup

- Create `scripts/audit/` directory with the 5 tooling scripts per §"In Scope" S0
- `package.json` — add devDependencies: `jscpd@^4`, `eslint@^9`, `cloc@^2` (or shell-out to system `cloc`)
- `scripts/audit/eslint-clean-code.config.mjs` — full rule pack per §"In Scope" S0
- `scripts/audit/README.md` — usage + false-positive triage guide
- Dry-run each script against a single file (`pforge-mcp/server.mjs`) to verify it produces non-empty output without crashing
- **Gate**: `bash -c "test -d scripts/audit && test -f scripts/audit/eslint-clean-code.config.mjs && test -f scripts/audit/run-jscpd.mjs && test -f scripts/audit/grep-matrix.mjs && test -f scripts/audit/measure-modules.mjs && test -f scripts/audit/long-param-walker.mjs && test -f scripts/audit/README.md && node scripts/audit/measure-modules.mjs --file pforge-mcp/server.mjs | grep -q 'lines'"` returns 0

### S1 — Run the audit

- Create `docs/plans/cleanup-findings/raw/` directory
- Capture run context (commit hash, tool versions, date) to `docs/plans/cleanup-findings/raw/RUN-CONTEXT.md`
- Run each audit tool against `pforge-mcp/**`, `pforge-master/**`, `pforge.ps1`, `pforge.sh`, `scripts/**` (excluding `scripts/audit/**`)
- Emit reports to `docs/plans/cleanup-findings/raw/`
- Verify each report file is non-empty
- **Gate**: `bash -c "test -f docs/plans/cleanup-findings/raw/eslint-report.json && test -f docs/plans/cleanup-findings/raw/duplication-report.json && test -f docs/plans/cleanup-findings/raw/grep-matrix-report.json && test -f docs/plans/cleanup-findings/raw/module-metrics.json && test -f docs/plans/cleanup-findings/raw/long-param-report.json && test -f docs/plans/cleanup-findings/raw/RUN-CONTEXT.md && for f in docs/plans/cleanup-findings/raw/*.json; do test -s \"$f\" || exit 1; done"` returns 0

### S2 — Triage & categorize

- New `docs/plans/cleanup-findings/CATALOG.md` — every raw finding mapped to category + severity + effort + file:line + rationale (or false-positive note)
- New `docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md` — pivot table category × severity × count
- Cross-check: every raw finding either appears in `CATALOG.md` OR is explicitly excluded with reason in `CATALOG.md`'s "Excluded findings" section
- **Gate**: `bash -c "test -f docs/plans/cleanup-findings/CATALOG.md && test -f docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md && grep -q '## Findings' docs/plans/cleanup-findings/CATALOG.md && grep -q '| Category |' docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md"` returns 0

### S3 — Draft phase stubs for high-severity categories

- Create `docs/plans/cleanup-findings/proposed-phases/` directory
- For each qualifying category (per §"In Scope" S3 criteria), generate `Phase-PROPOSED-<CATEGORY>-STUB.md`
- Each stub: provisional Scope Contract sketch (In Scope, Out of Scope, Forbidden Actions sketch), estimated slice count, dependencies, 3-5 sample file:line anchors from the catalog
- New `docs/plans/cleanup-findings/proposed-phases/README.md` — index of stubs with one-line summary each
- **Gate**: `bash -c "test -d docs/plans/cleanup-findings/proposed-phases && test -f docs/plans/cleanup-findings/proposed-phases/README.md && ls docs/plans/cleanup-findings/proposed-phases/Phase-PROPOSED-*-STUB.md 2>/dev/null | wc -l | awk '{ exit ($1 >= 1 ? 0 : 1) }'"` returns 0 (at least one stub generated)

### S4 — Guardrail updates

- `.github/instructions/architecture-principles.instructions.md` Temper Guards table — add entries derived from highest-frequency findings (≤3 new entries)
- Same file Warning Signs section — add observable patterns for the top-2 high-severity categories
- Edits MUST cite the catalog category for traceability
- **Gate**: `bash -c "grep -c 'Clean Code' .github/instructions/architecture-principles.instructions.md | awk '{ exit ($1 >= 1 ? 0 : 1) }'"` returns 0 (Clean Code citation present in updated guardrails)

### S5 — Retro + roadmap update

- `docs/plans/testbed-findings/Phase-42-CLEAN-CODE-AUDIT-retro.md` per §"In Scope" S5
- `docs/plans/DEPLOYMENT-ROADMAP.md` — add promoted proposed phases as Phase 43+ entries in Planned section
- `CHANGELOG.md` — `[Unreleased]` entry: `### Added — Clean Code audit catalog (read-only; no behavior change)`
- **Gate**: `bash -c "test -f docs/plans/testbed-findings/Phase-42-CLEAN-CODE-AUDIT-retro.md && grep -q 'Phase 43' docs/plans/DEPLOYMENT-ROADMAP.md && grep -q 'Clean Code audit catalog' CHANGELOG.md"` returns 0

---

## Acceptance Criteria

### MUST

1. `scripts/audit/` directory exists with all 5 tooling scripts + README, all runnable
2. `docs/plans/cleanup-findings/raw/` contains 5 non-empty raw reports + RUN-CONTEXT.md
3. `docs/plans/cleanup-findings/CATALOG.md` exists with every raw finding either mapped or explicitly excluded with rationale
4. `docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md` pivots categories × severity × counts
5. `docs/plans/cleanup-findings/proposed-phases/` contains ≥1 phase stub (or, if the audit found zero high-severity categories, a `NO-STUBS-NEEDED.md` explaining why)
6. `.github/instructions/architecture-principles.instructions.md` Temper Guards updated with ≤3 entries citing Clean Code categories from the catalog
7. **Zero changes to files under `pforge-mcp/`, `pforge-master/`, `pforge.ps1`, `pforge.sh` outside `package.json` devDependency additions** — verifiable by `git diff --stat <S0-commit> HEAD -- pforge-mcp pforge-master pforge.ps1 pforge.sh` showing only `package.json` if anything
8. Every catalog entry traces to a measurable tool output (ESLint rule ID, jscpd block ID, grep pattern hit, or AST walk match)
9. False-positive entries in the catalog include a documented rationale
10. `docs/plans/DEPLOYMENT-ROADMAP.md` reflects the promoted phases (if any)
11. `CHANGELOG.md` `[Unreleased]` entry exists
12. Retro at `docs/plans/testbed-findings/Phase-42-CLEAN-CODE-AUDIT-retro.md` covers: what was found, what got promoted, friction in triage, audit-frequency recommendation

### SHOULD

- Categories should sort by total severity weight (high=3, med=2, low=1) × count so the catalog reads roughly worst-first
- Proposed phase stubs should reference each other where fixes have dependencies (e.g. "Phase-PROPOSED-DEAD-CODE depends on Phase-PROPOSED-LONG-FUNCTION because dead code may live inside soon-to-be-decomposed functions")
- Audit-frequency recommendation should reference observed catalog growth (delta vs prior audit if any)
- Retro should list which Clean Code heuristics produced zero findings — those are the cleanest parts of the codebase

### Verification commands

```bash
# Tooling exists and runs
node scripts/audit/measure-modules.mjs --file pforge-mcp/server.mjs | grep -q 'lines'

# Raw reports captured
ls docs/plans/cleanup-findings/raw/*.json | wc -l   # expect ≥5

# Catalog complete
grep -c '^| [A-Z][0-9]' docs/plans/cleanup-findings/CATALOG.md   # expect ≥1 finding row

# Read-only invariant: zero production code change
git diff --stat $(git log --format=%H -n 1 --grep='S0 — Tooling setup' --all) HEAD -- pforge-mcp pforge-master pforge.ps1 pforge.sh | grep -v package.json | wc -l   # expect 0

# Guardrails updated
grep -c 'Clean Code' .github/instructions/architecture-principles.instructions.md   # expect ≥1

# Roadmap reflects promoted phases (if any)
grep -E 'Phase 4[3-9]' docs/plans/DEPLOYMENT-ROADMAP.md   # expect at least one match if stubs were promoted

# CHANGELOG entry
grep 'Clean Code audit catalog' CHANGELOG.md
```

---

## Stop Conditions

Halt execution and request human review if any of these fire:

- ESLint or jscpd crashes on a specific file. Don't skip the file — investigate; a crash may indicate a parsing issue we should report upstream OR a file Plan Forge stores in an unexpected format
- S1 raw reports total >50 MB combined. Symptom of overly aggressive rules; reduce rule pack severity in S0 and re-run
- S2 catalog exceeds 500 distinct findings. Means triage is no longer human-reviewable in one slice; STOP and break S2 into multiple slices by category (e.g. S2a = function-length findings, S2b = duplication, etc.)
- More than 25% of raw findings get marked as false positives in S2. Means the rules are mis-calibrated; tighten rule pack in S0 and re-run S1 — don't paper over with a flood of "false positive" annotations
- S3 wants to generate >5 phase stubs. Suggests the audit is uncovering more debt than one cleanup track can absorb; STOP and consult human on prioritization before drafting stubs
- Any file outside the In-Scope allowlist gets modified. Read-only invariant violated — revert immediately
- S4 wants to add >3 Temper Guard entries or >5 Warning Signs entries. Guardrail bloat; pick the highest-leverage entries and document the rest as future-audit candidates in the retro
- A reviewer rejects the catalog as "not actionable". Means S2 categorization didn't tie findings to clear fix paths; redo with better category/effort/file:line specificity

---

## Commit Convention

- Each slice = one commit
- S0: `feat(audit): S0 — Clean Code audit tooling (ESLint + jscpd + grep + AST)`
- S1: `chore(audit): S1 — run audit toolchain; emit raw findings`
- S2: `docs(audit): S2 — categorize findings into CATALOG.md (CC2 taxonomy)`
- S3: `docs(audit): S3 — draft phase stubs for high-severity categories`
- S4: `docs(architecture-principles): S4 — add Temper Guards + Warning Signs from audit`
- S5: `docs(plans): S5 — Phase 42 retro + roadmap update + CHANGELOG`

All commits land on `master`. PreCommit chain runs on each. S0 commit triggers `npm install` for the new devDependencies — verify it succeeds before merging.

---

## Hardening Audit Trail

| Date | Action | By |
|---|---|---|
| 2026-05-18 | Draft created from Phase 41 (ENUMS-CENTRALIZATION) planning carryover — user asked whether the cleanup phase should look for more Clean Code-style cleanup opportunities. Answer: separate read-only audit phase rather than expand ENUMS scope. | Copilot session |
| 2026-05-19 | Pre-harden research pass completed — codebase shape measured, G14 candidates identified, tech-debt marker baseline captured, threshold calibration recommendations drafted. See **Appendix C**. **Status remains DRAFT — plan body unchanged.** Findings feed the Step-2 hardener as advisory data. | Copilot session |
| _pending_ | Step-2 harden: lockHash, sharpen rule pack thresholds (start from Appendix C recommendations, not draft S0 values), decide CLI-script tooling (PSScriptAnalyzer + shellcheck vs. carve-out), decide jscpd token threshold, decide stop-condition volume gate against measured codebase size, decide whether to use system `cloc` or npm `cloc` package, decide on `knip`/`madge` adoption | _pending_ |
| _pending_ | Execution Hold lifted (gates on Phase 41 shipping) | _pending_ |

---

## Carryover (explicitly out of this phase)

- **Performance audit** — separate track, separate tooling (profiling, not lint rules)
- **Security audit** — separate track (`forge_secret_scan`, `forge_liveguard_run`, OWASP-driven sweeps)
- **Cross-repo audit** — auditing consuming projects would need entirely different tooling
- **Continuous audit / CI integration** — running the audit on every PR is a separate enabling phase if the catalog proves useful
- **Auto-formatter rollout** — Prettier / similar tooling adoption is a separate phase
- **Test smell deep-dive** — Clean Code Ch.9 / T1–T9 deserve a dedicated audit pass if the high-level catalog flags them as a dominant category
- **God-module decomposition** — `pforge-mcp/server.mjs`, `capabilities.mjs`, `pforge.ps1` are likely G14 candidates but their decomposition is multi-phase work, not a single cleanup phase
- **Naming refactors at scale** — N-category fixes touch every reference; require dedicated rename phases per module
- **TypeScript migration** — out of Clean Code scope; separate phase if ever undertaken

---

## Appendix A — Clean Code 2nd Edition heuristic map

> The catalog uses these IDs verbatim so future audits use the same taxonomy. Reference: Robert C. Martin, _Clean Code_ 2nd Edition (2025), Chapter 17 (Smells & Heuristics).

**Comments (C1–C5)**: C1 inappropriate information · C2 obsolete · C3 redundant · C4 poorly written · C5 commented-out code

**Environment (E1–E2)**: E1 build requires more than one step · E2 tests require more than one step

**Functions (F1–F4)**: F1 too many arguments · F2 output arguments · F3 flag arguments · F4 dead function

**General (G1–G36)** — most relevant subset:
- G5 duplication · G7 dead code · G14 feature envy · G16 obscured intent · G19 use explanatory variables
- G20 function names should say what they do · G21 understand the algorithm · G23 prefer polymorphism to if/else
- G25 replace magic numbers with named constants · G27 structure over convention · G29 avoid negative conditionals
- G34 functions should descend only one level of abstraction · G35 keep configurable data at high levels

**Names (N1–N7)**: N1 choose descriptive names · N2 choose names at the appropriate level of abstraction · N3 use standard nomenclature · N4 unambiguous names · N5 use long names for long scopes · N6 avoid encodings · N7 names should describe side-effects

**Tests (T1–T9)**: T1 insufficient tests · T2 use a coverage tool · T3 don't skip trivial tests · T4 ignored test is a question · T5 test boundary conditions · T6 exhaustively test near bugs · T7 patterns of failure · T8 coverage patterns · T9 tests should be fast

**Java (J1–J3)** — not applicable to Plan Forge (JS-only); excluded.

**Concurrency (Ch.13)** — flagged in catalog but no fix-phase proposals generated (per Resolved Decision #7).

---

## Appendix B — Tool-to-heuristic mapping

| Tool | Catches |
|---|---|
| ESLint `max-lines-per-function` | F3 (overlap), G16 |
| ESLint `max-params` | F1 |
| ESLint `complexity` | G16, G34 |
| ESLint `max-depth` | G34 |
| ESLint `no-magic-numbers` | G25 |
| jscpd | G5 |
| `grep-matrix` (TODO age via git blame) | C1, C2 |
| `grep-matrix` (commented-out code) | C5 |
| `grep-matrix` (HACK/XXX markers) | G27 (signal of structural issue) |
| `measure-modules` (per-file line counts) | G14 |
| `long-param-walker` (>5-arg call sites) | F1 (call-site complement to ESLint's declaration-site rule) |

Heuristics not covered by tooling (N1–N7 naming quality, G20/G21 intent, T1–T9 test smells) require human triage in S2 — flagged via grep for suspicious patterns but final judgment is reviewer's.

---

## Appendix C — Pre-harden research findings (2026-05-19)

> **Status**: Advisory data for the Step-2 hardener. The plan body above is UNCHANGED — thresholds in S0, volume gates in Stop Conditions, and tool selection in In-Scope are all subject to the hardener's decisions informed by this appendix. Numbers below are point-in-time measurements taken at draft commit; the hardener should re-measure if more than ~30 days have elapsed.

### C.1 — Codebase shape (audit target)

| Workspace | Files | LOC (incl. blanks) | Notes |
|---|---|---|---|
| `pforge-mcp/` `*.mjs` (excl. `tests/`, `ui/`, `public/`, `node_modules`) | 112 | **61,758** | 49 at top level. The dominant audit target. |
| `pforge-master/` `*.mjs` (excl. `tests/`, `ui/`, `node_modules`) | 54 | 10,921 | Recently introduced; smaller surface. |
| `scripts/` `*.mjs` (excl. `node_modules`) | 12 | 1,352 | Tiny; cheap to audit. |
| **Total `.mjs` source in scope** | **178** | **~74,000** | |
| CLI scripts (root) | `pforge.ps1` 6,746 + `pforge.sh` 5,985 | **12,731** | Not lintable by ESLint. See C.5. |
| Setup scripts (root) | `setup.ps1` 1,553 + `setup.sh` 1,468 + `validate-setup.ps1` 400 + `validate-setup.sh` 369 | 3,790 | Same gap as CLI scripts. |

**Callable units in `pforge-mcp/`**: ~1,120 named function declarations + ~404 arrow blocks = **~1,500 callable units**. Any per-function ESLint rule will produce dozens to hundreds of findings; threshold calibration matters.

### C.2 — Likely G14 (God-module) candidates — confirmed pre-audit

The top of the file-size distribution is steep enough that the catalog can pre-bake G14 expectations rather than discovering them blind.

| Rank | File | LOC | Pre-classified severity hint |
|---|---|---|---|
| 1 | `pforge-mcp/orchestrator.mjs` | **12,641** | extreme |
| 2 | `pforge-mcp/server.mjs` | **9,034** | extreme |
| 3 | `pforge.ps1` | 6,746 | extreme (CLI dispatcher; not ESLint-reachable) |
| 4 | `pforge.sh` | 5,985 | extreme (CLI dispatcher parity; not ESLint-reachable) |
| 5 | `pforge-mcp/capabilities.mjs` | 3,191 | high |
| 6 | `pforge-mcp/memory.mjs` | 1,957 | high |
| 7 | `setup.ps1` / `setup.sh` | 1,553 / 1,468 | medium |
| 8 | `pforge-mcp/cost-service.mjs` | 1,315 | medium |
| 9 | `pforge-mcp/tempering/runner.mjs` | 1,311 | medium |
| 10 | `pforge-mcp/tempering.mjs` | 1,179 | medium |
| 11 | `pforge-mcp/brain.mjs` | 1,140 | medium |
| 12 | `pforge-mcp/bridge.mjs` | 1,082 | medium |
| 13 | `pforge-master/src/reasoning.mjs` | 814 | medium |

Per Out-of-Scope, **G14 fixes are NOT proposed by this audit** — they require multi-phase decomposition. The catalog records them; promotion to phase stubs is a human decision.

### C.3 — Tech-debt marker baseline (production source, tests excluded)

| Marker | Hits | Comment |
|---|---|---|
| `console.log` | **129** | High. Plan Forge is a CLI — most are legitimate user-facing output. Hardener should scope the rule to non-CLI handlers OR accept en-masse as a single bulk-triaged category. |
| `TODO` | 28 | The plan's "TODO older than 90 days via git blame" filter likely cuts this to ~10. |
| `FIXME` | 9 | All real findings. |
| `HACK` | 6 | All real findings. |
| `XXX` | 3 | All real findings. |
| **Total marker hits** | **~175** | |

### C.4 — Existing tooling status

```
absent: eslint.config.mjs
absent: .eslintrc.json / .eslintrc.cjs / .eslintrc.js
absent: jscpd.config.json / .jscpd.json
absent: .prettierrc
absent: scripts/audit/
```

**Greenfield.** S0 can land a clean ESLint config without merge concerns. No existing audit infrastructure to integrate with.

### C.5 — Threshold calibration recommendations for the Step-2 hardener

The S0 draft thresholds are likely too tight given the measured codebase. The hardener should consider sharpening to:

| Rule | S0 draft | Recommended | Rationale |
|---|---|---|---|
| `max-lines-per-function` | warn 50, **error 150** | warn **100**, error **300** | Error at 150 will fire hundreds of times in orchestrator.mjs / server.mjs; reviewers will rubber-stamp. Looser error keeps signal. |
| `max-params` | warn 4 | warn 4 + **error 6** | Keep warn; add hard cap. |
| `complexity` (cyclomatic) | warn 10 | warn **12**, error 20 | 10 is aggressive on dispatcher functions — which is exactly what `forge_*` handlers are. |
| `max-depth` | warn 4 | warn 4 (keep) | Sensible. |
| `no-magic-numbers` | warn, "sensible ignores" | warn with `ignore: [-1, 0, 1, 2, 100, 1000]` + `ignoreArrayIndexes: true` + `ignoreDefaultValues: true` | Without these, port 3100 / ring-buffer 5000 / timeout 600 will flood the report. |
| jscpd token threshold | 50 | **75** | 50 on 74k LOC surfaces every repeated error-string; 75 preserves true-duplication signal. |
| **G14 file-LOC threshold** | *(not specified in draft)* | **>1000 LOC = flag**, **>3000 = high-severity** | Numeric rule needed. This cleanly catches the top 5 without flagging the 729-line median. |
| **Stop Conditions volume gate** | catalog >500 findings | **catalog >750** OR **raw >3000 pre-triage** | With measured codebase + lenient thresholds, raw findings likely 1,500–3,000. Categorization buckets them down, but 500 may trip on a healthy first run. |

### C.6 — Gaps in the current draft (for the hardener to resolve)

1. **CLI scripts have no covering tool.** `pforge.ps1` (6,746 LOC) and `pforge.sh` (5,985 LOC) are the largest files in the repo and ESLint cannot touch them. Hardener options:
   - **(A)** Add **PSScriptAnalyzer** for `.ps1` (Microsoft, MIT, `Install-Module`) + **shellcheck** for `.sh` (system binary, available via choco/scoop on Windows).
   - **(B)** Explicitly scope CLI scripts OUT of S1 and reserve a follow-up phase (Phase-42b-CLI-AUDIT) for them.
   - **(C)** Include them only in `measure-modules.mjs` LOC counts (G14 detection) but exempt from rule-based scanning.
   - Recommendation: (A) if PSScriptAnalyzer + shellcheck can be wired in <2 hr of S0 effort; otherwise (B).

2. **`pforge-master/` workspace coverage is implicit.** In-Scope S1 enumerates `pforge-master/**` but Resolved Decisions don't acknowledge it as a separate workspace with its own `package.json`. Hardener should explicitly confirm BOTH workspaces in scope and have audit reports separated by workspace in `docs/plans/cleanup-findings/raw/` (e.g., `eslint-report-mcp.json` vs `eslint-report-master.json`).

3. **Phase 41 (ENUMS) baseline comparison.** The Execution Hold correctly gates on Phase 41 shipping. The retro (S5) should additionally compare post-ENUMS jscpd output against a pre-ENUMS baseline if Phase 41 emitted one — this quantifies how much duplication ENUMS killed.

4. **Modern alternative tooling not yet decided.** Hardener should evaluate and record decisions:
   - **`knip`** — finds unused exports / dead code (cleaner than custom grep for G7/F4). Suggest adopt as an S0 tool.
   - **`madge`** — detects circular dependencies (G14-adjacent; signal of bad module boundaries). Suggest adopt as an S0 tool.
   - **`biome`** — single-tool ESLint+Prettier replacement. **Reject** — violates Principle 7 (lean deps); too much surface for what we need.

5. **AST walker parser dependency.** `long-param-walker.mjs` needs an AST. Options for the hardener:
   - **(A)** Add `acorn` directly (already a vitest transitive dep; can hoist).
   - **(B)** Drop the custom walker and rely on ESLint `max-params` (declaration-site only) plus a separate jscpd-style call-site sweep.
   - Recommendation: (B) if it materially reduces tooling footprint.

6. **`console.log` (129 hits) deserves pre-classification as a bulk category.** Rather than 129 individual findings, the hardener should declare in S0 that grep-matrix groups all `console.log` hits into a single bulk-triage bucket with one rationale (legitimate CLI surface vs. debug leakage).

### C.7 — Tooling cost & install footprint (devDependencies S0 will add)

All proposed audit deps are small and scoped to dev tooling only — well within Principle 7 since they don't enter the runtime.

| Package | Approx. install size | Justification |
|---|---|---|
| `eslint@^9` | ~6 MB | Industry-standard; covers F1/F3/G16/G25/G34. |
| `jscpd@^4` | ~12 MB | Only audit tool that finds copy-paste at the token level (G5). |
| `cloc` | shell-out to system binary (0 npm) OR `cloc@^2` (~200 KB) | Recommend shell-out path; npm package is a JS reimplementation. |
| `knip` (if adopted per C.6) | ~5 MB | G7 dead code, F4 dead functions. |
| `madge` (if adopted per C.6) | ~3 MB | G14 circular-dep signal. |
| `acorn` (if adopted per C.6) | already transitive via vitest | AST for `long-param-walker.mjs` if (A) chosen. |

**Total devDep growth ceiling**: ~26 MB (one-time, `node_modules` gitignored). Acceptable for a dev-only audit toolchain.

### C.8 — Reproduction commands (point-in-time, 2026-05-19)

The measurements above came from these PowerShell pipelines run from repo root:

```pwsh
# LOC + file counts per workspace
Get-ChildItem -Path pforge-mcp -Filter *.mjs -Recurse | Where-Object { $_.FullName -notmatch 'node_modules|\\tests\\|\\ui\\|\\public\\' } | Measure-Object
Get-ChildItem -Path pforge-master -Filter *.mjs -Recurse | Where-Object { $_.FullName -notmatch 'node_modules|\\tests\\|\\ui\\' } | Measure-Object

# Top-15 largest files
$all = @()
$all += Get-ChildItem -Path pforge-mcp -Filter *.mjs -Recurse | Where-Object { $_.FullName -notmatch 'node_modules|\\tests\\|\\ui\\|\\public\\' }
$all += Get-ChildItem -Path pforge-master -Filter *.mjs -Recurse | Where-Object { $_.FullName -notmatch 'node_modules|\\tests\\|\\ui\\' }
$all += Get-ChildItem -Path scripts -Filter *.mjs -Recurse | Where-Object { $_.FullName -notmatch 'node_modules' }
$all | ForEach-Object { [PSCustomObject]@{ Lines = (Get-Content $_.FullName | Measure-Object -Line).Lines; Path = $_.FullName } } | Sort-Object Lines -Descending | Select-Object -First 15

# Tech-debt markers
foreach ($marker in 'TODO','FIXME','HACK','XXX','console.log') {
  $files = Get-ChildItem -Path pforge-mcp,pforge-master -Filter *.mjs -Recurse | Where-Object { $_.FullName -notmatch 'node_modules|\\tests\\' }
  $c = (Select-String -Path ($files.FullName) -Pattern $marker -SimpleMatch | Measure-Object).Count
  "$marker = $c"
}
```

The Step-2 hardener should re-run these if Phase 41 ships meaningfully later than 2026-06 — the orchestrator.mjs and server.mjs counts in particular are the canonical drift indicators.
