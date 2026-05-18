<!--
Plan Forge — Stakeholder Briefing Template
===========================================

PURPOSE
  Fill the five placeholders below to produce a per-organisation stakeholder briefing
  in roughly five minutes. The canonical sections (1, 2, 4, 6, 7) are pre-written
  because they don't change between prospects. The prospect-specific sections
  (Reading alongside, Where it hurts, Mapping to squads, Mapping to KPIs, Pilot
  proposal, The ask) are deliberately blank and have inline guidance comments
  explaining what each one should contain.

PLACEHOLDERS — find and replace these five tokens:
  <<COMPANY>>          The customer / prospect organisation name
  <<SQUADS>>            One-line description of how their engineering org is structured
  <<KPIS>>              The two or three metrics they have told you they are measured on
  <<PILOT_TIMELINE>>    The proposed pilot window (e.g. "30 days, starting 2026-06-01")
  <<THE_ASK>>           What you actually need them to do at the end of the briefing

NOT placeholders — these are intentionally per-organisation prose:
  Section 2 (Reading alongside)
  Section 3 (Where it hurts)
  Section 5 (Mapping to squads)
  Section 7 (Mapping to KPIs)
  Section 10 (Pilot proposal)
  Section 12 (The ask)

The five canonical sections (1, 4, 6, 8, 9, 11) are sourced from
docs/manual/stakeholder-briefing.html — keep them in sync if you edit them
locally, and consider opening a PR upstream if your edit is generally useful.

HOW TO USE
  Path 1 — manual:   Copy this file, replace placeholders, write the per-prospect
                     sections, publish wherever your org publishes briefings.
  Path 2 — assisted: Run /stakeholder-briefing in your AI coding tool. The skill
                     prompts for the five placeholders and, with --source-dir,
                     drafts the per-prospect sections from your existing materials.
  Path 3 — review:   Open a discussion in the Plan Forge repo with your draft
                     for a second pair of eyes before sending to your VP.

Length target: ~3000 words total, ~10–15 minutes to read.
Voice target: bold lead sentence per section, bullets where they help, ruthless
              about cutting nuance the manual chapters cover. Cross-link, don't restate.
-->

# Stakeholder Briefing — Plan Forge for <<COMPANY>>

> A skimmable, self-contained briefing for the manager or VP at <<COMPANY>> who has
> to approve a Plan Forge pilot. Read end-to-end in ~10–15 minutes. Every headline
> number cross-links into the canonical chapter of the Plan Forge manual.

---

## 1. Executive Summary

**AI coding tools get a feature from prompt to running code in minutes — and then leave
the rest of the SDLC to humans.** Plan Forge is the orchestration harness that closes
that gap. It sits on top of GitHub Copilot (and any other AI coding tool that speaks the
Model Context Protocol) and adds the four layers production software actually needs:
planning, validation gates, memory, and reviewer separation. The receipt on the
project's own seven-slice memory-QA plan is **$0.07 on a single mid-tier model in
roughly 51 minutes, zero failed slices, zero escalation**.

For <<COMPANY>>, the upshot is straightforward: the same pipeline that produced that
receipt is the pipeline this briefing proposes piloting against your codebase, on your
infrastructure, against the KPIs you actually report on (Section 7).

- **The problem.** Vibe coding clears the 80% demo bar fast and stalls at the 20% that
  ships — tests, interfaces, DTOs, typed exceptions, cancellation, audit.
- **The fix.** Four named loops — Smelt (intake), Forge (execute), Guard (post-deploy),
  Learn (memory) — each with concrete artifacts and gates.
- **The receipt.** Phase-MEMORY-QA: 7 slices, $0.07 total, 100% on one mid-tier model.

