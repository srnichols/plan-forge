---
phase: 42
name: CLEAN-CODE-AUDIT
status: HARDENED
lockHash: 7087914c33814808ada928ba25fbd2f224d29fc35a805998677f258395618264
---

# Phase 42 — CLEAN-CODE-AUDIT — Read-only Clean Code audit + cleanup queue

> **Status**: **HARDENED — awaiting Execution Hold lift** (Phase 41 ENUMS-CENTRALIZATION must ship first). Cleared for `pforge run-plan` once Execution Hold checklist is satisfied. Step-2 harden completed 2026-05-19.
> **Source**: Carryover from Phase 41 (ENUMS-CENTRALIZATION) planning. User asked whether the cleanup phase should look for more things like those covered in Clean Code (Robert C. "Uncle Bob" Martin, 2nd Edition, 2025). The answer was "audit, then targeted fix phases" — this is the audit.
> **Tracks**: `docs/plans/cleanup-findings/` (NEW directory — only output), tooling-only changes to `scripts/audit/`, no production code touched.
> **Estimated cost**: low. Zero LLM-cost surfaces. Mostly ESLint rule pack + grep + cloc + jscpd + madge (dependency-graph analysis).
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
- `scripts/audit/scan-architecture.mjs` — madge wrapper that emits the dependency graph + derives the four `A` (Architecture) findings: import cycles (`A2`), cross-layer imports (`A1` — configurable layer policy in `scripts/audit/layer-policy.json` defining which directories are "inner" vs "outer"), high-fan-in-on-volatile modules (`A3` — fan-in × git-churn over a threshold), and high-fan-out-on-unstable modules (`A4` — fan-out where >50% of dependencies are themselves volatile). **Reuses madge — no new tool family.**
- `scripts/audit/layer-policy.json` — declarative layer map driving `A1` detection. Initial seed: `pforge-mcp/tools/**` is inner of `pforge-mcp/orchestrator.mjs`; `pforge-mcp/orchestrator.mjs` is inner of `pforge-mcp/server.mjs`; cross-package imports between `pforge-mcp/` and `pforge-master/` are flagged unless whitelisted. Hardener sharpens the initial policy.
- `package.json` — new devDependencies (`jscpd`, `eslint`, `@typescript-eslint/parser` for JS too, `cloc`, `madge`)
- `scripts/audit/README.md` — how to run, how to interpret, false-positive triage guide

**S1 — Run the audit toolchain**:
- Execute every tool in `scripts/audit/`; emit raw findings to `docs/plans/cleanup-findings/raw/`:
  - `eslint-report.json` — full ESLint output
  - `duplication-report.json` — jscpd output
  - `grep-matrix-report.json` — custom grep findings
  - `module-metrics.json` — per-file line/function/export counts
  - `long-param-report.json` — call sites with >5 args
  - `dep-graph.json` — madge raw dependency graph (per-module imports + cycles)
  - `architecture-findings.json` — `scan-architecture.mjs` output: A1 cross-layer imports, A2 cycles, A3 high-fan-in volatile modules, A4 high-fan-out unstable modules (each with file:line anchors, fan-in/fan-out counts, churn metric)
- Capture tool versions and commit hash at run time into `docs/plans/cleanup-findings/raw/RUN-CONTEXT.md` so the audit is reproducible

