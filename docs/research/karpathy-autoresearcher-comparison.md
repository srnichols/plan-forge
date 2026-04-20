# Plan-Forge vs. Karpathy's Loop, Auto-Researcher, and Recursive Self-Improvement

> **Type**: Research & analysis report
> **Status**: Draft v1
> **Date**: April 2026
> **Scope**: Compare Plan-Forge's architecture against three external agentic-AI paradigms — Karpathy's "LLM-OS" loop, Auto-Researcher (Sakana AI Scientist lineage), and recursive self-improvement (RSI) agents (Reflexion, Voyager, STOP, Darwin Gödel Machine).

---

## TL;DR

Plan-Forge already implements **~70%** of the primitives these external systems pioneered — deterministic agent loop, multi-tier memory, quorum voting, telemetry-driven feedback, and verifiability gates. Where it is deliberately conservative is the **self-modifying** dimension: Plan-Forge measures, warns, and escalates, but it does not yet mutate its own plans, prompts, skills, or gates. That's both a safety feature (Karpathy's "verifiability" doctrine) **and** the single largest expansion frontier. Three concrete lessons to import:

1. **Voyager-style auto-generated skill library** from successful slices.
2. **Reflexion-style verbal-memory feedback** injected into the next slice prompt.
3. **Darwin-Gödel-style competitive slice re-runs** on top of the existing `[P]` quorum infrastructure.

---

## 1. External paradigms — what they actually are

### 1a. Karpathy's Loop (the "LLM-OS" view)

Across Karpathy's *Intro to LLMs*, *State of GPT*, *Software 2.0*, and his 2025 blog posts (*Verifiability*, *The append-and-review note*, *Animals vs Ghosts*, *2025 LLM Year in Review*), he consistently frames an agent as:

```
  ┌──► perceive (context window = RAM)
  │      │
  │      ▼
  │    think  (LLM forward pass = CPU cycle)
  │      │
  │      ▼
  │    act   (tool call = syscall)
  │      │
  │      ▼
  └── observe (tool result appended to context)
```

Key tenets from his recent writing:

- **Context engineering > prompt engineering** — the artifact is the assembled context, not the prompt string.
- **Verifiability** (Nov 2025) — agents succeed where outcomes are mechanically checkable (tests, compilers, runtimes). Unverifiable domains are where they still fail.
- **Append-and-review** — human-like iterative refinement beats one-shot generation.
- **LLMs as "ghosts"** — statistical shadows of human writing; they need scaffolding, not autonomy.

### 1b. Auto-Researcher (Sakana "AI Scientist" lineage)

The archetype is Sakana's *The AI Scientist* (Aug 2024) and *AI Scientist v2* (2025):

```
idea generation → novelty check → experiment code → run → analysis → write paper → reviewer agent → iterate
```

Core ideas:

- **Open-ended hypothesis generation** with novelty filters against prior work.
- **Tree-search over research directions** (not linear).
- **Reviewer-agent self-critique** as the reward signal in the absence of ground truth.
- **Automated write-up** closes the loop — the artifact (paper) is both output and memory.

Related projects: AutoResearcher (lit-review automation), GPT Researcher, Elicit-style deep-research systems.

### 1c. Recursive Self-Improvement (RSI) agents

A spectrum from scripted to radical:

| System | Mechanism | What it modifies |
|---|---|---|
| **AutoGPT / BabyAGI** (2023) | goal → subtask decomposition → task queue | Task list only |
| **Reflexion** (Shinn et al. 2023) | verbal self-critique stored as episodic memory, replayed next attempt | *Prompt / memory* |
| **Voyager** (Wang et al. 2023, Minecraft) | skill library: successful code snippets saved and retrieved by embedding | *Tool / skill set* |
| **Tree of Thoughts** / **Reasoner** | branch + evaluate + prune during a single task | Reasoning trace |
| **STOP** (Zelikman et al. 2023) | scaffolding program rewrites itself to improve downstream-task scores | *Scaffolding code* |
| **Darwin Gödel Machine** (Sakana, 2025) | parent agent spawns mutated children, evaluated on SWE-bench, keeps winners | *Agent source code* |
| **Gödel Agent** | formal self-reference with proof obligations | Agent + its proof of improvement |

