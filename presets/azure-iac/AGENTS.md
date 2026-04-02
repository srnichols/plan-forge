# Agents & Automation Architecture

> **Project**: <!-- Your project name -->
> **Stack**: Azure IaC — Bicep / Terraform / PowerShell
> **Last Updated**: 2026-04-02

---

## AI Agent Development Standards

**BEFORE writing ANY automation, read:** `.github/instructions/architecture-principles.instructions.md`

### Priority
1. **Security-First** — Managed Identity, OIDC, no embedded secrets
2. **Validate Before Apply** — what-if / plan is non-negotiable
3. **Idempotent Operations** — every script and pipeline can run multiple times safely
4. **Typed Error Handling** — no empty catch blocks; every failure has a message

---

## Agent Categories

| Category | Purpose | Pattern |
|----------|---------|---------|
| **Reviewers** | Audit IaC for violations | Read-only agents (`tools: [read, search]`) |
| **Deploy Helpers** | Guide safe deployments | `tools: [read, search, runCommands]` |
| **Skill Workflows** | Multi-step automated procedures | Skill files in `.github/skills/` |

---

## Reviewer Agents

| Agent | Use When |
|-------|----------|
| `bicep-reviewer` | Reviewing Bicep module PRs |
| `terraform-reviewer` | Reviewing Terraform configuration PRs |
| `security-reviewer` | Security audit of any IaC change |
| `deploy-helper` | Guided deployment walkthroughs |
| `azure-sweeper` | Enterprise compliance sweep (WAF + CAF + LZ + Policy + Org Rules + Resource Graph + Telemetry) |

Reviewer agents are **read-only** — they never modify files.

The `azure-sweeper` agent uses `tools: [read, search, runCommands]` to query live Azure state via CLI and Resource Graph.

---

## Skills

| Skill | Trigger |
|-------|---------|
| `/infra-deploy` | "Deploy infrastructure to staging/prod" |
| `/infra-test` | "Run infra tests" / "Validate before deploy" |
| `/azure-sweep` | "Run compliance sweep" / "Audit this subscription" / "Check WAF + CAF compliance" |

---

## Sweeper Agent Architecture

The `azure-sweeper` runs **8 evaluation layers** in sequence:

```
Scope confirmed (subscription / resource group)
  │
  ├─ Layer 1: WAF  ─── Advisor recommendations + 5-pillar checklist
  ├─ Layer 2: CAF  ─── Management groups, subscriptions, mandatory tags, budgets, PIM
  ├─ Layer 3: Landing Zone ─── Identity / Network / Policy / Management / Security / Tagging baselines
  ├─ Layer 4: Policy ─── az policy state — non-compliant resources, expired exemptions
  ├─ Layer 5: Org Rules ─── org-rules.instructions.md — SKUs, regions, classification, extra tags
  ├─ Layer 6: Resource Graph ─── ARM inventory — orphans, public access, missing tags
  ├─ Layer 7: Telemetry ─── Defender alerts, Secure Score, Advisor cost, Monitor gaps
  └─ Layer 8: Remediation ─── Bicep + Terraform + CLI fix code with impact statements
```

### Triggering the Sweeper

Open Copilot chat and select `azure-sweeper` from the agent picker, then say:

```
Sweep my subscription <id> against WAF, CAF, and Landing Zone standards.
Output a findings report with Bicep remediation code.
```

### Output

The sweeper produces:
1. Executive summary table (per-layer status + finding counts)
2. Findings list ordered CRITICAL → HIGH → MEDIUM → LOW
3. Remediation code per HIGH/CRITICAL finding (Bicep / Terraform / CLI / Portal)
4. Impact quantification (security risk, cost savings, compliance gains)

---

## Pipeline Patterns

### GitHub Actions Flow
```
PR opened
  │
  ├─ Validate job: lint + build + what-if
  │   └─ FAIL → block merge
  │
merge to main
  │
  ├─ deploy-dev (automatic)
  │   └─ smoke tests → FAIL → stop pipeline
  │
  ├─ deploy-staging (automatic after dev)
  │   └─ smoke tests → FAIL → stop pipeline
  │
  └─ deploy-prod (manual approval gate)
      └─ smoke tests → FAIL → alert team
```

### Terraform Flow
```
PR opened
  │
  ├─ fmt -check + validate + plan
  │   └─ plan saved as artifact
  │
merge to main
  │
  ├─ apply (dev) — automatic
  │
  └─ apply (prod) — manual approval gate
```

---

## Quick Commands

```powershell
# Run all test gates before deploying
Invoke-Pester -Path ./tests/unit -Output Detailed
az bicep lint --file infra/main.bicep
az deployment group what-if --resource-group $rg --template-file infra/main.bicep --parameters infra/main.parameters.json

# Terraform validation
terraform init && terraform fmt -check && terraform validate && terraform plan

# azd deployment
azd up --environment dev
```
