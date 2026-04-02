# azure-infrastructure Extension

An extension for the Plan Forge Pipeline that adds Azure IaC guardrails to **any app repo** that ships
infrastructure code alongside application code.

Install this extension on top of any language preset (dotnet, typescript, python, etc.) to get:
- Bicep best practices and linter enforcement
- Terraform Azure conventions
- Azure Developer CLI (`azd`) configuration patterns
- CAF naming conventions
- Security guardrails (secrets, managed identity, RBAC, storage hardening)

---

## What's Included

| File | Purpose |
|------|---------|
| `instructions/bicep.instructions.md` | Bicep parameters, naming, outputs, linter config, security defaults |
| `instructions/terraform.instructions.md` | Provider versions, remote state, locals, sensitive outputs |
| `instructions/azd.instructions.md` | `azure.yaml`, tags, hooks, pipeline setup |
| `instructions/naming.instructions.md` | CAF abbreviations, uniqueString, character limits |
| `instructions/security.instructions.md` | Key Vault refs, managed identity, storage hardening |
| `agents/infra-reviewer.agent.md` | PR reviewer for the `infra/` folder |
| `prompts/new-bicep-module.prompt.md` | Scaffold a new Bicep module |
| `prompts/new-terraform-module.prompt.md` | Scaffold a new Terraform module |
| `prompts/add-azd-support.prompt.md` | Add azd support (`azure.yaml` + tags + pipeline) |

---

## Installation

### Manual

1. Copy instruction files → `.github/instructions/`
2. Copy agent files → `.github/agents/`
3. Copy prompt files → `.github/prompts/`

### Using setup script

```powershell
.\setup.ps1 -InstallExtensions
```

### Using CLI

```bash
pforge ext install .forge/extensions/azure-infrastructure
```

---

## When to Use This vs the `azure-iac` Preset

| Scenario | Use |
|----------|-----|
| Pure infrastructure repo (Bicep modules, no app code) | `presets/azure-iac/` preset |
| App repo with `infra/` folder alongside application code | This extension on top of your language preset |
| Retrofit Azure IaC to existing dotnet/typescript/python project | This extension |

---

## Coverage

| Technology | Covered |
|------------|---------|
| Bicep | ✅ Parameters, naming, modules, linter, security defaults |
| Terraform (azurerm + azapi) | ✅ Versions, remote state, locals, OIDC, sensitive outputs |
| Azure Developer CLI (azd) | ✅ `azure.yaml`, resource tags, hooks, pipeline |
| CAF naming | ✅ Abbreviations, uniqueString, character constraints |
| Security | ✅ Key Vault refs, managed identity, storage hardening, OIDC |
| ARM TTK | Use `presets/azure-iac/` for full ARM TTK coverage |
| Pester / infra tests | Use `presets/azure-iac/` for full Pester test coverage |
