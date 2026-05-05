---
description: Plan gate command rules — how to write validation gates in plan files, including portability constraints and the worker output watchdog env var.
applyTo: 'docs/plans/**'
priority: MEDIUM
---

# Plan Gate Command Rules

> **Applies to**: `docs/plans/**`  
> **Purpose**: Enforce portable, debuggable validation gates and document the worker output watchdog environment variable.

---

## Gate Command Portability

### Rule 1 — Use plain `node` or `npx`, never `bash -c` wrappers

Gates run through the orchestrator's `runGate` function, which spawns commands via the system shell. On Windows the shell is `cmd.exe`, not `bash`.

| ❌ Avoid | ✅ Use instead |
|---|---|
| `bash -c "node -e \"...\""` | `node -e "..."` |
| `bash -c "npx vitest run"` | `npx --prefix pforge-mcp vitest run` |
| `bash -c "grep -q X file"` | `node -e "const s=require('fs').readFileSync('file','utf8'); if(!s.includes('X')){process.exit(1)}"` |

### Rule 2 — Do not use brace-group pipes

Constructs like `grep -c pattern file | { read n; [ "$n" -ge 1 ]; }` are POSIX-bash only. The pipe result is invisible through the Windows `cmd.exe` → node shim.

Use `node -e` with `fs.readFileSync` and a JS boolean check instead.

### Rule 3 — Do not glob-expand in quoted strings passed to npx vitest

On Windows, `npx vitest run "pforge-mcp/tests/foo-*.test.mjs"` does **not** expand the glob — vitest reports "no test files found" and exits `0` (false pass). Omit the quotes or pass individual file paths.

### Rule 4 — ESM dynamic-import gates must await

When a gate uses dynamic `import()` to inspect an ESM module, the `node -e` expression must be an async IIFE:

```
node -e "import('./pforge-mcp/orchestrator.mjs').then(m=>{ ... })"
```

Do **not** use `require()` for `.mjs` files.

---

## Worker Output Watchdog

### Overview

The orchestrator's `spawnWorker` function installs an idle-output timer for CLI-spawned worker subprocesses. If the subprocess produces **no stdout or stderr bytes** for longer than the configured threshold, the watchdog kills the subprocess and the slice fails fast with a `slice-output-stalled` event.

This prevents silent 25-min deadlocks (observed in Phase B Slice 9 and Phase D Slice 7 of the GitHub-stack dogfood).

### Environment variable

| Variable | Default | Effect |
|---|---|---|
| `PFORGE_WORKER_OUTPUT_IDLE_MS` | `480000` (8 minutes) | Idle threshold in milliseconds before the watchdog fires |

**Accepted values**:
- Positive integer or float → overrides the default threshold.
- `0`, negative number, or non-numeric string → falls back to the default (`480000`). A warning is logged.
- Large value (e.g. `86400000` = 24 h) → effectively softens the watchdog without fully disabling it.

> **There is no "disable" value.** Setting `PFORGE_WORKER_OUTPUT_IDLE_MS=0` does **not** disable the watchdog — it falls back to the 8-min default. If you need to soften the watchdog for a slow test suite, set a large positive value.

### `slice-output-stalled` event

When the watchdog fires, the orchestrator emits this event on the SSE stream **before** `slice-failed`:

```json
{
  "event": "slice-output-stalled",
  "sliceId": "3",
  "sliceTitle": "Docs + version + CHANGELOG",
  "stallDurationMs": 480000,
  "lastBytesAtIso": "2026-05-05T10:00:00.000Z"
}
```

### Watchdog not installed in dry-run / estimate mode

When the orchestrator is invoked with `--dry-run` or `--estimate`, no subprocess is spawned, so the idle timer is never installed.

### API surface (pforge-mcp/orchestrator.mjs)

| Export | Type | Description |
|---|---|---|
| `DEFAULT_WORKER_OUTPUT_IDLE_MS` | `number` | `480_000` — the 8-minute default |
| `resolveWorkerOutputIdleMs()` | `() => number` | Reads `PFORGE_WORKER_OUTPUT_IDLE_MS`, validates, and returns the effective threshold |

---

## Worker Timeout

### Overview

The orchestrator's `spawnWorker` function uses a total-run timeout to hard-kill a worker subprocess that never exits. If the worker does not exit within the configured threshold, the slice fails with a timeout error.

The default was raised from 20 min to **30 min** in v2.90.2 to avoid premature timeouts on moderate-complexity slices observed during the GitHub-stack dogfood (Phase B Slice 5, 25:28 first attempt).

### Environment variable

