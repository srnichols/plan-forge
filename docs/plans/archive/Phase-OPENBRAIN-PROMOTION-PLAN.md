# Phase-OPENBRAIN-PROMOTION — Promote OpenBrain from Hidden Optional to Loud Optional

> **Status**: hardened draft · awaiting execution
> **Owner**: srnichols
> **Created**: 2026-05-18
> **Predecessor signal**: glossary-coverage audit (commits `0e1c897` → `c693ac0`) surfaced that OpenBrain is the architectural L3 layer (see `docs/V3-CAPABILITY-AUDIT.md` line 375: `L1 Hub ←→ L2 .forge/*.jsonl ←→ L3 OpenBrain via Anvil`) but is positioned as a row-5 optional extension in the README and is absent from the setup wizard entirely.

---

## Scope Contract

### In Scope

- Reframe OpenBrain across user-facing surfaces from "Optional companion" to "L3 layer — recommended, easy to skip."
- Add an OpenBrain prompt to the interactive paths of `setup.ps1` and `setup.sh` (Y / n / skip).
- Add an OpenBrain status row to `pforge smith` diagnostics.
- Add a minimal `pforge brain status` + `pforge brain hint` CLI surface — no installer wrapper.
- Update README Quick Start to add a numbered "Step 3 — Enable Persistent Memory (recommended)" section.
- Update glossary, CUSTOMIZATION.md, and AGENT-SETUP.md wording.
- Bump CHANGELOG + version.

### Out of Scope

- Bundling, shipping, or installing OpenBrain itself. Plan Forge remains a separate codebase.
- Mutating the user's existing `.vscode/mcp.json` to inject an OpenBrain stanza. Only print instructions.
- Changing any code path that runs when OpenBrain is configured — all 106 hooked files already work; we are not refactoring them.
- New `pforge brain install` subcommand that wraps the OpenBrain installer. Deferred to a future phase.
- Changing the soft-fail behavior — every OpenBrain hook stays gated behind `if configured` and degrades silently.

### Forbidden Actions

- Do NOT write to `.vscode/mcp.json` from `setup.ps1` / `setup.sh`. Only print examples.
- Do NOT remove or weaken any existing `if (openbrainConfigured)` gate. The soft-fail path must stay intact.
- Do NOT make any change that would break a fresh `setup.ps1 -NonInteractive` CI run.
- Do NOT block `pforge smith` exit code on missing OpenBrain. Yellow warning row only; exit 0.
- Do NOT rename existing tool surfaces (`brain_recall`, `brain_remember`, `forge_memory_*`).
- Do NOT couple `pforge brain status` to a network call by default — first check local config, only ping on `--ping`.

### Files Touched (by slice)

| Slice | Files |
|-------|-------|
| 1 | `docs/manual/glossary.html`, `docs/manual/assets/glossary-terms.js` (regen), `CUSTOMIZATION.md` |
| 2 | `README.md` |
| 3 | `pforge-mcp/server.mjs` (forge_smith handler only — add OpenBrain status row), `pforge-mcp/tests/smith.test.mjs` (add row assertion) |
| 4 | `setup.ps1`, `setup.sh` |
| 5 | `pforge.ps1`, `pforge.sh`, `pforge-mcp/cli-schema.json`, `pforge-mcp/tests/cli.test.mjs` |
| 6 | `CHANGELOG.md`, `VERSION` |

---

## Required Decisions

| ID | Decision | Default |
|----|----------|---------|
| D1 | Setup prompt is opt-out or opt-in? | **Opt-out**: prompt appears by default in interactive runs; `-NonInteractive` / `--non-interactive` / CI / no-TTY auto-skips. |
| D2 | Setup prompt default answer? | **Y** (recommended) — but Enter on a prompt that defaults to Y is still consent, and `skip` is one keystroke. |
| D3 | Does `pforge brain status` ping the endpoint by default? | **No.** Local config check only. `pforge brain status --ping` opt-in. |
| D4 | Does smith fail when OpenBrain is missing? | **No.** Yellow warning row, exit 0. |
| D5 | Where in README does the new section go? | Right after the existing "### 2. Start Planning", before "See [docs/CLI-GUIDE.md]". |

---

## Acceptance Criteria

### Reframing
- The glossary `OpenBrain` entry leads with "L3 memory layer" not "Optional companion".
- README's existing row-5 "OpenBrain memory" entry in the Optional Capabilities table is updated to point at the new Quick Start section instead of being the only mention.
- `CUSTOMIZATION.md` section heading `## Persistent Memory with OpenBrain (Optional)` becomes `## Persistent Memory with OpenBrain (Recommended)` — keep all existing "if configured" gating language inside.

