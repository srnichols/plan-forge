---
description: Azure IaC testing — Pester for PowerShell, Bicep linter, ARM TTK, Terraform validate/plan, what-if
applyTo: '**/*.Tests.ps1,**/tests/**,**/*.bicep,**/*.tf'
---

# Azure IaC Testing Patterns

## Testing Stack

| Layer | Tool | When |
|-------|------|------|
| **PowerShell functions** | Pester 5 | Unit test all public functions |
| **Bicep templates** | `az bicep build` + Bicep linter | Every commit |
| **ARM templates** | ARM TTK (`Test-AzTemplate`) | ARM templates only (not Bicep) |
| **Terraform** | `terraform validate` + `tflint` | Every commit |
| **Pre-deployment** | `az deployment group what-if` / `terraform plan` | Before every deployment |
| **Post-deployment** | Pester integration tests | After deployment to each environment |

## Pester 5 — PowerShell Unit Tests

```powershell
# modules/Deployment/tests/Deploy-BicepTemplate.Tests.ps1

BeforeAll {
    # Dot-source the module under test
    . $PSScriptRoot/../Deploy-BicepTemplate.ps1

    # Mock Az cmdlets — never hit real Azure in unit tests
    Mock New-AzResourceGroupDeployment {
        return [PSCustomObject]@{
            DeploymentName     = 'test-deployment'
            ProvisioningState  = 'Succeeded'
        }
    }
    Mock Get-AzResourceGroup {
        return [PSCustomObject]@{ ResourceGroupName = 'rg-test' }
    }
}

Describe 'Deploy-BicepTemplate' {
    Context 'given valid parameters' {
        It 'calls New-AzResourceGroupDeployment with correct arguments' {
            Deploy-BicepTemplate -TemplateFile './main.bicep' -ResourceGroupName 'rg-test' -EnvironmentName 'dev'

            Should -Invoke New-AzResourceGroupDeployment -Times 1 -ParameterFilter {
                $ResourceGroupName -eq 'rg-test'
            }
        }

        It 'returns a succeeded deployment object' {
            $result = Deploy-BicepTemplate -TemplateFile './main.bicep' -ResourceGroupName 'rg-test' -EnvironmentName 'dev'
            $result.ProvisioningState | Should -Be 'Succeeded'
        }
    }

    Context 'given an invalid environment' {
        It 'throws a validation error' {
            { Deploy-BicepTemplate -TemplateFile './main.bicep' -ResourceGroupName 'rg-test' -EnvironmentName 'invalid' } |
                Should -Throw
        }
    }
}
```

## Running Pester

```powershell
# Install Pester 5
Install-Module Pester -MinimumVersion 5.0 -Force
Import-Module Pester

# Run all tests with detailed output
Invoke-Pester -Path ./tests -Output Detailed

# Run with coverage report
Invoke-Pester -Path ./tests -Output Detailed -CodeCoverage ./modules/**/*.ps1

# Run in CI (exit code reflects pass/fail)
$config = New-PesterConfiguration
$config.Run.Path = './tests'
$config.Output.Verbosity = 'Detailed'
$config.TestResult.Enabled = $true
$config.TestResult.OutputPath = 'TestResults.xml'
$config.TestResult.OutputFormat = 'JUnitXml'
Invoke-Pester -Configuration $config
```

## Bicep Linting

```powershell
# Lint verifies best-practice rules (bicepconfig.json controls thresholds)
az bicep lint --file infra/main.bicep
az bicep build --file infra/main.bicep   # also triggers linter + generates ARM

# Validate WHAT-IF before deploying (requires Az CLI login)
az deployment group what-if \
  --resource-group rg-myapp-dev \
  --template-file infra/main.bicep \
  --parameters infra/main.parameters.json

# Example bicepconfig.json — promote critical rules to errors
```

## ARM TTK (ARM templates only — not Bicep)

