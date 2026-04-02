# Skill: azure-sweep

Runs the full 8-layer Azure governance sweep using the Azure Sweeper agent.

## Description

Executes a prioritised compliance sweep across WAF, CAF, Landing Zone, Policy, Org Rules,
Resource Graph, Telemetry, and Remediation layers. Outputs a structured findings report
with Bicep, Terraform, and CLI remediation code.

## When to Use

- Before a production deployment
- After an environment is provisioned
- During quarterly compliance reviews
- When Advisor or Defender alerts spike
- When onboarding an existing subscription into CAF governance

## Prerequisites

| Requirement | Check |
|-------------|-------|
| Azure CLI authenticated | `az account show` |
| Correct subscription selected | `az account set --subscription <id>` |
| Resource Graph extension installed | `az extension add --name resource-graph` |
| Instruction files present | `presets/azure-iac/.github/instructions/` |
| Org rules initialised (optional) | `.github/instructions/org-rules.instructions.md` |

## Steps

### Step 0 — Scope & Setup

Confirm scope before running:

```powershell
# Set scope variables
$subscriptionId = (az account show --query id -o tsv)
$rg = "<resource-group>"   # or "ALL" for subscription-wide

Write-Host "Sweeping subscription: $subscriptionId"
Write-Host "Resource group scope: $rg"
```

---

### Step 1 — WAF Layer

```powershell
# Fetch Azure Advisor WAF recommendations
az advisor recommendation list `
  --filter "Category eq 'HighAvailability' or Category eq 'Security' or Category eq 'Cost' or Category eq 'OperationalExcellence' or Category eq 'Performance'" `
  --output json | ConvertFrom-Json | `
  Select-Object category, impact, shortDescription, resourceMetadata
```

Pass gate: No CRITICAL Advisor items in Reliability or Security pillars.

---

### Step 2 — CAF Layer

```powershell
# Management group placement
az account management-group list --output table

# Tag compliance per resource group
az group list --query "[].{RG:name, Tags:tags}" --output json | ConvertFrom-Json | `
  Where-Object { -not $_.Tags.Environment -or -not $_.Tags.Owner -or -not $_.Tags.CostCenter }
```

Pass gate: All resource groups have mandatory tags. Subscription is in correct MG tier.

---

### Step 3 — Landing Zone Layer

```powershell
# Standing privileged assignments
az role assignment list `
  --query "[?roleDefinitionName=='Owner' || roleDefinitionName=='Contributor' || roleDefinitionName=='User Access Administrator']" `
  --subscription $subscriptionId `
  --output table

# Subnets without NSG
az network vnet list `
  --query "[].subnets[?networkSecurityGroup==null].{Name:name, VNet:id}" `
  --output table

# Defender tiers
az security pricing list `
  --query "[?pricingTier=='Free'].name" `
  --output tsv
```

Pass gate: No standing Owner/Contributor. All subnets have NSG. Key Defender plans on Standard.

---

### Step 4 — Policy Layer

```powershell
# Non-compliance count
$nonCompliantCount = az policy state list `
  --subscription $subscriptionId `
  --filter "complianceState eq 'NonCompliant'" `
  --query "length(@)" `
  --output tsv

# Per-policy breakdown
az policy state list `
  --subscription $subscriptionId `
  --filter "complianceState eq 'NonCompliant'" `
  --query "[].{Resource:resourceId, Policy:policyAssignmentName}" `
  --output table

Write-Host "Non-compliant resources: $nonCompliantCount"
```

Pass gate: Non-compliant count < 5% of total resources. No CRITICAL policy violations.

---

### Step 5 — Org Rules Layer

```powershell
# Check org-rules file exists
$orgRulesPath = ".github/instructions/org-rules.instructions.md"
if (-not (Test-Path $orgRulesPath)) {
  Write-Warning "org-rules.instructions.md not found. Run /new-org-rules to initialise."
} else {
  Write-Host "Org rules loaded from: $orgRulesPath"
}
```

Manual audit: Compare resource SKUs, regions, and tags against org-rules.instructions.md.

---

### Step 6 — Resource Graph Inventory

```powershell
# Ensure resource-graph extension
az extension add --name resource-graph --only-show-errors

# Orphaned disks
az graph query -q `
  "Resources | where type == 'microsoft.compute/disks' | where properties.diskState == 'Unattached' | project name, resourceGroup, sku.name, properties.diskSizeGB" `
  --output table

# Empty resource groups
az graph query -q `
  "ResourceContainers | where type == 'microsoft.resources/subscriptions/resourcegroups' | join kind=leftouter (Resources | summarize count=count() by resourceGroup) on resourceGroup | where isnull(count) or count == 0 | project name, location" `
  --output table

# Storage with public access
az graph query -q `
  "Resources | where type == 'microsoft.storage/storageaccounts' | where properties.allowBlobPublicAccess == true | project name, resourceGroup, location" `
  --output table
```

Pass gate: No orphaned disks. No storage with public access. No public IPs unassociated.

---

### Step 7 — Telemetry Signals

```powershell
# Secure Score
az security secure-score list `
  --query "[].{Name:displayName, Score:score.current, Max:score.max, Percentage:score.percentage}" `
  --output table

# Active critical/high Defender alerts
az security alert list `
  --query "[?status.state!='Dismissed' && (severity=='High' || severity=='Critical')].{Alert:alertDisplayName, Severity:severity, Resource:alertUri}" `
  --output table

# Cost savings from Advisor
az advisor recommendation list `
  --category Cost `
  --query "[?impact!='Low'].{Impact:impact, Problem:shortDescription.problem, Savings:extendedProperties.savingsAmount}" `
  --output table
```

Pass gate: Secure Score ≥ 70%. No undismissed Critical alerts. No Large-impact cost items unaddressed > 30 days.

---

### Step 8 — Remediation Code Generation

After collecting all findings, the Azure Sweeper agent generates:

1. **Prioritised finding list** — ordered CRITICAL → LOW
2. **Remediation code** for each HIGH/CRITICAL finding in Bicep, Terraform, and/or CLI
3. **Impact statement** — security, cost, compliance impact per fix

---

## Output

## Persistent Memory (if OpenBrain is configured)

- **Before sweeping**: `search_thoughts("azure sweep findings", project: "<project>", created_by: "copilot-vscode", type: "convention")` — load prior sweep findings, accepted risks, and remediation patterns
- **After sweep completes**: `capture_thought("Azure sweep: <N findings across N layers — key issues and pass/fail>", project: "<project>", created_by: "copilot-vscode", source: "skill-azure-sweep")` — persist sweep results for trend tracking across runs

The skill produces a markdown sweep report:

```
azure-sweep-report-<subscription>-<YYYYMMDD>.md
```

Stored at the workspace root or specified output path.

---

## Pass/Fail Summary

| Layer | Pass Condition |
|-------|---------------|
| WAF | No CRITICAL Adviser items in Reliability/Security |
| CAF | All RGs tagged; subscription in correct MG tier |
| Landing Zone | No standing access; NSGs on all subnets; Defender Standard on key services |
| Policy | Non-compliant < 5%; no CRITICAL policy violations |
| Org Rules | All resources comply with org-rules.instructions.md |
| Resource Graph | No orphaned disks; no public storage; no stray public IPs |
| Telemetry | Secure Score ≥ 70%; no undismissed Critical alerts |

**Overall PASS**: All 7 layers pass.
**Overall WARN**: 1-2 layers have medium findings only.
**Overall FAIL**: Any CRITICAL/HIGH finding unresolved.
