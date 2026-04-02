---
description: Azure Policy and Initiative compliance — definitions, assignment, compliance state, exemptions, remediation tasks
applyTo: '**/*.bicep,**/*.tf,**/*.ps1'
---

# Azure Policy & Initiative Compliance

> Azure Policy is the **enforcement layer** — it makes Landing Zone standards compulsory, not optional.

---

## Policy Effect Hierarchy

| Effect | Behavior | Typical Use |
|--------|----------|-------------|
| `Disabled` | Policy off | Temporary suppression only |
| `Audit` | Log non-compliance; allow resource | Discovery, initial rollout |
| `AuditIfNotExists` | Audit if related resource is missing | Check for associated resources |
| `Modify` | Auto-correct tags or properties | Tag enforcement |
| `Append` | Add properties without replace | Adding tags |
| `DeployIfNotExists` | Auto-deploy missing resources | Diagnostic settings, agents |
| `Deny` | Block non-compliant resource creation | Enforce hard requirements |

> **Progressive rollout**: Start with `Audit`, validate coverage, then promote to `Deny`.

---

## Core Policy Assignments (Landing Zone Level)

```bicep
// Assignment at management group scope — applies to all child subscriptions
targetScope = 'managementGroup'

// ✅ Deploy diagnostic settings automatically (DeployIfNotExists)
resource diagPolicy 'Microsoft.Authorization/policyAssignments@2023-04-01' = {
  name: 'deploy-diagnostic-settings'
  location: 'eastus'
  identity: { type: 'SystemAssigned' }   // ← DINE policies require managed identity
  properties: {
    policyDefinitionId: '/providers/Microsoft.Authorization/policySetDefinitions/{initiative-id}'
    enforcementMode: 'Default'
    parameters: {
      logAnalyticsWorkspaceId: { value: logAnalyticsWorkspaceId }
    }
  }
}

// ✅ Deny public network access on storage accounts
resource denyPublicStorage 'Microsoft.Authorization/policyAssignments@2023-04-01' = {
  name: 'deny-public-storage'
  properties: {
    policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/b2982f36-99f2-4db5-8eff-19bf0ddc60be'
    enforcementMode: 'Default'
    displayName: 'Deny public network access on Storage Accounts'
  }
}

// ✅ Require mandatory tags (Deny effect)
resource requireTagsPolicy 'Microsoft.Authorization/policyAssignments@2023-04-01' = {
  name: 'require-mandatory-tags'
  properties: {
    policyDefinitionId: mandatoryTagsInitiativeId
    enforcementMode: 'Default'
  }
}
```

---

## Custom Policy Definition

```bicep
// ✅ Custom policy: deny resources without CostCenter tag
resource requireCostCenterPolicy 'Microsoft.Authorization/policyDefinitions@2023-04-01' = {
  name: 'require-costcenter-tag'
  properties: {
    policyType: 'Custom'
    mode: 'Indexed'
    displayName: 'Require CostCenter tag on resources'
    description: 'All resources must have a CostCenter tag for FinOps chargeback.'
    metadata: { category: 'Tags'; version: '1.0.0' }
    policyRule: {
      if: {
        field: 'tags[CostCenter]'
        exists: 'false'
      }
      then: {
        effect: '[parameters(\'effect\')]'
      }
    }
    parameters: {
      effect: {
        type: 'String'
        allowedValues: ['Audit', 'Deny', 'Disabled']
        defaultValue: 'Audit'
      }
    }
  }
}
```

---

## Policy Initiative (Policy Set)

```bicep
// ✅ Group related policies into initiatives for easier management
resource securityBaseline 'Microsoft.Authorization/policySetDefinitions@2023-04-01' = {
  name: 'security-baseline-initiative'
  properties: {
    policyType: 'Custom'
    displayName: 'Security Baseline Initiative'
    metadata: { category: 'Security'; version: '1.0.0' }
    policyDefinitions: [
      {
        policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/b2982f36-99f2-4db5-8eff-19bf0ddc60be'
        parameters: {}
        // Deny storage account public access
      }
      {
        policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/a4af4a39-4135-47fb-b175-47fbdf85311d'
        parameters: {}
        // Audit VM without endpoint protection
      }
    ]
  }
}
```

---

## Reading Compliance State (CLI)

