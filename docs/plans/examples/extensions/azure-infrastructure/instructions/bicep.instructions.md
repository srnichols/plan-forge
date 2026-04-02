---
description: Bicep IaC patterns for app repos — naming, parameters, outputs, security defaults, CAF conventions
applyTo: '**/infra/**/*.bicep,**/infra/**/*.bicepparam,**/bicepconfig.json'
---

# Bicep Best Practices (App Repo Extension)

Applies to projects that include an `infra/` folder with Bicep templates alongside application code.

## File Structure

```
infra/
├── main.bicep             ← entry point, orchestrates modules
├── main.bicepparam        ← deployment parameters
├── bicepconfig.json       ← linter configuration
└── modules/
    ├── appservice.bicep
    ├── database.bicep
    └── keyvault.bicep
```

## Parameters

```bicep
// ✅ Always @description and @secure on secret params
@description('The environment name.')
@allowed(['dev', 'test', 'staging', 'prod'])
param environmentName string

@description('Short workload identifier for naming (2–8 chars).')
@minLength(2)
@maxLength(8)
param workloadName string

@description('The database admin password.')
@secure()
param dbAdminPassword string
```

## Naming

```bicep
// ✅ CAF abbreviations + uniqueString for globally unique names
var uniqueSuffix         = uniqueString(resourceGroup().id)
var storageAccountName   = take('st${workloadName}${environmentName}${uniqueSuffix}', 24)
var keyVaultName         = take('kv-${workloadName}-${environmentName}-${uniqueSuffix}', 24)
var appServiceName       = 'app-${workloadName}-${environmentName}'
```

## Required Tags

```bicep
var commonTags = {
  Environment : environmentName
  Workload    : workloadName
  ManagedBy   : 'Bicep'
}
// Apply to every resource: tags: commonTags
```

## Security Defaults

```bicep
// ✅ Storage: no public blob access, TLS 1.2
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

// ✅ Key Vault: RBAC + soft-delete + purge protection (prod)
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  properties: {
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
  }
}

// ✅ App references Key Vault secrets — never inline values
// '@Microsoft.KeyVault(SecretUri=${kv::mySecret.properties.secretUri})'
```

## bicepconfig.json

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
        "no-unused-vars": { "level": "warning" }
      }
    }
  }
}
```

## Checklist

- [ ] All parameters have `@description`
- [ ] `@secure()` on all secret/password/key parameters
- [ ] CAF naming with `uniqueString()` for globally unique resources
- [ ] `tags: commonTags` on every resource
- [ ] `bicepconfig.json` with security rules as errors
- [ ] Recent API versions used
- [ ] No hardcoded locations — `location` is a parameter
