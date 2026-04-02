# Plan Forge Analysis: Prompt Engineering Gaps & Enhancement Opportunities

> **Date**: 2026-04-01  
> **Analyst**: GitHub Copilot (Claude Opus 4.6)  
> **Scope**: Compare Plan Forge v1.2.0 against Anthropic's latest Claude Opus 4.6 prompt engineering best practices + general spec-driven development patterns  
> **Goal**: Identify gaps and enhancements that would help Plan Forge produce better specs, tighter hardened plans, and higher-quality code output with efficient token usage

---

## Executive Summary

Plan Forge is already a strong framework — the 7-step pipeline, 4-session isolation, mandatory template blocks, and two-layer guardrail model are well-designed. However, comparing the framework against Anthropic's latest prompt engineering guidance for Claude Opus 4.6 reveals **12 high-value enhancement opportunities** across three categories: spec quality, plan hardening fidelity, and token efficiency. None require architectural changes — they're refinements to existing prompts, new optional techniques, and alignment updates for the Claude 4.6 model family.

---

## Category 1: Spec Quality (Step 0 — Specify)

### Gap 1.1 — No XML Structuring in Specification Output

**What's missing**: Step 0 produces a free-form specification block, but Anthropic's guidance emphasizes that Claude Opus 4.6 parses XML-tagged content **unambiguously**. The specification output should use consistent XML tags so downstream steps (Harden, Execute, Review) can extract sections reliably without re-parsing prose.

**Why it matters**: When the Hardening Agent (Step 2) reads the spec, it has to infer which paragraph is "Acceptance Criteria" vs "Edge Cases." With XML tags, extraction is deterministic. This also reduces misinterpretation tokens — Claude doesn't waste reasoning on "is this an acceptance criterion or an edge case?"

**Enhancement**: Wrap the Step 0 output in structured tags:

```xml
<specification>
  <problem_statement>...</problem_statement>
  <user_scenarios>
    <scenario id="1">...</scenario>
  </user_scenarios>
  <acceptance_criteria>
    <criterion id="AC-1">...</criterion>
  </acceptance_criteria>
  <edge_cases>...</edge_cases>
  <out_of_scope>...</out_of_scope>
  <open_questions>...</open_questions>
</specification>
```

**Impact**: Medium. Reduces ambiguity in Step 2, saves ~5-10% tokens on re-interpretation.

---

### Gap 1.2 — No Few-Shot Examples in Step 0 Prompt

**What's missing**: Anthropic's guidance says "3–5 well-crafted examples dramatically improve accuracy and consistency." The Step 0 prompt template has no embedded examples of what a good spec looks like vs a bad one. The QUICKSTART-WALKTHROUGH has example *answers*, but those aren't in the prompt itself.

**Why it matters**: Without inline examples, each user gets a different quality of spec depending on how they phrase their answers. A bad spec produces a bad plan, which cascades through the entire pipeline. Claude Opus 4.6 generalizes excellently from examples — this is one of the highest-ROI changes.

**Enhancement**: Add 1-2 concise examples (wrapped in `<examples>` tags per Anthropic guidance) directly in the `step0-specify-feature.prompt.md` template showing:
- A **good** spec (clear acceptance criteria, concrete edge cases, tight scope)
- A **weak** spec (vague criteria, no edge cases, open-ended scope) with annotations showing why it's weak

**Impact**: High. Directly improves the quality of every spec that enters the pipeline.

---

### Gap 1.3 — No Structured Acceptance Criteria Format

**What's missing**: Acceptance criteria in Step 0 are free-text. Industry-standard formats like "Given/When/Then" (BDD) or "MUST/SHOULD/MAY" (RFC 2119) give Claude a tighter structure to work with and make validation gates in Step 3 more mechanically derivable.

**Why it matters**: Vague acceptance criteria like "Response time should be fast" can't be turned into validation gates. "GET /health MUST return 200 with `{status: healthy}` within 50ms" can. Claude Opus 4.6 excels at following structured patterns — give it one, and every spec will be testable.

**Enhancement**: Add an optional format guide in Step 0:

```
Express acceptance criteria in testable format:
- MUST: non-negotiable requirements (become validation gates)
- SHOULD: expected behavior (become test cases)
- MAY: optional enhancements (become future scope)
Example: "GET /health MUST return 200 OK with JSON body {status: 'healthy'}"
```