```powershell
# ✅ Get overall compliance summary for a subscription
az policy state summarize \
  --subscription $subscriptionId \
  --query "results | {compliant: policyStates[?complianceState=='Compliant'] | length(@), nonCompliant: policyStates[?complianceState=='NonCompliant'] | length(@)}"

# ✅ List all non-compliant resources for a specific policy
az policy state list \
  --subscription $subscriptionId \
  --filter "complianceState eq 'NonCompliant'" \
  --query "[].{Resource:resourceId, Policy:policyAssignmentName, Reason:complianceReasonCode}" \
  --output table

# ✅ List non-compliant resources across a management group
az policy state list \
  --management-group $managementGroupId \
  --filter "complianceState eq 'NonCompliant'" \
  --output table

# ✅ Export full compliance report to JSON
az policy state list \
  --subscription $subscriptionId \
  --output json > policy-compliance-$(Get-Date -Format 'yyyyMMdd').json
```

---

## Exemptions

```bicep
// ✅ Policy exemption — time-bounded, documented reason
resource policyExemption 'Microsoft.Authorization/policyExemptions@2022-07-01-preview' = {
  name: 'exempt-legacy-storage-account'
  properties: {
    policyAssignmentId: denyPublicStorageAssignment.id
    exemptionCategory: 'Waiver'               // Waiver | Mitigated
    displayName: 'Legacy storage account — migration in progress'
    description: 'Migration ticket: https://jira.corp.com/PLAT-1234. Target: 2026-07-01.'
    expiresOn: '2026-07-01T00:00:00Z'         // ← ALWAYS set an expiry
    metadata: {
      approvedBy: 'platform-team'
      approvedDate: '2026-04-01'
      ticketUrl: 'https://jira.corp.com/PLAT-1234'
    }
  }
}
```

> **Rules for exemptions:**
> - Always time-bounded — no permanent exemptions
> - `metadata` must include approver, date, and ticket URL
> - Review exemptions quarterly and clean up expired ones

---

## Remediation Tasks

```powershell
# ✅ Trigger remediation for a DINE or Modify policy
az policy remediation create \
  --name "remediate-diagnostic-settings-$(Get-Date -Format 'yyyyMMdd')" \
  --policy-assignment "/subscriptions/$subscriptionId/providers/Microsoft.Authorization/policyAssignments/deploy-diagnostic-settings" \
  --resource-discovery-mode ReEvaluateCompliance \
  --subscription $subscriptionId

# ✅ Check remediation status
az policy remediation show \
  --name "remediate-diagnostic-settings-20260402" \
  --subscription $subscriptionId \
  --query "{Status:provisioningState, Succeeded:deploymentSummary.successfulDeployments, Failed:deploymentSummary.failedDeployments}"
```

---

## Terraform: Policy Assignment

```hcl
# ✅ Assign built-in initiative via Terraform
resource "azurerm_subscription_policy_assignment" "security_benchmark" {
  name                 = "azure-security-benchmark"
  subscription_id      = data.azurerm_subscription.current.id
  policy_definition_id = "/providers/Microsoft.Authorization/policySetDefinitions/1f3afdf9-d0c9-4c3d-847f-89da613e70a8" # Azure Security Benchmark v3
  display_name         = "Azure Security Benchmark"
  enforce              = true  # Deny effect; set false for Audit-only
}

# ✅ Policy exemption via Terraform
resource "azurerm_resource_policy_exemption" "legacy_storage" {
  name                 = "exempt-legacy-storage"
  resource_id          = azurerm_storage_account.legacy.id
  policy_assignment_id = azurerm_subscription_policy_assignment.deny_public_storage.id
  exemption_category   = "Waiver"
  description          = "Migration in progress. Ticket: PLAT-1234. Expires 2026-07-01."
  expires_on           = "2026-07-01T00:00:00Z"
}
```

---

## Policy Compliance Checklist

- [ ] Key initiatives assigned at management group level (not just subscription)
- [ ] `Deny` policies in place for: public network access, required tags, allowed locations
- [ ] `DeployIfNotExists` policies for: diagnostic settings, agent provisioning
- [ ] Non-compliance rate < 5% across production subscriptions
- [ ] All exemptions have expiry dates and documented justification
- [ ] Remediation tasks triggered for DINE/Modify non-compliance
- [ ] Compliance report exported monthly to management dashboard
- [ ] Custom policies reviewed and version-bumped when updated
- [ ] Policy effect transitions documented: Audit → Deny (with stakeholder sign-off)
