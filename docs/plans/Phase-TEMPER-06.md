---
crucibleId: 07be2f66-92fd-4412-8bb4-7c28a6684fb4
source: self-hosted
status: draft
phase: TEMPER-06
arc: TEMPER
---

# Phase TEMPER-06: Bug Registry + GitHub Issues + closed-loop validator

> **Status**: 📝 DRAFT (arc-prep, no code yet)
> **Estimated Effort**: 2–3 slices
> **Risk Level**: High (external side effects — creates GitHub
> issues; closing the automation loop demands strict guardrails)
> **Target Version**: v2.47.0

See arc overview: [Phase-TEMPER-ARC.md](Phase-TEMPER-ARC.md)

---

## Why

Phases 01–05 built a system that can *find* problems. TEMPER-06
builds the system that *does something about them* — and, critically,
validates that the somethings done actually worked.

Without this phase, tempering is a very expensive smoke detector: it
beeps, but someone still has to wake up. With it, the Plan Forge loop
closes completely: a bug discovered by a scanner on Monday can be, by
Tuesday, a shipped fix whose correctness was validated by the same
scanner that found it.

This is also the phase where **GitHub Issues becomes a first-class
citizen** for teams inside Microsoft and beyond, while the **JSONL
source-of-truth fallback** keeps the system useful for everyone else,
and the **extension contract** is frozen for third-party issue
trackers.

## Scope Contract

### In-scope

**Slice 06.1 — Bug Registry core + classification**