### README Quick Start
- A new `### 3. (Recommended) Enable Persistent Memory` section appears between current Step 2 and the "See docs/CLI-GUIDE.md" pointer.
- The new section lists the 4 deploy options as one-liners with links to `srnichols.github.io/OpenBrain` and the easy-button prompt URL.
- The section explicitly says "Plan Forge works without it — but L3 semantic memory across sessions requires OpenBrain."

### Smith diagnostic
- `pforge smith` output contains an `OpenBrain` row.
- When unconfigured: row reads `OpenBrain ............ ⚠ not configured (L3 memory disabled)` with a link hint.
- When configured: row reads `OpenBrain ............ ✓ configured (host=<host>)`.
- Exit code stays `0` regardless.
- A new vitest case asserts both branches.

### Setup wizard
- Interactive `setup.ps1` and `setup.sh` runs end with an OpenBrain prompt: `Enable L3 persistent memory via OpenBrain? [Y/n/skip]`.
- `Y` → prints the 4 deploy options + the easy-button prompt + `srnichols.github.io/OpenBrain` link, then continues.
- `n` → prints one warning line: `⚠ L3 memory not configured. AI sessions will not retain context across sessions. Enable later with: pforge brain hint`.
- `skip` → silent.
- `-NonInteractive` (PowerShell) / `--non-interactive` / no-TTY / `CI=true` env → silent skip, no prompt rendered.
- No mutation of `.vscode/mcp.json` in any branch.

### CLI surface
- `pforge brain status` reads local config (`.vscode/mcp.json` + `.forge.json`) and prints whether OpenBrain is configured. Exits `0` either way. With `--ping`, also hits the endpoint.
- `pforge brain hint` prints the 4 deploy options + easy-button prompt + link, identical content to the setup wizard's `Y` branch (single source of truth in a shared helper).
- Both subcommands appear in `cli-schema.json`.
- A vitest case covers each.

### Versioning
- `VERSION` bumps minor (per memory note: feature releases bump minor).
- `CHANGELOG.md` gets a `## [X.Y.0] — 2026-MM-DD — OpenBrain Promotion` section linking the four user-facing changes.

---

## Execution Slices

### Slice 1: Doc-only reframing — glossary + CUSTOMIZATION [sequential]

**Goal**: Reword three doc surfaces to position OpenBrain as the L3 layer, not an optional extension. Pure prose. Reversible by `git revert`.

**Files**:
- `docs/manual/glossary.html` — modify the `OpenBrain` entry text only
- `docs/manual/assets/glossary-terms.js` — regenerated by `node docs/manual/maintain.mjs`
- `CUSTOMIZATION.md` — rename section heading + tighten the framing sentence

**Depends On**: nothing.

**Validation Gate**:
```bash
node docs/manual/maintain.mjs --audit && grep -q 'L3 memory layer' docs/manual/glossary.html && grep -q 'OpenBrain (Recommended)' CUSTOMIZATION.md && echo ok
```

---

### Slice 2: README Quick Start gains numbered Step 3 [sequential]

**Goal**: Move OpenBrain out of the row-5 "Optional Capabilities" table-row obscurity and into the main install flow as a numbered, prominent, explicitly-skippable step.

**Files**:
- `README.md` — insert new `### 3. (Recommended) Enable Persistent Memory` block; update the existing row-5 entry in the Optional Capabilities table to point back at the new section.

**Depends On**: Slice 1.

**Validation Gate**:
```bash
grep -q '### 3. (Recommended) Enable Persistent Memory' README.md && grep -q 'srnichols.github.io/OpenBrain' README.md && echo ok
```

---

### Slice 3: `pforge smith` OpenBrain status row [sequential]

**Goal**: Make missing L3 visible at diagnostic time. Yellow warning row, exit 0, never blocks.

**Files**:
- `pforge-mcp/server.mjs` — extend the `forge_smith` handler's output assembly to add an `OpenBrain` row computed from `.vscode/mcp.json` + `.forge.json` inspection
- `pforge-mcp/tests/smith.test.mjs` — add two vitest cases: configured-branch + unconfigured-branch row text

