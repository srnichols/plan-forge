# Tempering — Closed-Loop Bug Validation

> **Added**: v2.43.0 (scanners) · v2.45.0 (visual, mutation) · v2.47.0 (closed-loop validation)

Tempering is Plan Forge's automated test-quality and bug-lifecycle subsystem. It discovers bugs via scanner re-runs, classifies them, generates fix proposals, and validates fixes by re-running the same scanners that found the issue.

---

## 1. Overview

```
Scanner → Bug → Classify → Fix Proposal → Validate → Fixed
   ↑                                          ↓
   └──────── re-run same scanner ─────────────┘
```

The loop closes automatically: when `forge_bug_validate_fix` re-runs the scanner and all failures are gone, the bug transitions to `fixed` and adapters are notified.

## 2. Scanners (9)

| Scanner | Stack | What it checks |
|---------|-------|---------------|
| `unit` | All | Unit test failures via `npm test` / `dotnet test` / etc. |
| `integration` | All | Integration test failures |
| `ui-playwright` | JS/TS | Playwright UI tests |
| `contract` | All | API contract compliance (OpenAPI, gRPC) |
| `visual-diff` | JS/TS | Visual regression via screenshot comparison |
| `flakiness` | All | Test flakiness detection (repeated runs) |
| `performance-budget` | All | p95 latency and throughput budget checks |
| `load-stress` | All | Load/stress test threshold violations |
| `mutation` | All | Mutation testing coverage (Stryker, mutmut, etc.) |

## 3. Bug Lifecycle

```
open → in-fix → fixed
  ↓       ↓
  → wont-fix
  → duplicate
```

| Status | Meaning |
|--------|---------|
| `open` | Bug discovered, awaiting action |
| `in-fix` | Fix proposal generated and linked |
| `fixed` | Scanner re-run passed — bug confirmed resolved |
| `wont-fix` | Intentionally not fixing (with rationale) |
| `duplicate` | Duplicate of another bug |

## 4. Bug-Adapter Extensions

External bug trackers (GitHub Issues, Jira, Linear) are supported via the adapter contract. See [EXTENSIONS.md](../EXTENSIONS.md#tempering-bug-adapter-extensions) for the 4-function contract.

The contract is **frozen at v2.47.0**.

## 5. Closed-Loop Validation (v2.47.0)

### `forge_fix_proposal source=tempering-bug`

Generates a 2–3 slice fix plan from a bug's evidence. Automatically:
- Reads bug record and evidence
- Generates targeted fix slices (Reproduce → Fix → optional Regression Guard for critical/high)
- Transitions bug to `in-fix`
- Links fix plan path to bug record

### `forge_bug_validate_fix`

Re-runs the scanner(s) that discovered a bug to verify the fix:
- Loads bug record
- Re-runs scanner via `runSingleScanner`
- Appends validation attempt to bug's `validationAttempts[]`
- On pass: transitions to `fixed`, dispatches `commentValidatedFix` to adapter, broadcasts `tempering-bug-validated-fixed` event
- On fail: keeps bug in current status, returns failure details

## 6. LiveGuard Integration

The `forge_liveguard_run` health check includes a **tempering** dimension:

| Status | Condition |
|--------|-----------|
| 🟢 green | No open bugs |
| 🟡 yellow | Open bugs exist (none critical/high) |
| 🔴 red | Critical or high severity open bugs |

The tempering dimension contributes to `overallStatus` — red tempering makes the overall status red.

## 7. Anomaly Detection

The watcher fires `tempering-bug-unaddressed` when open real-bugs older than 14 days lack a linked fix plan. Recommendation: run `forge_fix_proposal source=tempering-bug`.

## 8. Configuration

In `.forge.json` or `.forge/tempering/config.json`:

```json
{
  "tempering": {
    "minCoverage": { "unit": 80, "integration": 60 },
    "mutationMinima": { "src/services": 70 },
    "bugRegistry": {
      "integration": "github",
      "autoCreateIssues": true,
      "labelPrefix": "tempering"
    }
  }
}
```
