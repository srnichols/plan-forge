# Fleet Operator Playbook

> **Audience**: Platform leads operating Plan Forge across multiple product teams.
> **Format**: A calendar, not a feature list. Day 1 / Week 4 / Week 12 milestones with concrete go/no-go criteria.

---

## How to read this playbook

Each phase has:
- **Goal** — what you're trying to achieve
- **Activities** — what to actually do
- **Go/no-go criteria** — observable signals that say "ready for next phase"
- **Anti-patterns to watch for** — common ways this stage goes wrong

This is the operator equivalent of a runbook. If you're following it strictly and something feels off, that's a signal worth investigating, not a step to skip.

---

## Day 0 — Prerequisites

Before you begin:

- [ ] GitHub Enterprise + Copilot Enterprise + Copilot Cloud Agent enabled on target repos
- [ ] LLM provider strategy decided (Anthropic, OpenAI, xAI, GitHub Copilot, Microsoft Foundry, or combination)
- [ ] Pilot team identified (one team, 5–15 engineers, real product work, not a sandbox)
- [ ] Executive sponsor named (someone who can defend cycle-time experiments at QBR)
- [ ] Initial budget envelope set (~$2K–$10K for the first month per team, varies wildly)
- [ ] OTel collector + observability backend chosen (Splunk, Datadog, Grafana, App Insights)

If any of these aren't true, work on them first. Plan Forge accelerates teams that already have direction; it doesn't substitute for it.

---

## Day 1 — Pilot installation

### Goal
Pilot team has Plan Forge installed, has run one plan end-to-end against a real (small) feature, and has a baseline measurement of cycle time and cost.

### Activities (~4–6 hours total)

1. **Install** (30 min)
   - Clone Plan Forge to each pilot dev's machine: `git clone https://github.com/srnichols/plan-forge`
   - Or use the consumer-mode setup: `setup.ps1` (Windows) or `setup.sh` (Mac/Linux) in target project
   - Verify: `pforge smith` returns clean

2. **Configure** (1–2 hr) — see [Agent Factory Recipe](agent-factory-recipe.md) Steps 2–5
   - Run `project-profile.prompt.md` once for the pilot repo
   - Run `project-principles.prompt.md` once
   - Review and customize `AGENTS.md` and `.github/copilot-instructions.md`
   - Configure `.vscode/mcp.json` with Plan Forge MCP server + github-mcp-server (and Foundry Toolbox if applicable)

