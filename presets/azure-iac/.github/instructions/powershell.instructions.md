---
description: PowerShell best practices for Azure IaC — Az module, script structure, Pester testing, PSScriptAnalyzer
applyTo: '**/*.ps1,**/*.psm1,**/*.psd1'
---

# PowerShell Best Practices for Azure IaC

## Script Structure

```powershell
#Requires -Modules Az.Accounts, Az.Resources
#Requires -Version 7.4

<#
.SYNOPSIS
    Short one-line description.
.DESCRIPTION
    Longer description of what the script does.
.PARAMETER EnvironmentName
    The target environment (dev, test, staging, prod).
.EXAMPLE
    .\Deploy-Infrastructure.ps1 -EnvironmentName prod
#>
[CmdletBinding(SupportsShouldProcess)]
param (
    [Parameter(Mandatory)]
    [ValidateSet('dev', 'test', 'staging', 'prod')]
    [string]$EnvironmentName,

    [Parameter()]
    [string]$Location = 'eastus'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
```

## Functions

```powershell
# ✅ Approved verbs, CmdletBinding, typed parameters
function New-ResourceGroupIfNotExists {
    [CmdletBinding(SupportsShouldProcess)]
    param (
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [string]$Location,

        [Parameter()]
        [hashtable]$Tags = @{}
    )

    $existing = Get-AzResourceGroup -Name $Name -ErrorAction SilentlyContinue

    if ($null -eq $existing) {
        if ($PSCmdlet.ShouldProcess($Name, 'Create resource group')) {
            Write-Verbose "Creating resource group '$Name' in '$Location'"
            New-AzResourceGroup -Name $Name -Location $Location -Tag $Tags
        }
    } else {
        Write-Verbose "Resource group '$Name' already exists. Skipping."
        $existing
    }
}
```

## Error Handling

```powershell
# ✅ Try/catch with specific error types and meaningful messages
try {
    $deployment = New-AzResourceGroupDeployment @deployParams
    Write-Verbose "Deployment succeeded: $($deployment.DeploymentName)"
}
catch [Microsoft.Azure.Commands.ResourceManager.Cmdlets.SdkModels.PSInvalidOperationException] {
    Write-Error "Deployment validation failed: $($_.Exception.Message)"
    throw
}
catch {
    Write-Error "Unexpected error during deployment: $($_.Exception.Message)"
    throw
}
```

## Authentication

```powershell
# ✅ Use Managed Identity in CI/CD — no stored credentials
# In GitHub Actions / Azure Pipelines: az login via OIDC/workload identity
# Then Connect-AzAccount is automatic if using Az module with OIDC

# ✅ In local dev: Connect-AzAccount (interactive or device code)
if (-not (Get-AzContext)) {
    Connect-AzAccount -UseDeviceAuthentication
}

# ❌ NEVER store credentials in scripts or variables
$cred = [PSCredential]::new('admin', (ConvertTo-SecureString 'P@ssword' -AsPlainText -Force))  # NEVER
```

## Secrets Management

```powershell
# ✅ Read secrets from Key Vault — never hardcode
function Get-SecretFromKeyVault {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory)] [string]$VaultName,
        [Parameter(Mandatory)] [string]$SecretName
    )

    $secret = Get-AzKeyVaultSecret -VaultName $VaultName -Name $SecretName
    return $secret.SecretValue  # returns SecureString — don't convert to plaintext unless required
}

# ❌ NEVER write secrets to output
Write-Host "Password: $($secret.SecretValueText)"  # NEVER
```

## Output Guidelines

```powershell
# ✅ Write-Verbose for operational information
Write-Verbose "Deploying module 'networking' to '$resourceGroupName'"

# ✅ Write-Warning for recoverable issues
Write-Warning "Resource group already exists. Continuing with existing group."

# ✅ Write-Error + throw for terminal failures
Write-Error "Required az module not found. Install with: Install-Module Az"
throw

# ❌ NEVER use Write-Host in reusable functions (it bypasses the pipeline)
Write-Host "Done"  # NEVER in functions — use Write-Verbose or output objects
```

## Module Structure

```
modules/
├── MyModule.psm1        ← function implementations
├── MyModule.psd1        ← module manifest
└── tests/
    └── MyModule.Tests.ps1
```

```powershell
# MyModule.psd1 — always version your modules
@{
    ModuleVersion   = '1.0.0'
    RootModule      = 'MyModule.psm1'
    FunctionsToExport = @('New-ResourceGroupIfNotExists', 'Deploy-BicepTemplate')
    RequiredModules = @('Az.Resources')
}
```

## PSScriptAnalyzer

Run before commit and in CI:

```powershell
# Install
Install-Module PSScriptAnalyzer -Force

# Run all rules
Invoke-ScriptAnalyzer -Path ./scripts -Recurse -ReportSummary

# Run in CI (fail on errors)
$results = Invoke-ScriptAnalyzer -Path ./scripts -Recurse -Severity Error
if ($results.Count -gt 0) { exit 1 }
```

Key rules to enforce:
- `PSAvoidUsingPlainTextForPassword` — no plaintext passwords
- `PSUseShouldProcessForStateChangingFunctions` — SupportsShouldProcess on mutating commands
- `PSAvoidUsingWriteHost` — use Write-Verbose / Write-Output
- `PSUseApprovedVerbs` — all function names use approved PowerShell verbs
- `PSUseDeclaredVarsMoreThanAssignments` — no unused variables

## Code Review Checklist

- [ ] `[CmdletBinding()]` on all functions
- [ ] `[Parameter(Mandatory)]` on required parameters
- [ ] `Set-StrictMode -Version Latest` and `$ErrorActionPreference = 'Stop'` at script top
- [ ] No hardcoded credentials or secrets
- [ ] No `Write-Host` in reusable functions
- [ ] `SupportsShouldProcess` on all state-changing functions
- [ ] `#Requires` for module and version dependencies
- [ ] `PSScriptAnalyzer` passes with no errors
- [ ] Pester tests exist for all public functions
