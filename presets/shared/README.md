# Shared Preset Files

Files in this directory are common to **all** tech presets and are copied
by the setup wizard regardless of which preset is selected.

## Shared Instruction Files

| File | Destination | Purpose |
|------|-------------|---------|
| `architecture-principles.instructions.md` | `.github/instructions/` | Universal architecture rules |
| `git-workflow.instructions.md` | `.github/instructions/` | Commit conventions |
| `ai-plan-hardening-runbook.instructions.md` | `.github/instructions/` | Quick-reference for plan editing |

> **Note**: The setup wizard copies these from `.github/instructions/` in the template root.

## Shared Agent Definitions

Cross-stack agents for SaaS-critical concerns. Copied from `.github/agents/` in this directory:

| Agent | Destination | Purpose |
|-------|-------------|---------|
| `api-contract-reviewer.agent.md` | `.github/agents/` | API versioning, backward compatibility, OpenAPI compliance |
| `accessibility-reviewer.agent.md` | `.github/agents/` | WCAG 2.2 compliance, semantic HTML, ARIA, keyboard nav |
| `multi-tenancy-reviewer.agent.md` | `.github/agents/` | Tenant isolation, data leakage prevention, RLS, cache separation |
| `cicd-reviewer.agent.md` | `.github/agents/` | Pipeline safety, environment promotion, secrets, rollback strategies |
| `observability-reviewer.agent.md` | `.github/agents/` | Structured logging, distributed tracing, metrics, health checks || `dependency-reviewer.agent.md` | `.github/agents/` | Supply chain security, CVEs, outdated packages, license conflicts |
| `compliance-reviewer.agent.md` | `.github/agents/` | GDPR, CCPA, SOC2, PII handling, audit logging |