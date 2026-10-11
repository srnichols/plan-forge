[CmdletBinding()]
param(
    [string]$Registry,
    [string]$Namespace,
    [string]$Tag,
    [string]$Variants = "node,dotnet,python",
    [string]$Platforms = "linux/amd64,linux/arm64",
    [string]$NodeVersion = "24",
    [switch]$Push,
    [switch]$DryRun,
    [switch]$Load
)

$ErrorActionPreference = "Stop"

function Stop-Build([string]$Message) {
    [Console]::Error.WriteLine("build-images: $Message")
    [Console]::Error.WriteLine("Usage: build-images.ps1 -Registry <host[:port]> -Namespace <name> -Tag <tag> [-Variants node,dotnet,python] [-Platforms linux/amd64,linux/arm64] [-NodeVersion 22|24] [-Push] [-Load] [-DryRun]")
    exit 2
}

if ([string]::IsNullOrWhiteSpace($Registry)) { Stop-Build "-Registry is required" }
if ([string]::IsNullOrWhiteSpace($Namespace)) { Stop-Build "-Namespace is required" }
if ([string]::IsNullOrWhiteSpace($Tag)) { Stop-Build "-Tag is required" }
if ($Registry -notmatch '^[A-Za-z0-9]+([.-][A-Za-z0-9]+)*(:[0-9]{1,5})?$') { Stop-Build "invalid registry: $Registry" }
if ($Registry.Contains(":")) {
    $port = [int]($Registry.Substring($Registry.LastIndexOf(":") + 1))
    if ($port -lt 1 -or $port -gt 65535) { Stop-Build "registry port must be between 1 and 65535" }
}
if ($Namespace -notmatch '^[a-z0-9]+([._-][a-z0-9]+)*(/[a-z0-9]+([._-][a-z0-9]+)*)*$') { Stop-Build "invalid namespace: $Namespace" }
if ($Tag -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') { Stop-Build "invalid tag: $Tag" }
if ($NodeVersion -notin @("22", "24")) { Stop-Build "-NodeVersion must be 22 or 24" }

$variantList = $Variants.Split(",")
if ($variantList.Count -eq 0 -or @($variantList | Where-Object { $_ -notin @("node", "dotnet", "python") }).Count -gt 0) {
    Stop-Build "-Variants must contain only node, dotnet, or python"
}
if (($variantList | Select-Object -Unique).Count -ne $variantList.Count) { Stop-Build "-Variants cannot contain duplicates" }

$platformList = $Platforms.Split(",")
if ($platformList.Count -eq 0 -or @($platformList | Where-Object { $_ -notin @("linux/amd64", "linux/arm64") }).Count -gt 0) {
    Stop-Build "-Platforms must contain linux/amd64 or linux/arm64"
}
if (($platformList | Select-Object -Unique).Count -ne $platformList.Count) { Stop-Build "-Platforms cannot contain duplicates" }
if ($Load -and $platformList.Count -gt 1) { Stop-Build "-Load cannot be used with multiple platforms" }
if ($Push -and $Load) { Stop-Build "-Push and -Load cannot be combined" }

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$contextDirectory = (Resolve-Path (Join-Path $scriptDirectory "..")).Path
$baseDockerfile = Join-Path $contextDirectory "deploy/Dockerfile.worker-base"
$baseImage = "$Registry/$Namespace/pforge-claw-worker-base:$Tag"
$platformArgument = $platformList -join ","

if ($Push) {
    $outputArguments = @("--push")
} elseif ($Load -or $platformList.Count -eq 1) {
    $outputArguments = @("--load")
} else {
    $outputArguments = @("--output", "type=cacheonly")
}

function Invoke-DockerBuild([string[]]$Arguments) {
    if ($DryRun) {
        [Console]::Out.WriteLine("--- docker")
        foreach ($argument in $Arguments) {
            [Console]::Out.WriteLine("  $argument")
        }
        return
    }
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

if (-not $DryRun) {
    & docker buildx version
    if ($LASTEXITCODE -ne 0) {
        [Console]::Error.WriteLine("build-images: docker buildx is required")
        exit 1
    }
}

$baseArguments = @(
    "buildx", "build",
    "--platform", $platformArgument,
    "--file", $baseDockerfile,
    "--tag", $baseImage,
    "--build-arg", "NODE_VERSION=$NodeVersion"
) + $outputArguments + @($contextDirectory)
Invoke-DockerBuild $baseArguments

foreach ($variant in $variantList) {
    $variantDockerfile = Join-Path $contextDirectory "deploy/worker-variants/Dockerfile.$variant"
    $variantImage = "$Registry/$Namespace/pforge-claw-worker-${variant}:$Tag"
    $variantArguments = @(
        "buildx", "build",
        "--platform", $platformArgument,
        "--file", $variantDockerfile,
        "--tag", $variantImage,
        "--build-arg", "BASE_IMAGE=$baseImage"
    ) + $outputArguments + @($contextDirectory)
    Invoke-DockerBuild $variantArguments
}
