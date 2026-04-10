---
name: infra-test
description: Run the full IaC test suite — Bicep linting, ARM TTK (if applicable), Terraform validate, Pester unit and integration tests. Use before deploying or after making infrastructure changes.
argument-hint: "[scope: unit|integration|all] [tool: bicep|terraform|all]"
---

# Infrastructure Test Skill

## Trigger
"Run infra tests" / "Test infrastructure" / "Validate before deploy" / "Run Pester"

## Steps

### 1. Static Analysis

```powershell
# PSScriptAnalyzer — PowerShell scripts
Invoke-ScriptAnalyzer -Path ./scripts -Recurse -Severity Error -ReportSummary

# Bicep lint
az bicep lint --file infra/main.bicep

# Terraform
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
```

### 2. Pester Unit Tests

```powershell
Install-Module Pester -MinimumVersion 5.0 -Force -Scope CurrentUser
Import-Module Pester

$config = New-PesterConfiguration
$config.Run.Path          = './tests/unit'
$config.Output.Verbosity  = 'Detailed'
$config.TestResult.Enabled         = $true
$config.TestResult.OutputPath      = 'TestResults-Unit.xml'
$config.TestResult.OutputFormat    = 'JUnitXml'
$config.CodeCoverage.Enabled       = $true
$config.CodeCoverage.Path          = './modules/**/*.ps1'

$result = Invoke-Pester -Configuration $config

if ($result.FailedCount -gt 0) {
    Write-Error "Unit tests failed: $($result.FailedCount) failures"
    exit 1
}
```

### 3. Bicep What-If (Pre-deploy Validation)

```powershell
az deployment group what-if \
  --resource-group $resourceGroup \
  --template-file infra/main.bicep \
  --parameters infra/main.parameters.json \
  --no-pretty-print
```

### 4. Terraform Plan

```bash
terraform plan -compact-warnings -out=tfplan
terraform show -json tfplan | jq '.resource_changes[] | select(.change.actions[] | contains("delete"))'
```

### 5. Integration Tests (Requires Deployed Environment)

```powershell
# Run against a real environment — requires Az authentication
$config = New-PesterConfiguration
$config.Run.Path = './tests/integration'
$config.Output.Verbosity = 'Detailed'
$config.TestResult.Enabled = $true
$config.TestResult.OutputPath = 'TestResults-Integration.xml'

Invoke-Pester -Configuration $config
```

## Pass / Fail Gates

| Gate | Command | Required |
|------|---------|----------|
| PSScriptAnalyzer | `Invoke-ScriptAnalyzer -Severity Error` | ✅ |
| Bicep lint | `az bicep lint` | ✅ |
| Pester unit | `Invoke-Pester ./tests/unit` | ✅ |
| Bicep what-if | `az deployment group what-if` | ✅ pre-deploy |
| Terraform validate | `terraform validate` | ✅ |
| Terraform fmt | `terraform fmt -check` | ✅ |
| Pester integration | `Invoke-Pester ./tests/integration` | ✅ post-deploy |

## Safety Rules
- NEVER skip static analysis — it catches security misconfigurations early
- NEVER deploy if unit tests fail
- ALWAYS run what-if/plan before production deployments
- Integration tests require a real Azure subscription — never mock in integration tests


## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Linting is enough, no need for what-if" | Lint catches syntax issues. What-if catches destructive runtime changes. Both are required. |
| "Unit tests for IaC are overkill" | IaC unit tests verify template logic (conditions, loops, defaults) before touching any cloud resources. |
| "Integration tests are too expensive" | Skipping integration tests means the first real test is production. That's the most expensive test of all. |
| "The template validated, so it will deploy fine" | Validation checks syntax. It doesn't check whether the SKU is available, the quota is sufficient, or the name is taken. |

## Warning Signs

- Static analysis skipped — templates deployed without linting or validation first
- What-if/plan output not reviewed — plan generated but not actually inspected for destructive changes
- Unit test failures ignored — Pester or test-framework failures dismissed as "environment issues"
- Integration tests never run — always deferred to "after deploy" instead of as a gate
- Test results not included in report — tests "ran" but no output pasted or summarised

## Exit Proof

After completing this skill, confirm:
- [ ] All static analysis passes (`az bicep lint`, `terraform validate`, `Invoke-ScriptAnalyzer`)
- [ ] Unit tests pass — `Invoke-Pester ./tests/unit` (or equivalent)
- [ ] What-if/plan output reviewed — no unexpected resource changes
- [ ] Integration tests pass (if deployed environment available)
- [ ] Test results report generated with pass/fail counts per gate
## Persistent Memory (if OpenBrain is configured)

- **Before running tests**: `search_thoughts("infra test failure", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load known test failures, linter false-positives, and Pester patterns
- **After test sweep**: `capture_thought("Infra test: <N passed, N failed — key failure patterns>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-infra-test")` — persist test outcomes and recurring failure patterns
