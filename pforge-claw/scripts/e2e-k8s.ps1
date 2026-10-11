[CmdletBinding()]
param(
    [string]$Namespace,
    [string]$Context,
    [string]$DispatcherFixtureImage,
    [string]$WorkerFixtureImage,
    [string]$FixtureConfig,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$invokeArgs = @((Join-Path $PSScriptRoot "k8s-e2e.mjs"))
foreach ($option in @(
    @("--namespace", $Namespace),
    @("--context", $Context),
    @("--dispatcher-fixture-image", $DispatcherFixtureImage),
    @("--worker-fixture-image", $WorkerFixtureImage),
    @("--fixture-config", $FixtureConfig)
)) {
    if (-not [string]::IsNullOrWhiteSpace($option[1])) { $invokeArgs += $option }
}
if ($DryRun) { $invokeArgs += "--dry-run" }
& node @invokeArgs
exit $LASTEXITCODE
