# Testbed Scenario Fixtures

Scenario fixture files define automated validation runs against a
**testbed repository** — a separate clone of Plan Forge (or a
consumer project) used to verify forge tools end-to-end.

## Fixture Format (JSON)

```jsonc
{
  "scenarioId": "happy-path-01",        // Unique ID — also the filename stem
  "kind": "happy-path",                 // happy-path | chaos | perf | long-horizon
  "description": "Basic forge_smith smoke test",

  // (optional) Expected HEAD commit — preflight rejects mismatch
  "expectedHead": "abc123...",

  // Setup steps run before execute (e.g. git reset, seed data)
  "setup": [
    { "cmd": "git checkout main", "timeout": 30000 }
  ],

  // Main execution steps
  "execute": [
    { "cmd": "node pforge-mcp/server.mjs --validate", "timeout": 60000 }
  ],

  // Assertions checked after execute
  "assertions": [
    { "kind": "exit-code", "expected": 0 },
    { "kind": "file-exists", "path": "pforge-mcp/tools.json" },
    { "kind": "file-contains", "path": "pforge-mcp/tools.json", "pattern": "forge_smith" }
  ],

  // Teardown steps always run (even on failure), skipped in dry-run
  "teardown": [
    { "cmd": "git checkout main", "timeout": 30000 }
  ]
}
```

## Assertion Kinds

| Kind | Required Fields | Description |
|------|----------------|-------------|
| `file-exists` | `path` | Checks file exists relative to testbed root |
| `file-contains` | `path`, `pattern` | Regex match against file content |
| `event-emitted` | `eventType` | Hub event emitted within `within` ms (default 30s) |
| `correlationId-thread` | `minSize` | N+ hub events share the run's correlationId |
| `exit-code` | `expected` | Last execute step's exit code matches |
| `duration-under` | `budgetMs` | Last execute step completed within budget |
| `artefact-count` | `dir`, `min` | Directory contains ≥ min entries |

## Scenario Kinds

- **`happy-path`** — standard expected-success flow
- **`chaos`** — intentionally broken inputs, missing files, bad config
- **`perf`** — timing budgets and resource constraints
- **`long-horizon`** — multi-slice or multi-run scenarios

## Adding a Scenario

1. Create `<scenarioId>.json` in this directory
2. Run `forge_testbed_run --scenarioId <id>` (or `--dryRun` first)
3. Findings land in `docs/plans/testbed-findings/`
