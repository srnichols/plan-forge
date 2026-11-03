# Phase GITHUB-A: GitHub Stack Introspection + Manual-Index Facelift

> **Status**: Drafted, awaiting hardening (Step 2)
> **Tracks**: Code (new `pforge github` subcommand) + Docs (manual index facelift + new chapter scaffold)
> **Estimated cost**: $1.50–$3.00 (8 slices, mix of code + docs, all small)
> **Pipeline**: Specify (this doc) → Pre-flight → Harden → Execute → Sweep → Review → Ship

---

## Feature Specification: GitHub Stack Introspection + Manual-Index Facelift

### Problem Statement

Plan-Forge today integrates with the GitHub-native AI surface (Copilot, AGENTS.md, `.github/copilot-instructions.md`, `.github/instructions/*`, MCP, Spaces, Metrics API, GHAS) but has no first-class way for a user to discover **what's wired up vs missing** in their own repo, and the manual has no chapter that describes the integration coherently. This makes three groups underserved:

1. **New GitHub Copilot users** evaluating Plan-Forge — they can't tell at a glance whether Plan-Forge "fits" their stack
2. **Existing users on GitHub** who want to deepen the integration but don't know what knobs exist
3. **Microsoft / GitHub field engineers** evaluating Plan-Forge for customer recommendations — they need a depth of documentation that matches the depth of integration

This is also the sequencing pre-requisite for two follow-on phases (Phase GITHUB-B: Copilot Coding Agent dispatch + SARIF ingestion; Phase GITHUB-C: the full chapter, dogfooded). We need a small, honest, opt-in starting point that produces real artifacts for the chapter to reference.

The work is **strictly opt-in**. Plan-Forge does not gain a GitHub dependency — `pforge github status` is a new subcommand a user can ignore entirely if they're on GitLab, Bitbucket, or anything else. The manual index gains audience tiles but the existing Quickstart hero stays. Nothing on the existing Plan-Forge surface changes behaviour.

### User Scenarios

**Scenario 1: New Copilot user evaluates Plan-Forge**
1. User installs Plan-Forge in a GitHub repo via `setup.ps1`.
2. They run `pforge github status` (mentioned in the new manual chapter and in the post-setup output).
3. They see a clear checklist: ✓ `.github/copilot-instructions.md` present, ✓ AGENTS.md present, ⚠ MCP not configured in `.vscode/mcp.json`, ⊘ GHAS not detectable without `--gh-token`.
4. They run `pforge github doctor` and see one-line fix hints for each `⚠` and `✗` row.
5. Outcome: in 30 seconds they understand what the GitHub-native stack offers and what they need to flip on. Trust is high because nothing was assumed about their setup.

**Scenario 2: Existing user lands on the manual via google search "plan-forge github copilot"**
1. They land on `docs/manual/index.html`.
2. Above the existing chapter grid, three audience tiles appear: "I'm new to Plan-Forge" / "I'm running it on the GitHub stack" / "I'm extending it".
3. They click the GitHub tile and land on `docs/manual/plan-forge-on-the-github-stack.html`.
4. The chapter (scaffolded in this Phase, content lands in Phase GITHUB-C) introduces the integration architecture, links to `pforge github status` for the readiness check, and lists the eight GitHub-native primitives Plan-Forge consumes.
5. Outcome: they have a single canonical entry point for the GitHub story. Search engines do too.

**Scenario 3: Plan-Forge maintainer dogfoods the new commands on the testbed**
1. Maintainer runs `pforge github status --project E:\GitHub\plan-forge-testbed`.
2. Output reflects the testbed's actual `.github/*` state (it has been run through `setup.ps1` so most green).
3. They run `pforge github status --json` and pipe to a file for the dashboard or for the chapter screenshot.
4. Outcome: the testbed becomes the visual demo for Section 1 of the new chapter, and the JSON output is consumable by the future dashboard tab without further work.

