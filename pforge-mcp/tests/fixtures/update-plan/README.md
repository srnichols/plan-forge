# `pforge update` baseline fixtures (#299, Slice 1)

Five minimal "source" (template) + "project" (installed) trees, one per stack
configuration `update-plan-baseline.test.mjs` exercises:

| Case | `.forge.json` `preset` | Notes |
|---|---|---|
| `dotnet` | `"dotnet"` | single string preset |
| `typescript` | `"typescript"` | single string preset |
| `dotnet-azure-iac` | `["dotnet", "azure-iac"]` | multi-preset (array form) |
| `no-forge-json` | *(no `.forge.json`)* | relies on `pforge-mcp/detect-preset.mjs`; ships a `src/Api/Api.csproj` marker so detection resolves to `dotnet` |
| `custom` | `"custom"` | no stack markers, explicit custom preset |

Every case's `source/` ships exactly two guidance files relevant to the
documented parity gap (see `docs/plans/Phase-UPDATE-CORE-PLAN.md`, D1):

- `.github/instructions/git-workflow.instructions.md` (an **internal**
  instruction) — the project's copy is hand-edited, so the update guard
  classifies it `customized` and both shells report `KEEP`.
- `presets/shared/.github/instructions/status-reporting.instructions.md` (a
  **shared** instruction) — the project does not have this file at all. Bash's
  `_pf_check` helper always queues a missing guidance file as `NEW`;
  PowerShell's `Invoke-Update` shared/internal-instruction loop only offers a
  file the project already has (`Test-Path $dstFile`), so it silently skips
  it. This is the one documented baseline difference Slice 1 captures.

At test time, `update-plan-baseline.test.mjs` copies each fixture into a temp
directory, adds the real `pforge-mcp/update-guard.mjs` (and, for
`no-forge-json`, the real `pforge-mcp/detect-preset.mjs`) plus the repo's
`pforge.ps1` / `pforge.sh`, and runs `update --dry-run` with both shells. No
other guidance categories (prompts, agents, skills, hooks, runbook docs,
presets) are populated, so every other scan is a no-op in both shells — the
only operations either shell can report are the two above (plus the
`pforge-mcp/*` auto-discovery entries the update guard itself requires,
which are symmetric in both shells).

Do not hand-edit the generated `<case>.baseline.json` snapshot files — they
are written by the test on every run.
