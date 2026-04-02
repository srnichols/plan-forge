# Instructions for Copilot — Azure IaC Project

> **Stack**: Azure Infrastructure as Code (Bicep / Terraform / PowerShell)
> **Last Updated**: 2026-04-02

---

## Architecture Principles

**BEFORE any code changes, read:** `.github/instructions/architecture-principles.instructions.md`

### Core Rules
1. **Security-First** — No secrets in code; Managed Identity everywhere; least-privilege RBAC
2. **Naming Convention** — CAF abbreviations: `rg-`, `kv-`, `st`, `app-`, etc.
3. **State is Infrastructure** — Bicep `what-if` / Terraform `plan` before every apply
4. **Parameterize Everything** — no hardcoded locations, names, or SKUs
5. **Test Your Infrastructure** — Pester unit tests for PowerShell; linting for Bicep/Terraform

### Red Flags
```
❌ Secrets or passwords in .bicep / .tf / .ps1 → STOP, use Key Vault
❌ Hardcoded resource names           → STOP, use expressions + uniqueString()
❌ Deploying without what-if / plan   → STOP, always validate first
❌ Local Terraform state              → STOP, use Azure Blob Storage backend
❌ Service principal with client_secret in pipeline → STOP, use OIDC
```

---

## Project Overview

**Description**: <!-- What infrastructure this repo provisions -->

**IaC Tool**:
- Primary: Bicep (default) / Terraform (if applicable)
- CLI: Azure CLI (`az`), Azure PowerShell (`Az` module)
- Deployment: Azure Developer CLI (`azd`) / GitHub Actions / Azure DevOps

**Architecture**:
- `infra/` — IaC entry point (`main.bicep` or `main.tf`)
- `infra/modules/` — reusable modules
- `scripts/` — PowerShell helper scripts
- `tests/unit/` — Pester unit tests for PowerShell
- `tests/integration/` — post-deployment validation tests

---

## Quick Commands

```powershell
# Validate Bicep (lint + build)
az bicep lint --file infra/main.bicep
az bicep build --file infra/main.bicep

# Bicep what-if (preview changes)
az deployment group what-if `
  --resource-group $resourceGroup `
  --template-file infra/main.bicep `
  --parameters infra/main.parameters.json

# Deploy (Bicep)
az deployment group create `
  --resource-group $resourceGroup `
  --template-file infra/main.bicep `
  --parameters infra/main.parameters.json

# Terraform
terraform init && terraform plan -out=tfplan
terraform apply tfplan

# azd
azd up           # provision + deploy
azd provision    # infra only
azd deploy       # app code only

# Tests
Invoke-Pester -Path ./tests/unit -Output Detailed
Invoke-ScriptAnalyzer -Path ./scripts -Recurse -Severity Error
```

---

## Coding Standards

### Naming
- Follow CAF convention: `{type}-{workload}-{env}-{region}[-{instance}]`
- Globally unique resources: always include `uniqueString()` or hash suffix
- No dashes in storage accounts or container registries

### Bicep
- `@description` on every parameter
- `@secure()` on all secret parameters
- camelCase symbolic names; no `Name` suffix
- Use `parent` property for child resources
- Recent API versions (≤ 2 years)

### Terraform
- Lock provider versions in `versions.tf`
- Remote state backend in `versions.tf`
- `for_each` over `count`
- `sensitive = true` on secret vars/outputs
- No `client_secret` in provider config

### PowerShell
- `[CmdletBinding(SupportsShouldProcess)]` on all functions
- `$ErrorActionPreference = 'Stop'`
- No `Write-Host` in reusable functions
- `PSScriptAnalyzer` passes with no errors

### Security
- All secrets in Key Vault — never in IaC source or outputs
- Managed Identity for all app-to-service auth
- OIDC / Workload Identity Federation in CI/CD
- Private endpoints + NSGs for production

---

## Planning & Execution

This project uses the **Plan Forge Pipeline**:
- **Runbook**: `docs/plans/AI-Plan-Hardening-Runbook.md`
- **Roadmap**: `docs/plans/DEPLOYMENT-ROADMAP.md`

### Instruction Files

| File | Domain |
|------|--------|
| `bicep.instructions.md` | Bicep patterns, linter, modules |
| `terraform.instructions.md` | Terraform, providers, state |
| `powershell.instructions.md` | Az module, script structure, PSScriptAnalyzer |
| `azd.instructions.md` | Azure Developer CLI, azure.yaml |
| `naming.instructions.md` | CAF naming conventions |
| `security.instructions.md` | Secrets, RBAC, network isolation |
| `testing.instructions.md` | Pester, ARM TTK, linting, what-if |
| `deploy.instructions.md` | GitHub Actions, Azure DevOps pipelines |
| `waf.instructions.md` | WAF 5 pillars — reliability, security, cost, operational excellence, performance |
| `caf.instructions.md` | CAF governance — management groups, subscriptions, tagging, identity |
| `landing-zone.instructions.md` | Landing Zone baselines — identity, network, policy, management, security |
| `policy.instructions.md` | Azure Policy — effects, assignments, initiatives, exemptions, remediation |

### Agents

| Agent | Use For |
|-------|---------|
| `bicep-reviewer` | PR review of Bicep templates |
| `terraform-reviewer` | PR review of Terraform configs |
| `security-reviewer` | Security-focused audit |
| `deploy-helper` | Guided deployments |
| `azure-sweeper` | Full-stack governance sweep — WAF + CAF + Landing Zone + Policy + Org Rules + Resource Graph + Telemetry + Remediation |

---

## Code Review Checklist

- [ ] No secrets in source (Bicep, Terraform, PowerShell, YAML)
- [ ] `@secure()` on secret params; `sensitive = true` on Terraform secret vars/outputs
- [ ] CAF naming conventions followed
- [ ] All resources tagged with required tags
- [ ] Bicep: `az bicep lint` passes; Terraform: `terraform validate` + `fmt -check` pass
- [ ] `PSScriptAnalyzer -Severity Error` returns zero hits
- [ ] Pester unit tests pass
- [ ] No `dependsOn` where implicit references should be used (Bicep)
- [ ] Managed Identity used — no service principal client secrets
- [ ] Pipeline uses OIDC — no stored long-lived credentials