**Scenario 4: User on Bitbucket runs Plan-Forge**
1. They never run `pforge github *`. The command exists but is never required.
2. The new manual chapter is one of 50+ chapters — they ignore it. The audience tiles include a fourth "I'm on a different stack" tile that links to `stack-notes.html` and `extensions.html`.
3. Outcome: zero negative impact. The GitHub depth is additive, not exclusive.

### Acceptance Criteria

- [ ] **MUST**: New file `pforge-mcp/github-introspect.mjs` exports `inspectGithubStack(projectRoot, opts)` returning a structured `{ checks: [{ id, label, status: 'pass'|'warn'|'fail'|'na', detail, fixHint? }], summary }` object. No network calls in the default path; `--gh-token` enables the API-backed checks.
- [ ] **MUST**: `pforge github status` prints a human-readable checklist (✓ / ⚠ / ✗ / ⊘) of all checks. Exit code 0 if no `fail`, 1 if any `fail`.
- [ ] **MUST**: `pforge github status --json` prints the structured object as JSON to stdout, suitable for piping. Exit code unchanged.
- [ ] **MUST**: `pforge github doctor` prints the same checklist plus one-line `fixHint` for every `warn` / `fail` row. Exit code mirrors `status`.
- [ ] **MUST**: At minimum, the following checks are implemented and pass on the testbed (`E:\GitHub\plan-forge-testbed`) where applicable:
  1. `.github/copilot-instructions.md` exists
  2. `AGENTS.md` exists at repo root
  3. `.github/instructions/` directory exists and contains at least one `*.instructions.md`
  4. `.github/prompts/` directory exists and contains at least one `*.prompt.md`
  5. `.vscode/mcp.json` exists and references a Plan-Forge MCP server entry
  6. `.github/workflows/` exists (signal of Actions usability)
  7. Repo has a `.git/config` with a `github.com` remote (signal of GitHub hosting)
  8. `gh` CLI is on PATH (signal of full GitHub tooling)
- [ ] **MUST**: All 8 checks produce a `fixHint` when failing or warning. Hints are one line, actionable, and reference a file path or command.
- [ ] **MUST**: The `pforge` CLI dispatcher (both `pforge.ps1` and `pforge.sh`) recognises `github` as a top-level subcommand and routes to the new module.
- [ ] **MUST**: `pforge github --help` prints the subcommand list (`status`, `doctor`) with one-line descriptions.
- [ ] **MUST**: Vitest test file `pforge-mcp/tests/github-introspect.test.mjs` covers all 8 checks across three programmatically-built fixture trees (green / partial / empty) created in a per-suite tmpdir at `beforeAll`. ≥ 95% line coverage of `github-introspect.mjs`. (Fixtures are NOT checked in: `.git/` paths cannot be tracked by git, and `.vscode/` is gitignored at repo root.)
- [ ] **MUST**: New chapter `docs/manual/plan-forge-on-the-github-stack.html` exists as a scaffold with: hero, Section 1 ("Is your repo set up?" — describes `pforge github status`/`doctor` with a real terminal-output screenshot from the testbed), Section 2 placeholder ("The eight primitives" — table only, prose lands in Phase GITHUB-C), and "Coming in Phase GITHUB-C" callouts for Sections 3+.
- [ ] **MUST**: `docs/manual/assets/manual.js` registers the new chapter under a new "Stack Integrations" group (or extends the existing Appendices group, Hardener decides).
- [ ] **MUST**: `docs/manual/index.html` gains an "Audience tiles" row above the existing Quickstart hero (or below it — Hardener decides) with four tiles:
  1. "I'm new to Plan-Forge" → links to `quickstart-install.html`
  2. "I'm running it on the GitHub stack" → links to `plan-forge-on-the-github-stack.html`
  3. "I'm extending it" → links to `customization.html` and `extensions.html`
  4. "I'm on a different stack" → links to `stack-notes.html`