**S2 — Triage & categorize**:
- New `docs/plans/cleanup-findings/CATALOG.md` — for each raw finding:
  - Map to Clean Code chapter or heuristic (`G5`, `F3`, `N1`, `T9`, …) OR to a Plan-Forge architecture code (`A1` cross-layer import, `A2` import cycle, `A3` high-fan-in volatile module, `A4` high-fan-out unstable module). Codes `A1-A4` are a Plan-Forge-local extension to the CC2 taxonomy — they cover structural concerns CC2 does not audit (Dependency Rule, Stable Dependencies Principle, Component Cohesion). See Appendix D for rationale.
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
- `.github/instructions/architecture-principles.instructions.md` Temper Guards table — add 1–3 new entries derived from the highest-frequency Clean Code violations found (e.g. if F3 long-function dominates the catalog, add "Adding a 100-line function? STOP, decompose first"). High-severity `A` findings get equal consideration (e.g., "Importing across the orchestrator → tool layer boundary? STOP — wrong direction").
- `.github/instructions/architecture-principles.instructions.md` Warning Signs section — add observable patterns matching the catalog's high-severity categories (including any structural patterns from `A1-A4`).
- These additions are the **only** modifications to non-audit files this phase makes. They are guardrails against re-introducing the patterns we just catalogued.
- **Note**: S4 deliberately produces only NEW guardrail text. The deeper guidance build-out (Dependency Rule explainer, SOLID per-letter, Component Cohesion section, `/clean-code-review` skill) belongs to Phase 50 and is gated on this phase's catalog.

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
- **Do NOT** modify any file under `pforge-mcp/`, `pforge-master/`, `pforge.ps1`, `pforge.sh`. The only `pforge-*` change permitted is `package.json` devDependency additions for ESLint/jscpd/cloc/madge.
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
3. **Clean Code 2nd ed. as the rubric, extended with Plan-Forge `A1-A4` for architectural findings** — the catalog uses CC2 chapter + heuristic IDs (G1–G36, N1–N7, C1–C5, F1–F4, J1–J3, T1–T9) so future audits use the same taxonomy. The CC2 rubric does not cover dependency direction, fan-in/fan-out skew, or import cycles; `A1` (cross-layer import), `A2` (import cycle), `A3` (high-fan-in volatile module), `A4` (high-fan-out unstable module) are a Plan-Forge-local extension detected from the madge dependency graph. The `A` codes are clearly marked as Plan-Forge-local in the catalog and in Appendix A to avoid mis-citing them as CC2.
4. **False positives stay in the catalog** — with a rationale. This prevents re-flagging in future audits and documents architectural decisions ("this long parameter list is justified because…").
5. **Phase stubs ≠ committed phases** — S3 produces *proposals*. Promotion to numbered phases is a separate human decision in S5 or later.
6. **Guardrail update is the only side effect** — S4's Temper Guards / Warning Signs additions are the leverage: catching the pattern at write-time is more valuable than the audit itself.
7. **Concurrency findings flagged, not fixed-by-proposal** — Clean Code Ch.13 fixes require senior judgment; this phase flags them in the catalog but does NOT generate phase stubs for mechanical concurrency rewrites.
8. **No audit-frequency commitment** — S5 retro recommends cadence but the actual schedule is a roadmap decision, not a phase deliverable.
9. **Single-repo scope** — auditing consuming projects is out. Cross-repo audit would need entirely different tooling.
10. **Catalog format is durable** — `docs/plans/cleanup-findings/CATALOG.md` is a long-lived artifact. Future audits append rather than overwrite (use date-stamped sections).

---

## Required Decisions

All architectural decisions for this phase are locked in §"Resolved Decisions" above (10 items). The deferred items below are **threshold calibrations**, not new TBDs — they are resolved during S0 execution against the measured codebase, not by adding new plan-time decisions.

| # | Decision | Status | Resolution path |
|---|----------|--------|-----------------|
| 1 | Audit is read-only | ✅ Resolved | RD #1; Forbidden Actions list enforces |
| 2 | Measurable criteria only | ✅ Resolved | RD #2 |
| 3 | CC2 + A1-A4 taxonomy | ✅ Resolved | RD #3; A1-A4 detection per Appendix D.2 |
| 4 | False-positive retention | ✅ Resolved | RD #4 |
| 5 | Stubs ≠ committed phases | ✅ Resolved | RD #5 |
| 6 | Guardrail-update is the only side effect | ✅ Resolved | RD #6 |
| 7 | Concurrency findings flagged not fixed-by-stub | ✅ Resolved | RD #7 |
| 8 | No audit-cadence commitment in plan | ✅ Resolved | RD #8; S5 retro recommends |
| 9 | Single-repo scope | ✅ Resolved | RD #9 |
| 10 | Catalog format durable | ✅ Resolved | RD #10 |
| 11 | A3/A4 thresholds | ⚙️ Calibrate at S0 | Defaults in Appendix D.2 (A3: `fan_in≥5 AND commits_last_90_days≥10`; A4: `fan_out≥8 AND >50% deps volatile`). S0 may raise thresholds if defaults produce >25% false positives in dry-run against `pforge-mcp/server.mjs`. |
| 12 | jscpd token threshold | ⚙️ Calibrate at S0 | Start at `--min-tokens=50`; S0 may raise to 70 if dry-run produces noise from boilerplate test-setup blocks. |
| 13 | ESLint rule pack severity calibration | ⚙️ Calibrate at S0 | Start with Appendix C recommendations; Stop Condition fires if >25% false positives. |

