<#
.SYNOPSIS
    Plan Forge — PreDeploy Hook (PreToolUse gate)
    Checks secret-scan and env-diff caches before deploy-pattern file writes or commands.
    Returns permissionDecision: "deny" when secrets are found and blockOnSecrets is enabled.
#>
$ErrorActionPreference = 'SilentlyContinue'

$input = [Console]::In.ReadToEnd()
$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) { $repoRoot = "." }

# Parse tool name, file path, and command from JSON input
$toolName = if ($input -match '"tool_name"\s*:\s*"([^"]+)"') { $Matches[1] } else { "" }
$filePath = if ($input -match '"filePath"\s*:\s*"([^"]+)"') { $Matches[1] } else { "" }
$command  = if ($input -match '"command"\s*:\s*"([^"]+)"') { $Matches[1] } else { "" }

# ── Deploy trigger detection ──────────────────────────────────────────
$isDeployTrigger = $false

if ($filePath) {
    $normalized = $filePath -replace '\\', '/'
    $deployPatterns = @('^deploy/', '^Dockerfile', '\.bicep$', '\.tf$', '^k8s/', '^docker-compose.*\.yml$')
    foreach ($pattern in $deployPatterns) {
        if ($normalized -match $pattern) {
            $isDeployTrigger = $true
            break
        }
    }
}

if (-not $isDeployTrigger -and $command) {
    $commandPatterns = @('\bpforge\s+deploy-log\b', '\bdocker\s+push\b', '\baz\s+deploy\b', '\bkubectl\s+apply\b', '\bazd\s+up\b', '\bgit\s+push\b')
    foreach ($pattern in $commandPatterns) {
        if ($command -match $pattern) {
            $isDeployTrigger = $true
            break
        }
    }
}

if (-not $isDeployTrigger) {
    Write-Output "{}"
    exit 0
}

# ── Load config ──────────────────────────────────────────────────────
$blockOnSecrets = $true
$warnOnEnvGaps = $true
$hookEnabled = $true

$forgeConfigPath = Join-Path $repoRoot ".forge.json"
if (Test-Path $forgeConfigPath) {
    try {
        $forgeConfig = Get-Content $forgeConfigPath -Raw | ConvertFrom-Json
        if ($forgeConfig.hooks -and $forgeConfig.hooks.preDeploy) {
            if ($null -ne $forgeConfig.hooks.preDeploy.blockOnSecrets) {
                $blockOnSecrets = [bool]$forgeConfig.hooks.preDeploy.blockOnSecrets
            }
            if ($null -ne $forgeConfig.hooks.preDeploy.warnOnEnvGaps) {
                $warnOnEnvGaps = [bool]$forgeConfig.hooks.preDeploy.warnOnEnvGaps
            }
            if ($null -ne $forgeConfig.hooks.preDeploy.enabled) {
                $hookEnabled = [bool]$forgeConfig.hooks.preDeploy.enabled
            }
        }
    } catch { }
}

# Exit early if hook is explicitly disabled
if (-not $hookEnabled) {
    Write-Output "{}"
    exit 0
}

# ── Check secret-scan cache ──────────────────────────────────────────
$secretCachePath = Join-Path $repoRoot ".forge/secret-scan-cache.json"
if ((Test-Path $secretCachePath) -and $blockOnSecrets) {
    try {
        $secretCache = Get-Content $secretCachePath -Raw | ConvertFrom-Json
        if ($secretCache.clean -eq $false -and $secretCache.findings -and $secretCache.findings.Count -gt 0) {
            $count = $secretCache.findings.Count
            $reason = "PreDeploy BLOCKED: LiveGuard detected $count potential secret(s). Deploy is blocked until resolved. Run: pforge secret-scan --since HEAD~1"
            $escaped = $reason -replace '"', '\"'
            Write-Output "{`"hookSpecificOutput`":{`"hookEventName`":`"PreToolUse`",`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$escaped`"}}"
            exit 0
        }
    } catch { }
}

# ── Check env-diff cache (advisory only — never blocks) ──────────────
$envCachePath = Join-Path $repoRoot ".forge/env-diff-cache.json"
if ((Test-Path $envCachePath) -and $warnOnEnvGaps) {
    try {
        $envCache = Get-Content $envCachePath -Raw | ConvertFrom-Json
        $totalMissing = 0
        if ($envCache.summary.totalMissing) { $totalMissing = $envCache.summary.totalMissing }
        elseif ($envCache.summary.totalGaps) { $totalMissing = $envCache.summary.totalGaps }

        if ($totalMissing -gt 0) {
            Write-Warning "PreDeploy Advisory: $totalMissing missing env key(s) detected. Deploy will proceed, but target environment may be missing required config."
        }
    } catch { }
}

# Allow the deploy action
Write-Output "{}"
