# Blitzy — comparison & competitive-landscape scratchpad

> **Status**: SCRATCHPAD — not a plan, not a commitment. Working notes evaluating
> [Blitzy](https://blitzy.com/) ("autonomous software development at enterprise scale")
> against Plan-Forge.
> **Owner**: srnichols
> **Started**: 2026-06-10
> **Decision bar**: improves Plan-Forge OR closes a real gap. Bloat = reject.
> **Source**: blitzy.com homepage, `/how_it_works`, and public FAQ (captured 2026-06-10).

---

## 1. What Blitzy actually is (one-paragraph version)

A closed, proprietary, enterprise-priced SaaS/VPC platform ("Blitzy OS") that runs
**thousands of specialized agents across every major foundation model** to autonomously
execute the whole SDLC: reverse-engineer a large existing codebase → build a knowledge
graph → generate an editable Technical Spec → take a natural-language prompt → produce a
**plan-of-action the human approves** → run **asynchronously for days/weeks** → deliver
compiled, runtime-validated, QA-cross-reviewed code (claims ~80% of a project, up to 3M
lines) plus a "developer's guide" for the human-owned last 20%. Differentiators it
advertises: "Infinite Code Context" knowledge graph, #1 on SWE-Bench Pro (66.5%), 27+
patents, SOC 2 Type II / ISO 27001, "no training on your code." Just raised **$200M at a
$1.4B valuation**. Pricing: $50K POC → $500K–$50M/yr, **$0.10/line onboarded, $0.20/line
generated**.

**Primary surface**: Cloud / customer-VPC, async, enterprise legacy-codebase modernization, "no IDE."
**Plan-Forge surface**: Developer-side, plan-driven, attended, runs in your editor + local CLI.

They are the **same species (agentic SDLC, not a copilot)** but built on **opposite
philosophies** — outsourced hyperscale autonomy vs. retained transparency and control.

---

## 2. Side-by-side

| Dimension | Plan-Forge | Blitzy |
|---|---|---|
| Category | Agentic SDLC pipeline (open framework) | Agentic SDLC platform (closed SaaS) |
| Where it runs | Local dev loop (CLI + MCP + VS Code) | Blitzy Cloud / Customer VPC, "no IDE" |
| Model | Open, self-hosted, no-build Node ESM + MCP | Proprietary, patented (27+), black box |
| Trigger | Developer runs `pforge run-plan` | Submit spec/prompt → async job (not cancelable) |
| Authoring unit | Plan markdown + per-slice gates + step prompts | NL prompt (WHY/WHAT/HOW) + editable Tech Spec |
| Human gate | Harden plan → approve before `forge_run_plan` | Edit/approve Tech Spec + plan-of-action |
| Agents at once | 1 worker per slice, quorum for review | "3,000+ specialized agents," multi-model fusion |
| Execution horizon | Slice-by-slice, gated, resumable | "Reason for days/weeks," up to 3M-line output |
| Context store | 3-tier memory (hub / files / OpenBrain pgvector) + lattice graph | "Infinite Code Context" knowledge graph |
| QA / review | Review-gate session, drift, LiveGuard, tempering | Multiple QA agents cross-review before delivery |
| "Last 20%" | Blocker reports, handoff summaries | Explicit developer's-guide artifact |
| Cost controls | `forge_estimate_quorum`, `forge_cost_report`, your own API spend | $0.10/line onboard, $0.20/line gen; $50K–$50M/yr |
| Target user | Individual devs & teams, any stack | IP-sensitive enterprises, 100M+ LOC legacy |
| Transparency | Every tool/gate/hook/slice inspectable & editable | Black box; jobs not cancelable once submitted |
| Provenance/audit | Hallmark stamps, audit trail, dry-run mutation safety | "No training on your code," SOC2/ISO27001 |

---

## 3. Where the workflows rhyme

The category-level overlap is real — anyone who knows Plan-Forge would recognize the loop:

- **Spec → plan → execute → review → ship** ≈ Blitzy's reverse-engineer → tech spec →
  prompt → approve plan-of-action → autonomous build → developer's guide.
- **Human approves a hardened plan before agents run** — both gate on human sign-off of a
  plan artifact (Plan-Forge `Phase-*-PLAN.md` hardening; Blitzy Tech-Spec + plan-of-action).
- **Multi-agent + multiple models** — Plan-Forge quorum modes vs. Blitzy's agent swarm.
- **Long-running autonomous execution** — Plan-Forge gated slices vs. Blitzy "days/weeks."
- **QA/review agents before code lands** — review gate / tempering / LiveGuard vs. Blitzy's
  cross-reviewing QA agents.
- **Codebase knowledge graph for deep context** — lattice + OpenBrain vs. "Infinite Code Context."
- **Explicit "last 20% to humans"** — both name the remainder as a first-class deliverable.

---

## 4. Where they sharply diverge (the moat question)

Blitzy is essentially a **closed, enterprise-priced, hyperscale** version of the idea
Plan-Forge embodies as an **open, transparent, developer-controlled framework**. The bets
are inverses:

- **Blitzy bets on scale + autonomy you outsource** — thousands of agents, 3M-line outputs,
  reverse-engineering 100M+ LOC legacy, "no IDE," per-line billing, black-box jobs.
- **Plan-Forge bets on governance + control you keep** — Project Principles, ACI contracts,
  dry-run mutation safety, audit trails, memory provenance, runs in your editor, no per-line
  fee (you pay your own model API costs), every surface editable.

These are not the same buyer. Blitzy targets the VP-Eng at an IP-sensitive enterprise with a
COBOL/C# monolith and a $500K+ budget. Plan-Forge targets the developer/team that wants an
auditable, self-hosted pipeline they can read and modify.

---

## 5. Idea harvest — what (if anything) to borrow

Legend: **Steal** = worth a real look · **Note** = directionally interesting · **Reject** = fights the constitution.

| Blitzy idea | Verdict | Rationale |
|---|---|---|
| Reverse-engineer → auto-generated, code-synced **Tech Spec** as a first-class artifact | **Note** | Plan-Forge has lattice + memory but no single "always-current spec doc" surface. Could be a thin `forge_*` view over lattice — but only if it stays lean (no new heavy dep). Measure against PROJECT-PRINCIPLES before building. |
| `.blitzyignore` (gitignore-style scoping for agent processing) | **Note** | Plan-Forge already has Scope Contracts + Forbidden Actions per slice. A repo-wide ignore file is simpler for users but partly redundant. Low priority. |
| Explicit **developer's-guide for the last 20%** as a named deliverable | **Steal-ish** | Plan-Forge emits blocker/handoff reports but doesn't aggregate "here's everything left for humans" into one artifact at run end. A `forge_*` run-summary "remaining work" rollup is cheap and high-signal. |
| Multiple **QA agents that cross-review each other** before delivery | **Note** | Already approximated by review-gate quorum + tempering. The cross-review framing (agents critique peers' output) could sharpen quorum design. |
| Per-line **cost transparency** model | **Reject (as pricing)** / **Note (as telemetry)** | Plan-Forge is free/open; don't adopt per-line billing. But surfacing "lines generated this run" as a metric next to token cost is a cheap dashboard add. |
| Async "set it and forget it" + notify-on-done | **Have it** | `pforge run-plan` + dashboard + notify-* extensions already cover this. |

---

## 6. Positioning takeaway (for the Plan-Forge narrative)

Blitzy is the **well-funded enterprise incumbent** in the "agentic SDLC, not a copilot"
category that Plan-Forge also occupies. That validates the category. Plan-Forge's
differentiation against it is **deliberate inversion**, not feature parity:

> *Open vs. closed. In-editor vs. black-box cloud. No per-line fee vs. $0.10–$0.20/line.
> Auditable, principle-governed, dry-run-safe control vs. outsourced hyperscale autonomy.*

If Blitzy ever comes up in a Plan-Forge stakeholder briefing, the honest frame is: "same
category, opposite philosophy — choose Blitzy if you want to outsource the build at enterprise
scale and price; choose Plan-Forge if you want to keep the pipeline transparent, self-hosted,
and under your team's control."

---

## 7. Open questions / to verify later

- Blitzy's "knowledge graph" internals are undisclosed — how does it actually compare to
  Plan-Forge's lattice + OpenBrain pgvector approach beyond marketing language?
- SWE-Bench Pro #1 (66.5%) is a real signal of code-gen quality at scale; no equivalent
  public benchmark exists for Plan-Forge's gated-slice approach. Worth tracking. (Now
  scoped in §10 below.)
- "Jobs not cancelable once submitted" is a notable UX/control gap Plan-Forge does **not**
  have (slices are resumable/abortable) — a genuine differentiator to highlight.

---

## 8. Deep-review addenda — what the first pass missed

A second pass (blog/SWE-Bench post, `docs.blitzy.com`, `/security`) surfaced material the
homepage-only read glossed over. These sharpen both the comparison and the gap analysis.

### 8a. The "harness layer" thesis (their actual technical bet)

The SWE-Bench post is the most candid technical statement Blitzy has published. The core
claim is **not** "better model" — it's **"better harness."** Quesma ran GPT 5.4 at max
reasoning (`xhigh`) on the same 20 hardest tasks; *every* incorrect GPT 5.4 patch was
"close" — right area, right general fix, **wrong on intricate details / corner cases.**
GPT 5.4 works from a **single pass** through the code; Blitzy had **already spent hours
building the knowledge graph** before attempting the task, so it got boundary conditions
and cross-module interactions right.

> **Why this matters for us**: This is *exactly* Plan-Forge's thesis too — value lives at
> the orchestration/harness layer (plan hardening, gates, memory, quorum), not in the raw
> model. Blitzy has now **published independently-audited proof** of that thesis. Plan-Forge
> makes the same bet but has **zero external validation** of it. That's the real gap (see §9).

### 8b. Benchmark numbers (concrete, for our records)

| System | SWE-Bench Pro Public | Notes |
|---|---|---|
| **Blitzy** | **66.5%** (486 / 731) | Audited by Quesma; multi-model + knowledge-graph harness |
| WarpGrep | 59.1% | Next-best *agent framework* |
| GPT 5.4 | 57.7% | SOTA frontier model, early Mar 2026 |
| Claude Code (Opus 4.5) | 55.4% | Runner-up agent |

Audit integrity notes (relevant if we ever submit): internet access was **package-install
only**, **no web searches**, no leakage of issue numbers / PR text / golden-patch tests.
SWE-Bench Verified is **deprecated** (frontier saturated it at 76–86%); SWE-Bench Pro is the
new bar, endorsed by OpenAI's Frontier Evals team (Feb 2026). The other current benchmark is
**Terminal Bench 2.0**.

### 8c. The docs tell a more grounded story than the homepage

`docs.blitzy.com` describes the *actual* product loop far more modestly than the homepage's
"thousands of agents reasoning for days":

> "Blitzy generates code from your prompts, validates it in isolated environments, and
> **opens a pull request for your review. You control every step — from the implementation
> plan to the final merge.**"

So the real shape is **human-in-the-loop, PR-based, you-approve-the-plan** — structurally
*much* closer to Plan-Forge than the marketing implies. The "80% autonomous / days of
reasoning" framing is the enterprise-scale ceiling, not the default interaction.

### 8d. Security architecture (genuinely differentiated — worth respecting)

The `/security` page is the most concrete part of their site and reveals real engineering:

- **Embeddings-only storage** — "we never store your code directly. Instead, solely store
  embeddings." (Plan-Forge stores plans + `.forge/` artifacts + code locally — different
  trust model, but worth noting their IP-protection posture.)
