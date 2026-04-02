---
description: "Scaffold a new Bicep module with parameters, variables, outputs, tags, and security defaults."
agent: "agent"
tools: [read, edit, search]
---
# Create New Bicep Module

Scaffold a reusable Bicep module following CAF naming, security defaults, and project conventions.

## Required Information

Before generating, ask for:
1. **Module purpose** — what Azure resource(s) does this module deploy?
2. **Scope** — resource group / subscription / management group?
3. **Parameters** — what can callers configure?
4. **Is this production-bound?** — enables stricter security defaults

## Module Template

```bicep
// modules/{moduleName}.bicep

// ─── Parameters ────────────────────────────────────────────────────────────
@description('The environment name, used for naming and tagging.')
@allowed(['dev', 'test', 'staging', 'prod'])
param environmentName string

@description('Short workload name used in resource naming (2–8 chars).')
@minLength(2)
@maxLength(8)
param workloadName string

@description('Azure region for this resource.')
param location string = resourceGroup().location

// ─── Variables ─────────────────────────────────────────────────────────────
var uniqueSuffix  = uniqueString(resourceGroup().id)
var resourceName  = '{abbreviation}-${workloadName}-${environmentName}-${uniqueSuffix}'

var commonTags = {
  Environment : environmentName
  Workload    : workloadName
  ManagedBy   : 'Bicep'
  Module      : '{moduleName}'
}

// ─── Resources ─────────────────────────────────────────────────────────────
// TODO: add resource definition

// ─── Outputs ───────────────────────────────────────────────────────────────
@description('The resource ID of the deployed resource.')
output resourceId string = {resource}.id

@description('The name of the deployed resource.')
output resourceName string = {resource}.name
```

## Rules

- ALL parameters have `@description` decorators
- `@secure()` on any parameter containing a secret — no default other than `''`
- `location` is always a parameter — never hardcoded
- All resources get `tags: commonTags` (or `union(commonTags, extraTags)`)
- Naming uses `uniqueString(resourceGroup().id)` prefix for globally unique resources
- Outputs use resource property references — never manually constructed values
- `@secure()` on outputs containing keys, secrets, or connection strings
- Use `existing` keyword for cross-module references — not string outputs from parents
- Secure defaults: `allowBlobPublicAccess: false`, `minimumTlsVersion: 'TLS1_2'`

## Reference Files

- [Bicep instructions](../instructions/bicep.instructions.md)
- [Naming instructions](../instructions/naming.instructions.md)
- [Security instructions](../instructions/security.instructions.md)
