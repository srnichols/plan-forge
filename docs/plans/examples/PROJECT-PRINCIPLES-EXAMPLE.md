# Project Principles — Example (Multi-Tenant SaaS Platform)

> **Purpose**: Example of a completed PROJECT-PRINCIPLES.md for a real-world
> multi-tenant SaaS platform built with .NET. Use as a reference when
> filling out your own.
>
> **Note**: This example is anonymized — domain-specific names have been
> replaced with generic equivalents.

---

## Project Identity

**What this project is** (one sentence):
> A multi-tenant SaaS platform that connects service providers with customers through a marketplace, featuring real-time booking, payment processing, and provider management tools.

**What this project is NOT**:
> Not a general-purpose e-commerce platform. Not a CMS. Not a single-tenant application — every feature must account for multi-tenant isolation. An AI agent should never propose single-tenant patterns, skip RLS policies, or suggest Entity Framework Core.

---

## Core Principles (5, non-negotiable)

| # | Principle | Rationale | Violated When |
|---|-----------|-----------|---------------|
| 1 | **Architecture-First** — Ask 5 questions before coding (layer, pattern, scale, testability, failure) | Prevents spaghetti architecture and unplanned complexity | Agent starts writing code without confirming which layer it belongs in |
| 2 | **Separation of Concerns** — Strict 4-layer (Controller → Service → Repository → Component) | Keeps code testable, maintainable, and debuggable | Business logic appears in a controller, SQL appears in a service, or HTTP concerns leak into repositories |
| 3 | **Multi-Tenant Isolation at Every Layer** — Always include tenant context in queries, caching, events, and APIs | Data leakage between tenants is a critical security breach | A query runs without `WHERE tenant_id = @TenantId`, a cache key doesn't include tenant, or an event doesn't carry tenant context |
| 4 | **TDD for Business Logic** — Red → Green → Refactor for all service-layer code | Catches regressions before they ship; forces testable design | A service method is written without a corresponding test, or tests are written after the code |
| 5 | **Best Practices Over Quick Wins** — Enterprise-grade solutions, never cut corners | "Quick fixes" become permanent debt; every shortcut costs 10x to fix later | Agent says "quick fix," "we'll refactor later," or skips error handling for convenience |

---

## Technology Commitments

Locked-in choices that are NOT up for discussion during execution:

| Category | Commitment | Alternatives Rejected |
|----------|-----------|----------------------|
| Language | C# 14 / .NET 10 (nullable ref types enabled) | Older .NET versions, Java, Node.js |
| Database | PostgreSQL with Citus extension (distributed) | SQL Server, MongoDB, MySQL |
| ORM/Data | Dapper (parameterized queries, explicit SQL) | Entity Framework Core (rejected: too much magic, poor Citus compatibility) |
| Caching | StackExchange.Redis with tenant-prefixed keys | In-memory only, Memcached |
| Auth | OpenID Connect (self-hosted identity server) + JWT Bearer | Auth0, Firebase Auth, API keys only |
| Messaging | Dapr pub/sub (NATS JetStream dev, Azure Service Bus prod) | Direct RabbitMQ, raw Azure Service Bus SDK |
| Observability | OpenTelemetry 1.12+ with OTLP export | Application Insights SDK, Datadog agent |
| Testing | xUnit (unit) + MSTest (integration) + NUnit/Playwright (E2E) | Single framework for all |
| Frontend | Blazor Server | React, Angular, Vue |
| GraphQL | HotChocolate 13.x | Apollo, custom implementation |
| Containers | Docker + Kubernetes (Azure Container Apps) | VM deployment, serverless only |

---

## Quality Non-Negotiables

| Metric | Target | Enforcement |
|--------|--------|-------------|
| Unit test coverage | 90%+ on business logic (service layer) | CI gate |
| Integration test coverage | All repository methods + API endpoints | CI gate |
| E2E test coverage | Critical user flows (auth, booking, payment) | Nightly CI |
| Build time | <60s local, <5min CI | Monitored |
| API response time | P95 <200ms for read endpoints | Load test in staging |
| Zero-downtime deploys | Rolling updates with health checks | Kubernetes deployment strategy |
| Security scanning | No Critical/High CVEs in dependencies | `pforge sweep` + Dependabot |

---

## Forbidden Patterns

Never acceptable, regardless of context or time pressure:

| # | Pattern | Why Forbidden |
|---|---------|--------------|
| 1 | String interpolation in SQL (`$"SELECT ... {variable}"`) | SQL injection — use `@Param` parameters always |
| 2 | Sync-over-async (`.Result`, `.Wait()`, `.GetAwaiter().GetResult()`) | Deadlock risk in ASP.NET Core request pipeline |
| 3 | Secrets in code or config files | Security breach — use Key Vault or environment variables |
| 4 | Empty catch blocks (`catch { }` or `catch (Exception) { }`) | Silent failures hide bugs — always log with context |
| 5 | Business logic in controllers | Layer violation — controllers handle HTTP only |
| 6 | SQL in services | Layer violation — data access belongs in repositories |
| 7 | Entity Framework Core for any data access | Architectural commitment to Dapper for performance and SQL control |
| 8 | Queries without `tenant_id` filter (except global reference tables) | Cross-tenant data leakage |
| 9 | `var` or `dynamic` when type is known | Type safety — explicit types on all signatures |
| 10 | `SELECT *` in production queries | Performance — select only needed columns |
| 11 | Skip tests or "we'll add tests later" | Unknown regressions — TDD means test first |
| 12 | Copy-paste code between files | DRY — extract shared logic into a reusable service or base class |

---

## Governance

**How are these project principles amended?**
> Requires a Pull Request with human review. The PR must explain why the principle needs to change and what impact the change has on existing code. No AI-only amendments.

**Who can amend them?**
> Project lead or team consensus (minimum 2 approvals on the PR).

**When were they last reviewed?**
> 2026-03-24
