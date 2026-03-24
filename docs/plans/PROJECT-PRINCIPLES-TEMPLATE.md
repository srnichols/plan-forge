# Project Principles

> **Purpose**: Declares the non-negotiable principles, commitments,
> and boundaries for this project. Referenced by the AI Plan Hardening
> Pipeline to validate plans and detect drift against project intent.
>
> **How created**: Run `.github/prompts/project-principles.prompt.md` for a
> guided workshop, or fill in manually.
>
> **How used**: Auto-loaded by Project Principles instruction file. Referenced
> in Step 1 (Preflight), Step 2 (Harden), and Step 5 (Review).

---

## Project Identity

**What this project is** (one sentence):
> (e.g., "A multi-tenant SaaS platform for managing healthcare appointments")

**What this project is NOT**:
> (e.g., "Not a general-purpose scheduling tool — healthcare-specific only")

---

## Core Principles (3–7, non-negotiable)

| # | Principle | Rationale | Violated When |
|---|-----------|-----------|---------------|
| 1 | (e.g., All data access through repositories) | (why this matters) | (concrete example of violation) |
| 2 | (e.g., No ORM magic — explicit SQL only) | | |
| 3 | (e.g., Multi-tenant isolation at every layer) | | |

---

## Technology Commitments

Locked-in choices that are NOT up for discussion during execution:

| Category | Commitment | Alternatives Rejected |
|----------|-----------|----------------------|
| Language | (e.g., C# 14 / .NET 10) | |
| Database | (e.g., PostgreSQL 17) | |
| ORM/Data | (e.g., Dapper — no EF Core) | |
| Testing | (e.g., xUnit + Testcontainers) | |
| Frontend | (e.g., Blazor Server) | |

---

## Quality Non-Negotiables

| Metric | Target | Enforcement |
|--------|--------|-------------|
| Test coverage | (e.g., 90%+ on business logic) | CI gate |
| Build time | (e.g., <60s local, <5min CI) | Monitored |
| Response time | (e.g., P95 <200ms for API) | Load test |
| Accessibility | (e.g., WCAG 2.2 AA) | Reviewer agent |

---

## Forbidden Patterns

Never acceptable, regardless of context or time pressure:

| # | Pattern | Why Forbidden |
|---|---------|--------------|
| 1 | (e.g., String interpolation in SQL) | SQL injection risk |
| 2 | (e.g., Sync-over-async (.Result, .Wait())) | Deadlock risk |
| 3 | (e.g., Secrets in code or config files) | Security breach |
| 4 | (e.g., Empty catch blocks) | Silent failures |

---

## Governance

**How are these project principles amended?**
> (e.g., "Requires a Pull Request with human review. No AI-only amendments.")

**Who can amend them?**
> (e.g., "Project lead or team consensus")

**When were they last reviewed?**
> (date)
