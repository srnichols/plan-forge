---
description: "Scaffold a Pester 5 test file for a PowerShell function or Azure integration validation."
agent: "agent"
tools: [read, edit, search]
---
# Create New Pester Test

Scaffold a Pester 5 test file following the `*.Tests.ps1` naming convention.

## Required Information

Before generating, ask for:
1. **What are we testing?** — a PowerShell function, a deployed Azure resource, or a pipeline script?
2. **Unit or integration?** — unit mocks Az cmdlets; integration tests run against real Azure
3. **Function/script name** — used for `Describe` block naming and file naming
4. **What should it validate?** — list success cases, failure/edge cases

## Unit Test Template

```powershell
# tests/unit/{FunctionName}.Tests.ps1
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }

BeforeAll {
    # Import the function under test via dot-sourcing
    . $PSScriptRoot/../../modules/{ModuleName}/{FunctionName}.ps1

    # Stub out Az cmdlets — never hit real Azure in unit tests
    Mock New-AzResourceGroupDeployment {
        [PSCustomObject]@{
            DeploymentName    = 'mock-deployment'
            ProvisioningState = 'Succeeded'
            Outputs           = @{}
        }
    }
}

Describe '{FunctionName}' {
    Context 'Given valid input' {
        It 'calls the Az cmdlet once with correct parameters' {
            {FunctionName} -ParameterA 'value-a' -ParameterB 'value-b'

            Should -Invoke New-AzResourceGroupDeployment -Times 1 -ParameterFilter {
                $ResourceGroupName -eq 'expected-rg'
            }
        }

        It 'returns a succeeded result' {
            $result = {FunctionName} -ParameterA 'value-a' -ParameterB 'value-b'
            $result.ProvisioningState | Should -Be 'Succeeded'
        }
    }

    Context 'Given invalid input' {
        It 'throws when required parameter is missing' {
            { {FunctionName} -ParameterB 'value-b' } | Should -Throw
        }

        It 'throws when environment is invalid' {
            { {FunctionName} -ParameterA 'invalid' } | Should -Throw -ExpectedMessage '*must be one of*'
        }
    }
}
```

## Integration Test Template

```powershell
# tests/integration/Verify-{ResourceType}.Tests.ps1
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
#Requires -Modules Az.Resources, Az.KeyVault, Az.Storage

BeforeAll {
    # Authenticate — use Managed Identity in CI
    if (-not (Get-AzContext)) {
        Connect-AzAccount -Identity
    }
}

Describe '{ResourceType} — Post-Deployment Validation' {
    BeforeAll {
        $resourceGroup = Get-AzResourceGroup -Name $env:RESOURCE_GROUP_NAME
        $resourceGroup | Should -Not -BeNullOrEmpty
    }

    Context 'Key Vault' {
        It 'exists in the resource group' {
            $kv = Get-AzKeyVault -ResourceGroupName $resourceGroup.ResourceGroupName
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
        It 'does not allow public blob access' {
            $sa = Get-AzStorageAccount `
                -ResourceGroupName $resourceGroup.ResourceGroupName `
                -Name $env:STORAGE_ACCOUNT_NAME
            $sa.AllowBlobPublicAccess | Should -Be $false
        }

        It 'enforces TLS 1.2' {
            $sa = Get-AzStorageAccount `
                -ResourceGroupName $resourceGroup.ResourceGroupName `
                -Name $env:STORAGE_ACCOUNT_NAME
            $sa.MinimumTlsVersion | Should -Be 'TLS1_2'
        }
    }
}
```

## Rules

- File name: `{FunctionName}.Tests.ps1` or `Verify-{ResourceType}.Tests.ps1`
- `BeforeAll` imports the tested function via dot-sourcing (`$PSScriptRoot`)
- Unit tests MUST mock all `Az*` cmdlets — never call real Azure
- Integration tests authenticate via `Connect-AzAccount -Identity` (CI managed identity)
- Method: `{MethodName}_{Scenario}_{ExpectedResult}` — use readable `It` descriptions
- Group tests with `Context` blocks by scenario
- `Should -Invoke` to verify the right Az cmdlet was called
- `Should -Throw` to verify error handling

## Reference Files

- [Testing instructions](../instructions/testing.instructions.md)
- [PowerShell instructions](../instructions/powershell.instructions.md)