**Impact**: High. Directly translates to better validation gates in Step 3 and clearer review criteria in Step 5.

---

### Gap 1.4 — No Complexity Estimation in Step 0

**What's missing**: Step 0 doesn't ask the user (or Claude) to estimate complexity. The pipeline guidance table in the Instructions file says "skip pipeline for micro changes, full pipeline for medium+", but there's no mechanism to route the output of Step 0 into the right track.

**Enhancement**: Add a complexity classification at the end of Step 0 that maps to the pipeline guidance:

```
Based on this specification, classify the work:
- Micro (<30 min, 1 file): → Direct commit, skip pipeline
- Small (30-120 min, 1-3 files): → Light hardening only
- Medium (2-8 hrs, 4-10 files): → Full pipeline
- Large (1+ days, 10+ files): → Full pipeline + branch-per-slice
```

**Impact**: Medium. Prevents over-engineering small features and under-engineering large ones.

---

## Category 2: Plan Hardening Fidelity (Step 2)

### Gap 2.1 — No "Context Files Budget" Awareness in Slice Definitions

**What's missing**: Each execution slice lists "Context Files" — the instruction files the agent must load. But there's no guidance on context budget impact. Anthropic's guidance warns that Claude Opus 4.6 does significantly more upfront exploration than previous models, and large context files eat into the working space.

**Why it matters**: A slice that loads `architecture-principles.instructions.md` (applyTo: '**'), `database.instructions.md`, `testing.instructions.md`, `security.instructions.md`, AND the full plan file could consume 30-40% of the context window before any code is generated. This causes late-slice degradation where Claude "forgets" earlier context.

**Enhancement**: Add a "Context Budget" field per slice in the hardening template:

```markdown
**Context Files** (estimated ~2,500 tokens):
- docs/plans/Phase-N-PLAN.md (Scope Contract section only)
- .github/instructions/database.instructions.md
- .github/instructions/testing.instructions.md
```

Also add guidance in the hardening prompt: "For each slice, list only the instruction files relevant to that slice's work. Do not load all 15 instruction files — load only those whose domain matches the slice's tasks. Reference only the Scope Contract and Stop Conditions from the plan, not the full plan file."

**Impact**: High. Directly reduces token waste and prevents late-slice context degradation.

---

### Gap 2.2 — No "Thinking Budget" Guidance for Claude 4.6

**What's missing**: Anthropic's latest guidance introduces the `effort` parameter and adaptive thinking for Claude 4.6. Plan Forge prompts don't reference these. Claude Opus 4.6 "does significantly more upfront exploration than previous models, especially at higher effort settings" — which means hardening prompts that were optimal for earlier models may now cause over-thinking.

**Why it matters**: The hardening prompt says things like "identify NON-GOALS", "identify REQUIRED DECISIONS", "identify FORBIDDEN ACTIONS" — these are strong imperative instructions that cause Claude 4.6 to think extensively. On a simple feature, this wastes tokens. On a complex one, it's appropriate.

**Enhancement**: Add a "Prompt Tuning" section to the Runbook or CUSTOMIZATION.md:

```markdown
## Claude 4.6 Tuning

If using Claude Opus 4.6 (VS Code Copilot, API, or CLI):

- **Hardening prompts**: These are already thorough. If the model is over-exploring,
  add: "Choose an approach and commit to it. Avoid revisiting decisions unless
  you encounter new information that directly contradicts your reasoning."

- **Execution prompts**: These work well with Claude 4.6's proactive behavior.
  Remove any "MUST" or "CRITICAL" language that was needed for earlier models —
  Claude 4.6 responds to normal prompting and may overtrigger on aggressive language.

- **Review prompts**: No changes needed — read-only audit maps well to Claude 4.6.
```

**Impact**: Medium. Prevents token waste from over-thinking and overtriggering.

---

### Gap 2.3 — Prompts Use Aggressive Language That Overtriggers Claude 4.6

**What's missing**: Anthropic explicitly warns: "Where you might have said 'CRITICAL: You MUST use this tool when...', you can use more normal prompting like 'Use this tool when...'" and "Instructions like 'If in doubt, use [tool]' will cause overtriggering." Plan Forge prompts are full of:
- "STOP immediately"
- "Do NOT invent behavior"
- "MUST re-read the Scope Contract"
- Multiple STOP CONDITIONS in ALL CAPS