3. **First plan** (2–3 hr including review)
   - Pick a real, small feature (1–3 day's worth of human work)
   - Run `step0` through `step5` of the pipeline
   - Use `pforge run-plan --estimate <plan>` first to see projected cost
   - Run `pforge run-plan --assisted <plan>` for human-in-the-loop the first time
   - Compare PR diff to plan via `pforge diff`

4. **Baseline metrics** (30 min)
   - Capture: total time spec → PR, total cost (LLM + Actions minutes), number of slices, number of gate failures, drift score
   - Save to `.forge/baseline-2026-05-06.json` or your team's metrics store

### Go/no-go criteria

| Signal | Pass | Fail |
|---|---|---|
| First plan ran end-to-end | Yes | Stop, debug |
| `pforge diff` clean post-merge | Yes (drift score ≥ 80) | Plan was too vague — re-harden |
| Cost within 50% of estimate | Yes | Either pricing data is stale or workload differs from typical — investigate |
| Pilot team's reaction | "Useful, with caveats" | "Confusing" or "in the way" — review configuration |

### Anti-patterns

- **Picking a toy feature** — lessons don't scale to real work
- **Skipping `--assisted` first time** — first plan should be observable
- **Running multiple plans in parallel before lessons land** — waste of cost
- **Skipping the baseline measurement** — you'll have nothing to compare against in Week 4

---

## Week 1 — Pilot runs N plans

### Goal
Pilot team runs 5+ plans, friction patterns become visible, instruction files start to encode lessons.

### Activities

- **Daily standup adds 5 minutes for Plan Forge friction**: each dev who used it that day flags one thing that didn't work
- **End of week**: dedicated 1-hour retro
  - What worked
  - What didn't (be specific — instruction file, prompt, agent persona, gate, cost)
  - What changed in `.github/instructions/*` as a result

### Go/no-go criteria for Week 2

| Signal | Pass | Fail |
|---|---|---|
| ≥ 5 plans completed | Yes | Slow uptake — investigate barriers (often: fear of cost, unclear when to use vs not) |
| Drift score average ≥ 70 | Yes | Plan-hardener prompt needs project-specific tuning |
| Instruction files updated ≥ 3 times | Yes | Team isn't iterating — that's the value loop, must enable it |
| Cost-per-PR trending down or stable | Yes | Cost going up plan-over-plan suggests waste — investigate slice sizing |

### Anti-patterns

- **Devs using Plan Forge for everything** — it's wrong for trivial bug fixes; right for plan-able work
- **No iteration on instructions** — the value compounds via instructions; if they're untouched, the team isn't learning
- **Hidden cost surprises** — surface costs daily, not weekly, in the first month

---

## Week 4 — Pilot graduation, second team onboarding

### Goal
Pilot team is self-sufficient. Second team starts, with patterns from Pilot 1 captured as templates. First multi-team observability dashboards live.

### Activities

1. **Pilot graduation**: pilot team operates Plan Forge without daily platform-team support. Platform team transitions to "office hours" model (1 hr / week).

2. **Second team onboard** (1 work day):
   - Reuses pilot team's `AGENTS.md` style and `.github/instructions/*` (forks where stack differs)
   - Reuses agent routing decisions from `.github/agents/ROUTING.md`
   - First plan runs in `--assisted` mode

3. **Multi-team observability**:
   - Both teams' OTel data flows to the same backend
   - Dashboards: per-team plan throughput, per-team cost, per-team drift scores, gate failure heatmap across teams
   - Plan Forge dashboard at `localhost:3100` shows per-developer; the OTel backend shows org-wide

4. **First quarterly KPI snapshot**:
   - Cycle time (spec → merged PR)
   - Cost per merged PR
   - Plan-Forge-driven PR percentage
   - Drift / regression incidents caught at gate vs. caught in production

### Go/no-go criteria for Week 8

| Signal | Pass | Fail |
|---|---|---|
| Pilot team self-sufficient | Yes | Means platform team is still bottleneck — extract patterns into docs |
| Team 2 ran first plan within 1 day of onboarding | Yes | Onboarding pattern needs simplification |
| Multi-team dashboards reflect real data | Yes | OTel pipeline issue — fix before adding more teams |
| Cost per merged PR vs. baseline | Trending down or stable | If up, investigate model routing and slice sizing |

### Anti-patterns

- **Onboarding team 2 before team 1 is ready to teach** — copy-paste failures multiply
- **Letting two teams diverge on instruction files** — common ground is what makes the fleet feel like a fleet
- **Platform team trying to operate every team's Plan Forge instance** — doesn't scale; build the office-hours model early

---

## Week 8 — 4 teams active, fleet patterns formalized

### Goal
4 of 5 teams active. Shared MCP server (Foundry Toolbox or in-house) deployed. Reviewer agents are catching real issues at PR time.

### Activities

1. **Add teams 3 and 4** in parallel using the Week 4 onboarding pattern (now refined)

2. **Deploy shared MCP server**:
   - For MS-shop fleets: Foundry Toolbox with curated tools (Web Search, Code Interpreter, File Search, org-specific OpenAPI tools)
   - For others: in-house MCP server hosted on Azure Container Apps / AWS App Runner / similar
   - Update each team's `.vscode/mcp.json` to consume

3. **Reviewer agent quality pass**:
   - For each of the 20 ship-default agents, look at the last 30 days of comments. Are they useful? Are they being acted on? Are they fired at the right cadence?
   - Tune agent personas based on findings. Document in agent file changelog.

4. **Cost guardrails formalized**:
   - Per-team budget caps in `.forge.json`
   - Cost anomaly alerts via `forge_alert_triage`
   - Cost-per-merged-PR target set per team based on Week 4 data

5. **Drift / quality KPIs reported to engineering leadership**:
   - Plan adherence (% of PRs with `pforge diff` clean)
   - Gate failure rate (overall, per team, trend)
   - Regressions caught at gate vs. in production
   - Cost per merged PR (per team, trend)
   - Reviewer-agent acceptance rate

### Go/no-go criteria for Week 12

| Signal | Pass | Fail |
|---|---|---|
| 4 teams active and self-sufficient | Yes | Onboarding pattern still has friction; investigate |
| Shared MCP server reduces per-team config drift | Yes | Adoption needs nudging — show concrete value |
| Reviewer-agent comments acted on ≥ 30% of the time | Yes | Personas need tuning, or routing is wrong |
| Cost guardrails preventing runaway | Yes | Budgets ineffective — likely too high or unenforced |

### Anti-patterns

- **Adding team 5 before teams 3 and 4 are stable** — compounds confusion
- **MCP server becomes a kitchen sink** — keep it curated; resist "add every API"
- **Reviewer agents never tuned** — they degrade over time as the codebase evolves

---

## Week 12 — Full fleet, first quarterly review

### Goal
All 5 teams active. First quarterly review of fleet metrics. Plan for next quarter.

### Activities

1. **Add team 5** using mature onboarding pattern (now ~4 hours)

2. **Quarterly review** (half-day session):
   - All KPIs reviewed (cycle time, cost-per-PR, drift, gate failures, reviewer-agent value, regressions caught)
   - Each team presents one win and one friction
   - Patterns extracted: what worked across teams, what's team-specific
   - Roadmap for next quarter: which capabilities to add, which to retire, which instruction-file patterns to standardize

3. **Eval data flywheel** (begin if not already):
   - Trajectories from completed runs become demonstrations for future runs
   - `forge_health_trend` aggregates the quarter's data
   - Memory architecture (`/memories/repo/`) captures the institutional learning

4. **Document the fleet operations model**:
   - Who runs what
   - On-call rotation for fleet-level issues
   - Escalation path when Plan Forge has a defect (use `forge_meta_bug_file`)

### Go/no-go criteria for next quarter

| Signal | Pass | Fail |
|---|---|---|
| All 5 teams operating without daily platform support | Yes | Fleet is too dependent — invest in self-service |
| Cost per merged PR is below baseline | Yes | Diminishing returns — investigate where time is going |
| Quarterly KPIs trending right direction | Yes | Hypothesis was wrong somewhere — adjust |
| Engineering leadership confident in scale-out to next 5 teams | Yes | Trust gap — surface what's missing |

### Anti-patterns

- **Treating quarterly review as a status update** — it's a planning session, not a report
- **Skipping eval flywheel** — trajectories are an asset; ignored, they're just storage
- **No documented operations model** — Plan Forge becomes one person's hobby instead of a fleet capability

---

## KPIs {#kpis}

The metrics that matter at the fleet level:

| KPI | Source | Healthy range |
|---|---|---|
| **Cycle time (spec → merged PR)** | OTel + git history | 30–70% of pre-Plan-Forge baseline |
| **Cost per merged PR** | `forge_cost_report` | Stable or declining month-over-month |
| **Plan adherence (drift score)** | `forge_diff` per plan | ≥ 80% of plans clean |
| **Gate failure rate** | `forge_health_trend` | < 30%; failures should drive instruction updates |
| **Regressions caught at gate vs. production** | Bug registry + OTel | Ratio improving over time |
| **Reviewer-agent acceptance rate** | Manual sampling | ≥ 30% of comments acted on |
| **Plan Forge plans / total PRs** | `forge_health_trend` | Grows over time toward team comfort level |
| **Per-engineer cost (when implemented)** | Cost service (planned) | Outliers investigated, not punished |
| **Time-to-green per slice** | OTel + slice events | Stable or improving |

---

## Cost discipline {#cost-discipline}

Three habits that make cost predictable:

1. **Always estimate before running.** `pforge run-plan --estimate <plan>` shows projected cost across all four quorum modes (`auto`, `power`, `speed`, `false`). Look at the numbers before the spend.
2. **Quorum mode is a knob, not a default.** `power` (Opus + GPT-5 + Grok consensus, threshold 5) is for high-stakes architectural slices. `speed` (cheaper models, threshold 7) is for high-volume routine work. `auto` makes a per-slice judgment. `false` is single-model. Use them deliberately.
3. **Watch the per-slice retry count.** Slices that retry 3+ times are usually either (a) gate is broken, (b) plan was too vague, or (c) wrong model for the task. Investigate, don't just absorb.

---

## Cost attribution {#cost-attribution}

Today, Plan Forge tracks cost per plan, per slice, per model. **Per-engineer attribution is on the roadmap** (planned) — until then, the workaround is:
- Each developer runs Plan Forge under their own user account
- Their `.forge/cost-history.json` is their own ledger
- Aggregate at the team level via OTel resource attributes (`service.namespace`, `service.instance.id`)

For finance teams that need formal chargeback, the OTel data is the source of truth, not the dashboard.

---

## Multi-team operations {#multi-team}

Two patterns work; pick one and stick with it:

### Pattern A: Federated (recommended for most)

- Each team owns its own Plan Forge installation, instruction files, and dashboard
- Platform team owns the shared MCP server, the OTel pipeline, and cross-team KPIs
- Quarterly cross-team learning session

Pros: teams move at their own pace, instruction files reflect team culture, no central bottleneck.
Cons: harder to enforce org-wide patterns.

### Pattern B: Centralized

- Platform team owns the canonical instruction files, agent personas, and quorum presets
- Teams consume from a shared `.github-private/` template repo
- Changes to shared assets require platform-team review

Pros: consistency across teams, easier compliance posture.
Cons: bottlenecks if platform team is small; teams may resent loss of autonomy.

The right answer depends on your engineering culture. Federated works for cultures that value team autonomy; centralized works for cultures that value consistency.

---

## Escalation: when Plan Forge itself has a defect

Plan Forge is software. Software has bugs. The escalation path:

1. **Self-repair first**: agents can file meta-bugs against Plan Forge with `forge_meta_bug_file` when they encounter a defect during execution. The tool routes to the Plan Forge GitHub repo with a stable hash to deduplicate
2. **Workaround in instruction files**: if the defect is reproducible and you can route around it via instructions, do so and document the workaround
3. **GitHub issue** at `srnichols/plan-forge` for non-emergency defects
4. **Pin a working version** in `package.json` if a recent release introduced the defect; rollback is one `npm install` away

Plan Forge is open source. There is no commercial support tier today. The escalation model is community + your own platform team's competence.

---

## Common operational mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Adding teams faster than the fleet can absorb | Inconsistent quality, cost surprises, frustrated devs | One team at a time until self-sufficient; don't compress for OKR optics |
| Skipping the iteration loop | Same friction in plan 50 as in plan 5 | Mandate post-plan retro; encode lessons in instructions |
| Treating Plan Forge as "set it and forget it" | Quality degrades; agents feel stale | It's a living configuration; budget time monthly to maintain |
| Reviewer agents fire on everything | Humans tune them out; signal lost | Tune routing per team; advisory ≠ blocking ≠ escalation |
| Cost reports go unread | Surprises at month-end | Daily cost dashboard for first month, weekly thereafter |
| No on-call for fleet-level Plan Forge issues | One engineer is the SPOF | Document operations model; rotate ownership |
| Eval data ignored | Trajectories accumulate; learning doesn't compound | Quarterly review trajectories; promote useful patterns |

---

## Changelog

- **2026-05-06** — Initial Fleet Operator Playbook. Day 0 / Day 1 / Week 1 / Week 4 / Week 8 / Week 12 phases. Go/no-go criteria per phase. KPIs, cost discipline, cost attribution, multi-team patterns (federated vs. centralized), escalation model, and operational anti-patterns.