- [ ] **MUST**: The new chapter is referenced exactly once from `setup.ps1` and `setup.sh` post-install output ("Run `pforge github status` to see your GitHub-native stack readiness, or read /manual/plan-forge-on-the-github-stack.html").
- [ ] **MUST**: `pforge github status` runs cleanly against the **Plan-Forge repo itself** (`E:\GitHub\Plan-Forge`) and against the **testbed** (`E:\GitHub\plan-forge-testbed`). Both produce all-pass or expected-warn output suitable for chapter screenshots.
- [ ] **SHOULD**: A screenshot of `pforge github status` running against the testbed is captured as `docs/manual/assets/screenshots/github-status-testbed.webp` and embedded in Section 1 of the new chapter.
- [ ] **SHOULD**: `pforge github status` also detects optional but recommended files: `.github/copilot-instructions.md` length ≥ 50 lines (warn if shorter — likely a stub), instruction files referencing `applyTo:` (warn if none — path-scoping not used).
- [ ] **MAY**: An MCP tool `forge_github_status` exposes the same JSON output to MCP clients (Copilot, Claude Code, Cursor) so an in-IDE chat can ask "what GitHub primitives am I missing?"
- [ ] **MAY**: A `--gh-token` mode adds three additional checks: GHAS code scanning enabled, Dependabot enabled, Copilot Coding Agent eligibility on the repo. Skipped silently without the token.

### Edge Cases

| Scenario | Expected Behavior |
|---|---|
| User on Windows without Git Bash installed | Status command works (pure Node, no shell-out for the 8 default checks). `gh` CLI check returns `warn` with hint. |
| Repo has no `.git/` directory (running outside a clone) | All Git/GitHub-remote checks return `na` (not applicable) with detail "no .git directory found". Exit code stays 0 unless other checks fail. |
| `.vscode/mcp.json` exists but doesn't reference a Plan-Forge entry | Returns `warn` (not `fail`) with hint "add a Plan-Forge MCP server entry; see /manual/mcp-server-quickstart.html". |
| User runs `pforge github status` without any `.github/*` files | All 8 checks `fail` or `warn`. Exit code 1. Output ends with one line: "Run `setup.ps1` or `setup.sh` to scaffold the GitHub-native surface." |
| `pforge github` (no subcommand) | Prints `--help` output. Exit code 0. |
| `pforge github typo-command` | Prints "Unknown subcommand 'typo-command'. Try `pforge github --help`." Exit code 1. |
| User pipes `--json` output to `jq` | Output is single-object JSON, no banner, no ANSI colour codes. |
| Run on the Plan-Forge repo itself (which IS the test repo for this feature) | All 8 checks pass green. Used as a regression smoke test. |
| Run on the testbed | All 8 checks pass green or have known expected warns. Used as the chapter screenshot source. |

### Out of Scope

- **Phase GITHUB-B work** (deferred): `pforge run-plan --worker copilot-coding-agent` watch loop, `pforge plan-from-sarif` SARIF ingestion, dispatch to Copilot Coding Agent
- **Phase GITHUB-C work** (deferred): Sections 3–8 of the new chapter (Coding Agent dispatch flow, GHAS chain, Spaces sync, Metrics API leaderboard, BYOK story, "other agent platforms" section)
- Copilot Spaces sync (`pforge sync-spaces`) — Phase GITHUB-D or later
- Metrics API ingestion + unified leaderboard — Phase GITHUB-D or later
- Any change to existing CLI commands (`run-plan`, `analyze`, `smith`, etc.) other than the new `github` dispatch entry
- Any change to the existing dashboard
- Any change to `setup.ps1` / `setup.sh` other than the single post-install line referencing the new chapter
- A `pforge gitlab` / `pforge bitbucket` symmetry — defer until a contributor asks
- An MCP tool registration if `MAY` item is dropped during hardening

### Open Questions

