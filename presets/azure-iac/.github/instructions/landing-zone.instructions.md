---
description: Azure Landing Zone baselines — identity, network, policy, management, security, tagging, subscription organization
applyTo: '**/*.bicep,**/*.tf,**/*.ps1'
---

# Azure Landing Zone Standards

> Based on the [Azure Landing Zone conceptual architecture](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/landing-zone/).
> Landing Zones are the **enterprise rulebook** — the infrastructure baselines that every workload
> subscription must conform to before workload code is deployed.

---

## Architecture Overview

```
                    ┌──────────────────────────────────┐
                    │         Management Baseline       │
                    │  Log Analytics · Automation ·    │
                    │  Backup · Update Mgmt · ASC       │
                    └────────────────┬─────────────────┘
                                     │ feeds
┌───────────────┐   ┌────────────────▼─────────────────┐   ┌──────────────────┐
│ Identity      │   │         Security Baseline         │   │ Network Baseline │
│ Baseline      │──►│  Defender · Sentinel · JIT ·     │◄──│ Hub-Spoke · AFW  │
│ AAD · PIM ·   │   │  SIEM · CVA · Secure Score       │   │ NSG · UDR · DNS  │
│ CA · MFA      │   └────────────────┬─────────────────┘   └──────────────────┘
└───────────────┘                    │ enforced by
                    ┌────────────────▼─────────────────┐
                    │         Policy Baseline           │
                    │  Initiatives · Deny · Audit ·    │
                    │  DeployIfNotExists · Remediation  │
                    └────────────────┬─────────────────┘
                                     │ governs
                    ┌────────────────▼─────────────────┐
                    │  Workload Subscriptions           │
                    │  (Corp · Online · Sandbox)        │
                    └──────────────────────────────────┘
```

---

## Identity Baseline

```bicep
// ✅ User-assigned managed identity per workload (not system-assigned)
// ✅ No service principals with client_secret in production
// ✅ PIM for all Owner/Contributor role assignments (no standing access)

// PIM role assignment via Bicep (eligible, not active)
resource pimRoleEligibility 'Microsoft.Authorization/roleEligibilityScheduleRequests@2022-04-01-preview' = {
  name: guid(subscription().id, principalId, contributorRoleId)
  properties: {
    principalId: principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', contributorRoleId)
    requestType: 'AdminAssign'
    scheduleInfo: {
      startDateTime: utcNow()
      expiration: { type: 'NoExpiration' }
    }
    ticketInfo: {}
  }
}
```

### Identity Baseline Controls

- [ ] All admin accounts require MFA — enforced by Conditional Access
- [ ] Break-glass accounts: 2 global admin accounts excluded from MFA/CA policies
- [ ] PIM enabled — no standing Owner or Contributor in production subscriptions
- [ ] Application identity: user-assigned managed identity; never client secret
- [ ] Guest access restricted — external identities require approval and quarterly review
- [ ] AAD Password Protection enabled (no common/banned passwords)
- [ ] Sign-in risk and user risk Conditional Access policies configured

---

## Network Baseline

```bicep
// ✅ Hub-Spoke topology: all workload VNets peer to hub VNet
// ✅ Azure Firewall or NVA in hub for East-West and North-South traffic inspection
// ✅ DNS: custom DNS via hub (private DNS zones centralized)
// ✅ No direct internet egress from workload VNets — route through hub FW

// Workload VNet with forced tunneling via hub
resource vnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  properties: {
    addressSpace: { addressPrefixes: [vnetAddressSpace] }
    dhcpOptions: { dnsServers: [hubDnsResolverIp] }   // ← use hub DNS, not Azure default
  }
}

// ✅ UDR: default route (0.0.0.0/0) pointing to Azure Firewall in hub
resource defaultRoute 'Microsoft.Network/routeTables@2023-09-01' = {
  properties: {
    routes: [{
      name: 'default-to-firewall'
      properties: {
        addressPrefix: '0.0.0.0/0'
        nextHopType: 'VirtualAppliance'
        nextHopIpAddress: hubFirewallPrivateIp
      }
    }]
    disableBgpRoutePropagation: true  // ← prevent BGP from overriding UDR
  }
}
```

### Network Baseline Controls

- [ ] Hub-spoke topology — workload VNets peer to hub with no direct internet egress
- [ ] Azure Firewall or NVA in hub inspects all East-West and North-South traffic
- [ ] NSG on every subnet — no subnet without NSG attached
- [ ] NSG flow logs enabled — sent to Log Analytics
- [ ] Private DNS zones centralized in hub connectivity subscription
- [ ] No public IP on workload VMs
- [ ] Private endpoint for every PaaS service (Key Vault, Storage, ACR, SQL, etc.)
- [ ] Service Endpoints disabled where Private Endpoints are used
- [ ] DDoS Protection Standard on hub VNet
- [ ] Azure Bastion deployed in hub for VM management (no public RDP/SSH)

