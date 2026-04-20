# Plan Forge — Scheduling Templates

Pre-built GitHub Actions workflows for automated Plan Forge maintenance.

## Installation

Copy the desired workflow files into your project's `.github/workflows/` directory:

```bash
cp templates/schedules/plan-forge-nightly-mutation.yml .github/workflows/
cp templates/schedules/plan-forge-weekly-drift.yml     .github/workflows/
cp templates/schedules/plan-forge-daily-sweep.yml      .github/workflows/
```

## Workflows

| File | Schedule | What it does |
|------|----------|-------------|
| `plan-forge-nightly-mutation.yml` | Daily 06:00 UTC | Full Tempering mutation scan |
| `plan-forge-weekly-drift.yml` | Monday 06:00 UTC | LiveGuard drift analysis with auto-incident |
| `plan-forge-daily-sweep.yml` | Daily 05:00 UTC | TODO/FIXME/stub marker sweep |

All workflows also support `workflow_dispatch` for manual triggering.

## Requirements

- **Node.js 20+** (set up via `actions/setup-node@v4`)
- **Ubuntu runner** (default `ubuntu-latest`)
- `pforge.sh` must be executable (`chmod +x pforge.sh`)

## Non-GitHub Alternatives

### Cron (Linux/macOS)

```bash
# Nightly mutation — 06:00 UTC
0 6 * * * cd /path/to/project && ./pforge.sh tempering run --full-mutation

# Weekly drift — Monday 06:00 UTC
0 6 * * 1 cd /path/to/project && ./pforge.sh drift --autoIncident

# Daily sweep — 05:00 UTC
0 5 * * * cd /path/to/project && ./pforge.sh sweep
```

### Windows Task Scheduler

```powershell
# Nightly mutation — 06:00 UTC (adjust for your timezone)
schtasks /create /tn "PlanForge-NightlyMutation" /tr "powershell -File C:\project\pforge.ps1 tempering run --full-mutation" /sc daily /st 06:00

# Weekly drift — Monday 06:00 UTC
schtasks /create /tn "PlanForge-WeeklyDrift" /tr "powershell -File C:\project\pforge.ps1 drift --autoIncident" /sc weekly /d MON /st 06:00

# Daily sweep — 05:00 UTC
schtasks /create /tn "PlanForge-DailySweep" /tr "powershell -File C:\project\pforge.ps1 sweep" /sc daily /st 05:00
```