**Why it matters**: Claude Opus 4.6 is significantly more responsive to system prompts than previous models. The aggressive language that was necessary to keep Claude 3.5/Opus 4.0 on track will cause Opus 4.6 to:
- Over-halt on minor ambiguities (unnecessary stops)
- Spend excessive thinking tokens re-checking stop conditions
- Generate verbose justifications for why it's continuing (defensive behavior)

**Enhancement**: Create Claude 4.6-optimized variants of the key prompts that use calibrated language:
- Replace "STOP immediately" → "Pause and ask for clarification"
- Replace "Do NOT invent behavior" → "When uncertain, ask rather than assume"
- Replace "You MUST re-read the Scope Contract" → "Re-read the Scope Contract between slices"
- Reduce ALL CAPS usage — Claude 4.6 follows normal casing just as well

This could be implemented as a `--claude46` flag in the prompt templates or as notes in CUSTOMIZATION.md.

**Impact**: High. Reduces unnecessary halts and defensive token spending. Estimated 15-25% token savings on execution prompts.

---

### Gap 2.4 — No Self-Correction Chain for Plan Quality

**What's missing**: Anthropic's guidance says "The most common chaining pattern is self-correction: generate a draft → have Claude review it against criteria → have Claude refine based on the review." Plan Forge does this for *code* (Execute → Sweep → Review) but not for the *plan itself*.

**Why it matters**: The hardened plan is the single most important artifact in the pipeline. Every downstream step depends on it. Yet it's generated in a single pass (Step 2) with no self-review. A malformed Scope Contract or a missing validation gate cascades into execution errors.

**Enhancement**: Add an optional "Plan Self-Review" substep to Step 2:

```markdown
After hardening, perform a PLAN QUALITY CHECK:
1. Does every Execution Slice have at least one validation gate with an exact command?
2. Does every [parallel-safe] slice avoid touching files touched by other slices in the same group?
3. Are all REQUIRED DECISIONS resolved (no TBD remaining)?
4. Does the Definition of Done include "Reviewer Gate passed"?
5. Do the Stop Conditions cover: build failure, test failure, scope violation, and security breach?

If any check fails, revise the plan before outputting.
```

This is lightweight (adds ~100 tokens to the prompt) and catches common hardening mistakes.

**Impact**: High. Catches plan defects before they cascade into execution.

---

## Category 3: Token Efficiency & Code Quality

### Gap 3.1 — No "Long Context" Structuring for Plan Files

**What's missing**: Anthropic's guidance says "Put longform data at the top, above your query, instructions, and examples. Queries at the end can improve response quality by up to 30%." Plan Forge's execution prompt puts the instruction "Read these files first" at the *top*, which is correct — but the files are listed in arbitrary order.

**Why it matters**: When Claude reads the hardened plan (which can be 200+ lines), the Scope Contract (the most important part) should be at the top. But most plan templates put the Overview first, then Prerequisites, then sometimes Scope Contract is buried mid-document.

**Enhancement**: Restructure the plan template to put the most-referenced sections first:

```markdown
## Scope Contract (IN-SCOPE / OUT-OF-SCOPE / FORBIDDEN)
## Stop Conditions
## Execution Slices
## Definition of Done
---
## Overview (background context)
## Prerequisites
## Architecture Decisions
```

This follows Anthropic's "put reference material first, queries last" pattern. The agent's most-needed sections are at the top of its context window.

**Impact**: Medium. Estimated ~10% quality improvement on slice execution fidelity.

---

### Gap 3.2 — No Guidance on Re-Anchoring Token Cost

**What's missing**: The re-anchor checkpoint after every slice tells the agent to "re-read the Scope Contract and Stop Conditions." For a 10-slice plan, that's 10 re-reads of the same content. Anthropic's guidance on context awareness suggests Claude 4.6 can track this internally — you can make re-anchoring lighter.

**Enhancement**: Add a "lightweight re-anchor" option:

```markdown
## Re-Anchor Checkpoint (per-slice)
Quick check (answer yes/no, do not re-read full Scope Contract unless any answer is "no"):
1. All changes in-scope? 
2. Non-goals violated? 
3. Forbidden files touched? 
4. Stop conditions triggered?

If all yes/no answers are clean, proceed. If any violation, re-read full Scope Contract.
```

This saves ~500-1000 tokens per slice on clean executions (which is the common case).

**Impact**: Medium. Saves ~5,000-10,000 tokens on a 10-slice plan with no violations.

---

### Gap 3.3 — No "Investigate Before Answering" Pattern in Execution Prompts

**What's missing**: Anthropic recommends an explicit anti-hallucination directive: "Never speculate about code you have not opened. You MUST read the file before answering." Plan Forge's execution agent prompt doesn't include this.

**Why it matters**: During slice execution, Claude may assume a file's contents based on the plan description rather than actually reading it. This causes subtle bugs — the agent generates code that calls a method signature it assumed exists but doesn't.

**Enhancement**: Add to the Execution Agent Prompt:

```xml
<investigate_before_coding>
Before writing code that depends on an existing file, read that file first.
Never assume a method signature, type name, or import path — verify it.
If the plan references a file you haven't loaded, load it before coding against it.
</investigate_before_coding>
```

**Impact**: High. Prevents the most common source of hallucination-induced bugs in agent coding.

---

### Gap 3.4 — No Overengineering Guard in Execution Prompts

**What's missing**: Anthropic's guidance explicitly warns: "Claude Opus 4.6 has a tendency to overengineer by creating extra files, adding unnecessary abstractions, or building in flexibility that wasn't requested." Plan Forge's execution prompt says "follow the plan as a CONTRACT" but doesn't include the specific anti-overengineering language.

**Why it matters**: Even with a tight Scope Contract, Claude 4.6 may add "helpful" abstractions — a factory pattern when a simple constructor works, a generic base class for one concrete type, or validation for scenarios that can't occur. This adds files, tests, and maintenance burden.

**Enhancement**: Add to the Execution Agent Prompt:

```xml
<implementation_discipline>
Only make changes specified in the current slice. Do not add features, refactor
existing code, add abstractions, or create helpers beyond what the slice requires.
Do not add error handling for scenarios that cannot occur. Do not add docstrings
or annotations to code you did not change. The right amount of complexity is the
minimum needed for the current slice.
</implementation_discipline>
```

**Impact**: High. Prevents scope creep at the implementation level even when the plan is tight.

---

## Category 4: Missing Capabilities

### Gap 4.1 — No Memory-Augmented Planning

**What's missing**: The UNIFIED-SYSTEM-ARCHITECTURE.md describes OpenBrain integration for persistent memory. But Plan Forge itself has no built-in guidance for using Copilot's memory system (`/memories/repo/`) to accumulate lessons across phases. The COPILOT-VSCODE-GUIDE.md mentions memory bridging between sessions, but doesn't standardize what gets captured.

**Enhancement**: Add a "Memory Capture Protocol" to Step 6 (Ship):

```markdown
## Memory Capture (Step 6)

After shipping, save to /memories/repo/:
1. `conventions.md` — New patterns discovered (append, don't overwrite)
2. `lessons-learned.md` — What went wrong and the fix (append)
3. `forbidden-patterns.md` — Patterns that caused regressions (append)

Before Step 2 (Harden), search /memories/repo/ for:
- Prior decisions on similar features
- Known anti-patterns for this domain
- Conventions established in earlier phases
```

**Impact**: Medium. Compounds quality over multiple phases — each plan is better than the last.

---

### Gap 4.2 — No Token Budget Estimation Per Phase

**What's missing**: There's no way to estimate whether a hardened plan will fit within a context window before execution starts. A 15-slice plan with heavy context files might exhaust context by Slice 8, requiring a session restart.

**Enhancement**: Add a "Token Budget Estimator" as a post-hardening check:

```markdown
## Token Budget Check (after Step 2)

Estimate total context per slice:
- Base: copilot-instructions.md (~800 tokens)
- Plan file (Scope Contract + current slice): ~1,000 tokens
- Context Files per slice: ~500-2,000 tokens
- Code generated per slice: ~500-3,000 tokens
- Re-anchor overhead: ~200 tokens

If estimated total exceeds 60% of context window for any single slice:
→ Split the slice or reduce Context Files

If total slices × average context > 2× context window:
→ Plan for session break (document in plan: "Session break after Slice N")
```

