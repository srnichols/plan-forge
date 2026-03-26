<#
.SYNOPSIS
    Plan Forge — PostToolUse Hook: Auto-Format
    Runs the project's formatter on edited files after each edit.
#>
$ErrorActionPreference = 'SilentlyContinue'

$input = [Console]::In.ReadToEnd()
$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) { $repoRoot = "." }

$toolName = if ($input -match '"tool_name"\s*:\s*"([^"]+)"') { $Matches[1] } else { "" }
$filePath = if ($input -match '"filePath"\s*:\s*"([^"]+)"') { $Matches[1] } else { "" }

$editTools = @('editFiles', 'create_file', 'replace_string_in_file', 'insert_edit_into_file', 'multi_replace_string_in_file')
if ($toolName -notin $editTools) {
    Write-Output "{}"
    exit 0
}

if (-not $filePath -or -not (Test-Path $filePath)) {
    Write-Output "{}"
    exit 0
}

$skipExtensions = @('.md', '.json', '.txt', '.csv', '.xml')
$ext = [System.IO.Path]::GetExtension($filePath)
if ($ext -in $skipExtensions) {
    Write-Output "{}"
    exit 0
}

$formatRan = $false

# .NET — dotnet format
if ((Test-Path (Join-Path $repoRoot "global.json")) -or (Get-ChildItem $repoRoot -Filter "*.sln" -ErrorAction SilentlyContinue)) {
    $null = dotnet format --include $filePath --no-restore 2>$null
    if ($LASTEXITCODE -eq 0) { $formatRan = $true }
}

# Node/TypeScript — prettier
if (-not $formatRan -and (Test-Path (Join-Path $repoRoot "package.json"))) {
    $prettier = Join-Path $repoRoot "node_modules/.bin/prettier"
    if (Test-Path $prettier) {
        $null = npx prettier --write $filePath 2>$null
        if ($LASTEXITCODE -eq 0) { $formatRan = $true }
    }
}

# Python — ruff or black
if (-not $formatRan -and ((Test-Path (Join-Path $repoRoot "pyproject.toml")) -or (Test-Path (Join-Path $repoRoot "requirements.txt")))) {
    if (Get-Command ruff -ErrorAction SilentlyContinue) {
        $null = ruff format $filePath 2>$null
        if ($LASTEXITCODE -eq 0) { $formatRan = $true }
    }
    elseif (Get-Command black -ErrorAction SilentlyContinue) {
        $null = black $filePath 2>$null
        if ($LASTEXITCODE -eq 0) { $formatRan = $true }
    }
}

# Go — gofmt
if (-not $formatRan -and (Test-Path (Join-Path $repoRoot "go.mod")) -and $filePath -like "*.go") {
    $null = gofmt -w $filePath 2>$null
    if ($LASTEXITCODE -eq 0) { $formatRan = $true }
}

# Java — google-java-format (if available)
if (-not $formatRan -and ((Test-Path (Join-Path $repoRoot "pom.xml")) -or (Test-Path (Join-Path $repoRoot "build.gradle")))) {
    if (Get-Command google-java-format -ErrorAction SilentlyContinue) {
        $null = google-java-format --replace $filePath 2>$null
        if ($LASTEXITCODE -eq 0) { $formatRan = $true }
    }
}

Write-Output "{}"