The shared structural primitive:

```
evaluate → reflect → mutate → select → persist
```

Different systems choose *what* is mutated: memory, prompts, tools, code, or proofs.

---

## 2. The shared primitive set

Extracting the union of primitives across all three paradigms:

1. **Perception / context assembly** — what goes into the prompt
2. **Action / tool use** with **verifiable outcomes**
3. **Episodic memory** — prior attempts retrievable
4. **Skill / procedural memory** — reusable tools that grow over time
5. **Self-critique / reviewer** — reflection step
6. **Mutation operator** — the thing that proposes improvements
7. **Selection operator** — the thing that decides which mutation to keep
8. **Provenance / lineage tracking** — which ancestor produced which artifact
9. **Parallel exploration** — branches, quorum, tree-search
10. **Termination / stop condition** — gate, budget, verifier pass

---

## 3. Plan-Forge mapping

| # | Primitive | Plan-Forge implementation | Strength |
|---|---|---|---|
| 1 | Context assembly | [brain.mjs](../../pforge-mcp/brain.mjs) scope routing (`session.* / project.* / cross.*`), [memory.mjs](../../pforge-mcp/memory.mjs) keyword-domain injection, `copilot-instructions.md` auto-load, `forge_capabilities` one-shot surface | **Full** |
| 2 | Verifiable actions | Slice validation gates, `GATE_ALLOWED_PREFIXES` (44 commands) in [orchestrator.mjs](../../pforge-mcp/orchestrator.mjs), forbidden-action hooks, Tempering test minima | **Full** — strongest area; matches Karpathy's verifiability doctrine |
| 3 | Episodic memory | `drift-history.jsonl`, `incidents.jsonl`, `model-performance.json`, `.forge/runs/*/trace.json` | **Full** (but under-retrieved during execution) |
| 4 | Skill / procedural memory | `.github/skills/*/SKILL.md`, [skill-runner.mjs](../../pforge-mcp/skill-runner.mjs) | **Partial** — skills are *human-authored*, not grown from runs (Voyager gap) |
| 5 | Self-critique / reviewer | `step5-review-gate.prompt.md` (Session 3), PostSlice drift hook, `brain.gate-check` responder | **Partial** — exists but session-scoped and advisory, not in-loop |
| 6 | Mutation operator | Plan hardening (Session 2), adaptive escalation chain from `model-performance.json` | **Partial** — mutates *model choice*, not plan / prompt / skill content |
| 7 | Selection operator | DAG topological order (Kahn's), quorum synthesis (≥2 models), gate pass / fail | **Partial** — quorum exists but synthesis not surfaced as voting |
| 8 | Provenance / lineage | Crucible (`crucibleId`, `lane`, `source`), manual-import audit, decimal-semver phases, atomic claims | **Full** — arguably stronger than any external system surveyed |
| 9 | Parallel exploration | `[P]` slice tag + `ParallelScheduler`, quorum parallel workers, hub event bus (port 3101) | **Partial** — parallelism is across *independent* slices; no *competitive* parallelism on the same slice |
| 10 | Termination | Gates, stop conditions in plan frontmatter, Teardown Safety Guard, cost / budget caps | **Full** |

---

## 4. Alignment scorecard

| Capability | External state-of-art | Plan-Forge | Notes |
|---|---|---|---|
| Deterministic agent loop | AutoGPT (loose) | ✅ Full | DAG + gates is stricter than AutoGPT |
| Context engineering | Karpathy doctrine | ✅ Full | `applyTo:` + skill auto-load + brain scopes |
| Verifiability | Karpathy doctrine | ✅ Full | Gates are first-class |
| Episodic reflection in-loop | Reflexion | 🟡 Partial | Drift / incidents logged but not injected into next slice prompt |
| Procedural skill growth | Voyager | ❌ Minimal | Skills authored by humans only |
| Self-authored hypotheses | AI Scientist | ❌ None | Plans authored by humans (by design) |
| Self-modifying code / prompts | DGM, STOP | ❌ None | Plans are read-only during run |
| Tree search over branches | ToT, AI Scientist | 🟡 Partial | `[P]` is parallel-independent, not competitive |
| Reviewer-agent critique | AI Scientist v2 | 🟡 Partial | Session 3 review is out-of-loop |
| Lineage / provenance | DGM | ✅ Full | Crucible surpasses most surveyed systems |
| Multi-agent consensus | Quorum papers | ✅ Full | `--quorum power/speed`, synthesis requires ≥2 |
| Cost / budget awareness | Not standard | ✅ Full | `cost-history.json`, anomaly flags |

**Overall**: Plan-Forge is **ahead** on provenance, verifiability, and cost; **at parity** on context engineering and memory scaffolding; **behind** on in-loop reflection, skill synthesis, and self-modification.

---

## 5. Concrete lessons & opportunities

### L1 — Reflexion-style in-loop critique (low effort, high value)

**Gap**: Drift / incident data exists in `drift-history.jsonl` and `incidents.jsonl` but is only *displayed* post-slice. Reflexion would *inject* the prior failure's critique into the retry prompt.

**Spike**: In [orchestrator.mjs](../../pforge-mcp/orchestrator.mjs) `executeSlice()` retry path, when `attempts > 1`, read the last failure event from the trace and prepend a structured "what went wrong last attempt" block via the same mechanism `buildMemoryCaptureBlock()` uses. Anchor: [memory.mjs](../../pforge-mcp/memory.mjs) `buildMemoryCaptureBlock`.

### L2 — Voyager-style auto-skill library (medium effort, compounding value)

**Gap**: `.github/skills/*/SKILL.md` only grows via human authoring. Voyager's insight was that *every successful action becomes a retrievable skill*.

**Spike**: After a slice passes all gates, extract the command sequence + context signature into `.forge/skills-auto/<hash>.md` with a summary generated by the same worker. Retrieve on future slices via domain-keyword match (the 9-pattern matcher already in [memory.mjs](../../pforge-mcp/memory.mjs) can be extended). Write-gate: only promote to permanent skill after N successful reuses.

### L3 — Competitive quorum ("DGM lite") — high value, infra already ~80% present

**Gap**: Current quorum synthesizes outputs from ≥2 models but treats them as votes on a single answer. DGM / AI-Scientist would **keep the best of N** based on a verifier.

**Spike**: Add `quorum.mode = "competitive"` to `.forge.json`. For a slice tagged `[competitive]`, run the slice in N parallel branches (leveraging existing `ParallelScheduler`), each committing to a scratch branch; then run validation gates on each and fast-forward the winner. Anchors: [orchestrator.mjs](../../pforge-mcp/orchestrator.mjs) quorum logic + Teardown Safety Guard pattern (baseline branch + verify) in [AI-Plan-Hardening-Runbook.md](../plans/AI-Plan-Hardening-Runbook.md).

### L4 — Reviewer-agent in-loop (not just Session 3)

**Gap**: `step5-review-gate.prompt.md` runs once at the end. AI Scientist v2 runs a reviewer *per artifact*.

**Spike**: Extend `brain.gate-check` responder to optionally invoke a cheap reviewer model (speed-quorum) on the slice diff before PostSlice releases the next slice. Advisory at first; blocking when score < threshold. Anchor: existing responder pattern, Phase FORGE-SHOP-06 Slice 06.2 in orchestrator.

### L5 — Plan refinement from execution outcomes ("closed research loop")

**Gap**: Plan hardening is a one-shot Session 2 artifact. After execution, learnings never flow back to improve the next plan.

**Spike**: Emit a `plan-postmortem.json` per run: which slices retried, which gates flapped, which drifted, which cost overshot. Feed this as required context to `step2-harden-plan.prompt.md` on the *next* feature. This is the Karpathy "append-and-review note" applied to planning itself.

### L6 — Adaptive gate synthesis (Tempering intel → actual gates)

**Gap**: Tempering tracks coverage / budgets but gates must still be hand-written.

**Spike**: For slices touching domains with a Tempering profile (domain / integration / controller), auto-append standard gates derived from [tempering.mjs](../../pforge-mcp/tempering.mjs) minima if the plan's slice lacks one. Surface as a *suggestion* first (advisory); promote to auto-inject after human approvals accumulate.

### L7 — Cross-project memory federation

**Gap**: OpenBrain semantic memory is per-project. AI Scientist and DGM assume shared lineage across runs.

**Spike**: Add a `cross.*` scope federation layer in [brain.mjs](../../pforge-mcp/brain.mjs) that queries a configurable list of sibling repos' `.forge/` directories (opt-in, explicit allowlist). Low risk — read-only by design.

### L8 — Verbalized "trajectory memory" per slice

**Gap**: Traces are JSON, optimized for dashboards, not retrieval. Reflexion-style memory is prose.

**Spike**: After each slice, the worker writes a one-paragraph "what I did, what worked, what I'd do differently" note to `.forge/trajectories/<plan>/<slice>.md`. Retrieved by [memory.mjs](../../pforge-mcp/memory.mjs) on future slices in the same plan.

---

## 6. What Plan-Forge intentionally does NOT do — and why that's right

These are **non-goals**, not gaps:

| Excluded pattern | Why Plan-Forge correctly avoids it |
|---|---|
| AutoGPT-style open-ended goal decomposition | Unverifiable drift. PF's DAG + human-authored plan is Karpathy's "verifiability" applied. |
| AI-Scientist-style autonomous hypothesis generation | In a codebase, "hypothesis" = architectural decision. Those need human ownership. The Specify / Harden sessions enforce this. |
| DGM-style self-modifying agent source | Safety boundary. The orchestrator itself should be immutable during a run. Crucible provenance would break otherwise. |
| Fully recursive agent spawning | Cost explosion + debuggability collapse. Bounded `[P]` + quorum gives 80% of the benefit with 0% of the blast radius. |

The right framing: **Plan-Forge is a constrained RSI system where the human owns the mutation operator for plans and skills, and the system owns the mutation operator for model / retry / budget choices.** That is a defensible middle ground.

---

## 7. Recommended next experiments (sized)

1. **Small spike (1 slice)** — L1 Reflexion retry injection. Existing plumbing; ~30 lines in `executeSlice`.
2. **Medium spike (3–5 slice plan)** — L2 auto-skill library + L8 trajectory memory together. These share the same write path.
3. **Large spike (full plan, its own Phase)** — L3 competitive quorum. Requires new scheduler mode, branch management, and gate-per-branch evaluation. High payoff — this is where Plan-Forge becomes a *search* system rather than a *pipeline*.

---

## Summary in one sentence

Plan-Forge's DAG-plus-gates architecture already embodies Karpathy's verifiability doctrine better than most agent frameworks, has provenance that exceeds the Darwin Gödel Machine, and has ~80% of the infrastructure needed to add Reflexion-style in-loop reflection and Voyager-style skill growth without compromising its human-in-the-loop safety posture.

---

## References

- Karpathy, A. — *karpathy.bearblog.dev/blog/* (2025 posts: *Verifiability*, *Animals vs Ghosts*, *2025 LLM Year in Review*)
- Karpathy, A. — *Intro to Large Language Models*, *State of GPT* (Microsoft Build 2023)
- Sakana AI — *The AI Scientist* (2024), *The AI Scientist v2* (2025), *Darwin Gödel Machine* (2025)
- Shinn et al. — *Reflexion: Language Agents with Verbal Reinforcement Learning* (2023)
- Wang et al. — *Voyager: An Open-Ended Embodied Agent with Large Language Models* (2023)
- Zelikman et al. — *Self-Taught Optimizer (STOP): Recursively Self-Improving Code Generation* (2023)
- Yao et al. — *Tree of Thoughts* (2023)