**Impact**: Medium. Prevents mid-execution context exhaustion.

---

## Priority Matrix

| # | Enhancement | Impact | Effort | Priority |
|---|------------|--------|--------|----------|
| 1.2 | Few-shot examples in Step 0 | High | Low | **P0** |
| 1.3 | Structured acceptance criteria | High | Low | **P0** |
| 2.3 | Calibrate aggressive language for Claude 4.6 | High | Medium | **P0** |
| 2.4 | Plan self-review substep | High | Low | **P0** |
| 3.3 | Anti-hallucination directive in execution | High | Low | **P0** |
| 3.4 | Anti-overengineering guard in execution | High | Low | **P0** |
| 1.1 | XML structuring in spec output | Medium | Medium | **P1** |
| 2.1 | Context budget awareness per slice | High | Medium | **P1** |
| 2.2 | Claude 4.6 thinking/effort guidance | Medium | Low | **P1** |
| 3.1 | Restructure plan template for long context | Medium | Low | **P1** |
| 3.2 | Lightweight re-anchor option | Medium | Low | **P1** |
| 4.1 | Memory-augmented planning protocol | Medium | Medium | **P2** |
| 1.4 | Complexity estimation routing | Medium | Low | **P2** |
| 4.2 | Token budget estimation per phase | Medium | Medium | **P2** |

---

## Strengths Worth Preserving

Before making changes, these aspects of Plan Forge are already well-aligned with Claude 4.6 best practices and should NOT be modified:

1. **4-session isolation** — Maps perfectly to Anthropic's "self-correction chain" and "fresh context eliminates blind spots" guidance. Don't collapse sessions.

2. **Mandatory template blocks** — The 6 blocks (Scope Contract, Required Decisions, Execution Slices, Re-anchor, Definition of Done, Stop Conditions) are an excellent contract format. Don't remove any.

3. **Parallel execution tagging** — `[parallel-safe]` / `[sequential]` maps directly to Claude 4.6's parallel tool execution capabilities.

4. **Completeness Sweep (Step 4)** — This catches the exact failure mode Anthropic describes: "agents frequently introduce deferred-work artifacts during scaffolding." Keep the sweep mandatory.

5. **Two-layer guardrail model** — Universal baseline + project profile is a clean separation. The applyTo-based auto-loading is exactly how instruction files should work.

6. **Pipeline agents with handoffs** — The `handoffs:` frontmatter creating click-through workflow is an elegant UX.

7. **Extension ecosystem** — The `.forge/extensions/` model for sharing guardrails is forward-thinking and scalable.

8. **Worked examples per stack** — The 5 stack-specific examples (TypeScript, .NET, Python, Java, Go) plus the PROJECT-PRINCIPLES-EXAMPLE and PROJECT-PROFILE-EXAMPLE are excellent. They serve as implicit few-shot examples even if not in the prompt itself.

---

## Recommended Implementation Order

**Phase 1 — Quick Wins (P0, 1-2 days)**:
- Add few-shot examples to `step0-specify-feature.prompt.md`
- Add structured acceptance criteria guidance to Step 0
- Add plan self-review checklist to `step2-harden-plan.prompt.md`
- Add anti-hallucination + anti-overengineering directives to `step3-execute-slice.prompt.md`
- Audit all prompts for Claude 4.6 language calibration (soften aggressive language)

**Phase 2 — Structural Improvements (P1, 2-3 days)**:
- Add XML structuring option for spec output
- Add context budget guidance to slice template in Runbook
- Add Claude 4.6 tuning section to CUSTOMIZATION.md
- Restructure plan template ordering (Scope Contract first)
- Add lightweight re-anchor option

**Phase 3 — New Capabilities (P2, 3-5 days)**:
- Add memory capture protocol to Step 6
- Add complexity estimation routing to Step 0
- Add token budget estimation guidelines

---

## Next Steps

Review this analysis together, then decide:
1. Which enhancements to prioritize
2. Whether to implement as new/modified prompt templates or as documentation updates
3. Whether Claude 4.6-specific guidance should be a separate document or integrated into existing files
