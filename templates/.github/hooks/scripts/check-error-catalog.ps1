$ErrorActionPreference = 'SilentlyContinue'
$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) { $repoRoot = "." }

$checker = Join-Path $repoRoot "scripts\check-error-catalog.mjs"
if (-not (Test-Path $checker)) {
    Write-Output "{}"
    exit 0
}

$output = node $checker 2>&1
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    $msg = ($output -join ' ') -replace '"', "'"
    Write-Output "{""blocked"":true,""message"":""error-catalog out of sync: $msg Run: node scripts/generate-error-catalog.mjs""}"
    exit 0
}

Write-Output "{}"