```powershell
# Install ARM TTK
$ttkUri  = 'https://github.com/Azure/arm-ttk/releases/latest/download/arm-ttk.zip'
Invoke-WebRequest -Uri $ttkUri -OutFile 'arm-ttk.zip'
Expand-Archive 'arm-ttk.zip' -DestinationPath './arm-ttk'
Import-Module ./arm-ttk/arm-ttk.psd1

# Run all tests
$results = Test-AzTemplate -TemplatePath ./infra

# Fail CI if any errors
if ($results | Where-Object { $_.Errors }) {
    Write-Error "ARM TTK validation failed"
    exit 1
}
```

## Terraform Validation

```bash
# Format check — fail if formatting is inconsistent
terraform fmt -check -recursive

# Validate configuration
terraform validate

# Static analysis (add to CI)
tflint --init
tflint --recursive

# What-if: preview changes before apply
terraform plan -out=tfplan
terraform show -json tfplan | jq '.resource_changes[]'
```

## Integration Tests (Post-Deployment)

```powershell
# tests/integration/Verify-Deployment.Tests.ps1

Describe 'Production Infrastructure' {
    BeforeAll {
        Connect-AzAccount -Identity   # use managed identity in CI
        $rg = Get-AzResourceGroup -Name $env:RESOURCE_GROUP_NAME
    }

    Context 'Key Vault' {
        It 'exists in the correct resource group' {
            $kv = Get-AzKeyVault -ResourceGroupName $rg.ResourceGroupName
            $kv | Should -Not -BeNullOrEmpty
        }

        It 'has soft-delete enabled' {
            $kv = Get-AzKeyVault -VaultName $env:KEY_VAULT_NAME
            $kv.EnableSoftDelete | Should -Be $true
        }

        It 'has purge protection enabled' {
            $kv = Get-AzKeyVault -VaultName $env:KEY_VAULT_NAME
            $kv.EnablePurgeProtection | Should -Be $true
        }
    }

    Context 'Storage Account' {
        It 'has public blob access disabled' {
            $sa = Get-AzStorageAccount -ResourceGroupName $rg.ResourceGroupName -Name $env:STORAGE_ACCOUNT_NAME
            $sa.AllowBlobPublicAccess | Should -Be $false
        }

        It 'enforces TLS 1.2' {
            $sa = Get-AzStorageAccount -ResourceGroupName $rg.ResourceGroupName -Name $env:STORAGE_ACCOUNT_NAME
            $sa.MinimumTlsVersion | Should -Be 'TLS1_2'
        }
    }
}
```

## CI Pipeline Integration

```yaml
# GitHub Actions — test gates before deployment
- name: Lint Bicep
  run: az bicep lint --file infra/main.bicep

- name: Bicep What-If
  run: |
    az deployment group what-if \
      --resource-group ${{ vars.RESOURCE_GROUP }} \
      --template-file infra/main.bicep \
      --parameters infra/main.parameters.json
  continue-on-error: false

- name: Run Pester Unit Tests
  shell: pwsh
  run: |
    Install-Module Pester -Force -Scope CurrentUser
    $config = New-PesterConfiguration
    $config.Run.Path = './tests/unit'
    $config.TestResult.Enabled = $true
    $config.TestResult.OutputPath = 'pester-unit.xml'
    Invoke-Pester -Configuration $config

- name: Publish Test Results
  uses: dorny/test-reporter@v1
  with:
    name: Pester Unit Tests
    path: pester-unit.xml
    reporter: java-junit
```

## Validation Gates (for Plan Hardening)

```markdown
- [ ] `az bicep lint` — zero errors
- [ ] `az bicep build` — compiles without errors
- [ ] `az deployment group what-if` — no unexpected resource deletions
- [ ] `Invoke-Pester -Path ./tests/unit` — all tests pass
- [ ] `terraform fmt -check` — no formatting differences
- [ ] `terraform validate` — configuration is valid
- [ ] `tflint` — zero errors
- [ ] `PSScriptAnalyzer -Severity Error` — zero errors
```