**Depends On**: Slice 1 (so the "L3 memory" phrasing is already canonical in glossary).

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/smith.test.mjs --reporter=dot > /dev/null 2>&1 && echo ok
```

---

### Slice 4: Setup wizard prompt + shared hint helper [sequential]

**Goal**: Surface OpenBrain at the moment of install. Y / n / skip with sane defaults; non-interactive runs unchanged.

**Files**:
- `setup.ps1` — add a function `Prompt-OpenBrain` invoked at the end of interactive runs only; gated on `$Host.UI.RawUI` TTY-detection + `-NonInteractive` flag + `$env:CI`
- `setup.sh` — equivalent bash function `prompt_openbrain`; gated on `[ -t 0 ]` + `--non-interactive` flag + `$CI`
- Both scripts gain a shared content block (literal duplicated text, no Bash-from-PS sourcing) for the Y-branch "deploy options" output. Keep them identical line-for-line.

**Depends On**: Slice 2 (the "deploy options" text lifted from the new README section is the single source of truth — copy verbatim).

**Validation Gate**:
```bash
grep -q 'Prompt-OpenBrain' setup.ps1 && grep -q 'prompt_openbrain' setup.sh && grep -q 'NonInteractive' setup.ps1 && grep -q 'non-interactive' setup.sh && echo ok
```

---

### Slice 5: `pforge brain status` + `pforge brain hint` CLI [sequential]

**Goal**: Give users a way to re-prompt the recommendation post-install without re-running setup, and a fast diagnostic that doesn't require firing up the MCP server.

**Files**:
- `pforge.ps1` — add `brain` dispatch with `status` and `hint` subcommands
- `pforge.sh` — equivalent
- `pforge-mcp/cli-schema.json` — declare the new commands
- `pforge-mcp/tests/cli.test.mjs` — a vitest covering schema lookup for `brain status` and `brain hint`

**Depends On**: Slices 3 + 4 (so the status logic and the hint text already exist; this slice extracts them into reusable shape).

**Validation Gate**:
```bash
cd pforge-mcp && npx vitest run tests/cli.test.mjs --reporter=dot > /dev/null 2>&1 && pwsh -NoProfile -c "& ./pforge.ps1 brain hint" | grep -q 'srnichols.github.io/OpenBrain' && echo ok
```

---

### Slice 6: CHANGELOG + VERSION bump [sequential]

**Goal**: Record the change at the canonical place.

**Files**:
- `VERSION` — bump minor
- `CHANGELOG.md` — prepend a release section linking the four user-facing changes

**Depends On**: Slices 1–5.

**Validation Gate**:
```bash
head -n 30 CHANGELOG.md | grep -q 'OpenBrain Promotion' && grep -q '^[0-9]*\.[0-9]*\.[0-9]*' VERSION && echo ok
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Setup wizard prompt slows down CI / scripted installs | TTY + `CI` + `-NonInteractive` gates auto-skip. Acceptance criteria explicitly cover this. |
| Loud framing makes users think Plan Forge requires OpenBrain | Every surface uses the exact phrase "recommended" / "Plan Forge works without it" / "easy to skip". Glossary explicitly enumerates what's still functional without L3. |
| Smith row noise for users who deliberately don't want L3 | Yellow not red, exit 0, single line. `pforge.json#suppressOpenBrainWarning: true` opt-out (added in Slice 3 if user demand surfaces later — not in scope now). |
| Setup script Y/n prompt translation drift between `setup.ps1` and `setup.sh` | Slice 4 acceptance criterion: text must be literal-identical line-for-line. Reviewed in Step 5 gate. |
| `pforge brain hint` text drifts from README section | Slice 5 lifts the text from README at edit time; reviewer-gate sweep grep-asserts both files contain `srnichols.github.io/OpenBrain`. |
| OpenBrain endpoint name guesses are wrong (we link to `srnichols.github.io/OpenBrain` but the user might fork) | Hint text always references the canonical project page. Custom forks are out of scope — users on forks know to substitute. |

---

## Definition of Done

- All six slices' validation gates pass.
- A fresh `git clone && setup.ps1 -Preset typescript -NonInteractive` produces zero OpenBrain output (CI path unchanged).
- A fresh `git clone && setup.ps1 -Preset typescript` (interactive) shows the prompt at the end.
- `pforge smith` on a fresh repo with no OpenBrain shows the yellow row and exits 0.
- `pforge brain status` on the same repo prints `not configured` and exits 0.
- `pforge brain hint` prints the same deploy-options block as the README and setup wizard.
- The glossary entry, the README Quick Start, the CUSTOMIZATION.md section, the smith row, the setup prompt, and the `brain hint` output all use consistent wording for the "still optional but recommended" framing.
- `CHANGELOG.md` records the release; `VERSION` is bumped.

---

## Post-Mortem

_To be filled in after Definition of Done passes. Capture: how long did each slice actually take, any drift from the spec, any hooks we discovered weren't actually opt-in, and any user signal on the prompt (skip rate vs. Y rate)._