1. **`pforge github` vs `pforge gh`?** — `gh` is the official GitHub CLI binary name. Using it as our subcommand could create user confusion. Recommend `pforge github` for clarity.
2. **Audience tiles placement: above or below the existing Quickstart hero?** — Above feels heavier on the page; below preserves the hero CTA. Hardener decides during Step 2 after a visual review.
3. **`--gh-token` checks (`MAY`): include in this Phase or defer?** — They require a network call and an auth token. Recommend defer to Phase GITHUB-B unless Hardener sees them as low-cost.
4. **Should `forge_github_status` MCP tool be in this Phase?** — Useful for in-IDE chat but adds tool-registration surface. Recommend include if Slice 4 has budget.
5. **Where does the new chapter sit in the manual sidebar?** — Options: (a) new "Stack Integrations" group in Part III, (b) Appendices, (c) standalone above Appendices. Hardener decides.

### Complexity Estimate

- **Estimated effort**: Medium (8 slices, mix of small code + small docs, no tricky integrations)
- **Estimated files**: ~15 (1 new module, 1 new test file + 3 fixture dirs, 1 new chapter, 1 chapter registry update, 1 manual index update, 2 CLI dispatcher updates, 2 setup script updates, 1 screenshot)
- **Recommended pipeline**: **Standard pipeline** — Steps 0–6 (Specify, Pre-flight, Harden, Execute, Sweep, Review, Ship). Step 5 Review can be light because the surface is small.

---

## Scope Contract

### Inputs

- Existing CLI dispatchers: [pforge.ps1](pforge.ps1), [pforge.sh](pforge.sh)
- Existing setup scripts: [setup.ps1](setup.ps1), [setup.sh](setup.sh)
- Existing manual index: [docs/manual/index.html](docs/manual/index.html)
- Existing chapter registry: [docs/manual/assets/manual.js](docs/manual/assets/manual.js)
- Existing stack-integration appendix: [docs/manual/stack-notes.html](docs/manual/stack-notes.html) (NOT modified — different concept; this file is about language presets)
- Testbed (read-only target for screenshots and integration tests): `E:\GitHub\plan-forge-testbed`
- Plan-Forge repo (also read-only target for the second integration smoke test): `E:\GitHub\Plan-Forge`

### Outputs

**New files** (~10):
- `pforge-mcp/github-introspect.mjs` — the introspection module
- `pforge-mcp/tests/github-introspect.test.mjs` — vitest coverage; builds green/partial/empty fixtures in a per-suite tmpdir at `beforeAll`
- `docs/manual/plan-forge-on-the-github-stack.html` — new chapter (scaffold)
- `docs/manual/assets/screenshots/github-status-testbed.webp` — terminal screenshot

**Modified files** (~6):
- `pforge.ps1` — adds `Invoke-Github` function and `'github'` switch case
- `pforge.sh` — adds the equivalent bash dispatch
- `setup.ps1` — adds one-line post-install reference to new chapter
- `setup.sh` — adds the equivalent bash one-liner
- `docs/manual/assets/manual.js` — registers new chapter
- `docs/manual/index.html` — adds audience-tiles row

### Forbidden Actions

- ❌ Modifying any existing `Invoke-*` function in `pforge.ps1` or its bash equivalent
- ❌ Modifying any existing manual chapter HTML other than `index.html`
- ❌ Adding any network call to the default `pforge github status` path (only `--gh-token` mode may make API calls, and only if Slice 4 includes it)
- ❌ Renaming, splitting, or restructuring `stack-notes.html` (different concept)
- ❌ Adding any GitHub-specific dependency to the Plan-Forge core (`pforge-mcp/server.mjs`, `orchestrator.mjs`, `cost-service.mjs`, etc.)
- ❌ Bumping VERSION until Slice 8
- ❌ Changing the existing Quickstart hero or CTA

---

## Slice Plan

> **Note for Hardener**: All gates use `bash -c "..."` for portability. Memory note `plan-gate-command-rules.md` applies. Slice 1 must include `npm` install of any new test dependency before Slice 2 runs.

