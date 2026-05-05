#Requires -Modules Pester
# sequence-plans.tests.ps1
# Pester v5 tests for scripts/sequence-plans.psm1

BeforeAll {
  $ModulePath = Join-Path $PSScriptRoot ".." "sequence-plans.psm1"
  Import-Module $ModulePath -Force
}

AfterAll {
  Remove-Module sequence-plans -ErrorAction SilentlyContinue
}

Describe "Get-CurrentOrchestratorPid" {

  Context "when the PID file does not exist" {
    It "returns null" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory -Path $tmpDir | Out-Null
      try {
        $result = Get-CurrentOrchestratorPid -RepoRoot $tmpDir
        $result | Should -BeNullOrEmpty
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }
  }

  Context "when the PID file contains a valid integer" {
    It "returns the integer PID" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory -Path (Join-Path $tmpDir ".forge") -Force | Out-Null
      Set-Content (Join-Path $tmpDir ".forge/last-orch.pid") "12345"
      try {
        $result = Get-CurrentOrchestratorPid -RepoRoot $tmpDir
        $result | Should -Be 12345
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }

    It "handles trailing whitespace/newline in the PID file" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory -Path (Join-Path $tmpDir ".forge") -Force | Out-Null
      Set-Content (Join-Path $tmpDir ".forge/last-orch.pid") "99999`n"
      try {
        $result = Get-CurrentOrchestratorPid -RepoRoot $tmpDir
        $result | Should -Be 99999
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }
  }

  Context "when the PID file contains non-numeric content" {
    It "returns null for text content" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory -Path (Join-Path $tmpDir ".forge") -Force | Out-Null
      Set-Content (Join-Path $tmpDir ".forge/last-orch.pid") "not-a-pid"
      try {
        $result = Get-CurrentOrchestratorPid -RepoRoot $tmpDir
        $result | Should -BeNullOrEmpty
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }

    It "returns null for empty file" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory -Path (Join-Path $tmpDir ".forge") -Force | Out-Null
      Set-Content (Join-Path $tmpDir ".forge/last-orch.pid") ""
      try {
        $result = Get-CurrentOrchestratorPid -RepoRoot $tmpDir
        $result | Should -BeNullOrEmpty
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }
  }
}

Describe "Test-OrchestratorAlive" {

  Context "when ProcId is null or zero" {
    It "returns false for null" {
      Test-OrchestratorAlive -ProcId 0 | Should -Be $false
    }

    It "returns false for a non-existent PID" {
      # Use an extremely large PID that is virtually guaranteed not to exist
      Test-OrchestratorAlive -ProcId 2147483647 | Should -Be $false
    }
  }

  Context "when the process exists" {
    It "returns true for the current process" {
      Test-OrchestratorAlive -ProcId $PID | Should -Be $true
    }
  }
}

Describe "Get-LatestRunDir" {

  Context "when the runs directory does not exist" {
    It "returns null" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory -Path $tmpDir | Out-Null
      try {
        $result = Get-LatestRunDir -RepoRoot $tmpDir
        $result | Should -BeNullOrEmpty
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }
  }

  Context "when the runs directory is empty" {
    It "returns null" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory -Path (Join-Path $tmpDir ".forge/runs") -Force | Out-Null
      try {
        $result = Get-LatestRunDir -RepoRoot $tmpDir
        $result | Should -BeNullOrEmpty
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }
  }

  Context "when multiple run directories exist" {
    It "returns the most recently modified directory" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      $runsDir = Join-Path $tmpDir ".forge/runs"
      New-Item -ItemType Directory -Path $runsDir -Force | Out-Null

      $older = New-Item -ItemType Directory -Path (Join-Path $runsDir "run-001")
      $older.LastWriteTime = (Get-Date).AddHours(-2)

      $newer = New-Item -ItemType Directory -Path (Join-Path $runsDir "run-002")
      $newer.LastWriteTime = (Get-Date)

      try {
        $result = Get-LatestRunDir -RepoRoot $tmpDir
        $result | Should -Be $newer.FullName
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }
  }
}

Describe "Get-RunStatus" {

  Context "when RunDir is null or missing" {
    It "returns 'unknown' for null RunDir" {
      Get-RunStatus -RunDir $null | Should -Be "unknown"
    }

    It "returns 'unknown' when events.log is absent" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory -Path $tmpDir | Out-Null
      try {
        Get-RunStatus -RunDir $tmpDir | Should -Be "unknown"
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }
  }

  Context "when events.log contains a run-failed record" {
    It "returns 'failed'" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory -Path $tmpDir | Out-Null
      @(
        '{"event":"slice-started","slice":1}',
        '{"event":"run-failed","reason":"timeout"}'
      ) | Set-Content (Join-Path $tmpDir "events.log")
      try {
        Get-RunStatus -RunDir $tmpDir | Should -Be "failed"
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }
  }

  Context "when events.log contains a run-aborted record" {
    It "returns 'failed'" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory -Path $tmpDir | Out-Null
      '{"event":"run-aborted"}' | Set-Content (Join-Path $tmpDir "events.log")
      try {
        Get-RunStatus -RunDir $tmpDir | Should -Be "failed"
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }
  }

  Context "when run-completed has slice failures" {
    It "returns 'failed' when 'failed':N > 0 in payload" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory -Path $tmpDir | Out-Null
      '{"event":"run-completed","slices":5,"failed":2,"status":"partial"}' |
        Set-Content (Join-Path $tmpDir "events.log")
      try {
        Get-RunStatus -RunDir $tmpDir | Should -Be "failed"
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }

    It "returns 'failed' when status field is 'failed'" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory -Path $tmpDir | Out-Null
      '{"event":"run-completed","failed":0,"status":"failed"}' |
        Set-Content (Join-Path $tmpDir "events.log")
      try {
        Get-RunStatus -RunDir $tmpDir | Should -Be "failed"
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }
  }

  Context "when run-completed shows clean success" {
    It "returns 'completed'" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory -Path $tmpDir | Out-Null
      '{"event":"run-completed","slices":3,"failed":0,"status":"ok"}' |
        Set-Content (Join-Path $tmpDir "events.log")
      try {
        Get-RunStatus -RunDir $tmpDir | Should -Be "completed"
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }

    It "returns 'completed' when no 'failed' key is present" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory -Path $tmpDir | Out-Null
      '{"event":"run-completed"}' | Set-Content (Join-Path $tmpDir "events.log")
      try {
        Get-RunStatus -RunDir $tmpDir | Should -Be "completed"
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }
  }

  Context "when the log has no terminal event" {
    It "returns 'in-progress'" {
      $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory -Path $tmpDir | Out-Null
      @(
        '{"event":"run-started"}',
        '{"event":"slice-started","slice":1}'
      ) | Set-Content (Join-Path $tmpDir "events.log")
      try {
        Get-RunStatus -RunDir $tmpDir | Should -Be "in-progress"
      } finally {
        Remove-Item $tmpDir -Recurse -Force
      }
    }
  }
}
