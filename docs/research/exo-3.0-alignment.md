# ExO 3.0 Alignment — improvements & idea scratchpad

> **Status**: SCRATCHPAD — not a plan, not a commitment. Working notes for evaluating
> ideas from **ExO 3.0** (Destination Architecture, Intelligence Stack, OODA) against
> Plan-Forge as it actually exists today.
> **Owner**: srnichols
> **Started**: 2026-06-10
> **Decision bar**: improves Plan-Forge OR closes a real gap. Bloat = reject.
> **Constitution check**: every idea is measured against `docs/plans/PROJECT-PRINCIPLES.md`
> (lean deps, no-build, self-hosting, CLI parity). Items that fight the constitution are
> flagged explicitly — they are go/no-go decisions, not defaults.

---

## 0. The framing correction (read this first)

The original ExO 3.0 write-up treated **Crucible** as the safety / adversarial-testing
surface. It is not. Grounding every recommendation against the codebase produced one big
correction and a recurring theme:

- **Crucible = idea refinement + plan-ID versioning** ("smelting" interview that hardens a
  plan before execution). Zero runtime safety role. No `forge_crucible_*` MCP tools.
- The safety surface is actually **three different subsystems**:
  - **Tempering** — post-build QA + bug classification (`forge_tempering_*`, 5 tools) with a
    convergence "drain" loop.
  - **LiveGuard** — post-deploy runtime defense (`forge_liveguard_run` + 13 tools: drift,
    secret-scan, regression-guard, incident-capture, health-trend).
  - **Testbed** — E2E scenario runner (`forge_testbed_*`) that **already** has chaos + XSS
    scenarios.

**Recurring theme**: most recommendations are **"harden & expose existing capability"**, not
greenfield builds. That inverts the original effort/priority ratings. The cheap, high-leverage
wins are the ones that surface what's already captured.

---

## 1. What ExO 3.0 contributes (one-paragraph version)

ExO 3.0's lens — Destination Architecture, a six-layer **Intelligence Stack**
(Observe → Orient → Decide → Act → Learn → Govern), Purpose-as-Protocol, and Boyd's **OODA**
tempo — maps cleanly onto Plan-Forge's specify → harden → execute → review → ship loop. The
value is not new primitives; it's a **vocabulary and a measurement discipline** for things
Plan-Forge already does implicitly. The risk is importing two ExO-native ideas (edge-first
runtime, agent marketplace) that collide with Plan-Forge's lean / self-hosted constitution.

---

## 2. Reality check — per recommendation

Legend: **Build** = genuinely net-new · **Expose** = capability exists, surface/wire it ·
**Refactor** = exists but tangled · **Defer/Cut** = fights the constitution or no real use case yet.

| # | Original rec | Ground truth | Verdict | Real effort |
|---|---|---|---|---|
| 1 | Six-layer Intelligence Stack API | Six functions exist but collapsed into `orchestrator.mjs` (~14k LOC) + tool handlers. No layer contracts. | **Refactor** (flagship) | High |
| 2 | Machine-readable MTP + enforcement | ~80% built: `PROJECT-PRINCIPLES.md` (8 principles, 16 forbidden patterns), `forbidden-matcher.mjs`, PreToolUse hook that blocks edits, `forge_org_rules`. Missing: machine-readable schema + **staged warn→soft→hard**. | **Expose + small Build** | Low–Med |
| 3 | Quorum provenance + model-health | Votes already carry confidence (0–100), token lineage in `events.jsonl`, `success_rate` per model in `model-performance.json`. Confidence-weighted synthesis exists. Missing: surfacing + **health/recency weighting**. | **Expose** | Med |
| 4 | "Crucible" safety harness | Misnamed. Testbed already has chaos + XSS scenarios. Missing: prompt-injection / data-poisoning / jailbreak scenarios + proactive token-budget kill. | **Build (small, on Testbed + LiveGuard)** | Med |
| 5 | OODA tempo dashboards | Per-tool `durationMs`, event timeline, health-trend all exist. Missing: end-to-end slice **cycle time** + decide-vs-act split. | **Expose** (smallest lift) | Low |
| 6 | Edge twin + CRDT | L2 offline-capable; L3 (OpenBrain) needs network; sync is unidirectional last-write-wins; **no CRDT anywhere**. | **Defer/Cut** — fights lean-deps + no-build; no current use case | High |
| 7 | Memory lifecycle / consent | TTL exists (`stampThoughtExpiry`) but **advisory only — nothing deletes**. Provenance via Hallmark exists. Redaction is a human guideline, not enforced. | **Build (enforce + redactor)** | Low–Med |
| 8 | Agent marketplace + trust layer | Delegation exists (`forge_delegate_to_agent`). **No registry, no trust scores, no OS sandbox** (scope contracts are policy-only). | **Defer / lower** — trust-scoring without real sandbox is theater | High |
| 9 | Escalation UX + explainability | Review queue with graded severity (`blocker`/`high`/`low`) + `--assisted` exist. Missing: "why did the agent choose X" / contrastive summaries. | **Build (cheap — quorum already has rationales)** | Low–Med |