- `.forge/bugs/` directory, one JSON file per bug (shape defined in
  [Phase-TEMPER-ARC.md](Phase-TEMPER-ARC.md) §"`.forge/bugs/<bugId>.json`
  shape")
- New MCP tools:
  - `forge_bug_register` — invoked by scanners, never by humans directly
  - `forge_bug_list` — query with filters (status / severity /
    scanner / date range)
  - `forge_bug_update_status` — flip status between `open` /
    `in-fix` / `fixed` / `wont-fix` / `duplicate`
- **Bug-vs-infra classifier**:
  - **Deterministic rule layer** (first pass, cheap):
    - Stack trace top frame in `tests/**` or `*.spec.*` → `infra`
    - Test file modified in the same commit as the failure → `infra`
    - Same test flaky ≥ 3/N runs (from TEMPER-05 flakiness data) →
      `infra`
    - Assertion failure with top frame in `src/` (or language
      equivalent) → `real-bug`
    - Visual regression flagged by quorum → `real-bug`
    - A11y violation flagged as serious / critical → `real-bug`
    - Contract mismatch → `real-bug`
    - Perf regression confirmed by 2 consecutive runs → `real-bug`
    - Load scanner hit error rate threshold → `real-bug`
  - **LLM arbitration layer** (only for cases the rules can't decide):
    - Single-model call by default, quorum opt-in
    - Returns `{ classification, reason, confidence }`
    - Confidence < 0.7 → routed to human-review queue (dashboard)
- `.forge/bugs/<bugId>.json` written only when classification is
  `real-bug`. Infra issues recorded in
  `.forge/tempering/<runId>.json#infraFixes[]` with no external side
  effects.
- Hub event `tempering-bug-registered`
- Dashboard **Bug Registry tab** — list view with filters, detail
  view with evidence / screenshots / repro / linked plan
- Tests — ~40 assertions covering every rule branch + classifier
  fallback

**Slice 06.2 — GitHub Issues integration + extension contract**

- `pforge-mcp/tempering/bug-adapters/github.mjs` — core integration
- **GitHub Issues adapter**:
  - Uses `gh` CLI where available (zero-secret-storage path),
    falls back to GitHub REST via `fetch` + token
  - Token source priority: `GITHUB_TOKEN` env →
    `.forge/secrets.json` → `gh auth token`
  - Repo auto-detect from `git remote get-url origin` when
    `config.bugRegistry.githubRepo` is null
  - **Create**: issue body includes full evidence JSON (collapsed
    `<details>` block), labels from `config.bugRegistry.labelPrefix +
    ['severity:<sev>', 'scanner:<scanner>']`
  - **Update**: comment appended when bug status / evidence changes;
    issue body never rewritten (preserves human edits)
  - **Validated fix**: comment posted with "🔥 Tempering validated
    this fix" + scan reference; issue remains open for human close
- **Extension contract** (applies to all non-GitHub trackers):
  ```js
  // .forge/extensions/<provider>/tempering-bug-adapter.mjs
  export async function registerBug(bug, config) {
    return { provider, issueNumber, url };
  }
  export async function updateBugStatus(bug, config) { /* ... */ }
  export async function commentValidatedFix(bug, config) { /* ... */ }
  export async function syncStatusFromProvider(bugId, config) { /* ... */ }
  ```
- **Extensions catalog stubs** for: GitLab, Azure DevOps Boards, Jira
  Cloud, Linear, on-prem Jira — each marked `extension-only` with
  clear entry points. Reference implementations can be contributed
  by the community via the same `pforge ext add` pipeline.
- JSONL fallback (`.forge/bugs/<bugId>.json`) is **always written
  regardless of external integration**, guaranteeing local source of
  truth.
- Tests — ~30 assertions against a mocked GitHub API fixture

**Slice 06.3 — Fix-proposal integration + closed-loop validator**

- `forge_fix_proposal` extended with new source:
  - `source: "tempering-bug"` + required `bugId` arg
  - Generates a 1–3 slice abandon-or-fix playbook similar to the
    Crucible source added in TEMPER-04
  - Auto-populated scope contract pulls `affectedFiles` from the bug
  - Validation gate for generated slices: `forge_bug_validate_fix
    --bugId <id>`
- `forge_bug_validate_fix` — the **closed-loop validator**:
  - Re-runs the exact scanner(s) that discovered the bug
  - On pass → marks bug `fixed`, sets `validatedAt`, posts
    validation comment to external tracker (if configured)
  - On fail → appends to bug's `validationAttempts[]`, keeps open
- Hub event `tempering-bug-validated-fixed`
- New watcher anomaly `tempering-bug-unaddressed` (severity: warn) —
  any `real-bug` open > 14 days with no `linkedFixPlan`
- **`forge_liveguard_run` integration** (the deferred wire-in
  repeatedly flagged in earlier phases):
  - Adds tempering dimension: status, coverage-vs-minima summary,
    open real-bug count, mutation score if available
  - Tempering now contributes to `overallStatus` green/amber/red
- Documentation pass:
  - `docs/manual/` chapter 8 (new): Tempering
  - `docs/EXTENSIONS.md` final contract doc
  - `README.md` — one-line pitch + link to manual
- Tests — ~45 assertions including an end-to-end fixture that goes
  discover-bug → create-issue → generate-fix-plan → mark-fixed →
  validate → close

### Out of scope (documented as future arc)

- Automatic PR creation from a fix-proposal plan — stays manual so
  humans review before push
- Cross-repo bug deduplication via LLM — useful but expensive;
  defer until real duplicate pain appears
- Slack / Teams / Discord notifications — extension opportunity, not
  core
- Custom bug workflows beyond the 5 statuses (e.g. "triaged",
  "in-review") — providers vary too much; extensions handle it

### Forbidden actions

- Do NOT close GitHub issues automatically — only comment. Humans
  close.
- Do NOT rewrite an issue body that a human has edited — only append
  comments
- Do NOT delete `.forge/bugs/*.json` — status updates only (even on
  `wont-fix` / `duplicate`)
- Do NOT file duplicate issues: check existing registry by
  `(scanner, testName, fingerprint)` tuple before creating
- Do NOT classify a bug as `real-bug` without at least one of:
  deterministic rule match OR LLM arbitration with confidence ≥ 0.7
- Do NOT run `forge_bug_validate_fix` against a bug in `in-fix`
  status if the linked fix plan is not yet merged — validation only
  post-merge

## Slices

### Slice 06.1 — Registry core + classifier

**Files touched:**
- `pforge-mcp/tempering/bug-registry.mjs` — new
- `pforge-mcp/tempering/bug-classifier.mjs` — new
- `pforge-mcp/server.mjs` — 3 new MCP tools
- `pforge-mcp/capabilities.mjs` + `tools.json` — schemas
- `pforge-mcp/dashboard/app.js` — Bug Registry tab
- `pforge-mcp/dashboard/index.html` — tab DOM
- `pforge-mcp/tests/tempering-bug-registry.test.mjs` — new, ~40 tests

### Slice 06.2 — GitHub adapter + extension contract

**Files touched:**
- `pforge-mcp/tempering/bug-adapters/github.mjs` — new
- `pforge-mcp/tempering/bug-adapters/jsonl-fallback.mjs` — new (no-op
  but always on)
- `extensions/catalog.json` — 5 extension-stub entries
- `docs/EXTENSIONS.md` — tempering bug-adapter contract
- `pforge-mcp/tests/tempering-github-adapter.test.mjs` — new, ~30 tests

### Slice 06.3 — Fix-proposal + validator + liveguard wire-in

**Files touched:**
- `pforge-mcp/server.mjs` — `forge_fix_proposal` extension,
  `forge_bug_validate_fix` handler, `forge_liveguard_run` tempering
  dimension
- `pforge-mcp/orchestrator.mjs` — `tempering-bug-unaddressed`
  anomaly + `recommendFromAnomalies` case
- `docs/manual/tempering.md` — new chapter 8
- `docs/manual/tempering.html` — generated
- `README.md` — link update
- `pforge-mcp/tests/tempering-closed-loop.test.mjs` — new, ~45 tests

## Success Criteria

- A fixture regression (e.g. a visual break seeded by a PR) flows
  end-to-end without human intervention:
  1. TEMPER-04 flags the regression
  2. Classifier → `real-bug`
  3. `forge_bug_register` writes `.forge/bugs/<id>.json` AND creates
     GitHub issue (when configured)
  4. Dashboard Bug Registry tab shows it with evidence
  5. `forge_fix_proposal source=tempering-bug bugId=<id>` generates
     a plan in `docs/plans/auto/`
  6. Human executes the plan; commits fix
  7. `forge_bug_validate_fix` re-runs the scanner; marks fixed
  8. GitHub issue gets the "validated" comment
  9. `forge_liveguard_run` reports green for tempering dimension
- Extension contract verified by a mock non-GitHub adapter in tests
- `forge_bug_list` returns consistent results whether reading from
  JSONL only or JSONL + GitHub-hydrated
- All existing tests continue to pass; new tests +115 (across the
  three slices)
- CHANGELOG entry under `v2.47.0`
- Full arc documentation complete: ARC doc, all 6 phase docs, manual
  chapter 8, EXTENSIONS.md, README one-liner

## Dependencies

- **Requires TEMPER-01 through TEMPER-05** all merged
- **Closes** the Tempering arc — after this phase ships, the metaphor
  from the ARC doc is fully realized end-to-end
- Arc doc `Phase-TEMPER-ARC.md` status flips from `planning` to
  `shipped` when this phase merges