### Slice 1 — Introspection module + fixtures + tests
**Files in scope**: `pforge-mcp/github-introspect.mjs`, `pforge-mcp/tests/github-introspect.test.mjs`, `pforge-mcp/tests/fixtures/github-introspect/{green,partial,empty}/`
**Goal**: Implement `inspectGithubStack(projectRoot, { ghToken? })` returning the structured object described in Acceptance Criteria. Implement all 8 default checks. Build three fixture directories. Vitest covers all checks.
**Validation gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/github-introspect.test.mjs"
```
**Estimated cost**: $0.40

### Slice 2 — `pforge github status` + `doctor` CLI dispatch (PowerShell)
**Files in scope**: `pforge.ps1`
**Goal**: Add `Invoke-Github` function with `status` and `doctor` subcommands. Both call `node pforge-mcp/github-introspect.mjs --project <root> [--json] [--doctor]`. `status` prints checklist; `doctor` prints checklist + fix hints. Exit code 0/1 by failure presence. Add `'github'` case to the main dispatcher switch.
**Validation gate**:
```bash
bash -c "node pforge-mcp/github-introspect.mjs --project . --json | grep -q '\"checks\"'"
bash -c "pwsh -NoProfile -File pforge.ps1 github --help | grep -q status"
```
**Estimated cost**: $0.20

### Slice 3 — `pforge github` bash dispatch
**Files in scope**: `pforge.sh`
**Goal**: Mirror Slice 2 in bash. Same subcommands, same exit codes, same `--json` flag.
**Validation gate**:
```bash
bash pforge.sh github --help | grep -q status
bash pforge.sh github status --json | grep -q '"checks"'
```
**Estimated cost**: $0.15

### Slice 4 — Optional MCP tool + extra checks (drop if budget tight)
**Files in scope**: `pforge-mcp/server.mjs` (additive only — new tool registration), `pforge-mcp/tools.json` (additive), `pforge-mcp/github-introspect.mjs` (extra checks for instruction-file `applyTo:` usage and copilot-instructions length)
**Goal**: Register `forge_github_status` MCP tool returning the same JSON. Add the two `SHOULD` extra checks. Update tests.
**Validation gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/github-introspect.test.mjs"
bash -c "grep -q 'forge_github_status' pforge-mcp/tools.json"
```
**Estimated cost**: $0.20
**Drop condition**: If hardening review or Slice 1–3 overruns budget, drop this slice and move both items to Phase GITHUB-B backlog.

### Slice 5 — New chapter scaffold
**Files in scope**: `docs/manual/plan-forge-on-the-github-stack.html`, `docs/manual/assets/manual.js`
**Goal**: Create the chapter with hero, Section 1 (full content describing `pforge github status` + `doctor` with the testbed screenshot placeholder), Section 2 (the 8-primitives table from the slide-8 mapping), and "Coming in Phase GITHUB-C" callouts for Sections 3–8. Register in `manual.js` under the group decided during hardening.
**Validation gate**:
```bash
bash -c "test -f docs/manual/plan-forge-on-the-github-stack.html"
bash -c "grep -q 'plan-forge-on-the-github-stack' docs/manual/assets/manual.js"
bash -c "grep -q 'pforge github status' docs/manual/plan-forge-on-the-github-stack.html"
```
**Estimated cost**: $0.30

### Slice 6 — Manual index audience tiles
**Files in scope**: `docs/manual/index.html`
**Goal**: Add the four audience tiles row in the location decided during hardening. Each tile is an `<a class="...">` block matching existing manual visual language (forge-amber accents, slate dark background). All four links resolve to existing chapters.
**Validation gate**:
```bash
bash -c "grep -q 'I.m running it on the GitHub stack' docs/manual/index.html"
bash -c "grep -q 'plan-forge-on-the-github-stack.html' docs/manual/index.html"
bash -c "grep -q 'I.m on a different stack' docs/manual/index.html"
```
**Estimated cost**: $0.15