Calibration outcomes recorded in `docs/plans/cleanup-findings/raw/RUN-CONTEXT.md` (S1) for reproducibility.

---

## Slice Decomposition

> All slices are tagged **[sequential]**. The dependency chain (tooling → run → triage → stubs → guardrails → retro) is strict; no slice can begin before its predecessor's gate is green. Triage feedback may force a return to S0/S1 (re-calibrate + re-run) — this is normal and is what the Stop Conditions for high false-positive rates protect.

### Slice 0 — Tooling setup

- **Depends On**: nothing (Phase 41 must have shipped per Execution Hold, but that is enforced outside the slice graph)
- **Parallelism**: [sequential]
- **Context Files**: `package.json` (devDependency additions), `scripts/` (existing tooling shape), Appendix C (codebase measurements), Appendix D (architectural-codes thresholds)
- **Traces to**: MUST #1
- Create `scripts/audit/` directory with the 5 tooling scripts per §"In Scope" S0 + `scan-architecture.mjs` (madge wrapper) + `layer-policy.json` per Appendix D
- `package.json` — add devDependencies: `jscpd@^4`, `eslint@^9`, `madge@^7`. (No `cloc` package — shell out to system `cloc` or fall back to Node line-count.)
- `scripts/audit/eslint-clean-code.config.mjs` — full rule pack per §"In Scope" S0
- `scripts/audit/README.md` — usage + false-positive triage guide + threshold calibration outcomes (RD #11-13)
- Dry-run each script against `pforge-mcp/server.mjs` to verify non-empty output without crash
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const required=['scripts/audit/eslint-clean-code.config.mjs','scripts/audit/run-jscpd.mjs','scripts/audit/grep-matrix.mjs','scripts/audit/measure-modules.mjs','scripts/audit/long-param-walker.mjs','scripts/audit/scan-architecture.mjs','scripts/audit/layer-policy.json','scripts/audit/README.md'];const missing=required.filter(p=>!fs.existsSync(p));if(missing.length)throw new Error('missing files: '+missing.join(','));const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));for(const d of ['jscpd','eslint','madge']){if(!(pkg.devDependencies||{})[d])throw new Error('missing devDep: '+d);}console.log('ok '+required.length+' tooling files + 3 devDeps present');"
```

### Slice 1 — Run the audit

- **Depends On**: S0
- **Parallelism**: [sequential]
- **Context Files**: `scripts/audit/` (tooling from S0), `pforge-mcp/`, `pforge-master/`, `pforge.ps1`, `pforge.sh`, `scripts/` (audit targets)
- **Traces to**: MUST #2
- Create `docs/plans/cleanup-findings/raw/` directory
- Capture run context (commit hash, tool versions, date, S0 calibration outcomes per RD #11-13) to `docs/plans/cleanup-findings/raw/RUN-CONTEXT.md`
- Run each audit tool against `pforge-mcp/**`, `pforge-master/**`, `pforge.ps1`, `pforge.sh`, `scripts/**` (excluding `scripts/audit/**` itself)
- Emit reports to `docs/plans/cleanup-findings/raw/`: `eslint-report.json`, `duplication-report.json`, `grep-matrix-report.json`, `module-metrics.json`, `long-param-report.json`, `architecture-report.json` (A1-A4 from madge)
- Verify each report file is non-empty
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const reports=['eslint-report.json','duplication-report.json','grep-matrix-report.json','module-metrics.json','long-param-report.json','architecture-report.json'];const base='docs/plans/cleanup-findings/raw/';if(!fs.existsSync(base+'RUN-CONTEXT.md'))throw new Error('RUN-CONTEXT.md missing');for(const r of reports){const p=base+r;if(!fs.existsSync(p))throw new Error('missing: '+r);const sz=fs.statSync(p).size;if(sz===0)throw new Error('empty: '+r);}console.log('ok '+reports.length+' raw reports + RUN-CONTEXT present');"
```

### Slice 2 — Triage & categorize

- **Depends On**: S1
- **Parallelism**: [sequential]
- **Context Files**: `docs/plans/cleanup-findings/raw/` (S1 output), this plan's §"Resolved Decisions" + Appendix D (taxonomy)
- **Traces to**: MUST #3, MUST #4, MUST #8, MUST #9
- New `docs/plans/cleanup-findings/CATALOG.md` — every raw finding mapped to category (CC2 G/F/N/C/T or Plan-Forge-local A1-A4) + severity (high/med/low) + effort (S/M/L) + file:line + rationale (or false-positive note with reason)
- New `docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md` — pivot table category × severity × count, sorted by total-severity-weight descending
- Cross-check: every raw finding either appears in `CATALOG.md` Findings section OR is explicitly listed in `CATALOG.md` "Excluded findings" with reason
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const cat=fs.readFileSync('docs/plans/cleanup-findings/CATALOG.md','utf8');const sum=fs.readFileSync('docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md','utf8');if(!cat.includes('## Findings'))throw new Error('CATALOG.md missing ## Findings section');if(!cat.includes('Excluded findings'))throw new Error('CATALOG.md missing Excluded findings section');if(!sum.includes('| Category |'))throw new Error('CATEGORIES-SUMMARY.md missing pivot header');const rows=(cat.match(/^\\|\\s*[A-Z]\\d+\\s*\\|/gm)||[]).length;if(rows<1)throw new Error('CATALOG.md has zero finding rows');console.log('ok catalog has '+rows+' findings + summary pivot');"
```

### Slice 3 — Draft phase stubs for high-severity categories

- **Depends On**: S2
- **Parallelism**: [sequential]
- **Context Files**: `docs/plans/cleanup-findings/CATALOG.md` (S2 output), `docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md`, this plan's §"In Scope" S3 (stub criteria)
- **Traces to**: MUST #5
- Create `docs/plans/cleanup-findings/proposed-phases/` directory
- For each qualifying category (per §"In Scope" S3 criteria), generate `Phase-PROPOSED-<CATEGORY>-STUB.md`
- Each stub: provisional Scope Contract sketch (In Scope, Out of Scope, Forbidden Actions sketch), estimated slice count, dependencies, 3-5 sample file:line anchors from the catalog
- New `docs/plans/cleanup-findings/proposed-phases/README.md` — index of stubs with one-line summary each
- If audit found zero high-severity categories, write `proposed-phases/NO-STUBS-NEEDED.md` explaining why (still counts as ≥1 file for the gate)
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const dir='docs/plans/cleanup-findings/proposed-phases';if(!fs.existsSync(dir))throw new Error('proposed-phases/ missing');if(!fs.existsSync(dir+'/README.md'))throw new Error('proposed-phases/README.md missing');const stubs=fs.readdirSync(dir).filter(f=>/^Phase-PROPOSED-.*-STUB\\.md$/.test(f));const noStubs=fs.existsSync(dir+'/NO-STUBS-NEEDED.md');if(stubs.length===0&&!noStubs)throw new Error('zero stubs AND no NO-STUBS-NEEDED.md');console.log('ok '+stubs.length+' stubs (NO-STUBS-NEEDED='+noStubs+')');"
```

### Slice 4 — Guardrail updates

- **Depends On**: S2 (needs catalog to cite specific findings)
- **Parallelism**: [sequential]
- **Context Files**: `.github/instructions/architecture-principles.instructions.md`, `docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md`
- **Traces to**: MUST #6
- `.github/instructions/architecture-principles.instructions.md` Temper Guards table — add entries derived from highest-frequency findings (≤3 new entries)
- Same file Warning Signs section — add observable patterns for the top-2 high-severity categories
- Edits MUST cite the catalog category for traceability (text like "From Phase 42 catalog, category G14 (12 findings)")
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const c=fs.readFileSync('.github/instructions/architecture-principles.instructions.md','utf8');if(!/Clean Code/.test(c))throw new Error('Clean Code citation missing');if(!/Phase 42/.test(c))throw new Error('Phase 42 catalog citation missing — guardrails must reference source');console.log('ok guardrails cite Clean Code + Phase 42 catalog');"
```

### Slice 5 — Retro + roadmap update

- **Depends On**: S0-S4 all green
- **Parallelism**: [sequential]
- **Context Files**: `docs/plans/DEPLOYMENT-ROADMAP.md`, `CHANGELOG.md`, `docs/plans/cleanup-findings/proposed-phases/` (S3 output for promotion candidates)
- **Traces to**: MUST #10, MUST #11, MUST #12
- `docs/plans/testbed-findings/Phase-42-CLEAN-CODE-AUDIT-retro.md` per §"In Scope" S5 — must cover: what was found, what got promoted, friction in triage, audit-frequency recommendation, which CC2 heuristics produced zero findings (cleanest parts of codebase)
- `docs/plans/DEPLOYMENT-ROADMAP.md` — add promoted phase stubs as Phase 43-49 entries in Planned section (numbers reserved for Phase 42 fix-stubs per roadmap note)
- `CHANGELOG.md` — `[Unreleased]` entry: `### Added — Clean Code audit catalog (read-only; no behavior change)`
- **Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('docs/plans/testbed-findings/Phase-42-CLEAN-CODE-AUDIT-retro.md'))throw new Error('retro missing');const dr=fs.readFileSync('docs/plans/DEPLOYMENT-ROADMAP.md','utf8');if(!/Phase 4[3-9]/.test(dr)&&!/NO-STUBS-NEEDED/.test(dr))throw new Error('roadmap missing promoted phases AND no NO-STUBS-NEEDED reference');const ch=fs.readFileSync('CHANGELOG.md','utf8');if(!/Clean Code audit catalog/.test(ch))throw new Error('CHANGELOG entry missing');console.log('ok retro + roadmap + CHANGELOG');"
```

---

## Re-anchor Checkpoints

Lightweight re-anchor (4 yes/no) after every slice. Full re-anchor against §"Scope Contract" + §"Resolved Decisions" at these breakpoints:

- **After S1** (raw reports complete, before triage): full re-anchor. Specifically verify (a) zero production code modified outside `scripts/audit/` and `package.json`, (b) all 6 raw report files present and non-empty, (c) calibration outcomes (RD #11-13) recorded in RUN-CONTEXT.md. If any check fails, fix before triage begins — re-triaging is expensive.
- **After S3** (stubs drafted, before guardrail edits): full re-anchor + drift check. Specifically verify (a) no stub recommends modifying production code outside its own future Scope Contract sketch, (b) catalog→stub traceability is preserved (every stub cites catalog file:line anchors), (c) read-only invariant still intact (re-run `git diff --stat` against the S0 commit hash for production files; expect zero).

---

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

**Scope drift**
- Any file outside the In-Scope allowlist gets modified. **Read-only invariant violated — revert immediately.** This is the cardinal sin of Phase 42.
- S3 wants to generate >5 phase stubs. Suggests the audit is uncovering more debt than one cleanup track can absorb; STOP and consult human on prioritization before drafting stubs
- S4 wants to add >3 Temper Guard entries or >5 Warning Signs entries. Guardrail bloat; pick the highest-leverage entries and document the rest as future-audit candidates in the retro
- A reviewer rejects the catalog as "not actionable". Means S2 categorization didn't tie findings to clear fix paths; redo with better category/effort/file:line specificity

**Build / test failure**
- Any slice's validation gate fails twice consecutively — STOP, do not retry blindly
- ESLint or jscpd crashes on a specific file. Don't skip the file — investigate; a crash may indicate a parsing issue we should report upstream OR a file Plan Forge stores in an unexpected format
- `npm install` fails after S0 adds devDependencies. STOP and resolve before merging S0; do not let downstream slices proceed against a broken lockfile
- `pforge validate` fails after S0 (suggests the new devDeps broke an existing config)
- S2 catalog exceeds 500 distinct findings. Means triage is no longer human-reviewable in one slice; STOP and break S2 into multiple slices by category
- More than 25% of raw findings get marked as false positives in S2 (per RD #11-13 calibration thresholds). Means rules are mis-calibrated; tighten rule pack in S0 and re-run S1 — don't paper over with false-positive annotations
- S1 raw reports total >50 MB combined. Symptom of overly aggressive rules; reduce rule pack severity in S0 and re-run

**Security**
- Any audit script attempts to execute code from the codebase being audited (eval / dynamic require of audit-target files). STOP — audit tooling must be purely static-analysis; loading audit targets risks side effects from module-init code
- Any audit script emits findings containing credentials, secrets, or tokens (even patterns that look like them). STOP — strip from raw reports before triage; never let secrets enter `docs/plans/cleanup-findings/`
- The `scripts/audit/` tooling reads or writes anywhere outside `pforge-mcp/**`, `pforge-master/**`, `pforge.{ps1,sh}`, `scripts/**`, `docs/plans/cleanup-findings/**` (write-only). STOP — sandbox violation

---

## Definition of Done

Phase 42 is complete when ALL of the following are true:

- [ ] All 6 slice validation gates green (S0-S5)
- [ ] Reviewer Gate passed (zero 🔴 Critical, zero 🟡 High that block scope)
- [ ] `scripts/audit/` directory exists with all 8 required artifacts (5 audit scripts + scan-architecture.mjs + layer-policy.json + README.md), all runnable
- [ ] `package.json` devDependencies include `jscpd`, `eslint`, `madge` (zero other new deps)
- [ ] `docs/plans/cleanup-findings/raw/` contains all 6 non-empty raw reports + RUN-CONTEXT.md with calibration outcomes (RD #11-13)
- [ ] `docs/plans/cleanup-findings/CATALOG.md` has Findings section + Excluded findings section; every raw finding either mapped or excluded with rationale; A1-A4 entries (if any) clearly marked Plan-Forge-local
- [ ] `docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md` pivots categories × severity × count, sorted worst-first
- [ ] `docs/plans/cleanup-findings/proposed-phases/` contains ≥1 stub OR `NO-STUBS-NEEDED.md` with rationale + README.md index
- [ ] `.github/instructions/architecture-principles.instructions.md` Temper Guards/Warning Signs cite Clean Code + Phase 42 catalog explicitly
- [ ] **Read-only invariant verified**: `git diff --stat <S0-commit> HEAD -- pforge-mcp pforge-master pforge.ps1 pforge.sh` shows only `package.json` (or nothing) — no production code modified
- [ ] `docs/plans/DEPLOYMENT-ROADMAP.md` reflects promoted phases (or NO-STUBS-NEEDED reference)
- [ ] `CHANGELOG.md` `[Unreleased]` entry added
- [ ] `docs/plans/testbed-findings/Phase-42-CLEAN-CODE-AUDIT-retro.md` covers: what was found, what got promoted, friction in triage, audit-frequency recommendation, zero-finding heuristics
- [ ] `pforge validate` clean
- [ ] Branch model respected: all commits land on `master`

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
| 2026-05-19 | A1-A4 architectural-finding extension added per Phase 50 scope expansion — added `A1` (cross-layer import), `A2` (cycle), `A3` (high-fan-in volatile), `A4` (high-fan-out unstable) detected via madge dependency graph. Added `scripts/audit/scan-architecture.mjs` + `layer-policy.json` to S0; added `architecture-report.json` to S1 outputs. Defaults in Appendix D.2 (A3: fan_in≥5 AND commits_last_90_days≥10; A4: fan_out≥8 AND >50% deps volatile) — S0 may raise thresholds if dry-run produces >25% false positives. RD #3 updated to cite Plan-Forge-local nature of A codes. | Copilot session |
| 2026-05-19 | **Step-2 harden**: (a) YAML frontmatter added with `lockHash` field. (b) Per-slice metadata added: `Depends On`, `Parallelism: [sequential]`, `Context Files`, `Traces to` (Acceptance Criteria MUST-N mapping). (c) All slice validation gates rewritten in pure `node -e` form — eliminates `bash -c` wrappers per meta-bug #171 (`where bash` resolving to WSL on Windows) and removes nested-escaped-quote patterns per meta-bug #93. (d) `## Required Decisions` section added — 10 plan-time decisions locked (cross-reference Resolved Decisions); 3 calibration items (RD #11-13) explicitly deferred to S0 execution with documented thresholds and resolution path (recorded in RUN-CONTEXT.md). (e) `## Re-anchor Checkpoints` section added (full re-anchors after S1 and S3). (f) `## Definition of Done` section added with 16 explicit checks including Reviewer Gate, read-only invariant verification, and Phase 42 catalog citation in guardrails. (g) Stop Conditions reorganized into scope / build-test / security categories per Runbook; added explicit security entries (no eval of audit targets, no secret leakage into findings, sandbox enforcement). (h) Status flipped DRAFT → HARDENED. **lockHash protects Forbidden Actions list only** (slice headers use `S0/S1` per project convention, not `Slice 0/Slice 1` that `computeLockHash` would match for full slice content). | Copilot session (Step-2) |
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

**Architecture (A1–A4)** — _Plan-Forge-local extension; NOT from CC2._ Codified from Robert C. Martin's _Clean Architecture_ (2017) Dependency Rule + Robert C. Martin's _Agile Software Development_ (2002) Stable Dependencies Principle + Component Cohesion (REP/CCP/CRP). Detected via madge dependency graph + git churn metric:
- `A1` cross-layer import (outer depends on outer, or inner depends on outer — wrong-direction dependency per layer-policy.json)
- `A2` import cycle (any strongly-connected component of size ≥ 2 in the module graph)
- `A3` high-fan-in volatile module (`fan_in × commits_last_90_days` above threshold — a stable component whose code keeps churning is a stable-dependencies violation)
- `A4` high-fan-out unstable module (fan-out where >50% of dependencies have themselves changed in the last 90 days — an unstable component depending on other unstable components)

See Appendix D for why these four codes (and not more) were chosen.

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
| `scan-architecture` (madge graph + layer-policy.json) | A1 cross-layer import, A2 cycle |
| `scan-architecture` (madge graph + git churn) | A3 high-fan-in volatile, A4 high-fan-out unstable |

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


---

## Appendix D — Architectural triage rationale (2026-05-19 carryover from Phase-50 planning)

> **Why this appendix exists**: Phase 50 (CLEAN-CODE-GUIDANCE) needs empirical signal on architectural patterns to prioritize its `architecture-principles.instructions.md` expansion (Dependency Rule, SOLID per-letter, Component Cohesion, Stable Dependencies). CC2's G/F/N/C/T taxonomy does not produce that signal — CC2 audits *code quality*, not *structure*. Rather than insert a Phase 42.5, the `A1-A4` codes piggyback on madge (already a low-cost addition) and use the existing triage discipline.

### D.1 — Why exactly four `A` codes (and not more)

The four codes are the maximum that is **mechanically detectable from source + git history** without semantic analysis. Anything richer requires either a heavyweight static analyzer (sonar / semgrep) or human reading — both out of scope for an automated audit phase.

| Considered | Why included / excluded |
|---|---|
| `A1` cross-layer import | INCLUDED. Detectable from import graph + layer policy. Direct Dependency Rule violation. |
| `A2` import cycle | INCLUDED. madge detects natively. Cycles defeat the Dependency Rule and signal Component Cohesion (CCP) failure. |
| `A3` high-fan-in volatile module | INCLUDED. `fan_in` from graph × commit count from `git log --since` = Stable Dependencies Principle signal. |
| `A4` high-fan-out unstable module | INCLUDED. Inverse of A3. Surfaces "shotgun surgery" pattern (modules whose every change cascades). |
| Fowler "feature envy" | EXCLUDED. Requires semantic analysis (which method accesses which other module's data more than its own). Out of scope for grep + madge. |
| Fowler "shotgun surgery" | EXCLUDED. Partially covered by A4 + git-blame correlation, but full detection requires change-set correlation across commits — too expensive. |
| Fowler "divergent change" | EXCLUDED. Requires per-file change-frequency clustering by reason — needs commit-message NLP. |
| LSP / ISP / DIP violations | EXCLUDED. Require type system + interface-vs-implementation analysis. JavaScript's structural typing makes this unreliable. |
| Component Cohesion REP/CCP/CRP | PARTIALLY COVERED by A2 + A3 + A4. Full cohesion analysis requires release-unit definition (Plan Forge has no concept of internal sub-packages). |
| SRP "one reason to change" | PARTIALLY COVERED by A4 + commit-message review. Mechanically intractable without human judgment. |

The pattern: `A1-A4` are the **structural smells with high signal-to-noise ratio under cheap tooling**. The rest are intentionally deferred to the `/clean-code-review` skill (Phase 50) for human-triggered deeper review, or to per-PR judgment.

### D.2 — Threshold defaults (hardener calibrates)

| Code | Default threshold | Justification |
|---|---|---|
| `A1` | Any wrong-direction import per `layer-policy.json` | Boolean — either it crosses the line or it doesn't |
| `A2` | Cycles of size ≥ 2 | All cycles are bugs; size ≥ 2 is the minimum |
| `A3` | `fan_in ≥ 5` AND `commits_last_90_days ≥ 10` | A module imported by ≥5 others that changed ≥10 times in 90 days is genuinely unstable for its responsibility |
| `A4` | `fan_out ≥ 8` AND `>50%` of dependencies have `commits_last_90_days ≥ 10` | A module depending on ≥8 others where the majority are volatile is shotgun-surgery-prone |

Hardener should re-calibrate after running once against the actual codebase — `pforge-mcp/orchestrator.mjs` and `pforge-mcp/server.mjs` (per Appendix C.2) will almost certainly trip A3 due to size + churn. That's expected; the question is whether the *catalog* records it once or 30 times.

### D.3 — Linkage to Phase 50

Phase 50 S0 (drafting `clean-code.instructions.md`) and S1 (expanding `architecture-principles.instructions.md`) explicitly bias rule selection toward heuristics with non-zero catalog hits. Without the `A` codes in this phase's catalog, Phase 50 would either guess at structural rule prioritization OR ship guidance with no empirical backing — defeating its own design contract. The `A` codes close that loop.

### D.4 — What this does NOT do

This addition does NOT make Phase 42 an "architectural audit". It adds a thin layer of architectural smell detection riding on tooling that's already required (madge for cycles was already a candidate). The phase remains a code-quality catalog with a small structural appendix. A true architectural audit (component boundaries, release-unit analysis, contract verification) remains future work and would warrant its own numbered phase.

### D.5 — Cost impact on the phase

- **Slice count**: unchanged (S0-S5)
- **New tool**: 1 (`scan-architecture.mjs` — thin wrapper over madge)
- **New devDep**: 1 (`madge`)
- **New raw-output files**: 2 (`dep-graph.json`, `architecture-findings.json`)
- **New triage codes**: 4 (`A1-A4`, all in one new category section)
- **Estimated added effort**: <1 slice equivalent. Folds into S0 (tool) + S1 (run) + S2 (triage) with marginal additions.
