---
description: Azure Cloud Adoption Framework (CAF) governance — management groups, naming, tagging, subscriptions, cost management, identity governance
applyTo: '**/*.bicep,**/*.tf,**/*.ps1'
---

# Azure Cloud Adoption Framework (CAF) Governance

> Based on the [Microsoft Cloud Adoption Framework for Azure](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/).
> CAF is the **environment governance** layer — it governs how subscriptions, management groups, and
> shared services are organized across the enterprise, above the workload level.

---

## Management Group Hierarchy

```
Root Management Group
├── Platform
│   ├── Identity         (AAD, PIM, DNS)
│   ├── Management       (Log Analytics, Automation, Backup)
│   └── Connectivity     (hub VNet, ExpressRoute, Azure Firewall)
└── Landing Zones
    ├── Corp             (internal workloads — connected to hub)
    │   ├── Production subscriptions
    │   └── Non-prod subscriptions
    └── Online           (internet-facing workloads — no hub connectivity required)
        ├── Production subscriptions
        └── Non-prod subscriptions
```

### IaC: Management Group Structure

```bicep
// management-groups.bicep — deploy at tenant scope
targetScope = 'tenant'

resource landingZones 'Microsoft.Management/managementGroups@2023-04-01' = {
  name: 'mg-landing-zones'
  scope: tenant()
  properties: {
    displayName: 'Landing Zones'
    details: { parent: { id: tenantResourceId('Microsoft.Management/managementGroups', rootMgId) } }
  }
}

resource corpLz 'Microsoft.Management/managementGroups@2023-04-01' = {
  name: 'mg-corp'
  properties: {
    displayName: 'Corp'
    details: { parent: { id: landingZones.id } }
  }
}
```

---

## Subscription Design

| Pattern | When to Use |
|---------|-------------|
| One subscription per workload | Default for most landing zones |
| One subscription per environment (dev/prod) | High-compliance or regulated workloads |
| Shared subscription | Only for non-production, shared infrastructure |

### Subscription Naming

```
sub-{workload}-{environment}
sub-payments-prod
sub-payments-nonprod
sub-platform-identity
sub-platform-management
sub-platform-connectivity
```

---

## CAF Naming Convention

See `naming.instructions.md` for the full CAF resource naming reference.

Key CAF naming rules:
- Include workload + environment + region in every resource name
- Use lowercase, hyphens, no underscores (unless resource type requires)
- Consistent abbreviation set — never improvise abbreviations

---

## Mandatory Tagging Policy

All resources and resource groups MUST carry these tags (enforced via Azure Policy):

| Tag | Description | Example |
|-----|-------------|---------|
| `Environment` | Deployment target | `prod`, `staging`, `dev` |
| `Workload` | Application or service name | `payments`, `auth-service` |
| `Owner` | Team or contact alias | `platform-team`, `jane@corp.com` |
| `CostCenter` | Billing code for FinOps | `CC-1234` |
| `ManagedBy` | IaC tool | `Bicep`, `Terraform` |
| `Repository` | Source repo URL | `https://github.com/org/repo` |
| `ClassificationLevel` | Data sensitivity | `public`, `internal`, `confidential`, `restricted` |

```bicep
// ✅ Enforce tags in Bicep — always apply commonTags
var commonTags = {
  Environment:       environmentName
  Workload:          workloadName
  Owner:             ownerAlias
  CostCenter:        costCenter
  ManagedBy:        'Bicep'
  Repository:        repoUrl
  ClassificationLevel: dataClassification
}
```

---

## Cost Management Governance

```powershell
# ✅ Budget with alert thresholds — required per subscription
$budget = @{
  Name        = "budget-${subscriptionName}-monthly"
  Amount      = 5000
  TimeGrain   = 'Monthly'
  Thresholds  = @(50, 80, 100)    # alert at 50%, 80%, 100% of budget
  ContactEmails = @('finops@corp.com', 'team-lead@corp.com')
}
New-AzConsumptionBudget @budget
```

```bicep
// ✅ Budget resource in Bicep — deploy at subscription scope
targetScope = 'subscription'

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: 'budget-${workloadName}-monthly'
  properties: {
    category: 'Cost'
    amount: budgetAmount
    timeGrain: 'Monthly'
    timePeriod: { startDate: '2026-01-01' }
    notifications: {
      atFiftyPercent: {
        enabled: true; operator: 'GreaterThan'; threshold: 50
        contactEmails: [finOpsEmail]
      }
      atEightyPercent: {
        enabled: true; operator: 'GreaterThan'; threshold: 80
        contactEmails: [finOpsEmail, ownerEmail]
      }
    }
  }
}
```

---

## Identity Governance

```
✅ Break-glass accounts: 2 emergency accounts in AAD, excluded from Conditional Access
✅ Privileged Identity Management (PIM): no standing Owner/Contributor in production
✅ Azure AD Conditional Access: MFA required for all admin access
✅ Service principals: use Managed Identity or Workload Identity Federation; no client_secret
✅ Guest account review: quarterly access review for external identities
```

---

## CAF Governance Checklist

### Management & Organization
- [ ] Management group hierarchy follows CAF Landing Zone pattern
- [ ] Platform subscriptions separated from workload subscriptions
- [ ] Production subscriptions isolated from non-production

### Naming & Tagging
- [ ] All resources follow CAF naming convention
- [ ] Mandatory tags defined and enforced via Azure Policy
- [ ] `ClassificationLevel` tag present on all data stores

### Cost Management
- [ ] Monthly budget with 50%/80%/100% alerts per subscription
- [ ] Cost allocation tags applied for FinOps chargeback
- [ ] Azure Advisor cost recommendations reviewed monthly
- [ ] Dev/test subscriptions use Azure Dev/Test pricing where eligible

### Identity Governance
- [ ] Break-glass accounts configured
- [ ] PIM enabled — no standing privileged access in production
- [ ] MFA enforced via Conditional Access for all users
- [ ] Service principal audit: all should use managed identity or OIDC
- [ ] Quarterly access review scheduled

### Compliance
- [ ] Azure Policy Initiative assigned at management group level
- [ ] Non-compliant resources have remediation tasks or documented exemptions
- [ ] Compliance reports exported to management dashboard monthly