---

## Policy Baseline

> See `policy.instructions.md` for full Azure Policy patterns.

Core built-in initiatives to assign at Landing Zone management group:

| Initiative | Assignment Scope | Effect |
|-----------|-----------------|--------|
| `Azure Security Benchmark` | Management group | Audit |
| `NIST SP 800-53 Rev. 5` | Management group (if required) | Audit |
| `Enforce tag and its value on resources` | Subscription | Deny |
| `Configure diagnostic settings to Log Analytics` | Subscription | DeployIfNotExists |
| `Require HTTPS on Storage Accounts` | Subscription | Deny |
| `No public IP on VMs` | Corp LZ MG | Deny |
| `Allowed locations` | Subscription | Deny |

---

## Management Baseline

```bicep
// ✅ Central Log Analytics Workspace — all subscriptions send logs here
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-management-${environmentName}'
  properties: {
    retentionInDays: 90              // ← minimum 90 days; 365 for production
    sku: { name: 'PerGB2018' }
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

// ✅ Azure Monitor: action groups for alert routing
resource actionGroup 'microsoft.insights/actionGroups@2023-01-01' = {
  properties: {
    enabled: true
    emailReceivers: [{
      name: 'platform-alerts'
      emailAddress: platformAlertEmail
      useCommonAlertSchema: true
    }]
  }
}
```

### Management Baseline Controls

- [ ] Central Log Analytics workspace in management subscription
- [ ] All subscription activity logs forwarded to central Log Analytics
- [ ] Azure Monitor alert rules: subscription activity, security events, cost anomalies
- [ ] Azure Automation: Update Management enabled for VM patch compliance
- [ ] Azure Backup: vault per workload, backup policies with defined retention
- [ ] Azure Policy: DeployIfNotExists for diagnostic settings on all resource types
- [ ] Service health alerts configured for subscription-level events

---

## Security Baseline

```powershell
# ✅ Enable Defender for Cloud Standard on all subscriptions
$plans = @('VirtualMachines', 'SqlServers', 'AppServices', 'StorageAccounts',
           'Containers', 'KeyVaults', 'Dns', 'Arm', 'SqlServerVirtualMachines')
foreach ($plan in $plans) {
    Set-AzSecurityPricing -Name $plan -PricingTier 'Standard'
}

# ✅ Configure auto-provisioning of MMA/AMA agent
Set-AzSecurityAutoProvisioningSetting -Name 'mma' -EnableAutoProvision
```

### Security Baseline Controls

- [ ] Defender for Cloud Standard tier on all production subscriptions
- [ ] Secure Score target ≥ 75% (track monthly)
- [ ] Vulnerability assessment enabled on all VMs and container images
- [ ] Microsoft Sentinel workspace connected in SIEM subscription
- [ ] Just-in-time (JIT) VM access enabled — no permanent RDP/SSH open
- [ ] Endpoint protection (Defender for Endpoint) on all VMs
- [ ] File integrity monitoring on critical VMs
- [ ] Security alerts integrated with ITSM / incident management

---

## Tagging Baseline

All resources must carry these tags or deployment is blocked by policy:

```bicep
// ✅ These tags are required — Azure Policy enforces via Deny effect
var requiredTags = {
  Environment:        environmentName      // dev | test | staging | prod
  Workload:           workloadName
  Owner:              ownerAlias
  CostCenter:         costCenter
  ManagedBy:          'Bicep'
  ClassificationLevel: dataClassification  // public | internal | confidential | restricted
}
```

---

## Landing Zone Checklist (Pre-Workload Deployment)

Before deploying any workload subscription to production, verify:

### Identity
- [ ] PIM enabled on subscription — no standing Owner/Contributor
- [ ] Managed Identity provisioned for workload (not service principal with secret)
- [ ] RBAC role assignments at resource group scope (not subscription)

### Networking
- [ ] VNet peered to hub
- [ ] UDR applied — default route via Azure Firewall
- [ ] NSG on all subnets with flow logs enabled
- [ ] Private endpoints deployed for all PaaS dependencies
- [ ] No public IPs on VMs

### Policy
- [ ] Subscription assigned to correct management group
- [ ] Policy compliance ≥ 90% before workload goes live
- [ ] All Deny policies pass (check with `az policy state list`)

### Management
- [ ] Diagnostic settings sending to central Log Analytics
- [ ] Azure Backup vault configured
- [ ] Budget alert configured

### Security
- [ ] Defender for Cloud Standard tier active
- [ ] Secure Score baseline recorded
- [ ] No critical/high findings unresolved in Defender for Cloud
