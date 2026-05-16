#!/usr/bin/env pwsh
# Memory-QA smoke test — verifies v2.95.0 memory-upgrade tools are present and wired.
# Exit code = number of failing checks.
# Output format: [OK|FAIL|SKIP] <check-name> [- <reason>]
#
# Env overrides:
#   PFORGE_MCP_PORT  — MCP server port (default: 3100)
#   OPENBRAIN_URL    — if set, checks OpenBrain /health for provenance capability

$ErrorActionPreference = 'Continue'

$Pass      = 0
$Fail      = 0
$Skip      = 0
$FailNames = @()

function Write-Ok($name) {
    Write-Host "[OK]   $name"
    $script:Pass++
}
function Write-Fail($name, $reason) {
    Write-Host "[FAIL] $name - $reason"
    $script:Fail++
    $script:FailNames += $name
}
function Write-Skip($name, $reason) {
    Write-Host "[SKIP] $name - $reason"
    $script:Skip++
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════╗"
Write-Host "║   Plan Forge — Memory QA Smoke (v2.95.0)           ║"
Write-Host "╚════════════════════════════════════════════════════╝"
Write-Host ""

# ── MCP server availability ───────────────────────────────────────────
$McpPort      = if ($env:PFORGE_MCP_PORT) { $env:PFORGE_MCP_PORT } else { "3100" }
$McpAvailable = $false
try {
    $null = Invoke-WebRequest -Uri "http://localhost:$McpPort/api/health" -TimeoutSec 2 -ErrorAction Stop
    $McpAvailable = $true
} catch {
    $McpAvailable = $false
}

# ── Check 1: pforge anvil stat ────────────────────────────────────────
if ($McpAvailable) {
    try {
        $null = & bash "$RepoRoot/pforge.sh" anvil stat 2>&1
        if ($LASTEXITCODE -eq 0) { Write-Ok "pforge-anvil-stat" }
        else { Write-Fail "pforge-anvil-stat" "pforge anvil stat exited $LASTEXITCODE" }
    } catch {
        Write-Fail "pforge-anvil-stat" $_.Exception.Message
    }
} else {
    Write-Skip "pforge-anvil-stat" "MCP server not running on port $McpPort"
}

# ── Check 2: pforge hallmark show ────────────────────────────────────
if ($McpAvailable) {
    try {
        $null = & bash "$RepoRoot/pforge.sh" hallmark show 2>&1
        if ($LASTEXITCODE -eq 0) { Write-Ok "pforge-hallmark-show" }
        else { Write-Fail "pforge-hallmark-show" "pforge hallmark show exited $LASTEXITCODE" }
    } catch {
        Write-Fail "pforge-hallmark-show" $_.Exception.Message
    }
} else {
    Write-Skip "pforge-hallmark-show" "MCP server not running on port $McpPort"
}

# ── Check 3: pforge lattice stat ─────────────────────────────────────
if ($McpAvailable) {
    try {
        $null = & bash "$RepoRoot/pforge.sh" lattice stat 2>&1
        if ($LASTEXITCODE -eq 0) { Write-Ok "pforge-lattice-stat" }
        else { Write-Fail "pforge-lattice-stat" "pforge lattice stat exited $LASTEXITCODE" }
    } catch {
        Write-Fail "pforge-lattice-stat" $_.Exception.Message
    }
} else {
    Write-Skip "pforge-lattice-stat" "MCP server not running on port $McpPort"
}

# ── Check 4: tools.json lists the 15 v2.95.0 tools ───────────────────
$ToolsJson     = Join-Path $RepoRoot "pforge-mcp/tools.json"
$ExpectedTools = @(
    "forge_testbed_run", "forge_testbed_findings", "forge_testbed_happypath",
    "forge_anvil_stat",  "forge_anvil_clear",       "forge_anvil_rebuild",
    "forge_anvil_dlq_list", "forge_anvil_dlq_drain",
    "forge_hallmark_show",  "forge_hallmark_verify",
    "forge_lattice_index",  "forge_lattice_stat",    "forge_lattice_query",
    "forge_lattice_callers", "forge_lattice_blast"
)
if (Test-Path $ToolsJson) {
    $ToolsContent = Get-Content $ToolsJson -Raw
    $Missing = @()
    foreach ($tool in $ExpectedTools) {
        if ($ToolsContent -notmatch [regex]::Escape("`"$tool`"")) {
            $Missing += $tool
        }
    }
    if ($Missing.Count -eq 0) { Write-Ok "forge-capabilities-15-tools" }
    else { Write-Fail "forge-capabilities-15-tools" "missing: $($Missing -join ', ')" }
} else {
    Write-Fail "forge-capabilities-15-tools" "pforge-mcp/tools.json not found"
}

# ── Check 5: .gitignore template includes .forge/anvil/ ──────────────
$GitignoreTmpl = Join-Path $RepoRoot "templates/.gitignore"
if (Test-Path $GitignoreTmpl) {
    $GitContent = Get-Content $GitignoreTmpl -Raw
    if ($GitContent -match [regex]::Escape(".forge/anvil/")) { Write-Ok "gitignore-anvil-entry" }
    else { Write-Fail "gitignore-anvil-entry" ".forge/anvil/ not found in templates/.gitignore" }
} else {
    Write-Fail "gitignore-anvil-entry" "templates/.gitignore not found"
}

# ── Check 6: .gitignore template includes .forge/lattice/ ────────────
if (Test-Path $GitignoreTmpl) {
    $GitContent = Get-Content $GitignoreTmpl -Raw
    if ($GitContent -match [regex]::Escape(".forge/lattice/")) { Write-Ok "gitignore-lattice-entry" }
    else { Write-Fail "gitignore-lattice-entry" ".forge/lattice/ not found in templates/.gitignore" }
} else {
    Write-Fail "gitignore-lattice-entry" "templates/.gitignore not found"
}

# ── Check 7 & 8: OpenBrain /health + provenance capability ───────────
$OpenBrainUrl = $env:OPENBRAIN_URL
if ($OpenBrainUrl) {
    try {
        $HealthResp = Invoke-WebRequest -Uri "$OpenBrainUrl/health" -TimeoutSec 5 -ErrorAction Stop
        Write-Ok "openbrain-health"
        if ($HealthResp.Content -match '"provenance"') {
            Write-Ok "openbrain-provenance-capability"
        } else {
            Write-Fail "openbrain-provenance-capability" `
                "response does not include provenance capability (requires OpenBrain >= 0.7.0)"
        }
    } catch {
        Write-Fail "openbrain-health" "$OpenBrainUrl/health did not respond: $($_.Exception.Message)"
        Write-Skip "openbrain-provenance-capability" "openbrain-health check failed"
    }
} else {
    Write-Skip "openbrain-health" "OPENBRAIN_URL not set"
    Write-Skip "openbrain-provenance-capability" "OPENBRAIN_URL not set"
}

# ── Summary ───────────────────────────────────────────────────────────
Write-Host ""
Write-Host "────────────────────────────────────────────────────"
Write-Host "  $Pass passed | $Fail failed | $Skip skipped"
Write-Host "────────────────────────────────────────────────────"
Write-Host ""

if ($Fail -gt 0) {
    Write-Host "❌ Smoke FAILED — $($FailNames -join ', ')"
    exit $Fail
}
Write-Host "✅ Smoke passed."
exit 0
