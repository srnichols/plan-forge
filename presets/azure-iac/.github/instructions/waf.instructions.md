---
description: Azure Well-Architected Framework (WAF) guardrails — Reliability, Security, Cost, Operational Excellence, Performance
applyTo: '**/*.bicep,**/*.tf,**/*.ps1,**/azure.yaml'
---

# Azure Well-Architected Framework (WAF)

> Based on the [Microsoft Azure Well-Architected Framework](https://learn.microsoft.com/en-us/azure/well-architected/).
> The WAF is the **workload quality** layer — it governs individual service design decisions.

## The 5 Pillars

| Pillar | Core Question |
|--------|--------------|
| **Reliability** | Will it stay available when things go wrong? |
| **Security** | Is the workload protected end-to-end? |
| **Cost Optimization** | Are we paying for what we actually use? |
| **Operational Excellence** | Can we deploy, operate, and recover safely? |
| **Performance Efficiency** | Does it scale and respond well under load? |

---

## Reliability

### Key Controls

```bicep
// ✅ Deploy across availability zones — never single-zone in production
resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  sku: { name: 'P1v3'; tier: 'PremiumV3'; capacity: 2 }
  properties: {
    zoneRedundant: true   // ← required for zone-pinned AZ support
  }
}

// ✅ Health probes on load balancers and App Gateway
// ✅ Auto-scale rules based on CPU + memory, not just time-based
// ✅ Azure backup enabled for databases and storage
// ✅ Soft-delete + point-in-time restore for all databases
```

### Reliability Checklist

- [ ] Resources deployed across ≥ 2 availability zones in production
- [ ] Auto-scale configured with appropriate min/max and cool-down
- [ ] Health checks / probes on every outward-facing service
- [ ] Recovery Time Objective (RTO) and Recovery Point Objective (RPO) defined
- [ ] Azure Backup enabled for databases and critical storage
- [ ] Geo-redundant storage (GRS or RA-GRS) for critical data in production
- [ ] Azure Site Recovery evaluated for VM/stateful workloads
- [ ] Circuit breaker / retry policies in application code (not just infra)

---

## Security

> See `security.instructions.md` for the detailed Azure IaC security patterns.

### WAF Security Checklist

- [ ] Managed Identity for all service-to-service auth — no static credentials
- [ ] Key Vault for all secrets, certificates, and keys
- [ ] Private endpoints for all PaaS services in production
- [ ] Azure DDoS Protection Standard on public-facing VNets
- [ ] Azure Web Application Firewall (WAF) on Application Gateway or Front Door
- [ ] Defender for Cloud Standard tier enabled on all subscriptions
- [ ] Just-in-time (JIT) VM access enabled
- [ ] Azure AD Conditional Access policies configured

---

## Cost Optimization

```bicep
// ✅ Use B-series VMs for dev/test (burstable, lower cost)
// ✅ Reserved Instances or Savings Plans for stable production workloads
// ✅ Azure Hybrid Benefit for Windows/SQL Server workloads
// ✅ Lifecycle management policies on storage accounts
resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  name: 'default'
  parent: storageAccount
  properties: {
    policy: {
      rules: [{
        name: 'move-cool-after-30-days'
        type: 'Lifecycle'
        definition: {
          filters: { blobTypes: ['blockBlob']; prefixes: ['logs/'] }
          actions: {
            baseBlob: {
              tierToCool: { daysAfterModificationGreaterThan: 30 }
              delete:    { daysAfterModificationGreaterThan: 365 }
            }
          }
        }
      }]
    }
  }
}
```

### Cost Optimization Checklist

- [ ] Budget alerts configured on all subscriptions and resource groups
- [ ] Dev/test uses appropriate SKUs (B-series VMs, basic tiers)
- [ ] Auto-shutdown on non-production VMs during off-hours
- [ ] Orphaned resources identified and removed (unattached disks, unused IPs, empty RGs)
- [ ] Storage lifecycle policies: move to Cool/Archive, delete expired data
- [ ] Reserved Instances or Savings Plans applied to steady-state production workloads
- [ ] Azure Hybrid Benefit applied where applicable
- [ ] Right-sizing reviewed via Azure Advisor recommendations

---

## Operational Excellence

```bicep
// ✅ Deployment slots for zero-downtime deploys (App Service)
resource stagingSlot 'Microsoft.Web/sites/slots@2023-01-01' = {
  name: 'staging'
  parent: appService
  properties: { serverFarmId: appServicePlan.id }
}

// ✅ Diagnostic settings on all resources — logs to Log Analytics
// ✅ Health endpoints on all services (/health, /ready, /live)
// ✅ Infrastructure changes only via IaC — no manual portal edits
```

### Operational Excellence Checklist

- [ ] All infrastructure changes deployed via IaC (Bicep/Terraform) — no manual edits
- [ ] Deployment slots or blue/green strategy for zero-downtime releases
- [ ] Health endpoints (`/health`, `/ready`) on all services
- [ ] Diagnostic settings deployed for all resources → Log Analytics
- [ ] Runbooks documented for: rollback, database restore, incident response
- [ ] Change management: every deploy tied to a PR and approval
- [ ] Alerts configured for error rate, latency, availability thresholds
- [ ] Regular disaster recovery drills scheduled

---

## Performance Efficiency

```bicep
// ✅ CDN or Front Door for globally distributed static assets and APIs
// ✅ Auto-scale on compute resources
// ✅ Redis Cache for hot data paths
// ✅ Read replicas for read-heavy database workloads
// ✅ Correct SKU tier -- don't overprovision dev, don't underprovision prod
```

### Performance Efficiency Checklist

- [ ] Auto-scale configured on App Service / AKS / Container Apps
- [ ] Azure Front Door or CDN for global distribution of static content
- [ ] Redis Cache for session state and hot data (avoid database round-trips)
- [ ] Database connection pooling configured to avoid connection exhaustion
- [ ] Load test results validate performance at expected peak load
- [ ] Azure Monitor + Application Insights tracking P50/P95/P99 latency
- [ ] No N+1 query patterns in application code
- [ ] SKU tiers right-sized per environment (premium in prod, basic in dev)

---

## WAF Assessment Integration

Use this as input to the `azure-sweeper.agent.md` WAF layer. The sweeper evaluates each pillar independently and reports weighted findings.

```powershell
# Run WAF alignment check via Azure Advisor (CLI)
az advisor recommendation list \
  --filter "Category eq 'HighAvailability' or Category eq 'Security' or Category eq 'Cost' or Category eq 'OperationalExcellence' or Category eq 'Performance'" \
  --output table
```
