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

## 3. Idea triage

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

## 4. Sequencing thoughts

If we do any of these, the dependency order is:

```
Idea 1 (proposed-changes manifest)
   ├─► Idea 2 (threat classifier)   [needs manifest as input]
   ├─► Idea 4 (network allowlist)   [feeds hosts into manifest]
   └─► Idea 5 (lock file)           [manifest schema informs lock schema]

Idea 3 (Plan Health Auditor)    [independent — can start any time]

Idea 6 (objective tempering)    [independent — punt until needed]
```

**Smallest meaningful first step**: Idea 3 (Plan Health Auditor) — it's
read-only, it productizes work you're already doing manually in
`/memories/repo/`, and it gives you immediate signal on what's actually
breaking before you invest in the bigger gate refactor.

**Highest-leverage first step**: Idea 1 (proposed-changes manifest) — unlocks
2 and 4, formalizes the Scope Contract from a request into a boundary, gives
review-gate a clean artifact to inspect.

---

## 5. Things I'm uncertain about

- [ ] How does Idea 1's apply-gate interact with `--assisted` mode? Does the
      gate run before or after the user review? (Probably **before** — user
      reviews a pre-gated proposal, not a raw diff.)
- [ ] Does the manifest format need to be stable enough for external tooling,
      or is it purely internal? (Internal at first; stabilize only if Idea 3
      or external integrations need it.)
- [ ] Network allowlist on Windows — how do we proxy without breaking
      enterprise corporate proxies users already have? (Chain proxies.
      Need to test.)
- [ ] Where does the Plan Health Auditor's output live? New top-level
      `.forge/health/` dir? Or absorbed into the dashboard?

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

- 2026-05-18: Initial scratchpad created. No decisions yet. Next pass: pick
  one idea and pressure-test it against existing Plan-Forge architecture
  before committing to anything.
