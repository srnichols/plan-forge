---
description: Azure IaC security for app repos — secrets, managed identity, RBAC, Key Vault, storage hardening
applyTo: '**/infra/**/*.bicep,**/infra/**/*.tf'
---

# Azure IaC Security (App Repo Extension)

## No Secrets in IaC

```bicep
// ❌ NEVER — inline secrets
app_settings: { DB_PASSWORD: 'MyPassword!' }

// ✅ ALWAYS — Key Vault references
app_settings: { DB_PASSWORD: '@Microsoft.KeyVault(SecretUri=${kv::dbPass.properties.secretUri})' }
```

```hcl
# ❌ NEVER in Terraform
app_settings = { DB_PASSWORD = "MyPassword!" }

# ✅ Reference Key Vault secret URI
app_settings = { DB_PASSWORD = "@Microsoft.KeyVault(SecretUri=${data.azurerm_key_vault_secret.db_pass.id})" }
```

## Managed Identity

```bicep
// ✅ User-assigned identity for the app
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${workloadName}-${environmentName}'
  location: location
  tags: commonTags
}

resource app 'Microsoft.Web/sites@2023-01-01' = {
  identity: { type: 'UserAssigned'; userAssignedIdentities: { '${identity.id}': {} } }
}
```

## Key Vault

```bicep
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  properties: {
    enableRbacAuthorization: true    // RBAC, not access policies
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    // enablePurgeProtection: true   // uncomment for production
  }
}
```

## Storage Hardening

```bicep
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}
```

## Pipeline Auth

```
✅ OIDC / Workload Identity Federation — no stored client_secret
   Run: azd pipeline config
```

## Checklist

- [ ] No secrets in Bicep, Terraform, or YAML files
- [ ] All app secrets in Key Vault — referenced at runtime
- [ ] Managed Identity for app-to-Azure auth
- [ ] `allowBlobPublicAccess: false` on storage accounts
- [ ] Key Vault: RBAC + soft-delete enabled
- [ ] OIDC in CI pipeline — `azd pipeline config` or equivalent
