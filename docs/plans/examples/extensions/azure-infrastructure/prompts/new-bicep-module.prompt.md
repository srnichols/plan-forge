---
description: "Scaffold a Bicep module in the infra/ folder of an app repo, following CAF naming and security defaults."
agent: "agent"
tools: [read, edit, search]
---
# Create New Bicep Module (App Repo)

Scaffold a reusable Bicep module in `infra/modules/` for an application repository.

## Required Information

Ask for:
1. **What resource does this module deploy?** (App Service, Key Vault, SQL, etc.)
2. **What parameters should callers configure?**
3. **Is this production-bound?** (enables stricter network/purge protection defaults)

## Template

```bicep
// infra/modules/{resourceType}.bicep

@description('The environment name.')
@allowed(['dev', 'test', 'staging', 'prod'])
param environmentName string

@description('Short workload name (2–8 chars).')
@minLength(2)
@maxLength(8)
param workloadName string

@description('Azure region.')
param location string = resourceGroup().location

// ─── Naming ────────────────────────────────────────────────────────────────
var uniqueSuffix  = uniqueString(resourceGroup().id)
var resourceName  = '{abbreviation}-${workloadName}-${environmentName}'  // include uniqueSuffix if globally unique

var commonTags = {
  Environment : environmentName
  Workload    : workloadName
  ManagedBy   : 'Bicep'
}

// ─── Resources ─────────────────────────────────────────────────────────────
// TODO: resource definition with security defaults

// ─── Outputs ───────────────────────────────────────────────────────────────
@description('The resource ID.')
output resourceId string = {resource}.id

@description('The resource name.')
output resourceName string = {resource}.name
```

## Rules

- `@description` on every parameter and output
- `@secure()` on any secret/password param — no default other than `''`
- Tags applied to every resource
- Location comes from parameter, never hardcoded
- Globally unique names include `uniqueString(resourceGroup().id)` suffix
- Use `parent` for child resources — never manual name concatenation

## Reference Files

- [Bicep instructions](../instructions/bicep.instructions.md)
- [Naming instructions](../instructions/naming.instructions.md)
- [Security instructions](../instructions/security.instructions.md)
