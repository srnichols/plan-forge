# Phase ENUMS-CENTRALIZATION — Single source of truth for stable small-set identifiers

> **Status**: **DRAFT — pending Step-2 harden**. Do NOT execute. Sign-off needed on §"Scope Contract" + §"Resolved Decisions" before running `step2-harden-plan.prompt.md`.
> **Source**: Carryover from Phase-AUDITOR-AUTOMATION planning session (2026-05-18) where four hardcoded-array surfaces had to be hand-scoped into the parent plan because no enum existed to enumerate against.
> **Tracks**: `pforge-mcp/enums.mjs` (new), `pforge-mcp/capabilities.mjs`, `pforge-mcp/cost-service.mjs`, `pforge.ps1` + `pforge.sh` (`smith`), `docs/capabilities.md` (auto-gen target), `docs/manual/errors-and-exit-codes.html` (auto-gen target), `docs/manual/forge-json-reference.html` (cross-link target).
> **Estimated cost**: low–medium. Zero new LLM-cost surfaces. Most slices are mechanical migration with CI guards. The doc auto-gen in S3/S4 is the only creative work.
> **Pipeline**: Specify ✅ → Harden ⏳ → HOLD → Execute → S6 unit QA → S7 docs sweep + retro.
> **Recommended starting slice**: **S0 → S1** (build the enum file first; everything else consumes it).
> **Session budget**: 7 slices. Recommended break point: **commit + new session after S1** (so the enum file gets fresh-eyes review before consumers migrate to it).

---

## Execution Hold

Hardened plan MUST NOT execute until:

- [ ] **Phase-AUDITOR-AUTOMATION has shipped** ([docs/plans/Phase-AUDITOR-AUTOMATION-PLAN.md](Phase-AUDITOR-AUTOMATION-PLAN.md)). This phase touches the same surfaces (smith hook list, capabilities.mjs tool list, error catalog) and would create merge hell if run in parallel. Seeding the enums file with the final post-AUDITOR shape (including `PostRun` hook, `forge_master_observe` tool, `observer-budget-exceeded` + `auditor-spawn-failed` error codes) is the right design moment.
- [ ] **Phase-AUDITOR-AUTOMATION-UI has shipped** ([docs/plans/Phase-AUDITOR-AUTOMATION-UI-PLAN.md](Phase-AUDITOR-AUTOMATION-UI-PLAN.md)). Same rationale — UI follow-up adds dashboard settings fields that map to `MODEL_TIERS`; better to seed the enum after the UI naming is locked.
- [ ] No competing in-flight plan is modifying `pforge.ps1`, `pforge.sh`, `pforge-mcp/capabilities.mjs`, or `pforge-mcp/cost-service.mjs` (this phase touches all four)
- [ ] `master` is clean
- [ ] `lockHash` (added in Step-2 harden) matches plan body at run time
- [ ] All new hooks, tools, error codes, and modes from prior phases are settled — no in-flight `feat:` commits that would add another stable-set identifier between Execution Hold lift and S1 commit

**To resume**: change Status to `HARDENED — cleared for execution YYYY-MM-DD` and run `pforge run-plan docs/plans/Phase-ENUMS-CENTRALIZATION-PLAN.md`.

---

## Why this phase exists

Plan Forge has accreted ~8 small stable identifier sets across its lifetime. None of them are enumerated centrally:

| Concept | Today's storage | Drift incidents observed |
|---|---|---|
| Hook names | Hardcoded array in `pforge.ps1:3428` AND repeated as keys in `$configKeyMap:3431` AND a separate (smaller) list in `pforge.sh:2893` | `PostRun` had to be scoped as 4 separate file edits into Phase-AUDITOR-AUTOMATION; `PreAgentHandoff` had similar drift history |
| MCP tool names | Literal strings in `pforge-mcp/server.mjs` `TOOLS` array AND `capabilities.mjs` `TOOL_METADATA` AND `docs/capabilities.md` table AND `docs/manual/glossary.html` count comment AND `docs/llms.txt` AND root `llms.txt` | Tool count appears in **6** documents; manual counting has produced 89/90/91 drift between sources |
| Capability tiers (model selection) | Literal strings `"flagship" \| "mid" \| "fast"` referenced in plan prose, intended for `modelTier` config knob | New — no canonical declaration yet |
| Quorum modes | `"auto" \| "power" \| "speed" \| "false"` — string-compared in orchestrator, run-plan CLI, cost estimator | Validated independently in 3 sites |
| Forge-Master modes | `"ask"` only today; `"observe"` coming via AUDITOR-AUTOMATION | New |
| Watcher modes | `"live"`, future `"cross-run"` (AUDITOR-AUTOMATION Cluster B) | New |
| Cost source labels | Convention only: `"forge-master"`, `"worker"`, `"observer"` | `cost-service.mjs` aggregates by exact string match — silent miscategorization risk |
| Named error codes | Throw sites scattered; doc catalog at `docs/manual/errors-and-exit-codes.html` hand-maintained | Catalog drifts behind throw sites; users see undocumented codes |