### Slice 7 — Setup-script post-install reference + testbed screenshot
**Files in scope**: `setup.ps1`, `setup.sh`, `docs/manual/assets/screenshots/github-status-testbed.webp`
**Goal**: Add the single post-install line to both setup scripts. Capture the testbed screenshot by running `pforge github status` against `E:\GitHub\plan-forge-testbed` (manually, then commit the binary). Embed in Section 1 of the new chapter.
**Validation gate**:
```bash
bash -c "grep -q 'pforge github status' setup.ps1"
bash -c "grep -q 'pforge github status' setup.sh"
bash -c "test -f docs/manual/assets/screenshots/github-status-testbed.webp"
```
**Estimated cost**: $0.10

### Slice 8 — Cross-link sweep + version bump
**Files in scope**: `docs/manual/assets/manual.js` (sidebar verification only), `VERSION`, `CHANGELOG.md`
**Goal**: Verify sidebar nav renders the new chapter correctly (manual visual spot check counts here — note in the slice). Update VERSION (patch bump). Add CHANGELOG entry under "Added".
**Validation gate**:
```bash
bash -c "grep -qE '^[0-9]+\.[0-9]+\.[0-9]+' VERSION"
bash -c "grep -q 'pforge github' CHANGELOG.md"
bash -c "grep -q 'plan-forge-on-the-github-stack' CHANGELOG.md"
```
**Estimated cost**: $0.05

---

## Branch Strategy

- Branch name: `feat/github-stack-introspection`
- Base: `master`
- Merge strategy: Squash merge after all 8 slices pass and Step 5 Review is clean

## Rollback Plan

- Slices 1–4 (code): rollback via `git revert <merge-commit>`. New module is self-contained; no other Plan-Forge code depends on it. CLI dispatch entries are additive — removing them only loses the `pforge github` subcommand.
- Slices 5–7 (docs): rollback via `git revert`. New chapter is additive; sidebar-nav drops it cleanly. Audience-tiles row is one block in `index.html`.
- Slice 8 (version + CHANGELOG): trivial revert, then re-bump if other work has shipped since.
- No data migrations, no DB changes, no breaking CLI changes — rollback is safe at any point.

---

## Open Decisions (resolve during Step 2 hardening)

1. **Naming**: `pforge github` vs `pforge gh` (recommend `github` for clarity)
2. **Audience-tiles placement**: above vs below the Quickstart hero on `index.html`
3. **Sidebar-nav home**: new "Stack Integrations" group vs Appendices vs standalone
4. **Slice 4**: include or defer to Phase GITHUB-B
5. **`forge_github_status` MCP tool**: include in Slice 4 or skip entirely

---

## Notes for the Hardener (Step 2)

- This Phase is the **Phase A** of a three-Phase arc. Phase B (Coding Agent dispatch + SARIF) and Phase C (full chapter content) are intentionally deferred. The Hardener should NOT pull scope from B or C into A.
- The chapter scaffold in Slice 5 is intentionally thin — its job is to create the URL and Section 1 only. Sections 3–8 are stubbed with "Coming in Phase GITHUB-C" callouts. This is honest and creates the structural slot.
- All gates are single-line `bash -c "..."` per memory note `plan-gate-command-rules.md`. Do not introduce `cd dir && cmd` patterns.
- The testbed screenshot in Slice 7 is the only manual step. The Hardener should decide whether to demand the maintainer pre-capture it before the run starts, or accept it as a Slice 7 manual deliverable.
- The Plan-Forge repo itself and the testbed BOTH need to pass `pforge github status` cleanly when this Phase merges — that's the dogfood proof.
- The "different stack" audience tile linking to `stack-notes.html` is the OSS-honest move. Do not remove it during hardening.
- Total estimated cost is $1.50–$3.00 across 8 slices. If a model over $0.10/slice is selected (e.g., quorum mode), the Hardener should re-run `forge_estimate_quorum` before execution.
