[CmdletBinding()]
param(
    [string]$Config,
    [string]$Namespace
)

$ErrorActionPreference = "Stop"
$invokeArgs = @((Join-Path $PSScriptRoot "render-egress.mjs"))
if (-not [string]::IsNullOrWhiteSpace($Config)) { $invokeArgs += @("--config", $Config) }
if (-not [string]::IsNullOrWhiteSpace($Namespace)) { $invokeArgs += @("--namespace", $Namespace) }
& node @invokeArgs
exit $LASTEXITCODE
