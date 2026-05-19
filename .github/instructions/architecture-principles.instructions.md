---
description: Core architecture principles — Architecture-First Approach, Separation of Concerns, TDD, Best Practices over Quick Wins. READ BEFORE any code changes.
applyTo: '**'
priority: critical
---

# Architecture-First Engineering Principles

> **Priority**: CRITICAL — Read before ANY code changes
> **Applies to**: ALL files

---

## AI Agent Instructions

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  STOP! Before writing ANY code, you MUST:                                   │
│                                                                             │
│  1. ✅ Read this file (architecture-principles.instructions.md)             │
│  2. ✅ Follow the Decision Framework below                                  │
│  3. ✅ Apply Separation of Concerns                                         │
│  4. ✅ Consider TDD for business logic                                      │
│  5. ✅ Check existing patterns first (DON'T reinvent)                       │
│                                                                             │
│  🚨 RED FLAGS that MUST stop you:                                           │
│  ❌ "quick fix" → STOP, find proper solution                                │
│  ❌ "copy-paste" → STOP, create reusable abstraction                        │
│  ❌ "skip types" → STOP, add proper types                                   │
│  ❌ "we'll refactor later" → STOP, do it right now                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## The 5 Questions Before Writing ANY Code

### 1. Does this code BELONG in this file/layer?

| Layer | Responsibility |
|-------|---------------|
| **Controllers / Routes** | HTTP handling only — no business logic |
| **Services** | Business logic only — no data access |
| **Repositories / Data Access** | Database queries only — no business rules |
| **Components / Views** | UI rendering only — no side effects |

### 2. Does a PATTERN already exist for this?

- Search existing codebase for similar functionality
- Check `.github/instructions/*.instructions.md` files
- Follow existing patterns — don't create new approaches

### 3. Will this SCALE appropriately?

- Consider high-volume data scenarios
- Consider concurrent users
- Consider future feature additions

### 4. Is this TESTABLE?

- Can business logic be unit tested in isolation?
- Are dependencies injectable?
- Are side effects isolated and mockable?
- **Have I written the test first?** (TDD for business logic)

### 5. HOW will this FAIL?

- What if the database is unavailable?
- What if the API returns an error?
- What if the user provides invalid input?
- Add proper error handling for ALL failure modes

---

## Separation of Concerns

### The 4-Layer Architecture

```
┌─────────────────────────────┐
│  PRESENTATION               │  Components, Pages, Views
│  (render UI, handle events) │  ❌ No business logic
├─────────────────────────────┤
│  API / CONTROLLERS          │  Routes, Endpoints
│  (HTTP handling only)       │  ❌ No business logic, no SQL
├─────────────────────────────┤
│  SERVICES                   │  Business Logic
│  (validation, orchestration)│  ❌ No SQL, no HTTP
├─────────────────────────────┤
│  DATA ACCESS                │  Repositories, ORM queries
│  (database operations only) │  ❌ No business rules
└─────────────────────────────┘
```

---

## Non-Negotiable Best Practices

### Type Safety
- **No `any`** (TypeScript) / **No `dynamic`** (C#) / **No `Any`** (Python) when type is known
- Explicit types on function signatures
- Use generics over type assertions

### Error Handling
- No empty catch blocks — always log or handle
- Use typed error classes, not generic exceptions
- Return structured error responses (RFC 7807 ProblemDetails or equivalent)

### Async Patterns
- All I/O operations must be async
- Never block on async operations (no `.Result`, `.Wait()`, `asyncio.run()` in async context)
- Support cancellation where the platform provides it

### Security
- Parameterized queries — never string interpolation in SQL
- Input validation at system boundaries
- No secrets in code — use environment variables or secret managers

### Testing
- TDD for business logic: Red → Green → Refactor
- Integration tests for data access
- E2E tests for critical user flows

---

## Decision Framework

```
New code needed?
  │
  ├─ Does it exist already? → YES → Reuse it
  │                          → NO ──┐
  │                                  │
  ├─ Which layer? ──► Controller (HTTP) │ Service (logic) │ Repository (data) │ Component (UI)
  │                                  │
  ├─ Does a pattern exist? → YES → Follow the pattern
  │                         → NO → Create pattern, document in instructions.md
  │
  ├─ Is it testable? → NO → Refactor until it is
  │
  └─ How will it fail? → Add error handling for each case
```

---

## Code Review Checklist

Before suggesting code changes, verify:

- [ ] Code is in the correct layer
- [ ] Follows existing patterns
- [ ] All types explicit (no `any`/`dynamic`/`object`)
- [ ] Error handling is comprehensive
- [ ] Input validated at boundaries
- [ ] Tests included for new features
- [ ] No sync-over-async patterns
- [ ] Security best practices followed

---

## Temper Guards

Common shortcuts agents take that still produce compiling code but erode architecture quality:

| Shortcut | Why It Breaks |
|----------|--------------|
| "Putting this logic in the controller is simpler" | Controllers become untestable God objects. Business logic belongs in services where it can be unit tested without HTTP plumbing. |
| "One service can handle both concerns" | Violates Single Responsibility. When requirements diverge, the combined service becomes a maintenance bottleneck with tangled dependencies. |
| "We'll refactor to the proper layer later" | Later never comes. Every shortcut trains the next agent session to copy the wrong pattern. Do it right now — it takes the same number of lines. |
| "This is a one-off, patterns don't apply" | One-offs multiply. The next developer (or agent) sees the exception and copies it. Follow the pattern even for one-offs. |
| "Adding an interface for one implementation is over-engineering" | Interfaces enable testing, future swaps, and dependency injection. The cost is one file — the benefit is permanent testability. |
| "I'll skip the repository and query directly from the service" | Services with data access can't be unit tested without a database. The repository boundary exists to make testing fast and reliable. |
| "Hardcoding a string from a stable-small-set in code?" | STOP — import from `pforge-mcp/enums.mjs`. Hook names, quorum modes, model tiers, cost sources, watcher modes, and error codes all have canonical frozen arrays there. Hand-typed literals drift silently; the frozen arrays are checked by CI guards. |
| "It's only two copies — I'll deduplicate later if a third appears" | **DRY violation.** Two is already enough to drift. The Phase 41 enums-centralization had to chase the same string literals across 50+ files because two became four became fifty over time. If the same value, regex, or 3+ line block appears in two places, extract to a named constant or helper **now** — the cost is one symbol; the benefit is one place to fix bugs. Run `/clean-code-review` to surface duplicates via `jscpd`. |

### Tool-surface (ACI) temper guards

When designing or modifying any MCP tool surface (`forge_*` handlers, output payloads, schemas), watch for these shortcuts. Empirically validated against the SWE-agent ACI principle: the agent only performs as well as the surface lets it.

| Shortcut | Why It Breaks |
|----------|--------------|
| "Return the full object to be safe" | Unbounded payloads (30KB+ snapshots, 10K-event captures) blow agent context budgets and cause the agent to skip later tool calls or hallucinate to fit. **Fix**: return summary counts/status by default; offer a `drill` / `verbose` opt-in for details. |
| "Raw CLI output is good enough" | Silent success or empty stdout is ambiguous to the agent — it cannot tell "no findings" from "command failed quietly". **Fix**: post-process to inject an explicit positive message (`"No markers found. Code is complete!"`) or structured `{ ok: true, count: 0 }`. |
| "Pagination is too hard; return all" | Tools like `forge_run_plan`, `forge_diagnose`, and `forge_home_snapshot` can return arbitrarily large activity logs. **Fix**: always paginate with `limit` + `cursor` + `hasMore`; pick a small default (10–25). |
| "Empty response means nothing happened" | A bare `{ hits: [], total: 0 }` reads as failure to most agents. **Fix**: include a `message` field describing what was searched, what filters were active, and how to broaden the query. |
| "I'll add the field, agent will figure it out" | Undocumented response fields force the agent to guess. **Fix**: every new payload field must appear in the tool's `description`, `inputSchema`, and the `TOOL_METADATA.example.output`. |

**Reference standard**: `forge_search` is the gold standard ACI surface — bounded 80-char snippets, sparse fields (`{ source, recordRef, snippet, score, timestamp }`), `total` + `truncated` for pagination metadata, and a friendly `message` on the empty path. Pattern-match new tool refactors against it.

---

## Warning Signs

Observable patterns indicating these principles are being violated:

- A controller method contains database queries or ORM calls (bypassed service + repository layers)
- A service imports HTTP-specific types like `HttpContext`, `IActionResult`, or status codes (leaking HTTP into business logic)
- A repository contains `if/else` business rules, calculations, or validation beyond query construction (business logic in data access)
- A single file handles both routing and data persistence (collapsed layers)
- A new utility/helper class created for a one-time operation (premature abstraction — inline it)
- A class has more than 10 public methods or exceeds 300 lines (God object forming)
- A method accepts more than 5 parameters (missing a model or configuration object)
- Test files are absent for new service or repository classes (TDD skipped)
- A new MCP tool returns more than ~10KB of JSON in its happy path with no opt-in flag (unbounded ACI surface — paginate or summarize)
- A new MCP tool returns silent empty results (`{ hits: [] }` with no `message` field) when filters match nothing (ambiguous to agents)

---

## Clean Architecture Principles

These principles extend the 4-layer model above with deeper structural guidance from *Clean Architecture* (Robert C. Martin).

### Dependency Rule

Source-code dependencies MUST point only inward — toward higher-level policies:

```
Outer  (Frameworks / Drivers / UI)
  →  Interface Adapters  (Controllers, Gateways, Presenters)
    →  Application Business Rules  (Use Cases / Services)
      →  Core  (Enterprise Business Rules / Entities)
```

Nothing in an inner circle may know anything about an outer circle. Data crossing a boundary must be in a form convenient for the inner circle — never raw framework types such as `Request`, `Response`, or ORM models.

**In Plan Forge**: tool handlers (`forge_*`) are at the interface-adapter layer. They depend on `hub.mjs` and `memory.mjs` (inner). They MUST NOT depend on the orchestrator (peer layer). The orchestrator depends on tools, not the reverse.

### SOLID Principles

| Principle | Rule | Violation to Watch |
|-----------|------|--------------------|
| **S** — Single Responsibility | A module has one reason to change (one actor owns it) | God files, services that both validate and persist |
| **O** — Open/Closed | Open for extension, closed for modification | Chains of `if/else`/`switch` on type instead of polymorphism |
| **L** — Liskov Substitution | Subtypes must be substitutable for their base types | Overrides that throw, or that narrow accepted input |
| **I** — Interface Segregation | Clients must not depend on methods they do not use | Fat interfaces forcing consumers to stub unused members |
| **D** — Dependency Inversion | High-level policy must not depend on low-level detail — both depend on abstractions | Service importing a concrete ORM class directly |

### Boy Scout Rule

> "Leave the code cleaner than you found it." — Robert C. Martin

Every commit that touches a file must leave it in a better state: rename a confusing variable, extract a guard clause, add a missing type, delete a dead comment. Accumulated Boy Scout passes are how large-scale cleanup happens safely without dedicated refactor sprints.

**Corollary**: If you are forced to touch a file that has an active ESLint error (`complexity-error`, `max-lines-per-function-error`), fix that error in the same commit.

**Corollary**: Do not introduce new violations in a file you are already cleaning. A PR that removes one `complexity-error` and adds another is net-zero, not Boy Scout compliant.

### Component Cohesion

Three principles govern which modules belong together in a deployable component:

| Principle | Statement | When it applies |
|-----------|-----------|-----------------|
| **REP** — Reuse/Release Equivalence | The granule of reuse is the granule of release. Group code that is released and versioned together. | Package / library design |
| **CCP** — Common Closure Principle | Classes that change for the same reasons and at the same times belong in the same component. | Application component boundaries |
| **CRP** — Common Reuse Principle | Do not depend on things you do not use. Split components that force consumers to redeploy for irrelevant changes. | Component splitting decisions |

In Plan Forge the MCP tool surface, the orchestrator business logic, and the memory persistence layer are three distinct CCP components. A change to the memory schema should not force a redeployment of all 100+ tool handlers.

### Stable Dependencies Principle

**Depend in the direction of stability.** Stable components (low change frequency, many dependents) should be depended upon by volatile components (high change frequency, few dependents).

Stability metric: `I = fan-out / (fan-in + fan-out)`
- `I = 0` → maximally stable (depended upon by many, depends on nothing)
- `I = 1` → maximally volatile (depends on many, nothing depends on it)

Guardrail: if component A is more volatile than component B (`I_A > I_B`), A may depend on B but B must never depend on A. Violating this means a change to A propagates to B unexpectedly.

### Professional Refusal

A professional practitioner's obligation to say **"no"** clearly when:

- A requested timeline makes quality impossible. (Lying about an estimate is unprofessional; the correct answer is the true estimate with an explanation of the tradeoff.)
- A shortcut would violate a non-negotiable principle in this file. (Citing the principle is the correct response, not silent compliance.)
- Pressure to skip tests, skip review, or deploy untested code is applied ("just this once").
- The requester frames urgency as permission to skip quality steps.

**"No" is a complete answer.** Propose the real path forward with an honest timeline. Accepting an impossible deadline as if it were achievable does not help the project — it accumulates hidden debt that surfaces at the worst possible moment.

**In agent context**: if a plan slice instructs you to violate a principle in this file, emit a Blocker Report (see `status-reporting.instructions.md`) and halt. Do not comply silently.

---

## Clean Code Standards (Phase 42 Catalog)

> **Reference**: *Clean Code* (Robert C. Martin) — the conceptual baseline for the guardrails in this section.
> **Audit source**: Phase 42 Clean-Code Audit catalog — 27 actionable findings across 6 categories.
> See `docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md` for the full finding set.
> **Detailed guardrails**: `.github/instructions/clean-code.instructions.md` (function rules, naming, commenting, PR checklist).

Active guardrails derived from the Phase 42 audit:

| Category | Guard |
|----------|-------|
| **Module Size — high (A-series)** | No file may exceed 3,000 LOC. Extract sub-modules, split by Single Responsibility. |
| **Module Size — medium (B-series)** | Files 1,000–3,000 LOC must be monitored; extract on the next feature addition to that file. |
| **Long Parameter Lists (C-series)** | Functions with ≥4 positional parameters MUST wrap args in an options object (*Clean Code* Ch. 3: "Dyadic and Triadic Functions"). |
| **ESLint Errors (D-series)** | All `complexity-error` violations in `orchestrator.mjs` and `server.mjs` are **blocking** — fix before any release gate. |
| **ESLint Warnings (E-series)** | Batch-fix by rule; prioritise `complexity-warn` first, then nesting depth. |
| **Console.log advisory (F-series)** | Every `console.log` must be intentional CLI output. Debug leakage is a warning sign; audit with each PR. |