---

## 3. Re-sequenced by *actual* effort

> Front-load "expose what exists." Treat the Intelligence-Stack extraction as the flagship
> refactor. Park edge/marketplace behind explicit go/no-go.

### Tier A — cheap, high-leverage (do first)
- **#5 OODA cycle-time metrics** — derive end-to-end slice cycle time + decide/act split from
  existing `events.jsonl`; add a dashboard tab. *Establishes the baseline* the original
  "20–40% reduction" target presupposes.
- **#2 Machine-readable principles + staged enforcement** — JSON schema for principles/MTP;
  wire `warn → soft block → hard block` into the existing PreToolUse hook + `forge_org_rules`.
  **This is the headline idea** (see §4).
- **#3 Quorum health surfacing** — expose per-leg confidence + `success_rate`; add
  recency/health weighting to synthesis.

### Tier B — focused builds
- **#7 Memory lifecycle enforcement** — make `stampThoughtExpiry` actually prune; add an
  automated redactor in the memory write path (not a human guideline).
- **#9 "Why" summaries** — generate contrastive rationale from per-leg quorum outputs (raw
  material already exists).
- **#4 AI-safety scenarios** — add prompt-injection / data-poisoning / jailbreak scenarios to
  **Testbed**; wire pass-thresholds into the existing **LiveGuard PreDeploy** hook.

### Tier C — flagship refactor
- **#1 Intelligence-Stack extraction** — carve the six OODA functions out of `orchestrator.mjs`
  into named layer modules with contracts. Aligns with the clean-code God-file guardrail.

### Tier D — go/no-go (constitution conflict)
- **#6 Edge runtime + CRDT** — large new surface vs. lean-deps / no-build; no current use case.
  *Recommend defer or cut.*
- **#8 Agent marketplace + trust** — biggest net-new; trust without sandboxing is theater.
  *Recommend defer; revisit only if a real third-party-agent use case appears.*

---

## 4. The one genuinely original idea — staged enforcement

Plan-Forge enforcement is **binary** today: the PreToolUse hook blocks an edit or it doesn't.
ExO's Purpose-as-Protocol pushes toward **graded enforcement**:

```
warn        → log the violation, continue (telemetry only)
soft block  → require explicit human override to continue
hard block  → halt execution unconditionally (today's only mode)
```

Nothing like this exists. It's low-effort (the hook + `forge_org_rules` already have the
matching machinery), high-value (lets principles ship in "warn" mode and ratchet up as
confidence grows), and it's the natural home for a machine-readable MTP schema. **Elevate this
from a footnote to the lead.**

---

## 5. Metric recalibration

The original 90-day targets assume greenfield baselines that don't exist:

| Original target | Problem | Corrected |
|---|---|---|
| 100% quorum provenance | Already near-true | Track *surfacing* coverage, not capture |
| OODA loop −20–40% | No baseline measured yet | Sprint 1 must **establish** cycle-time baseline first |
| 95% safety pass before auto-act | No AI-safety scenarios exist yet | Gate on # of scenarios authored, then pass-rate |
| 90% memory retention tags | Provenance exists; *enforcement* doesn't | Track % entries actually pruned/redacted |

---

## 6. Constitution conflicts (explicit)

Two ExO-native ideas pull against `PROJECT-PRINCIPLES.md`:

- **Edge runtime + CRDT (#6)** vs. **Principle 7 (lean deps)** + **no-TypeScript-build** +
  **self-hosting**. A CRDT runtime + signed-manifest edge daemon is a heavy new surface.
- **Agent marketplace (#8)** vs. **lean / self-hosted**. A registry + vetting + billing surface
  is a product in itself; trust-scoring without OS-level sandboxing gives false assurance.

These aren't "no" — they're "not by default." If pursued, each needs a Required Decision entry
and probably its own funded initiative, not a slice in the 90-day plan.

---

## 7. Open questions / to noodle

- Does staged enforcement belong in the PreToolUse hook, `forge_org_rules`, or both? What's the
  override audit trail?
- Where does the machine-readable MTP schema live — `.forge.json`, a new `.forge/mtp.json`, or
  frontmatter on `PROJECT-PRINCIPLES.md`?
- OODA cycle-time: is "decide" separable from "act" given gates run async inside the worker spawn?
- For #4, do AI-safety scenarios run in dry-run/quorum mode, and what's the pass threshold shape?
- Is there *any* real near-term edge/offline use case, or is #6 purely framework-driven?

---

## 8. Next deliverables (pick one to draft)

- **A. Layered diagram** — Plan-Forge components mapped to the six Intelligence-Stack layers.
- **B. Grounded 90-day plan** — re-sequenced by real effort (Tiers A→C), real file targets
  (`orchestrator.mjs`, `forbidden-matcher.mjs`, `testbed.mjs`), constitution items as go/no-go.
- **C. MTP JSON schema + staged-enforcement rules** — highest-leverage, lowest-risk start.
- **D. Quorum health-weighting spec** — surfacing + recency/health weighting, with API examples.

---

## 9. Concept-level mapping — ExO 3.0 pillars → Plan-Forge

> §2 graded the *9 proposals*. This maps the *full ExO 3.0 concept vocabulary* onto what
> Plan-Forge actually is, which surfaces gaps the proposal list missed. Strength is mapping
> quality, not effort.

| ExO 3.0 pillar | Plan-Forge analog | Strength | The real gap |
|---|---|---|---|
| **MTP / Purpose as Protocol** | `PROJECT-PRINCIPLES.md`, Project Profile, forbidden patterns, Crucible smelting | Strong on **constraints** ("thou shalt not"), absent on **aspiration** | No machine-readable **positive objective** — slices pass local gates but nothing scores contribution to a north-star |
| **Intelligence Stack (O-O-D-A-L-G)** | Observe=`hub.mjs`/telemetry; Orient=memory L1-L3 + `lattice` + `forge_search`; Decide=gates+quorum+complexity scoring; Act=orchestrator slice exec; Learn=`memory_capture`+`model-performance.json`+drain history; Govern=`forbidden-matcher`+LiveGuard | **All six present** — Plan-Forge *is* an Intelligence Stack, unlabeled | The **Learn→Orient seam** is broken: data is *written* but not *read back* to change future decisions (static thresholds). See §12. |
| **Destination Architecture** | `DEPLOYMENT-ROADMAP.md`, specify→harden working backward from intent | Partial | Roadmap is a human linear queue, not a **living target-state** the system reasons "where are we vs. destination" against |
| **OODA tempo** | per-tool `durationMs`, watcher, retry loops | Partial | Boyd's point is *relative* tempo; with no adversary the meaningful metric is **rework rate** (slices retried/re-planned), not raw loop time — and that data already exists |
| **Agentic Work** | multi-agent (claude/cursor/codex), delegation, quorum, subagents | Strong as **conductor** (1 orchestrator, many models) | No **swarm** — no peer agent negotiation/specialization. *Deliberate* (auditability), not just missing |
| **SHAPE / Safe Autonomy** | dry-run defaults, Forbidden hook, secret-scan, LiveGuard, review queue, `--assisted` | Strong pre-act + post-act | Autonomy is **configured, not earned** — no graduated autonomy that expands with demonstrated reliability (see §12 "earn-your-autonomy") |
| **Edge-first** | local-first dev loop (CLI + L2 offline) | **Already satisfied in spirit** — the developer *is* the edge | Only the *literal* CRDT-runtime reading (§2 #6) is missing, and that's the part to cut |
| **Human Architecture** | 4-session model, `--assisted`, review queue, agent personas | Strong on roles/handoff | No **incentive/feedback model** — human override signals (review rejections) stored but never fed back to improve proposals (same broken seam) |

**Headline**: every ExO 3.0 pillar has a real Plan-Forge analog. The framework's value is **vocabulary + measurement discipline**, not new primitives. The single structural weakness it exposes is the **Learn→Orient feedback seam** (§12).

---

## 10. Classic ExO lens — SCALE / IDEAS (fresh angle)

> ExO 3.0 still carries the original 10 attributes. Mapping them is a different cut than the
> pillars and exposes *where* Plan-Forge is a textbook ExO vs. where it deliberately isn't.

**SCALE (external / leverage):**

| Attribute | Plan-Forge | Verdict |
|---|---|---|
| **Staff on Demand** | quorum models + delegation to claude/cursor/codex/copilot | **Strong** — models *are* staff on demand |
| **Community & Crowd** | extensions catalog (`pforge ext`) | Thin |
| **Algorithms** | orchestrator + quorum + complexity scoring + cost engine | **Strong** — the core |
| **Leveraged Assets** | 100+ `forge_*` tools, OpenBrain shared memory, per-stack presets | **Strong** — owns no models, leverages all |
| **Engagement** | dashboard (read-only) | **Gap** — no engagement/reputation/feedback loop |

**IDEAS (internal):**

| Attribute | Plan-Forge | Verdict |
|---|---|---|
| **Interfaces** | MCP, CLI, dashboard, `forge_master_ask` (ACI discipline *is* interface design) | **Strong** |
| **Dashboards** | localhost:3100 — cost/health/timeline/traces | **Strong** |
| **Experimentation** | quorum dry-runs *are* parallel approach A/B tests; testbed; tempering drain | **Strong** |
| **Autonomy** | `run-plan` autonomous mode | Strong but **un-graduated** (SHAPE gap) |
| **Social technologies** | memory sync, OpenBrain L3, `forge_team_activity`/`team_dashboard` | Partial |

**What this lens reveals**: Plan-Forge is a textbook ExO on the **technical/algorithmic** attributes (Algorithms, Leveraged Assets, Interfaces, Dashboards, Experimentation, Staff-on-Demand) and deliberately thin on the **human/network-effect** attributes (Engagement, Community & Crowd, Social technologies). That under-investment is **coherent and defensible** — Plan-Forge is a dev tool, not a community platform — but it should be a **named choice**, not an accident.

---

## 11. Gap taxonomy — three honest buckets

1. **Real gaps worth closing** (inside the constitution):
   - Learn→Orient feedback seam (§12.1) — highest value.
   - Earn-your-autonomy / graduated SHAPE (§12.2).
   - Positive MTP / objective function (§12.3).
   - "Why did the agent choose X" explainability (§2 #9).
   - Enforced memory lifecycle + redactor (§2 #7).

2. **Constitution-blocked** (need a Required Decision + own initiative, not a slice):
   - Edge CRDT runtime (§2 #6).
   - Agent marketplace + trust/sandbox (§2 #8).
   - Heavy community/engagement platform (§10 SCALE gaps).

3. **Already satisfied in spirit** (stop treating as gaps):
   - Edge-first → local dev loop already is the edge.
   - Intelligence Stack → all six layers exist (just uncontracted).
   - Experimentation → quorum dry-runs already are it.

---

## 12. Net-new insights the concept lens surfaced (not in the 9 recs)

### 12.1 The Learn→Orient seam is the single highest-value loop to close
Everything needed is **already captured** — `model-performance.json` (success_rate per model
per slice-type), tempering drain history, review-queue rejections, gate-failure clusters — but
**decisions stay static** (fixed thresholds, fixed routing). Reading this history back into
Decide turns Plan-Forge from *instrumented* to *self-improving*. This **subsumes parts of #3 and
#5 and is bigger than either**. If only one thing gets built, build this.

### 12.2 "Earn-your-autonomy" (graduated SHAPE)
Auto-tune autonomy/quorum level **per slice-type from historical success_rate**: slice-types
with proven high success run with less oversight; flaky ones escalate to quorum/`--assisted`
automatically. The data exists; nothing reads it. Net-new, directly in the constitution, and the
natural payload of staged enforcement (§4).

### 12.3 Positive MTP / objective function
Plan-Forge encodes **constraints** (16 forbidden patterns) but **no north-star metric**. A plan
can have every slice pass while collectively drifting from the feature's actual intent. ExO's
"Massive Transformative" half has no analog. Open question: is a machine-readable *objective*
(not just *constraints*) even desirable for a dev tool, or does it over-formalize? Worth a debate,
not a build — yet.

### 12.4 The community/social under-investment is a strategy, name it
§10 shows the network-effect attributes are deliberately thin. Decide explicitly: is that
permanent (Plan-Forge stays a focused dev tool) or a future pivot (extensions → marketplace →
community)? Pretending it's a gap invites scope creep that fights the constitution.

---

**End of scratchpad.**