| Variable | Default | Effect |
|---|---|---|
| `PFORGE_WORKER_TIMEOUT_MS` | `1800000` (30 minutes) | Total-run timeout in milliseconds before the worker subprocess is hard-killed |

**Accepted values**:
- Positive integer or float → overrides the default threshold.
- `0`, negative number, or non-numeric string → falls back to the default (`1800000`). A warning is logged.
- Large value (e.g. `7200000` = 2 h) → extends the timeout for a slow environment.

### Per-slice override

A plan author can override the timeout for a specific slice by adding `workerTimeoutMs: <ms>` to the slice's frontmatter (or as a `**WorkerTimeoutMs**: <number>` body line). The parser captures it into `slice.workerTimeoutMs`.

**Priority**: `slice.workerTimeoutMs` (per-slice frontmatter) → `PFORGE_WORKER_TIMEOUT_MS` env var → `DEFAULT_WORKER_TIMEOUT_MS` (30 min).

Example slice frontmatter:
```
**WorkerTimeoutMs**: 3600000
```
This sets a 60-minute timeout for that slice only. Other slices use the default.

### API surface (pforge-mcp/orchestrator.mjs)

| Export | Type | Description |
|---|---|---|
| `DEFAULT_WORKER_TIMEOUT_MS` | `number` | `1_800_000` — the 30-minute default |
| `resolveWorkerTimeoutMs(opts?)` | `(opts?: {sliceOverride?: number\|null}) => number` | Resolves the effective timeout using the priority chain above |

---

## Gate Linter

### Overview

The orchestrator's `runGate` function runs a static linter on each gate command string **before** executing it. The linter detects known portability anti-patterns and emits structured warnings so plan authors get actionable feedback without waiting for a runtime failure.

Warnings are emitted as `gate-lint-warn` SSE events. In the default advisory mode, the gate still runs. In strict mode, the gate is skipped and marked failed immediately.

### Warning codes

| Code | Triggered by | Why it matters |
|---|---|---|
| **W1** | `bash -c` or `sh -c` wrapper in gate command | The orchestrator spawns gates via `cmd.exe` on Windows; bash wrappers are silently skipped or error out without a useful message. |
| **W2** | Brace-group pipe `\| {` or `\| {` variant | Brace-group variable scoping is invisible through the `cmd.exe` → node shim; the check always exits `0` (false pass). |
| **W3** | Quoted glob argument to `npx vitest run` (e.g. `"pforge-mcp/tests/foo-*.test.mjs"`) | Windows does not expand globs inside quoted strings; vitest reports "no test files found" and exits `0`. |
| **W4** | `require(` call on a `.mjs` file path | `.mjs` files are ESM-only; `require()` throws at runtime. Use `import()` with `await` instead. |

### `PFORGE_GATE_LINT_STRICT`

When this variable is set to `1` or `true`, any W1–W4 warning is treated as a **hard gate failure**:

- The gate command is **not executed**.
- The slice fails with `exitCode: 1` and a `gate-lint-strict-abort` reason.
- The warning codes that triggered the abort are included in the `slice-failed` event payload.

Any other value (including `0`, `false`, or an empty string) leaves the linter in advisory-only mode.

```
PFORGE_GATE_LINT_STRICT=1 pforge run-plan docs/plans/my-plan.md
```

### `pforge-lint-disable` per-gate directive

To suppress one or more warning codes for a single gate, add a `# pforge-lint-disable <codes>` comment anywhere in the gate command string:

```
node -e "..." # pforge-lint-disable W3
```

Multiple codes are comma-separated:

```
bash -c "..." # pforge-lint-disable W1,W2
```

- Unknown codes in the disable list are silently ignored.
- The directive applies **only to the gate it appears in**; it does not affect other gates in the same slice or plan.
- Using `pforge-lint-disable` in strict mode still suppresses the listed warnings for that gate (the gate runs normally).

### `gate-lint-warn` SSE event

```json
{
  "event": "gate-lint-warn",
  "sliceId": "2",
  "gateIndex": 0,
  "code": "W1",
  "message": "bash -c wrapper detected — gate will not run on Windows cmd.exe",
  "cmd": "bash -c \"node -e \\\"...\\\"\""
}
```

---

## Gate Template (copy-paste safe)

```
node -e "const fs=require('fs'); const content=fs.readFileSync('<FILE>','utf8'); const checks={<key>:<boolean-expression>}; const failed=Object.entries(checks).filter(([_,v])=>!v); if(failed.length){console.error('failed:',failed.map(([k])=>k).join(','));process.exit(1)} console.log('ok')"
```

Replace `<FILE>` and `<key>: <boolean-expression>` pairs. This pattern is cross-platform (node built-ins only, no shell extensions).