> Read more → [Foreword — From Impossible to Seven Minutes](https://github.com/srnichols/plan-forge/blob/master/docs/manual/foreword.html) (10 min, the year-long story).

---

## 2. Reading alongside <<COMPANY>>'s own slides

<!--
2–4 sentences naming the customer's own strategy doc, architecture deck, AI-SDLC
RFP, or whatever framing they have already put on paper. The point is to show
this briefing is responsive to their stated context, not generic boilerplate.

If the customer hasn't shared materials: name the public artifact you know they
care about (their engineering blog's most-cited post, their published OKRs, their
last earnings-call line about engineering productivity).

Example: "This briefing reads alongside <<COMPANY>>'s 2026 Engineering Strategy
deck (sections 3 and 7) and the 'AI-SDLC platform' RFP circulated 2026-04-12. It
maps Plan Forge into the platform-team slot called out on slide 19 and treats the
quality bar on slide 27 as the success criterion for the pilot in Section 10."
-->

---

## 3. Where <<COMPANY>> said the existing AI-SDLC tooling falls short

<!--
3–5 sentences naming the specific pain the customer has already articulated.
Lift the language from their own materials when possible — a stakeholder
recognising their own words on the page reads ten times more carefully than one
parsing yours.

Three good sources for this section:
  - Verbatim quotes from interview notes or call transcripts
  - Sentences from the customer's own RFP / strategy deck (cite the slide)
  - Public statements: blog posts, conference talks, podcast appearances

If you have nothing on paper: this section is the one to leave blank and write
last, after a 30-minute call with the champion. Do not invent the pain.
-->

---

## 4. Plan Forge on top of the GitHub Copilot ecosystem

**Plan Forge does not compete with GitHub Copilot, Claude, Cursor, Codex, Gemini, or
Windsurf — it routes work through them.** The harness is the orchestration layer; the
substrate is whatever AI coding tool is already in your IDE. Section 4 of the canonical
briefing (in the manual) shows the surface-by-surface map. The short version: every
primitive the AI coding tools provide — chat, edit, MCP tool calls, agent sessions — is
consumed by Plan Forge as a building block. None of it is replaced.

For <<COMPANY>>, this matters because adopting Plan Forge does **not** require giving
up the AI coding tool the org has already standardised on. If your developers use
Copilot today, they keep using Copilot. The harness shows up as a CLI, a small set of
slash commands, and a plan file format the AI agents already know how to follow.

> Read more → [Appendix H — GitHub Stack Alignment](https://github.com/srnichols/plan-forge/blob/master/docs/manual/github-stack-alignment.html) and [Appendix I — Plan Forge on the GitHub Stack](https://github.com/srnichols/plan-forge/blob/master/docs/manual/plan-forge-on-the-github-stack.html).

---

## 5. Mapping Plan Forge to <<COMPANY>>'s squads (<<SQUADS>>)

<!--
A small table or short bullet list mapping the four Plan Forge stations
(Smelt, Forge, Guard, Learn) to the squads / chapters / functions inside
<<COMPANY>>. The point is to show whose day-to-day work changes, and by how much.

Recommended format:

| <<COMPANY>> squad                 | Owns today                              | With Plan Forge, also owns                                |
|-----------------------------------|------------------------------------------|-----------------------------------------------------------|
| Platform engineering              | CI, build, secrets, deploy automation   | The pforge install + the .forge.json baseline             |
| AI-SDLC working group / SRE       | (none yet — this is the gap)            | Plan templates, hardening runbook, LiveGuard hooks        |
| Product engineering squads        | Feature delivery against Copilot prompts | Same — Plan Forge is opt-in per plan, no forced adoption  |
| QA / quality engineering          | Test coverage SLA, defect triage         | Validation gates, A/B test runs, quorum-mode quality bar  |
| Security / compliance             | SAST, SBOM, secret scanning              | LiveGuard secret-scan + env-diff PreDeploy hooks          |

Fill in <<COMPANY>>-specific squad names. If you don't know the structure, ask
the champion for an org chart before writing this section — guessing here breaks
trust faster than any other section.
-->

---

## 6. The memory layer the existing plan doesn't have

**Most AI-SDLC adoptions stall at month three because every plan starts cold.** The model
re-derives the same decisions, re-learns the same gotchas, re-spends the same tokens on
context the team has already paid to discover once. Plan Forge addresses this with an
open-source, user-owned memory service — **OpenBrain** — that captures every plan's
outcomes (passing gates, failing gates, fix proposals, post-mortems) and recalls them
into the next plan's context.

For <<COMPANY>>, this is the difference between a tool that gets cheaper to use over
time and one that does not. Concretely: drift dropped 64% over 90 days on the project's
own memory-QA stream; the same plan that costs a dollar on day one costs a fraction of
that on day ninety, with fewer escalations.

- **Where it runs.** Inside your tenancy, on your hardware, behind your audit boundary.
- **What it stores.** Decisions, gates, outcomes — not source code, not customer data.
- **Why it's separate from the model.** A model upgrade should not wipe institutional
  memory. The memory layer survives model swaps.

> Read more → [Memory System chapter](https://github.com/srnichols/plan-forge/blob/master/docs/manual/memory-system.html).

---

## 7. Mapping Plan Forge to <<COMPANY>>'s KPIs (<<KPIS>>)

<!--
A table mapping the two or three KPIs <<COMPANY>> reports on (developer
velocity, defect escape rate, MTTR, cycle time, story-point throughput,
cost-per-feature — whatever they actually measure) to the Plan Forge mechanism
that moves the needle.

Be honest about what doesn't move. If they care about a KPI Plan Forge doesn't
help with, say so in the table and pivot to the adjacent KPI that does.

Recommended format:

| <<COMPANY>> KPI                  | Plan Forge mechanism                            | Expected directional impact                       |
|----------------------------------|--------------------------------------------------|---------------------------------------------------|
| Defect escape rate               | Validation gates + reviewer separation           | Down 30–60% (cite the .NET A/B test, 99 vs 44)    |
| Cost per shipped feature         | Auto-escalation + memory recall                  | Down 40–80% on plans that re-touch known surfaces |
| Time-to-merge                    | Hardened plans + scope contract                  | Modestly down; quality is the bigger lever        |
| Developer satisfaction (eNPS)    | Fewer regressions to chase, clearer guardrails   | Indirect — measure at 90 days                     |

Fill in <<COMPANY>>'s actual KPIs. If you don't know which metrics they report
on, the next call should establish them — without this table, the pilot has no
success criterion.
-->

---

## 8. What we add that <<COMPANY>> might not have asked for

**A handful of Plan Forge capabilities exist because they kept being the missing piece in
production adoptions and adding them once was cheaper than re-explaining their absence.**
None is hidden, gated, or paywalled; they ship in the same MIT harness.

- **An open-source memory layer (OpenBrain).** A user-owned memory service. Your
  decisions stay in your tenancy, on your hardware, behind your audit boundary — not in
  a vendor's control plane.
- **Reviewer separation.** Author and reviewer run in different sessions, different
  model selections, often different model families. Reviewer cannot be flattered by
  author framing.
- **Validation gates baked into the plan, not the CI script.** The plan owns its gates.
  CI verifies that gates ran and passed; CI does not get to redefine them.
- **Plan provenance.** Every plan carries Scope Contract, Forbidden Actions, and an
  immutable record of which slices ran on which model at what cost.
- **Fleet operations.** Multi-plan, multi-repo, multi-agent — same dashboard, same cost
  ledger, same memory recall.
- **Audit trail.** GitHub Issues, PRs, Actions runs, and plan commit history *are* the
  audit trail. No second system to grant the auditor a seat in.

> Read more → [Appendix J — Plan Forge for Enterprise](https://github.com/srnichols/plan-forge/blob/master/docs/manual/enterprise-deployment.html).

---

## 9. Adoption path — two routes

**There are two ways to adopt Plan Forge, and they are both first-class.** Both
terminate at the same place: a hardened, gated, memory-backed pipeline running against
your repo with audit trail on every artifact.

- **Route A — adopt as-is.** Clone the repo, run `setup.ps1` (or `setup.sh`) against the
  preset that matches your stack, and start running `pforge run-plan` against your plans
  within the hour. Stay on the community upgrade cadence. Best for teams that want a
  working pipeline today.
- **Route B — fork and brand.** Fork into your org. Rebrand the presets, agent set,
  skill list, and plan templates to match how <<COMPANY>> already talks about software.
  Rebase from upstream on your release rhythm. Best for organisations whose SDLC
  vocabulary or compliance constraints make as-is a poor fit out of the box.

For <<COMPANY>>, the recommended starting route is **<!-- pick one and justify in one
sentence: A if the org is comfortable with community cadence and the standard preset
matches the stack; B if there are compliance, vocabulary, or naming constraints that
make rebranding essential -->**.

> Read more → [Installation chapter](https://github.com/srnichols/plan-forge/blob/master/docs/manual/installation.html) (route A) and [Customization chapter](https://github.com/srnichols/plan-forge/blob/master/docs/manual/customization.html) (route B).

---

## 10. Concrete 30-day pilot proposal (<<PILOT_TIMELINE>>)

<!--
The single most prospect-specific section in the briefing. Owns the timeline,
the scope, the named participants, the success criteria, the exit ramps.

Recommended structure (adapt to <<PILOT_TIMELINE>>):

Week 1 — Install + first hardened plan
  - Day 1: clone, setup against the stack preset, verify with `pforge smith`
  - Day 2–3: harden one real plan from <<COMPANY>>'s backlog (champion + one engineer)
  - Day 4–5: run the plan end-to-end, capture the cost-ledger + reviewer outputs

Week 2 — Three plans across two squads
  - Pick two squads from Section 5; one plan each from each squad's backlog
  - Wire the LiveGuard PreDeploy hooks against the staging environment
  - Daily 15-min standup with champion + squad leads, no managers

Week 3 — Memory layer + reviewer separation
  - Stand up OpenBrain in <<COMPANY>>'s tenancy
  - Run a fourth plan with memory recall enabled; compare cost ledger vs week 1
  - Independent reviewer session (different model family) on the week-2 plans

Week 4 — Decide
  - Pilot summary against the KPIs in Section 7
  - Cost-per-plan trend chart from the cost ledger
  - Three-way go/no-go: roll out as-is, fork and rebrand, or stop

Success criteria (cite from Section 7):
  - <KPI 1> moves by at least <X>
  - <KPI 2> moves by at least <Y>
  - Champion can name two patterns the team will take forward even if the pilot stops

Exit ramps:
  - Stop the pilot at any week boundary with no contractual residue
  - All artifacts (plans, gates, memory entries) stay in <<COMPANY>>'s repos / tenancy
-->

---

## 11. Why open source matters here

**An SDLC harness is the wrong layer to rent.** Renting the model is fine — the model is
interchangeable. Renting the orchestration *on top of* the model is a category mistake.
The orchestration is where your decisions live, your audit trail accumulates, your
compliance posture is encoded, and your institutional memory is stored. The closer that
layer sits to your business, the worse the lock-in if you do not own it.

Four things change when the harness is open source and the memory layer is user-owned:

- **IP stays yours.** Plans, patterns, memory entries, agents, skills — all in your repo
  or your tenancy. No vendor takedown can strand any of it.
- **Audit is in-place.** The artifacts an auditor wants — plan, gates, run log, cost
  ledger, reviewer verdict — are GitHub objects under your existing access controls.
- **Customisation is unbounded.** Anything in the harness can be forked, replaced, or
  augmented. Presets, agents, skills, hooks, notifier extensions, the orchestrator itself.
- **No vendor lock-in on the orchestration layer.** The model can change tomorrow; the
  harness does not.

For <<COMPANY>>, the practical implication is that the cost of *exiting* Plan Forge in
year two or year three is the cost of leaving your own plans, your own memory, and your
own audit trail in place and walking away from a directory of MIT-licensed code. There
is no exit fee, no data-extraction project, no vendor-survived re-platforming.

> Read more → [Memory System chapter](https://github.com/srnichols/plan-forge/blob/master/docs/manual/memory-system.html) and [Customization chapter](https://github.com/srnichols/plan-forge/blob/master/docs/manual/customization.html).

---

## 12. The ask (<<THE_ASK>>)

<!--
The single most concrete sentence in the briefing. What do you actually need
this stakeholder to do, by when, with whom?

Bad asks:
  - "Let me know if you're interested."
  - "Happy to set up a follow-up call."
  - "Consider whether this might be a fit."

Good asks:
  - "Approve a 30-day pilot starting <<DATE>> with <<NAMED_SQUAD>>. No budget
     ask. I will report back at week 2 and week 4 against the KPIs in Section 7.
     Decision needed by <<DATE>>."
  - "Name one engineer from <<NAMED_SQUAD>> to be the technical lead for the
     pilot in Section 10. I need them for ~6 hours/week for 4 weeks."
  - "Forward this briefing to <<NAMED_PEER>> by <<DATE>> and tell me whether
     they want to attend the kickoff in week 1."

The ask should be answerable with yes / no / let-me-think — not with another
meeting. If you genuinely need another meeting first, ask for that.
-->

---

## Appendix A — Visual reference

The canonical visual reference for the GitHub stack with Plan Forge layered on top lives
in the [Plan Forge manual](https://github.com/srnichols/plan-forge/blob/master/docs/manual/github-stack-alignment.html) (Appendix H). For a per-briefing artifact, either embed
the same SVG (link above) or screenshot the figure for inclusion in this document.

The substrate / harness / outcomes stack diagram is the single most useful visual when
walking a stakeholder through Section 4. If only one image lands in this briefing, make
it that one.

---

<!--
END OF TEMPLATE

After filling: validate by reading end-to-end in one sitting. If a section
doesn't feel concrete enough to defend in a Q&A, replace the placeholder prose
with a one-line "to be confirmed" and bring it to the next call.

Word-count target: ~3000 words. Section count: 12 (matches the audit's
per-prospect briefing TOC). Length budget: 10–15 minutes to read.

If this template was useful and you'd like to improve it, open a PR upstream:
https://github.com/srnichols/plan-forge — the canonical briefing in the manual
is the source of truth for the pre-written sections.
-->
