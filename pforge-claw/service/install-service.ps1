param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('install', 'uninstall', 'status')]
  [string]$Action,
  [switch]$DryRun,
  [string]$HomeDir = (Join-Path $HOME '.pforge-claw'),
  [string]$NodePath = (Get-Command node -ErrorAction Stop).Source,
  [string]$CliPath = (Join-Path $PSScriptRoot '..\cli.mjs')
)

$ErrorActionPreference = 'Stop'
$taskName = 'Plan Forge Claw'

function ConvertTo-WindowsArgument([string]$Value) {
  $escaped = $Value -replace '(\\*)"', '$1$1\"'
  $escaped = $escaped -replace '(\\+)$', '$1$1'
  return '"' + $escaped + '"'
}

function Get-ClawAction {
  $arguments = @(
    (ConvertTo-WindowsArgument $CliPath),
    'start',
    '--home',
    (ConvertTo-WindowsArgument $HomeDir)
  ) -join ' '
  return New-ScheduledTaskAction -Execute $NodePath -Argument $arguments
}

switch ($Action) {
  'install' {
    if ($DryRun) {
      [pscustomobject]@{
        Action = 'install'
        TaskName = $taskName
        Execute = $NodePath
        Arguments = @($CliPath, 'start', '--home', $HomeDir)
        Trigger = 'AtLogOn'
      } | ConvertTo-Json -Compress
      exit 0
    }
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet `
      -RestartCount 999 `
      -RestartInterval (New-TimeSpan -Minutes 1) `
      -ExecutionTimeLimit ([TimeSpan]::Zero) `
      -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $taskName -Action (Get-ClawAction) `
      -Trigger $trigger -Settings $settings -Force | Out-Null
    Write-Output 'installed'
  }
  'uninstall' {
    if ($DryRun) {
      Write-Output (@{ Action = 'uninstall'; TaskName = $taskName } | ConvertTo-Json -Compress)
      exit 0
    }
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output 'uninstalled'
  }
  'status' {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if (-not $task) {
      Write-Output 'not installed'
      exit 0
    }
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    [pscustomobject]@{
      State = $task.State
      LastTaskResult = $info.LastTaskResult
      LastRunTime = $info.LastRunTime
    } | ConvertTo-Json -Compress
  }
}
