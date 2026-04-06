# Phase 14: Community Walkthroughs — Greenfield + Brownfield Worked Examples

> **Status**: 🟡 HARDENED — Ready for execution  
> **Estimated Effort**: 3 hours (3 execution slices)  
> **Risk Level**: Low (docs-only, no code changes to framework)  
> **Branch**: `feature/community-walkthroughs`  
> **Quorum**: Auto

---

## Overview

Create two end-to-end worked examples showing Plan Forge in real-world scenarios: a greenfield project (build from scratch) and a brownfield project (add guardrails to existing code). These complement the existing QUICKSTART-WALKTHROUGH.md (which covers a trivial health endpoint) by showing realistic, multi-slice features with actual problems and solutions.

---

## Prerequisites

- [x] QUICKSTART-WALKTHROUGH.md exists and is complete
- [x] 5 demo scripts exist in docs/demos/
- [x] Example plan files exist for all 5 stacks

## Acceptance Criteria

- [ ] Greenfield walkthrough: full pipeline from `setup.ps1` to shipped feature (~2000 words)
- [ ] Brownfield walkthrough: adding Plan Forge to existing messy codebase (~2000 words)
- [ ] Both walkthroughs reference real commands, real file paths, real output
- [ ] Examples page (docs/examples.html) updated with links to walkthroughs
- [ ] README.md references the new walkthroughs
- [ ] CHANGELOG.md updated

---

## Scope Contract

### In Scope
- `docs/walkthroughs/greenfield-todo-api.md` — build a Todo API from scratch
- `docs/walkthroughs/brownfield-legacy-app.md` — add Plan Forge to existing Express app
- `docs/examples.html` — add walkthrough cards/links
- `README.md` — add walkthroughs section
- `CHANGELOG.md` — entry

### Out of Scope
- No framework code changes
- No new MCP tools
- No new skills or presets

### Forbidden Actions
- Do NOT modify setup.ps1/setup.sh
- Do NOT modify any preset files
- Do NOT modify MCP server code

---

## Execution Slices

### Slice 1: Greenfield Walkthrough [sequential]

Create `docs/walkthroughs/greenfield-todo-api.md` — a complete worked example building a Todo API using Plan Forge + TypeScript preset.

**Structure**:
1. **Setup** — `setup.ps1 -Preset typescript -ProjectName TodoTracker`
2. **Step 0: Specify** — Interview answers for a Todo CRUD API
3. **Step 2: Harden** — Show the resulting hardened plan with 3 slices
4. **Step 3: Execute** — Walk through each slice with real code snippets
5. **Step 5: Review** — Show review findings (1 warning: missing rate limiting)
6. **Lessons** — What the user learned, what to do next

**Key teaching moments**:
- How guardrails auto-load (editing a route → api-patterns loads)
- How validation gates catch real errors (build fails, fix, re-run)
- How the scope contract prevents drift
- How consistency scoring works

**Validation Gate**: File exists, >1500 words, contains all 6 pipeline steps

**Depends On**: None

---

### Slice 2: Brownfield Walkthrough [sequential]

Create `docs/walkthroughs/brownfield-legacy-app.md` — adding Plan Forge to a messy Express.js project with no tests, SQL injection, and hardcoded secrets.

**Structure**:
1. **The Mess** — describe a typical legacy Express app (no types, raw SQL, .env committed)
2. **Setup** — `setup.ps1 -Preset typescript -ProjectPath ./legacy-app -AutoDetect`
3. **Smith First** — run `pforge smith` to see the problems
4. **Security Audit** — use `/security-audit` to find the SQL injection and hardcoded secrets
5. **Plan the Fix** — create a hardening plan (3 slices: fix SQL injection, move secrets, add tests)
6. **Execute** — walk through slices with before/after code
7. **Measure** — show consistency score improving from 0 to 85

**Key teaching moments**:
- How Plan Forge works on existing code (not just new projects)
- How security-audit finds real vulnerabilities
- How to incrementally improve a codebase with sliced plans
- The value of consistency scoring for brownfield projects

**Validation Gate**: File exists, >1500 words, contains security-audit usage

**Depends On**: Slice 1

---

### Slice 3: Wire into Docs + README + Changelog [sequential]

**Tasks**:
1. Update `docs/examples.html` to add walkthrough cards linking to the new docs
2. Update `README.md` to reference walkthroughs in the Getting Started section
3. Update `CHANGELOG.md`

**Validation Gate**: examples.html references both walkthroughs, README links to walkthroughs

**Depends On**: Slices 1, 2

---

## Definition of Done

- [ ] 2 walkthrough files created (greenfield + brownfield)
- [ ] docs/examples.html updated
- [ ] README.md updated
- [ ] CHANGELOG.md updated
- [ ] All validation gates passed
- [ ] Reviewer Gate passed (zero 🔴 Critical)

---

## Stop Conditions

- ❌ Framework code modified (scope violation)
- ❌ Walkthrough references non-existent commands or files
- ❌ Security vulnerabilities in example code (even in "before" examples, mark clearly as vulnerable)
