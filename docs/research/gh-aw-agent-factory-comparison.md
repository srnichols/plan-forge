# gh-aw / Peli's Agent Factory — comparison & idea scratchpad

> **Status**: SCRATCHPAD — not a plan, not a commitment. Working notes for evaluating
> ideas from GitHub Next's [Peli's Agent Factory](https://github.github.com/gh-aw/blog/2026-01-12-welcome-to-pelis-agent-factory/) /
> [GitHub Agentic Workflows (`gh-aw`)](https://github.github.com/gh-aw/) against Plan-Forge.
> **Owner**: srnichols
> **Started**: 2026-05-18
> **Decision bar**: improves Plan-Forge OR closes a real gap. Bloat = reject.

---

## 1. What `gh-aw` actually is (one-paragraph version)

A `gh` CLI extension by GitHub Next + Microsoft Research that lets you author
repo-automation agents in **Markdown + YAML frontmatter**, then **compiles** them
into hardened `.lock.yml` GitHub Actions workflows. Agents run in sandboxed
containers on Actions infra, with a 5-layer security model (read-only token,
zero secrets in agent, network firewall, safe-outputs gate, AI threat detection).
"Peli's Agent Factory" is the showcase repo where ~100 of these workflows run
against `github/gh-aw` itself.

**Primary surface**: GitHub-side, event-triggered, unattended, hostile-input-aware.
**Plan-Forge surface**: Developer-side, plan-driven, attended, hardened-input.

They are **orthogonal**, not competitive. Could coexist in the same repo.

---

## 2. Side-by-side

| Dimension | Plan-Forge | `gh-aw` / Agent Factory |
|---|---|---|
| Where it runs | Local dev loop (CLI + MCP + VS Code) | GitHub Actions runners |
| Trigger | Developer runs `pforge run-plan` | issues / PR / schedule / slash command |
| Authoring unit | Plan markdown + per-slice gates + step prompts | Workflow markdown + YAML frontmatter |
| Compile step | None — plan is the artifact | `gh aw compile` → `.lock.yml` |
| Trust boundary | Developer + hardened plan; gates are guardrails | Untrusted issue/PR text → sandbox → gated apply |
| Agents at once | 1 worker per slice, quorum for review | Dozens of small specialized workflows |
| State | Plan file + `.forge/` + memory + OpenBrain | Per-run ephemeral + opt-in `repo-memory` |
| Cost controls | `forge_estimate_quorum`, `forge_cost_report` | `timeout-minutes`, narrow toolsets |
| Write boundary | Worker has full git access | Agent emits JSON intent; gated job applies |
| Network controls | None at runtime (firewall is launcher OS only) | Squid proxy + explicit domain allowlist |
| Threat detection | `forge_secret_scan`, drift, Forbidden Actions hook | AI scan of proposed diff before apply |
| Plan/decomp idea | `step2-harden-plan.prompt.md` | `/plan` slash command — 67% PR merge rate |

---

## 3. Action list (AGREED 2026-05-18)

> **Status**: agreed scope. Sequencing in §4. Original brainstorm preserved
> below in §3-archive for context.
>
> **Guiding rule**: enhance existing artifacts, don't invent new ones.
> Backwards-compatible by default (every new field is opt-in).

### Accepted actions

| ID | Action | Extends | Net new artifacts |
|----|--------|---------|------------------|
| **A1** | Make PreToolUse Forbidden-Actions check a **hard** block (not advisory) | `.github/hooks/` PreToolUse | none |
| **A2** | New tool `forge_diff_classify` — scores staged diff before commit | `forge_secret_scan` plumbing | 1 tool file |
| **A3** | Add `PreCommit` hook chain that runs every slice (secret-scan + A2 + Forbidden Actions) | PreDeploy hook machinery | 1 hook config entry |
| **A4** | New agent file `plan-health-auditor.agent.md` (meta-agent over run history) | `.github/agents/`, `forge_master_ask`, `/memories/repo/` | 1 agent file, `.forge/health/latest.md` |
| **A5** | `network.allowed: [...]` in plan frontmatter — **log-only mode first** | Plan parser, worker spawn | 1 frontmatter field, ~50 LOC in-process proxy |
| **A6** | `lockHash:` in plan frontmatter — block run if plan drifted post-harden | `step2-harden-plan.prompt.md`, plan parser | 1 frontmatter field |
| **A7** | `--objective <cmd>` mode on existing `forge_tempering_run` (Autoloop pattern) | `forge_tempering_run` | none (flag on existing tool) |
| **A8** | `tools.deny: [...]` in plan frontmatter — cost cap + tool hygiene (denylist, not allowlist) | Plan parser, MCP bridge | 1 frontmatter field |

### Why this is the right cut

- **A1+A3** = the gh-aw "safe-outputs" idea, without inventing a manifest
  format. The git index already *is* the manifest.
- **A2** = the gh-aw "threat detection" job, as one new MCP tool that reuses
  secret-scan plumbing.
- **A4** = the gh-aw "meta-agent" pattern, as one agent file that productizes
  what we already do by hand in `/memories/repo/`.
- **A5** = the gh-aw "network firewall" idea, log-only first so we collect
  real data before deciding what to enforce.
- **A6** = our own "we got hurt by brittle gates" lesson, captured as a
  frontmatter hash instead of a separate `.lock.json` artifact.
- **A7** = the Autoloop pattern, as a flag on an existing tool.
- **A8** = the gh-aw `tools:` block idea, narrowed to a **denylist** so it
  defaults to today's behavior and never breaks existing plans.

### Deliberately rejected

| Rejected | Reason |
|----------|--------|
| Separate `proposed.json` manifest format | Git index + diff already serve this role. A1+A3 deliver the gate without the schema. |
| `pforge compile` CLI verb + `.lock.json` file | A6 gives the same drift protection with zero new artifacts. |
| `bash:` command allowlist per plan | A2 + A3 catch the resulting damage. Fighting cross-shell command names isn't worth it. |
| `permissions:` block as separate concept | A1 + A3 already cover write enforcement on paths. |
| `safe-outputs:` block (gh-aw's GitHub-write gate) | We don't write to GitHub from the worker. Filesystem writes are gated by A1+A3. |
| Allowlist (vs denylist) for `tools:` | Allowlist breaks every existing plan when we add a new tool. Denylist is opt-in. |
| Dozens of single-purpose triage/style/poetry bots | Outside scope. Skills + agents already cover this. |
| GitHub-web-UI plan authoring | Our value is the local dev loop. |

---

## 3-archive. Original brainstorm (kept for context)

### 3A. 🟢 Strong candidates — high leverage, contained surface

#### Idea 1: Proposed-changes manifest + apply-gate for `pforge run-plan`
**Source pattern**: gh-aw "safe-outputs" — agent produces a JSON artifact describing
intended writes; a separate gated job validates and applies.

**Plan-Forge mapping**:
- Worker completes a slice in a "proposing" state, not a "committing" state.
- Worker emits `.forge/slices/<slice-id>/proposed.json` with:
  - Files added/modified/deleted (paths + content hash)
  - Commands run (exit codes, stdout/stderr summaries)
  - Network hosts contacted (if we add net policy — see Idea 4)
  - Forbidden-action checks (pass/fail per item in plan's Forbidden Actions)
- A small **applier** step (already morally exists in orchestrator.mjs commit
  logic) validates against:
  - Plan's Scope Contract (file allowlist)
  - Forbidden Actions (already enforced by PreToolUse hook — make it hard)
  - Secret-scan severity threshold
  - Diff size / risk classifier (see Idea 2)
- Only on pass: snapshot apply + commit.

**Why not bloat**: it formalizes what the PreToolUse hook + secret-scan + drift
report already do, but turns them into a **hard gate** the worker can't bypass.
It also produces a stable artifact that `forge_tempering_*` and the
review-gate agent can consume.

**Open questions / decisions needed**:
- [ ] Does this replace the snapshot-apply-then-drop flow or sit before it?
      (Probably **before** — manifest gate runs, then snapshot apply, then drop.
      Snapshot still needed for rollback on later-slice failure.)
- [ ] Do we keep `proposed.json` after commit or drop it? (Keep for audit trail
      under `.forge/runs/<run-id>/slices/<n>/`.)
- [ ] What's the manifest format? Reuse the `forge_diff` output shape?
- [ ] How does this interact with `--assisted` mode where the user reviews?
      (Manifest becomes the review surface — cleaner than current diff dump.)
- [ ] Performance cost of hashing every file in the diff? (Bound by slice's
      file allowlist size, so should be fine.)

**Effort estimate**: medium. New file format, new orchestrator step, but most
inputs already exist as tool outputs.

---

#### Idea 2: AI threat-detection on the proposed diff
**Source pattern**: gh-aw runs an AI classifier over the agent's output before
the write job runs. Blocks on prompt-injection, leaked creds, malicious patterns.

**Plan-Forge mapping**:
- Extend `forge_secret_scan` (already exists) with a sibling
  `forge_diff_classify` that takes the proposed manifest and returns:
  - `severity: low | medium | high | critical`
  - `findings: [{ category, file, line, snippet, reason }]`
  - Categories: leaked-secret, prompt-injection-echo, eval/exec-introduced,
    unexpected-network-call, license-incompatible-paste, large-binary-dump.
- Wire into the apply-gate (Idea 1). Block on `>= high`, warn on `medium`.

**Why not bloat**: it's one new tool that reuses the manifest from Idea 1 and
the secret-scan plumbing. No new user-facing concept.

**Open questions**:
- [ ] Which model classifies? (Probably the cheap-tier model — this runs every
      slice. Use `forge_estimate_slice`-style projection to keep costs visible.)
- [ ] False-positive handling — escape hatch like Forbidden Actions has?
- [ ] Does this run inside the worker session or in a separate process?
      (**Separate** — same isolation principle as gh-aw's threat job.)

**Effort estimate**: medium. Mostly a classifier prompt + scoring rubric +
wiring. Depends on Idea 1 landing first.

---

#### Idea 3: "Plan Health Auditor" meta-agent
**Source pattern**: gh-aw says meta-agents (agents that watch other agents)
are one of their **top three lessons** from running ~100 workflows.

**Plan-Forge mapping**:
- A scheduled (cron/manual) `forge_master_ask`-style agent that reads:
  - `.forge/orchestrator-logs/*.log`
  - `.forge/runs/*/manifest.json`
  - Self-repair issues filed via `forge_meta_bug_file`
  - `/memories/repo/*.md` (already a manual version of this!)
- Produces a weekly **Plan Health Report**:
  - Top failure modes by class (plan-defect / orchestrator-defect / prompt-defect)
  - Recurring gate-portability problems (we already have a memory file on this)
  - Slice retry rate trends
  - Proposed instruction-file or template patches
- Optional: opens a PR with a draft patch for review (like `gh-aw`'s
  continuous-simplicity workflows — 67% merge rate suggests this works).

**Why not bloat**: it productizes the manual triage you currently do when
writing `/memories/repo/v3.x.x-*-fix.md` entries. Reads-only by default.

**Open questions**:
- [ ] Is this a new tool, a new agent file in `.github/agents/`, or both?
      (Agent file + tool that gathers the data.)
- [ ] How does it interact with OpenBrain? (Read OB for cross-session patterns,
      write findings back as a `brain_recall`-able note.)
- [ ] Trigger model — schedule, manual, or post-N-runs? (Manual at first;
      schedule later when we trust output.)

**Effort estimate**: small-medium. Data-gathering tool + agent prompt + report
template. Most data already exists; this is plumbing + presentation.

---

#### Idea 4: Worker-side network allowlist (egress policy)
**Source pattern**: gh-aw containers route outbound traffic through Squid with
an explicit domain allowlist. Anything else dropped at kernel level.

**Plan-Forge mapping**:
- Add `network.allowed: [...]` to plan frontmatter (default: model providers +
  github.com + dashboard localhost).
- Launcher sets `HTTPS_PROXY` / `HTTP_PROXY` env vars pointing to a tiny local
  proxy (could be a Node script — we don't need full Squid).
- Proxy logs every connection, denies unlisted hosts.
- Logged hosts feed the proposed-changes manifest (Idea 1).

**Why not bloat**: it's a launcher-side concern (env vars + small proxy
process), not new tools or new user concepts. Plan declares network needs,
launcher enforces.

**Open questions**:
- [ ] How do we handle worker subprocesses that bypass proxy env vars
      (Python `requests`, raw sockets)? (Same limitation gh-aw has — best-effort
      defense-in-depth, not a security boundary on its own.)
- [ ] Default allowlist — strict or permissive on day one? (Permissive +
      log-only mode first; flip to enforce after we see real traffic.)
- [ ] Does this break package installs (npm/pip)? (Yes — registry domains
      must be in default allowlist or declared per-plan.)

**Effort estimate**: medium. Small proxy is easy, but distribution & cross-OS
behavior is fiddly. Defer until Ideas 1+2 land.

---

### 3B. 🟡 Worth considering — bigger commitment

#### Idea 5: `pforge compile <plan.md>` → `<plan>.lock.json`
**Source pattern**: gh-aw separates editable markdown from compiled lock file
that Actions actually runs. CI can validate the lock file.

**Plan-Forge mapping**:
- Normalize plan to a JSON form: resolved slices, hashed scope contracts,
  parsed gates, declared network/permissions.
- `pforge compile --validate` checks gates are portable, scope contracts are
  non-empty, etc.
- CI step: `pforge compile --check` fails if lock file is stale.

**Pros**:
- Catches brittle-grep-gate class of bugs **before** execution (we have a
  whole memory file on this).
- Makes review-gate's job partially mechanical.
- Plan-format migrations become detectable via lock-file diff.

**Cons / bloat risk**:
- New artifact in repo → versioning question (commit it? gitignore?)
- New CLI verb to teach + document
- Step2 hardener already does most of this implicitly
- We end up maintaining a schema we'll keep evolving

**Decision needed**: commit only if we're serious about CI-side plan validation.
Otherwise the step2 hardener + plan-parser sanity check covers 80%.

---

#### Idea 6: Objective-driven tempering (Autoloop pattern)
**Source pattern**: [Autoloop](https://githubnext.com/projects/autoloop) — give
agent a metric command, agent proposes changes, keep only if metric improves.

**Plan-Forge mapping**:
- `forge_tempering_run --objective "node scripts/measure-coverage.mjs"
  --accept-if greater`
- Worker proposes diffs; accept-gate runs objective command before/after; keep
  if metric improved.

**Pros**: Powerful for perf, coverage, bundle-size work without writing plans.

**Cons**: Open-ended tempering can wander; needs strong budget controls.
Possibly out of scope for what tempering is meant to be.

**Decision needed**: punt unless a real user need surfaces.

---

### 3C. 🔴 Skip — would dilute Plan-Forge

- **Dozens of single-purpose triage/style/poetry bots** — outside scope; skills
  + agents already cover this if users want it.
- **GitHub-web-UI plan authoring** — our value is the local dev loop.
- **Adopting gh-aw's markdown+YAML schema directly** — migration cost with no
  payoff. Steal the *idea* of declared `permissions/network/tools` blocks
  (feeds Ideas 1+4); don't adopt their format.

---

## 4. Sequencing

### Dependency graph (agreed actions)

```
A1 (hard PreToolUse)          ── 1-line hook promotion, no deps
   │
A3 (PreCommit hook chain)     ── reuses PreDeploy machinery
   │
A2 (forge_diff_classify)      ── plugs into A3's chain

A5 (network log-only)         ── independent, gathers data for later enforcement
A8 (tools.deny frontmatter)   ── independent, opt-in
A6 (lockHash frontmatter)     ── independent, opt-in
A4 (Plan Health Auditor)      ── independent, read-only
A7 (--objective tempering)    ── independent, flag on existing tool
```

### Smallest meaningful first step
**A1** — one-line promotion of an existing advisory check to a hard block.
Highest ROI per LOC.

### Highest-leverage first step
**A1 + A3 + A2** as a unit — gives us the gh-aw "safe-outputs + threat
detection" pattern using only the git index and one new MCP tool. After this
lands, A5/A8/A6/A4/A7 are independent and can land in any order.

### Historical sequencing (original brainstorm — superseded)

```
Idea 1 (proposed-changes manifest) — REJECTED in favor of A1+A3
   ├─► Idea 2 (threat classifier)   — now A2
   ├─► Idea 4 (network allowlist)   — now A5
   └─► Idea 5 (lock file)           — REJECTED in favor of A6
Idea 3 (Plan Health Auditor)        — now A4
Idea 6 (objective tempering)        — now A7
```

---

## 5. Things still uncertain (carried forward)

- [ ] **A1 / A3 + `--assisted` mode**: gate runs **before** user review (user
      reviews a pre-gated diff, not a raw one). Confirm in implementation plan.
- [ ] **A5 on Windows**: how do we proxy without breaking enterprise corporate
      proxies users already have? (Chain proxies. Need to test before flipping
      from log-only to enforce.)
- [ ] **A4 output location**: `.forge/health/latest.md`? Absorb into dashboard?
      Both? Start with the markdown file; dashboard later if there's signal.
- [ ] **A2 model tier**: cheap-tier (runs every slice — cost matters) or
      structured-output-with-rubric on the default model? Project cost both
      ways before committing.
- [ ] **A6 hash scope**: what fields of the plan are inside the hash? Slices +
      gates + scope contracts + forbidden actions for sure. Title? Frontmatter
      other fields? Decide when we draft the plan.
- [ ] **A8 default denylist**: start empty (purely opt-in) or ship a starter
      list (e.g. deny `forge_lattice_blast` by default)? Probably empty —
      surprises break trust.

---

## 6. Open links / further reading

- [Welcome post](https://github.github.com/gh-aw/blog/2026-01-12-welcome-to-pelis-agent-factory/)
- [`gh-aw` reference](https://raw.githubusercontent.com/github/gh-aw/main/.github/aw/github-agentic-workflows.md)
- [Multi-phase improvers](https://github.github.com/gh-aw/blog/2026-01-13-meet-the-workflows-multi-phase/) — closest analog to Plan-Forge slice execution
- [Project coordination workflows](https://github.github.com/gh-aw/blog/2026-01-13-meet-the-workflows-campaigns/) — `/plan` command, 67% merge rate
- [Autoloop](https://githubnext.com/projects/autoloop) — objective-driven loop (Idea 6)
- [Architecture / safe-outputs](https://github.github.com/gh-aw/introduction/architecture/)

---

## 7. Notes / running log

- 2026-05-18: Initial scratchpad created. Brainstormed 6 ideas (Ideas 1-6).
- 2026-05-18: Re-framed under "enhance, don't create" rule. Original Idea 1
  rejected in favor of A1+A3 (use git index as the manifest). Original Idea 5
  rejected in favor of A6 (hash into existing frontmatter).
- 2026-05-18: Added A8 (`tools.deny` frontmatter) after revisiting the
  gh-aw `permissions/network/tools` block. Chose denylist over allowlist
  for backwards compatibility.
- 2026-05-18: **Action list A1–A8 agreed.** Next pass: draft a plan for the
  A1 + A3 + A2 unit (highest-leverage first step). A4–A8 land independently.
- 2026-05-18: **Phase-WORKER-GUARDRAILS-PLAN shipped.** All 11 slices (S0–S10)
  complete. A1–A8 all landed. See `docs/plans/Phase-WORKER-GUARDRAILS-PLAN.md`
  §"What actually shipped" for the full retro, commit SHAs, and gotchas.