- **Air-gapped code generation** — the gen environment is isolated, *not* reachable from
  their UI or the public internet.
- **Inbound-only VPC** — the platform **never initiates outbound requests** and has **no
  public endpoints**. Strong attack-surface story.
- **Secrets via encrypted UI, never exposed to AI agents.**
- **Deployment matrix**: Cloud · Hybrid cloud · VPC · Black-box VPC · On-prem · Black-box
  on-prem. (Plan-Forge is *always* on-prem/local by nature — arguably the strongest possible
  version of this, but it's implicit, never marketed as a security posture.)

> **Takeaway**: Plan-Forge's local-first model is a *stronger* privacy story than Blitzy's
> (the code never leaves your machine at all), but we **never frame it that way**. Blitzy
> turned "we only store embeddings" into a headline. We could turn "your code never leaves
> your repo" into one.

---

## 9. Possible Plan-Forge gaps worth considering

Grounded against what Blitzy does **and** against `PROJECT-PRINCIPLES.md`. Each item is a
**go/no-go**, not a default. Legend: **Consider** = plausibly improves the system ·
**Watch** = monitor, don't build yet · **Reject** = fights the constitution.

| # | Gap (vs. Blitzy) | Verdict | Notes / fit against principles |
|---|---|---|---|
| G1 | **No external benchmark / validation of the harness thesis.** Blitzy has audited SWE-Bench Pro proof; we have anecdotes. | **Consider** | Highest-leverage gap. A public, reproducible benchmark score is the single most credible signal in this category. Scoped in §10. |
| G2 | **No always-current, auto-generated codebase spec doc.** Blitzy's code-synced Tech Spec is a first-class artifact + onboarding deliverable. | **Consider (lean only)** | We have lattice + memory but no single "here's the system" view. Could be a thin `forge_*` read-view over lattice — *only* if no heavy dep. Reject if it needs a doc-gen engine. |
| G3 | **Reverse-engineering large legacy codebases as a front-door.** Blitzy ingests 100M+ LOC and maps it before any change. | **Watch** | Plan-Forge assumes you bring a plan; it doesn't "onboard a strange 10M-line repo and explain it." Lattice partially covers this. Big build; only if users actually ask. |
| G4 | **"Remaining work / last-20%" rollup as one artifact at run end.** | **Consider (cheap)** | We emit blocker + handoff reports per slice but never aggregate "everything left for humans" into one end-of-run deliverable. Low effort, high signal. (Already flagged Steal-ish in §5.) |
| G5 | **Cross-review QA framing** (agents critiquing each other's output before delivery). | **Watch** | Approximated by review-gate quorum + tempering. The explicit peer-critique loop could sharpen quorum design without new infra. |
| G6 | **Privacy/security posture is implicit, not marketed.** | **Consider (positioning, not code)** | "Your code never leaves your machine" is a stronger claim than Blitzy's "embeddings-only." It's a README/positioning gap, not an engineering one. |
| G7 | **"Lines generated" / throughput telemetry.** Blitzy quantifies output (3M lines, $/line). | **Consider (telemetry only)** | A dashboard metric next to token cost is cheap and gives users a tangible "how much did this run produce" signal. **Reject** adopting per-line *billing*. |
| G8 | **Scale ceiling.** Blitzy markets "days/weeks of reasoning, 3M-line outputs." Plan-Forge is gated/incremental by design. | **Reject as a goal** | This is a *feature*, not a gap — gated slices + resumability + audit trail are the constitution. Don't chase hyperscale autonomy. Frame it as deliberate. |
| G9 | **Enterprise compliance surface** (SOC 2 / ISO 27001 / SAML-SSO). | **Reject (out of scope)** | Plan-Forge is a self-hosted dev tool, not a SaaS. Compliance is the *consuming org's* boundary. Not our layer. |
| G10 | **Multi-deployment packaging** (VPC / black-box / on-prem variants). | **Reject** | Local-first already *is* the most private deployment. Nothing to add. |

**Net read**: only **G1, G2, G4, G6, G7** are worth real consideration, and of those **G1
(benchmark)** and **G6 (positioning)** are the highest-leverage because they close *credibility*
gaps, not capability gaps. G4 and G7 are cheap wins. Everything else either fights the
constitution or is already covered.

---

## 10. Should we run Plan-Forge through SWE-Bench Pro?

**Short answer: yes, it's worth scoping — Plan-Forge is a legitimate "harness" candidate, and
this is the single highest-credibility signal available in this category (closes gap G1).**
But it's a real project, not a weekend script. Honest breakdown:

### Why it fits

SWE-Bench Pro evaluates a **harness** (model + agent scaffolding) on resolving real GitHub
issues against hidden tests. Blitzy competes there *as a harness*, not as a model — and that
is exactly what Plan-Forge is. The benchmark is philosophically aligned with our entire thesis
(value at the orchestration layer). A respectable score would be the first **external,
reproducible** validation of the gated-slice/quorum approach.

### What it would actually require

1. **A harness adapter.** SWE-Bench Pro hands you `(repo, base_commit, issue_text)` and expects
   a unified-diff patch. Plan-Forge is plan-driven, so we'd need an adapter that turns a single
   issue into a minimal execution flow — most likely reusing the existing **`forge_bug_*` /
   bug-fix skill** path (load issue → `/code-review` context → TDD failing test → fix →
   validate) rather than the full `Phase-*-PLAN.md` pipeline. This is the core build.
2. **Containerized, network-locked runs.** Each task runs in the benchmark's Docker image.
   Audit rules: **no web search**, internet for package installs only. Plan-Forge's orchestrator
   already shells out via `spawn`; we'd run it headless inside the harness container with
   OpenBrain/L3 memory **disabled** (no cross-task leakage) and the dashboard off.
3. **Per-task budget + model pinning.** 731 public tasks. With quorum **on**, cost/time
   multiplies — likely run **`--quorum=false` single-model first** to establish a baseline,
   then a small quorum subset to measure the harness lift. Pin one model (e.g. a flagship) so
   the score is attributable to *the harness*, not model luck.
4. **Leakage hygiene** (or the score is worthless): disable L3 recall, scrub any memory that
   could carry golden-patch hints, log full trajectories so an auditor (Blitzy used Quesma)
   could verify no reward-hacking. Mirror their integrity bar from day one.
5. **Cost guardrails.** Use `forge_estimate_quorum` / `forge_cost_report` to project spend
   **before** a full 731-task sweep. A pilot of ~25–50 representative tasks gives a directional
   number for a fraction of the cost.

### Recommended path (incremental, cheap-first)

- **Phase 0 — Pilot (low cost):** Build the bug-fix adapter, run **20–50 tasks single-model**,
  no quorum. Goal: prove the adapter works end-to-end and get a directional %. This is enough to
  decide whether a full run is worth it.
- **Phase 1 — Baseline:** Full 731 tasks, single flagship model, `--quorum=false`. This is the
  honest "Plan-Forge harness lift over a bare model" number.
- **Phase 2 — Quorum lift:** Re-run a subset with `--quorum=power` to quantify what review-quorum
  buys. This is the marketing-grade number *if* it beats the baseline meaningfully.
- **Phase 3 — Audit (optional):** Only if the number is competitive, commission an external audit
  (as Blitzy did) before publishing.

### Honest caveats

- **A weak score is a liability**, not just a non-event — publishing a mediocre number in a
  category where Blitzy leads at 66.5% could hurt. Run privately first; only publish if strong.
- **The score is model-bounded.** A frontier model is ~55–58% *bare*. Our harness lift is the
  story — frame the result as **"+X points over the same model bare,"** not as an absolute,
  because the absolute is mostly the model's.
- **Effort is non-trivial** — the adapter, container plumbing, leakage hygiene, and a
  potentially four/five-figure API bill for a full sweep. Pilot first, decide with data.
- **This is net-new scope** — it must go through a hardened `Phase-*-PLAN.md` and be weighed
  against the roadmap, not started ad hoc.

**Recommendation**: green-light **Phase 0 (the ~25–50-task pilot)** as a scoped phase. It's the
cheapest way to convert gap G1 from "we believe the harness helps" into "we measured it," and it
de-risks any decision about a full, publishable run.
