---
description: Bicep IaC patterns — file structure, naming, modules, parameters, outputs, linter, security
applyTo: '**/*.bicep,**/*.bicepparam,**/bicepconfig.json'
---

# Bicep Best Practices

## File Structure

```
infra/
├── main.bicep                  ← entry point, orchestrates modules
├── main.bicepparam             ← deployment parameters (per environment)
├── abbreviations.json          ← resource type abbreviation lookup
├── bicepconfig.json            ← linter configuration
└── modules/
    ├── networking.bicep
    ├── compute.bicep
    ├── storage.bicep
    └── security.bicep
```

## Parameters

```bicep
// ✅ Always use @description — describe what and why
@description('The environment name, used for resource naming and tagging.')
@allowed(['dev', 'test', 'staging', 'prod'])
param environmentName string

// ✅ Enforce length constraints where naming rules apply
@description('Short workload name used in resource names. 2–8 chars.')
@minLength(2)
@maxLength(8)
param workloadName string

// ✅ @secure on all secret parameters — never surfaces in logs
@description('The admin password for the database.')
@secure()
param dbAdminPassword string

// ❌ NEVER provide a non-empty default for a @secure param
@secure()
param secret string = ''      // ← only empty string is acceptable
```

## Naming

```bicep
// ✅ Use uniqueString() with a prefix for globally unique names
var storageAccountName = 'st${workloadName}${environmentName}${uniqueString(resourceGroup().id)}'

// ✅ Use template expressions for all resource names
var keyVaultName = 'kv-${workloadName}-${environmentName}-${uniqueString(resourceGroup().id)}'

// ✅ camelCase for symbolic names — never include "Name" suffix
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = { ... }

// ❌ NEVER hardcode resource names
resource keyVaultName 'Microsoft.KeyVault/vaults@2023-07-01' = { ... }
```

## Resource Definitions

```bicep
// ✅ Use resource properties as outputs — don't fabricate URLs
output appUrl string = appService.properties.defaultHostName

// ❌ NEVER construct URLs manually
output appUrl string = 'https://${appServiceName}.azurewebsites.net'

// ✅ Implicit dependencies via symbolic references
resource appService 'Microsoft.Web/sites@2023-01-01' = {
  properties: {
    serverFarmId: appServicePlan.id   // ← implicit dependency
  }
}

// ✅ Use existing keyword for cross-resource references
resource existingKv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

// ✅ child resources via parent property — never construct child names manually
resource secret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'mySecret'
  properties: { value: secretValue }
}

// ✅ Extract complex expressions into variables
var appServiceConfig = {
  alwaysOn: environmentName == 'prod'
  minTlsVersion: '1.2'
  ftpsState: 'Disabled'
}
```

## Outputs

```bicep
// ✅ @secure on outputs that contain sensitive data
@secure()
output connectionString string = storageAccount.listKeys().keys[0].value

// ✅ Prefer existing keyword over passing values through outputs
// ← Have downstream templates look up the key directly, don't output raw keys
```

## Modules

```bicep
// ✅ Modules are single-responsibility, parameterised, and reusable
module networking 'modules/networking.bicep' = {
  name: 'deploy-networking'
  params: {
    environmentName: environmentName
    workloadName: workloadName
    location: location
  }
}

// ✅ Pass location as a parameter — never hard-code
@description('Azure region for all resources.')
param location string = resourceGroup().location
```

## Required Tags

All resources MUST include standard tags:

```bicep
var commonTags = {
  Environment: environmentName
  Workload: workloadName
  ManagedBy: 'IaC'
  Repository: repoUrl
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  tags: commonTags
  ...
}
```

## Linter Configuration (bicepconfig.json)

```json
{
  "analyzers": {
    "core": {
      "enabled": true,
      "rules": {
        "no-hardcoded-env-urls": { "level": "error" },
        "outputs-should-not-contain-secrets": { "level": "error" },
        "secure-params-in-nested-deploy": { "level": "error" },
        "no-unused-params": { "level": "warning" },
        "no-unused-vars": { "level": "warning" },
        "prefer-interpolation": { "level": "warning" },
        "use-resource-symbol-reference": { "level": "warning" },
        "use-safe-access": { "level": "warning" },
        "no-unnecessary-dependson": { "level": "warning" },
        "use-stable-vm-image": { "level": "warning" },
        "adminusername-should-not-be-literal": { "level": "error" },
        "no-hardcoded-location": { "level": "warning" }
      }
    }
  }
}
```

## API Versions

```bicep
// ✅ Use recent API versions — within 2 years
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = { ... }

// ❌ NEVER use deprecated or very old API versions
resource storageAccount 'Microsoft.Storage/storageAccounts@2019-06-01' = { ... }
```

## Security

```bicep
// ✅ Key Vault secret references — never inline secrets
resource appSettings 'Microsoft.Web/sites/config@2023-01-01' = {
  parent: appService
  name: 'appsettings'
  properties: {
    DATABASE_PASSWORD: '@Microsoft.KeyVault(SecretUri=${kv::dbPassword.properties.secretUri})'
  }
}

// ✅ Disable public access on storage accounts
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
    }
  }
}

// ✅ RBAC assignment — use built-in role IDs, not names
var storageContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, managedIdentity.id, storageContributorRoleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageContributorRoleId)
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
```

## Code Review Checklist

- [ ] All parameters have `@description` decorators
- [ ] Secrets use `@secure()` — no default values other than `''`
- [ ] Resource names use `uniqueString()` where global uniqueness is required
- [ ] All resources tagged with `commonTags`
- [ ] No `dependsOn` where symbolic references can create implicit dependency
- [ ] Child resources use `parent` not manual name concatenation
- [ ] `outputs-should-not-contain-secrets` linter rule — outputs are safe
- [ ] Recent API versions (< 2 years old)
- [ ] No hardcoded locations — location comes from parameter
- [ ] Modules are single-responsibility and reusable