This phase introduces a single `pforge-mcp/enums.mjs` module that every consumer reads from, and adds CI guards so future identifier additions can't drift again.

**Non-goals**: vendor model IDs (those live in `pforge-mcp/model-resolver.mjs` as a data registry; they age out monthly), skill names, agent names, extension config keys, per-plan slice IDs.

---

## Scope Contract

### In Scope

**S1 — `pforge-mcp/enums.mjs` (new file)**:
- `HOOK_NAMES` — `Object.freeze({ SessionStart: 'sessionStart', PreToolUse: 'preToolUse', PostToolUse: 'postToolUse', Stop: 'stop', PreDeploy: 'preDeploy', PostSlice: 'postSlice', PreAgentHandoff: 'preAgentHandoff', PostRun: 'postRun' })` — pascal → camel config key map (replaces `$configKeyMap` in `pforge.ps1`)
- `HOOK_PASCAL` — `Object.freeze(Object.keys(HOOK_NAMES))` — the array smith uses (replaces `$liveGuardHooks` and `expected_hooks`)
- `HOOK_CATEGORY` — `{ session: [...], liveGuard: [...] }` so smith can render the two sections separately
- `MODEL_TIERS` — `Object.freeze(['flagship', 'mid', 'fast'])`. **`null` is the documented "inherit" sentinel** but is intentionally not in the array — consumers should accept `null | <one of MODEL_TIERS>`.
- `QUORUM_MODES` — `Object.freeze(['auto', 'power', 'speed', 'false'])` (string `'false'`, not boolean — matches today's CLI surface)
- `FORGE_MASTER_MODES` — `Object.freeze(['ask', 'observe'])`
- `WATCHER_MODES` — `Object.freeze(['live', 'snapshot', 'cross-run'])` (verify `snapshot` is the canonical third today via grep before locking)
- `COST_SOURCES` — `Object.freeze(['worker', 'forge-master', 'observer', 'auditor'])` — checked at `cost-service.mjs` ingest boundary
- `ERROR_CODES` — `Object.freeze({ <CODE>: { code, severity, remediation, docAnchor } })` — populated by walking all current throw sites in S4; intentionally NOT populated in S1 to avoid stale-by-merge
- `TOOL_NAMES` — single source of truth for the 90-tool inventory; consumed by `capabilities.mjs` AND the auto-gen target for `docs/capabilities.md`
- Helper exports: `assertHookName(name)`, `assertModelTier(tier)`, `assertQuorumMode(mode)`, etc. — pure functions that throw `RangeError` with a "valid values are: X | Y | Z" message
- Brand-new `pforge-mcp/tests/enums.test.mjs`:
  - Frozen-ness check on each export (mutation throws in strict mode)
  - `assertHookName('PostRun')` passes; `assertHookName('PostRunner')` throws with helpful message
  - Cross-check: every key in `HOOK_NAMES` appears in exactly one of `HOOK_CATEGORY.session` or `HOOK_CATEGORY.liveGuard`
  - `TOOL_NAMES.length` matches `pforge-mcp/server.mjs` `TOOLS.length` (covers the silent-drift risk where someone adds a tool without enum entry)

**S2 — Diagnostic CLI migration (`pforge smith`)**:
- New tiny helper `pforge-mcp/bin/enums-cli.mjs` that prints requested enum as one-value-per-line (e.g. `node pforge-mcp/bin/enums-cli.mjs --enum HOOK_PASCAL`) so PowerShell + bash can shell-out instead of redeclaring
- `pforge.ps1` — `$liveGuardHooks` and `$configKeyMap` and `$allExpectedHooks` arrays replaced with: `$enumOutput = node pforge-mcp/bin/enums-cli.mjs --enum HOOK_PASCAL ...` and parse into the existing variables (preserves all downstream report formatting)
- `pforge.sh` — `expected_hooks` array replaced the same way; **also** adds the LiveGuard hooks section so the bash doctor reaches parity with PowerShell (this is the "pre-existing asymmetry" called out in Phase-AUDITOR-AUTOMATION Scope Contract)
- Behavior preservation: smith output diff before/after migration MUST be byte-identical on a representative fixture project (captured as a golden file in tests)

**S3 — `capabilities.mjs` migration + `docs/capabilities.md` auto-gen**:
- `pforge-mcp/capabilities.mjs` — wherever a tool name string appears (TOOL_METADATA keys, `tools: [...]` arrays inside `buildForgeMasterCapabilities()` and similar surface builders), use the enum constant
- New script `scripts/generate-capabilities-doc.mjs` — reads `TOOL_NAMES` and `TOOL_METADATA`, regenerates the `## MCP Tools (N)` table in `docs/capabilities.md` deterministically (sorted, formatted)
- Same script regenerates the `<!--c:tools-->N<!--/c-->` count in `docs/manual/glossary.html` and the tool inventory line in `docs/llms.txt` + root `llms.txt`
- New CI guard: `scripts/check-capabilities-doc.mjs` runs the generator into a temp file and diffs against the committed `docs/capabilities.md`. Non-zero exit if drift. Wired into preCommit chain.

**S4 — Error catalog migration + `errors-and-exit-codes.html` auto-gen**:
- Walk all `throw new Error(<NAMED-CODE>:`, `throw new <CustomError>(`, and `formatError({ code: ...})` sites across `pforge-mcp/`, `pforge-master/`, orchestrator. Collect into `ERROR_CODES` in `enums.mjs`.
- For codes currently undocumented: synthesize a minimal remediation from the throw site comment if present; otherwise mark `remediation: 'TBD — see source'` and surface as a SHOULD-fix (not a MUST blocker).
- New script `scripts/generate-error-catalog.mjs` — regenerates the named-error table in `docs/manual/errors-and-exit-codes.html` from `ERROR_CODES`
- New CI guard: same pattern as capabilities — diff after regen, non-zero exit on drift
- Throw sites migrated to import error metadata from `enums.mjs` (e.g. `throw new PfError(ERROR_CODES.observerBudgetExceeded, { cap, spend })`) — keeps remediation text in one place

**S5 — `cost-service.mjs` + orchestrator string-match hardening**:
- `cost-service.mjs` — `costForLeg()` is forbidden territory (universal tripwire); only touch the **caller-facing label normalization**, NOT the math. Wherever a source label is parsed, validate against `COST_SOURCES` and warn on unknown (don't reject — backward compat).
- `pforge-mcp/orchestrator.mjs` — wherever `mode === 'auto'` / `'power'` / `'speed'` / `'false'` appears, switch to `QUORUM_MODES.includes(mode)` or named constant
- `pforge.ps1` + `pforge.sh` — quorum mode parsing reads from enums-cli (same pattern as S2)
- `pforge-master/src/config.mjs` — `getForgeMasterConfig()` validates `observer.modelTier` and `auditor.modelTier` against `MODEL_TIERS` (or `null`) before returning

**S6 — Full QA sweep + golden-output verification**:
- Run all new test suites: `enums.test.mjs`, plus the existing `pforge-mcp` and `pforge-master` test suites
- Run `pforge smith` against `E:\GitHub\plan-forge-testbed` (real project) and diff stdout against pre-migration golden (S2 captured this) — MUST be byte-identical
- Run `node scripts/check-capabilities-doc.mjs` and `node scripts/check-error-catalog.mjs` — both MUST exit 0
- Run `forge_capabilities` via MCP — assert `tools` count matches `TOOL_NAMES.length`

**S7 — Docs sweep + retro**:
- Update `docs/manual/forge-json-reference.html` — `modelTier` rows now reference `MODEL_TIERS` enum source-of-truth; quorum mode rows reference `QUORUM_MODES`
- Update `docs/CLI-GUIDE.md` — note `pforge-mcp/bin/enums-cli.mjs` as the canonical enumeration helper (low-traffic, internal but documented)
- Update `docs/manual/customization.html` — hook table notes that `HOOK_PASCAL` in `enums.mjs` is the source of truth
- Update `.github/instructions/architecture-principles.instructions.md` Temper Guards — add: "Hardcoding a string from a stable-small-set in code? STOP, import from `pforge-mcp/enums.mjs`."
- `CHANGELOG.md` — one grouped entry under `[Unreleased]`: `### Changed — Centralized stable enums (no behavior change)`
- Retro: write `docs/plans/testbed-findings/Phase-ENUMS-CENTRALIZATION-retro.md` covering migration friction, CI-guard false positives, surfaces still NOT centralized and why

### Out of Scope

- **Anything not listed in §"In Scope"**. This is not a refactor pass on the *consumers* of these enums beyond the migration itself.
- **Vendor model IDs** (`claude-opus-4.7`, `gpt-5`, `grok-4.20`, etc.) — these live in `pforge-mcp/model-resolver.mjs` as a registry. They are **data**, not constants; they age out monthly. Explicitly out of scope per Phase-AUDITOR-AUTOMATION Forbidden Action #14.
- **Skill names, agent names, extension config keys** — these are registered by extensions and a frozen enum would block the extension ecosystem.
- **Plan slice IDs, phase numbers, version numbers** — per-plan / per-release, not global.
- **Per-plan gate command strings** — plan-specific; enumeration would over-constrain plan authoring.
- **TypeScript migration** — `enums.mjs` is plain JS with `Object.freeze` + runtime asserts. A TS migration of the whole codebase is a separate, much larger phase.
- **Replacing `model-resolver.mjs`** — `MODEL_TIERS` is the abstraction *over* the resolver, not its replacement. The resolver continues to map tier → concrete model.
- **Touching `pforge-mcp/cost-service.mjs#costForLeg()`** (universal tripwire — v2.83.0 protected — already a Forbidden Action in every plan)
- **Auto-generating `docs/manual/forge-json-reference.html`** — too much hand-curated prose; reference-link approach only (S7)
- **Migrating `docs/manual/customization.html` to auto-gen** — same reason; reference-link only
- Touching `pforge-sdk/`, `extensions/`, `presets/` (universal carveouts)
- Cross-repo enum sync (e.g. consuming projects importing `enums.mjs`) — single-repo only this phase

### Forbidden Actions

- **Do NOT modify** `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` (v2.83.0 protected — universal tripwire)
- **Do NOT** put vendor model identifiers (`claude-opus-4.7`, `gpt-5`, `grok-4.20`, etc.) in `enums.mjs`. Capability tiers (`MODEL_TIERS`) are the abstraction. Vendor IDs aging out is the entire reason this distinction exists.
- **Do NOT** make any enum mutable. Every export MUST be `Object.freeze`'d. Mutation tests MUST cover every export.
- **Do NOT** change any user-facing CLI output, doc text, or report formatting as part of the migration. S6 byte-identical smith output is the proof. Reformatting is a separate phase.
- **Do NOT** add new enum entries for capabilities that don't yet exist in code. Every entry must trace to a real consumer at commit time. (Prevents this plan from speculatively pre-loading enums for features that get cancelled.)
- **Do NOT** break the existing `.forge.json` schema. Config keys keep their current camelCase. Enums are an *implementation* detail; schema is the *contract*.
- **Do NOT** introduce a runtime dependency on `node` from `pforge.ps1` / `pforge.sh` for code paths that don't already require it. `smith` already shells to node, so the enums-cli helper is acceptable; quorum-mode parsing in `run-plan` is borderline — verify node is already required on that path before migrating in S5.
- **Do NOT** make `enums.mjs` import from any other `pforge-mcp/*.mjs` module. It is a leaf module; circular import = build break across the whole tree.
- **Do NOT** bundle slices into one commit. Each slice = one commit. S0 / S6 / S7 also each = one commit.
- **Do NOT** push to the testbed repository at `E:\GitHub\plan-forge-testbed` during S6. The smith golden-output test reads testbed state; it MUST NOT write.
- **Do NOT** allow CI guards (`check-capabilities-doc.mjs`, `check-error-catalog.mjs`) to auto-fix on drift detection. Drift is human-review-required; auto-fix would mask real issues.

---

## Resolved Decisions

Decisions locked at draft time; Step-2 hardener may sharpen but should not re-litigate.

1. **Leaf module, no dependencies** — `enums.mjs` imports nothing from `pforge-mcp/*.mjs`. It is the bottom of the dependency tree. This is why error remediation text lives in the enum itself (not in a separate doc module).
2. **`Object.freeze` over TypeScript** — JS-only project; runtime freeze + `assertX` helpers gives 90% of enum value without a TS migration. TS is a separate, much larger phase if ever undertaken.
3. **Auto-gen the high-drift docs, reference-link the low-drift docs** — `capabilities.md` and `errors-and-exit-codes.html` get script-generated tables. `forge-json-reference.html` and `customization.html` get a reference link only (their prose has too much hand-curated detail to safely auto-gen).
4. **CI guards reject, never auto-fix** — drift on a generated doc means someone added a tool/error without updating the enum. That's a human-review event. Auto-fix would let real drift accumulate silently.
5. **`null` as inherit sentinel for `modelTier`** — `null` is intentionally NOT in `MODEL_TIERS`. Consumers explicitly check `tier === null ? inheritAskMode() : assertModelTier(tier)`. This forces the inherit decision to be visible in every consumer rather than buried.
6. **Quorum mode `'false'` stays a string** — backward compat with today's CLI surface (`--quorum=false`). A boolean coercion would break existing user scripts. The string is documented as a sentinel in `QUORUM_MODES`.
7. **`PostRun` and `forge_master_observe` land in S1, not pre-staged** — Execution Hold gates on AUDITOR-AUTOMATION shipping. By the time S1 runs, those identifiers exist in code, and S1 is just enumerating reality.
8. **bash + PowerShell parity is a freebie** — S2's enums-cli approach incidentally fixes the pre-existing asymmetry where `pforge.sh` doctor never enumerated LiveGuard hooks. Free win.
9. **Behavior preservation is non-negotiable** — byte-identical smith output on the golden fixture is the S6 gate. Any deliberate formatting change is a separate `feat:` commit in a separate slice (not this phase).
10. **No enum churn during the phase** — if a competing PR adds a new hook or tool during this phase's execution window, the lockHash check will fail and require human re-harden. This is by design.

---

## Slice Decomposition

### S0 — Baseline test harness

- Capture golden `pforge smith` output against `E:\GitHub\plan-forge-testbed` to `pforge-mcp/tests/fixtures/smith-golden-pre-enums.txt`
- Capture current `docs/capabilities.md` tool count, `docs/manual/glossary.html` count comment, and `docs/llms.txt` tool inventory to `pforge-mcp/tests/fixtures/capabilities-doc-pre-enums.snapshot.json`
- Capture current named-error-catalog HTML row count + code list to `pforge-mcp/tests/fixtures/error-catalog-pre-enums.snapshot.json`
- New stub `pforge-mcp/tests/enums.test.mjs` that fails on missing import (red-state baseline for S1)
- **Gate**: `bash -c "test -f pforge-mcp/tests/fixtures/smith-golden-pre-enums.txt && test -f pforge-mcp/tests/fixtures/capabilities-doc-pre-enums.snapshot.json && test -f pforge-mcp/tests/fixtures/error-catalog-pre-enums.snapshot.json && cd pforge-mcp && npx vitest run tests/enums.test.mjs 2>&1 | grep -q 'fail'"` returns 0 (red baseline confirmed)

### S1 — Create `pforge-mcp/enums.mjs` + tests

- New file `pforge-mcp/enums.mjs` with all 8 exports per §"In Scope" S1 (excluding `ERROR_CODES`, which is filled in S4)
- `ERROR_CODES = Object.freeze({})` placeholder with TODO comment pointing to S4
- `pforge-mcp/tests/enums.test.mjs` — covers frozen-ness, assert helpers, cross-checks
- No consumer migration in this slice; enums.mjs ships unconsumed
- **Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/enums.test.mjs"` returns 0

### S2 — Migrate `pforge smith` (ps1 + sh)

- New `pforge-mcp/bin/enums-cli.mjs` — minimal CLI: `--enum <NAME> [--format text|json]`
- `pforge.ps1` smith section — replace `$liveGuardHooks`, `$configKeyMap`, `$allExpectedHooks` literals with calls to enums-cli; preserve all output formatting
- `pforge.sh` smith section — same migration; ADD LiveGuard hooks check (was previously absent — bash parity)
- New test `pforge-mcp/tests/smith-golden.test.mjs` — runs `pforge smith` against the testbed, diffs stdout against S0 golden, asserts byte-identical
- **Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/smith-golden.test.mjs && diff <(./pforge.sh smith 2>&1) <(pwsh -NoProfile -File ./pforge.ps1 smith 2>&1) | head -50"` exits 0 and the diff shows only expected platform differences (path separators, etc.) — not enum content

### S3 — Migrate `capabilities.mjs` + auto-gen `docs/capabilities.md`

- `pforge-mcp/capabilities.mjs` — every tool-name literal replaced with `TOOL_NAMES.foo`
- New `scripts/generate-capabilities-doc.mjs` — emits the `## MCP Tools (N)` table; also updates count in `docs/manual/glossary.html` `<!--c:tools-->N<!--/c-->` and `docs/llms.txt`
- New `scripts/check-capabilities-doc.mjs` — runs generator into temp dir, diffs against committed; non-zero exit on drift
- Run generator once to regenerate committed doc (this slice's actual content change to docs/)
- Wire `check-capabilities-doc.mjs` into the preCommit chain (per Phase-WORKER-GUARDRAILS pattern)
- **Gate**: `bash -c "node scripts/generate-capabilities-doc.mjs --dry-run && node scripts/check-capabilities-doc.mjs"` returns 0

### S4 — Migrate error catalog + auto-gen `errors-and-exit-codes.html`

- Walk throw sites; populate `ERROR_CODES` in `enums.mjs`
- Migrate throw sites to use `ERROR_CODES.foo` (incremental; codes that can't be cleanly migrated stay literal with a `// TODO: enum migration` marker — those become a follow-up SHOULD)
- New `scripts/generate-error-catalog.mjs` — emits the named-error table in `docs/manual/errors-and-exit-codes.html`
- New `scripts/check-error-catalog.mjs` — same pattern as S3
- Wire into preCommit chain
- **Gate**: `bash -c "node scripts/generate-error-catalog.mjs --dry-run && node scripts/check-error-catalog.mjs"` returns 0

### S5 — Migrate quorum/cost-source/mode strings

- `pforge-mcp/orchestrator.mjs` — `QUORUM_MODES` and `WATCHER_MODES` migrations
- `pforge-mcp/cost-service.mjs` — `COST_SOURCES` validation at ingest boundary only (do NOT touch `costForLeg()`)
- `pforge-master/src/config.mjs` — `MODEL_TIERS` + `FORGE_MASTER_MODES` validation in `getForgeMasterConfig()`
- `pforge.ps1` + `pforge.sh` — quorum mode parsing migrated via enums-cli (only if node already required on that path; otherwise defer to a follow-up)
- **Gate**: `bash -c "cd pforge-mcp && npx vitest run && cd ../pforge-master && npx vitest run"` returns 0 (full existing test suites must still pass — pure migration, zero behavior change)

### S6 — Full QA sweep

- Re-run S0 golden capture; diff against post-migration smith output (MUST be byte-identical)
- Run both `pforge-mcp` and `pforge-master` test suites
- Run `node scripts/check-capabilities-doc.mjs && node scripts/check-error-catalog.mjs` (both exit 0)
- Run `forge_capabilities` via MCP — assert `tools.length === TOOL_NAMES.length`
- Run `pforge smith` and `pforge check` against the testbed — both exit 0, output reviewed manually
- **Gate**: `bash -c "cd pforge-mcp && npx vitest run && cd ../pforge-master && npx vitest run && node scripts/check-capabilities-doc.mjs && node scripts/check-error-catalog.mjs"` returns 0

### S7 — Docs sweep + retro

- Per §"In Scope" S7
- `CHANGELOG.md` entry under `[Unreleased]`: `### Changed — Centralized stable enums (no behavior change)`
- Retro at `docs/plans/testbed-findings/Phase-ENUMS-CENTRALIZATION-retro.md`
- **Gate**: `bash -c "grep -q 'enums.mjs' .github/instructions/architecture-principles.instructions.md && grep -q 'Centralized stable enums' CHANGELOG.md && test -f docs/plans/testbed-findings/Phase-ENUMS-CENTRALIZATION-retro.md"` returns 0

---

## Acceptance Criteria

### MUST

1. `pforge-mcp/enums.mjs` exists, exports all 8 stable-set enumerations, all `Object.freeze`'d
2. `pforge-mcp/tests/enums.test.mjs` passes with frozen-ness, assert helper, and cross-check coverage
3. `pforge.ps1 smith` and `pforge.sh smith` both read hook lists from `enums.mjs` via `enums-cli.mjs` — zero hardcoded hook arrays remain in shell scripts
4. `pforge.sh smith` now enumerates LiveGuard hooks (parity with PowerShell — pre-existing asymmetry resolved)
5. `pforge smith` stdout against testbed is byte-identical before vs after migration (S6 golden test passes)
6. `docs/capabilities.md` tool table is auto-generated by `scripts/generate-capabilities-doc.mjs`; CI guard `scripts/check-capabilities-doc.mjs` is in preCommit chain
7. `docs/manual/errors-and-exit-codes.html` named-error table is auto-generated by `scripts/generate-error-catalog.mjs`; CI guard in preCommit chain
8. `pforge-mcp/capabilities.mjs` uses `TOOL_NAMES` constants — zero hardcoded tool-name literals in `buildForgeMasterCapabilities()` or any tool-list array
9. `pforge-master/src/config.mjs` validates `observer.modelTier` and `auditor.modelTier` against `MODEL_TIERS` (or `null`) — invalid values throw with helpful message listing valid tokens
10. Full `pforge-mcp` + `pforge-master` test suites pass with zero failures after all migrations
11. `forge_capabilities` returns `tools.length === TOOL_NAMES.length` — programmatic and enum source of truth agree
12. `CHANGELOG.md` has the grouped `[Unreleased]` entry
13. `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` is unchanged (universal tripwire)

### SHOULD

- Throw sites that couldn't be cleanly migrated to `ERROR_CODES` in S4 are tagged `// TODO: enum migration` for follow-up
- `pforge.ps1` and `pforge.sh` quorum mode parsing also migrated in S5 (if node is already required on that path; otherwise deferred)
- Retro documents which enum candidates were considered and rejected (and why) — feeds future reviewers
- `.github/instructions/architecture-principles.instructions.md` Temper Guards updated with the "hardcoded string from stable set" pattern

### Verification commands

```bash
# Enum source of truth exists and is frozen
node -e "const e = require('./pforge-mcp/enums.mjs'); try { e.HOOK_PASCAL.push('Bad'); process.exit(1) } catch { process.exit(0) }"

# Smith no longer has hardcoded hook arrays
! grep -E '\$liveGuardHooks\s*=\s*@\(' pforge.ps1
! grep -E '\$allExpectedHooks\s*=\s*@\(' pforge.ps1
! grep -E 'expected_hooks=\(' pforge.sh

# Capabilities.mjs uses enum
grep -q "TOOL_NAMES" pforge-mcp/capabilities.mjs

# CI guards exist
test -f scripts/check-capabilities-doc.mjs
test -f scripts/check-error-catalog.mjs

# preCommit chain wires them
grep -q "check-capabilities-doc" .forge.json
grep -q "check-error-catalog" .forge.json

# Behavior preservation
diff <(./pforge.sh smith 2>&1) pforge-mcp/tests/fixtures/smith-golden-pre-enums.txt  # expect: only expected diffs (timestamps, paths)

# Self-test count consistency
node pforge-master/server.mjs --self-test 2>&1 | grep -q '2 tools'

# CHANGELOG
grep -q "Centralized stable enums" CHANGELOG.md
```

---

## Stop Conditions

Halt execution and request human review if any of these fire:

- S2 byte-identical smith output check fails. Diff must be reviewed line-by-line; any unintended format change is a STOP (the migration must be invisible)
- `enums-cli.mjs` shell-out adds >100ms to `pforge smith` cold-start (perf regression — must investigate before continuing; reverting to in-process JSON inline is the fallback)
- S3 or S4 auto-gen produces a doc that diffs against the committed version on first run AND the diff is non-trivial (means the doc had hand-edits that aren't captured in code — those edits need to be ported into the generator before locking)
- S4 throw-site walk discovers more than 20 distinct error codes (suggests the catalog is bigger than a single slice — STOP and break S4 into two slices)
- Any consumer migration introduces a circular import touching `enums.mjs` (means `enums.mjs` accidentally grew a dependency — must refactor back to leaf module)
- S6 full test suite shows ANY new failure (pure migration = zero failures expected; any failure is real and must be fixed before continuing)
- A competing PR lands a new hook, tool, or error code on `master` between Execution Hold lift and S1 commit — `lockHash` check will catch this; halt, re-harden, re-run S0 to recapture goldens

---

## Commit Convention

- Each slice = one commit
- S0: `test(enums-centralization): S0 — baseline goldens + red-state enum test`
- S1: `feat(pforge-mcp): pforge-mcp/enums.mjs — stable-set enumerations`
- S2: `refactor(cli): pforge smith reads hook lists from enums.mjs; bash gains LiveGuard parity`
- S3: `refactor(capabilities): capabilities.mjs reads from TOOL_NAMES; docs/capabilities.md auto-generated`
- S4: `refactor(errors): named error codes centralized in enums.mjs; errors-and-exit-codes.html auto-generated`
- S5: `refactor: quorum/cost-source/mode strings migrated to enums.mjs`
- S6: `test(enums-centralization): S6 — full QA sweep, golden behavior preservation verified`
- S7: `docs(enums-centralization): S7 — reference links + Temper Guard + CHANGELOG + retro`

All commits land on `master`. PreCommit chain (shipped in WORKER-GUARDRAILS A3) runs on each. S3 and S4 commits ALSO wire their own check scripts into the chain.

---

## Hardening Audit Trail

| Date | Action | By |
|---|---|---|
| 2026-05-18 | Draft created from Phase-AUDITOR-AUTOMATION planning carryover — user surfaced the question "should we make some global enumerations so we are consistent across the app?" after observing that PostRun + forge_master_observe each had to be scoped as multiple separate file edits because no enum existed | Copilot session |
| _pending_ | Step-2 harden: lockHash, sharpen S4 throw-site walk methodology, decide whether quorum-mode parsing in `pforge.ps1` / `pforge.sh` ships in S5 or deferred | _pending_ |
| _pending_ | Execution Hold lifted (gates on AUDITOR-AUTOMATION + AUDITOR-AUTOMATION-UI shipping) | _pending_ |

---

## Carryover (explicitly out of this phase)

- **TypeScript migration of the whole codebase** — `Object.freeze` + runtime asserts give 90% of enum value without TS. A TS migration is a separate, much larger phase if ever undertaken.
- **Vendor model ID registry refactor** — `model-resolver.mjs` already does this job for the data-registry concern; centralizing capability tiers (`MODEL_TIERS`) here is the appropriate boundary.
- **Cross-repo enum sync** — consuming projects don't import `enums.mjs`; that's a v2 problem. Per-repo enums are fine today.
- **Auto-generating `forge-json-reference.html`** — too much hand-curated prose; deliberately reference-link only.
- **Extension config key enumeration** — extensions register their own keys; a global enum would break the ecosystem.
- **Plan slice ID conventions** — per-plan, not global. (Some convention guidance lives in the Plan Hardening Runbook but is not a code-level enum.)
- **Skill name registry** — same reason as extensions.
- **Migration of throw sites that didn't cleanly fit `ERROR_CODES` in S4** — tagged `// TODO: enum migration`; follow-up phase if the backlog grows past ~10 sites.

---

## Appendix A — Pre-execution surface inventory (verified at draft time)

> **Why this exists**: The whole point of this phase is that hardcoded surfaces drift. This appendix is the snapshot of *every* surface this phase migrates, so the executor can verify completeness mechanically.

### Files this phase will create

| Path | Purpose |
|---|---|
| `pforge-mcp/enums.mjs` | Single source of truth for stable-set identifiers |
| `pforge-mcp/bin/enums-cli.mjs` | Shell-out helper for ps1 + sh consumers |
| `pforge-mcp/tests/enums.test.mjs` | Frozen-ness, assert helpers, cross-checks |
| `pforge-mcp/tests/smith-golden.test.mjs` | Behavior preservation gate |
| `pforge-mcp/tests/fixtures/smith-golden-pre-enums.txt` | S0 golden |
| `pforge-mcp/tests/fixtures/capabilities-doc-pre-enums.snapshot.json` | S0 golden |
| `pforge-mcp/tests/fixtures/error-catalog-pre-enums.snapshot.json` | S0 golden |
| `scripts/generate-capabilities-doc.mjs` | S3 generator |
| `scripts/check-capabilities-doc.mjs` | S3 CI guard |
| `scripts/generate-error-catalog.mjs` | S4 generator |
| `scripts/check-error-catalog.mjs` | S4 CI guard |
| `docs/plans/testbed-findings/Phase-ENUMS-CENTRALIZATION-retro.md` | S7 retro |

### Files this phase will modify (consumer migration targets)

| Path | Lines (approx, at draft time) | Migration target |
|---|---|---|
| `pforge.ps1` | ~3428 (`$liveGuardHooks`), ~3431 (`$configKeyMap`), elsewhere for `$allExpectedHooks` | S2 |
| `pforge.sh` | ~2893 (`expected_hooks`); ADD LiveGuard section | S2 |
| `pforge-mcp/capabilities.mjs` | TOOL_METADATA keys (~lines 1300–1700), `buildForgeMasterCapabilities()` (~line 3084), other tool-list arrays | S3 |
| `pforge-mcp/server.mjs` | TOOLS array (~line 642), MCP_ONLY_TOOLS (~line 8313) | S3 |
| `pforge-master/server.mjs` | `ListToolsRequestSchema` handler (~line 108), self-test banner (~line 183) | S3 |
| `pforge-mcp/orchestrator.mjs` | quorum mode string-matches; watcher mode string-matches | S5 |
| `pforge-mcp/cost-service.mjs` | source label parsing (NOT `costForLeg()`) | S5 |
| `pforge-master/src/config.mjs` | `getForgeMasterConfig()` — `modelTier` validation | S5 |
| `docs/capabilities.md` | Tool table (regenerated by S3 script) | S3 |
| `docs/manual/glossary.html` | `<!--c:tools-->N<!--/c-->` count | S3 |
| `docs/manual/errors-and-exit-codes.html` | Named-error table (regenerated by S4 script) | S4 |
| `docs/llms.txt` + root `llms.txt` | Tool inventory line | S3 |
| `docs/manual/forge-json-reference.html` | Add reference link to `enums.mjs` for `modelTier` / quorum mode rows | S7 |
| `docs/CLI-GUIDE.md` | Document `enums-cli.mjs` helper | S7 |
| `docs/manual/customization.html` | Note `HOOK_PASCAL` source of truth | S7 |
| `.github/instructions/architecture-principles.instructions.md` | Add Temper Guard entry | S7 |
| `CHANGELOG.md` | `[Unreleased]` grouped entry | S7 |
| `.forge.json` | preCommit chain entries for S3 + S4 CI guards | S3 + S4 |

### Pre-flight grep sentinel (run BEFORE starting S1)

If any of these grep'd values has changed since this appendix was written, DO NOT execute blindly — re-audit:

| Value | Expected at draft time | Re-check command |
|---|---|---|
| `$liveGuardHooks` line in `pforge.ps1` | one occurrence ~line 3428 | `grep -n '\$liveGuardHooks\s*=' pforge.ps1` |
| `$configKeyMap` line in `pforge.ps1` | one occurrence ~line 3431 | `grep -n '\$configKeyMap\s*=' pforge.ps1` |
| `expected_hooks` line in `pforge.sh` | one occurrence ~line 2893 | `grep -n 'expected_hooks=' pforge.sh` |
| TOOLS array in `pforge-mcp/server.mjs` | one declaration ~line 642 | `grep -nE '^(const\|let\|var)?\s*TOOLS\s*=' pforge-mcp/server.mjs` |
| `buildForgeMasterCapabilities` in `pforge-mcp/capabilities.mjs` | one function ~line 3064 | `grep -n 'function buildForgeMasterCapabilities' pforge-mcp/capabilities.mjs` |
| `costForLeg` line in `pforge-mcp/cost-service.mjs` | ~line 309–318 (DO NOT TOUCH) | `grep -n 'function costForLeg' pforge-mcp/cost-service.mjs` |
| Hook count in `docs/manual/customization.html` | row count for LiveGuard table | `grep -c '<tr>' docs/manual/customization.html` (cross-check vs expected 7 + PostRun = 8 post-AUDITOR-AUTOMATION) |
| Tool count expectation | post-AUDITOR-AUTOMATION = 90 | `grep -E '^## MCP Tools \([0-9]+\)' docs/capabilities.md` |
