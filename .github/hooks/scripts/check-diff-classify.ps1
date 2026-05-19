$ErrorActionPreference = 'SilentlyContinue'
$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) { $repoRoot = "." }

$modulePath = Join-Path $repoRoot "pforge-mcp\diff-classify.mjs"
if (-not (Test-Path $modulePath)) {
    Write-Output "{}"
    exit 0
}

$diff = git diff --cached 2>$null
if (-not $diff) {
    Write-Output "{}"
    exit 0
}

$env:PFORGE_DIFF_INPUT = $diff
$env:PFORGE_MODULE_PATH = $modulePath

$script = @'
const { classifyDiff, SEVERITY_ORDER } = await import(process.env.PFORGE_MODULE_PATH);
const diff = process.env.PFORGE_DIFF_INPUT || '';
const result = classifyDiff(diff);
const idx = SEVERITY_ORDER.indexOf(result.severity);
if (idx >= 3) {
  const cats = result.findings.map(f => f.category).join(', ');
  process.stdout.write(JSON.stringify({ blocked: true, message: `diff-classify blocked [${result.severity}]: ${cats}` }));
} else if (idx === 2) {
  const cats = result.findings.map(f => f.category).join(', ');
  process.stdout.write(JSON.stringify({ blocked: false, advisory: `diff-classify warning [medium]: ${cats}` }));
} else {
  process.stdout.write('{}');
}
'@

$result = $script | node --input-type=module
Write-Output $result
