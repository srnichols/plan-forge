---
description: Azure IaC security — secrets, managed identity, RBAC, network isolation, Key Vault, compliance
applyTo: '**/*.bicep,**/*.tf,**/*.ps1,**/azure.yaml'
---

# Azure IaC Security Patterns

## Secrets Management

### Never in Code
```bicep
// ❌ NEVER — hardcoded secrets in IaC
resource appSettings 'Microsoft.Web/sites/config@2023-01-01' = {
  properties: {
    DATABASE_PASSWORD: 'MyS3cretP@ssword!'    // NEVER
  }
}

// ✅ ALWAYS — Key Vault references at runtime
resource appSettings 'Microsoft.Web/sites/config@2023-01-01' = {
  properties: {
    DATABASE_PASSWORD: '@Microsoft.KeyVault(SecretUri=${kv::dbPassword.properties.secretUri})'
  }
}
```

```hcl
# ❌ NEVER — secrets in Terraform files
resource "azurerm_app_service" "this" {
  app_settings = {
    DATABASE_PASSWORD = "MyS3cretP@ssword!"  # NEVER
  }
}

# ✅ ALWAYS — reference Key Vault secret URI
data "azurerm_key_vault_secret" "db_password" {
  name         = "db-admin-password"
  key_vault_id = azurerm_key_vault.this.id
}
```

### Key Vault Setup

```bicep
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: tenant().tenantId
    enableRbacAuthorization: true          // ✅ RBAC — not access policies
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true            // ✅ required for production
    publicNetworkAccess: 'Disabled'        // ✅ private endpoint only in prod
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
    }
  }
}
```

## Managed Identity Over Service Principals

```bicep
// ✅ User-assigned managed identity for all app workloads
resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${workloadName}-${environmentName}'
  location: location
  tags: commonTags
}

// ✅ Assign identity to resource
resource appService 'Microsoft.Web/sites@2023-01-01' = {
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
}

// ❌ NEVER use system-assigned identity for shared infrastructure
// (it makes role assignments harder to track)
```

## RBAC Assignments

```bicep
// ✅ Built-in role IDs — look up in Azure portal or docs
// Full list: https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles
var keyVaultSecretsUserRoleId    = '4633458b-17de-408a-b874-0445c86b69e6'
var storageContributorRoleId     = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var storageBlobDataReaderRoleId  = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'

// ✅ Deterministic GUID for role assignment name
resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, managedIdentity.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
```

## Network Isolation

```bicep
// ✅ Private endpoints for all PaaS services in production
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-09-01' = {
  name: 'pe-${storageAccount.name}'
  location: location
  properties: {
    subnet: {
      id: '${vnet.id}/subnets/snet-private-endpoints'
    }
    privateLinkServiceConnections: [{
      name: 'plsc-storage'
      properties: {
        privateLinkServiceId: storageAccount.id
        groupIds: ['blob']
      }
    }]
  }
}

// ✅ NSG on every subnet — deny all by default, allow specific traffic
resource nsg 'Microsoft.Network/networkSecurityGroups@2023-09-01' = {
  properties: {
    securityRules: [
      {
        name: 'Deny-All-Inbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: '*'
        }
      }
    ]
  }
}
```

## Storage Account Hardening

```bicep
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  properties: {
    allowBlobPublicAccess: false          // ✅ disable public blob access
    allowSharedKeyAccess: false           // ✅ Entra ID only, no storage keys
    minimumTlsVersion: 'TLS1_2'          // ✅ TLS 1.2 minimum
    supportsHttpsTrafficOnly: true        // ✅ HTTPS only
    networkAcls: {
      defaultAction: 'Deny'              // ✅ deny by default
      bypass: 'AzureServices'
    }
    encryption: {
      services: {
        blob: { enabled: true, keyType: 'Account' }
        file: { enabled: true, keyType: 'Account' }
      }
      keySource: 'Microsoft.Storage'
    }
  }
}
```

## Diagnostic Logging

```bicep
// ✅ All resources MUST send diagnostic logs to Log Analytics
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'diag-${keyVault.name}'
  scope: keyVault
  properties: {
    workspaceId: logAnalyticsWorkspace.id
    logs: [
      { category: 'AuditEvent'; enabled: true; retentionPolicy: { enabled: true; days: 90 } }
    ]
    metrics: [
      { category: 'AllMetrics'; enabled: true }
    ]
  }
}
```

## Bicep Linter Security Rules

Ensure `bicepconfig.json` treats these as errors:

```json
{
  "analyzers": {
    "core": {
      "rules": {
        "outputs-should-not-contain-secrets": { "level": "error" },
        "no-hardcoded-env-urls": { "level": "error" },
        "secure-params-in-nested-deploy": { "level": "error" },
        "adminusername-should-not-be-literal": { "level": "error" },
        "protect-commandtoexecute-secrets": { "level": "error" },
        "secure-secrets-in-params": { "level": "error" }
      }
    }
  }
}
```

## Security Checklist

- [ ] No secrets, passwords, or connection strings in Bicep/Terraform source
- [ ] All secrets stored in Key Vault — referenced, not embedded
- [ ] Key Vault uses RBAC authorization (not access policies)
- [ ] Key Vault has soft-delete and purge protection enabled
- [ ] Managed Identity used for all app-to-service authentication
- [ ] No service principals with client_secret — use OIDC or managed identity
- [ ] Storage accounts: `allowBlobPublicAccess: false`, `allowSharedKeyAccess: false`
- [ ] All PaaS services have `publicNetworkAccess: Disabled` in production
- [ ] Private endpoints deployed for Key Vault, Storage, databases in production
- [ ] NSGs on all subnets with deny-by-default rules
- [ ] Diagnostic logs sent to Log Analytics for all critical resources
- [ ] RBAC role assignments use deterministic GUID names
- [ ] `@secure()` on all Bicep params holding secrets; `sensitive = true` in Terraform
