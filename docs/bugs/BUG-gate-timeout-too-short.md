# BUG: Validation gate 120s hard timeout too short for full test suites

**Filed**: 2026-04-21
**Severity**: Medium — causes false-positive slice failures on any plan whose test gate runs the full suite
**Status**: Open
**Observed on**: Phase-28.1 Slice 6 (v2.62.0-dev), gate `bash -c "cd pforge-mcp && npx vitest run"`

---

## Symptom

`runGate()` in `pforge-mcp/orchestrator.mjs` passes `timeout: 120_000` (120s) to `execSync`. Our own test suite now takes ~200s:

- `cost-service.test.mjs` — 105s
- `estimate-slice.test.mjs` — 17s
- `worker-capability.test.mjs` — 16s
- `quorum-probe.test.mjs` — 10s
- other — ~50s combined

The slice 6 worker reported 3124/3124 tests passed. The orchestrator marked the slice **failed** because `execSync` threw on the 120s timeout, mid-way through the cost-service suite. The worker even diagnosed this in its PFORGE_TRAJECTORY: *"the previous attempt's vitest gate was recorded as failed despite all tests passing ... the gate likely failed because the previous attempt timed out before the full 203-second run completed, not because any test actually failed."*

## Reproduction

```powershell
# Any plan whose validation gate runs the full test suite
.\pforge.ps1 run-plan <plan-with-full-vitest-gate>
# Gate command:  bash -c "cd pforge-mcp && npx vitest run"
# Result:        slice marked failed, stderr buffer truncated mid-test
```

## Cost

Each false-positive triggers the retry loop. Phase-28.1 Slice 6 burned ~18 minutes and one premium request (claude-opus-4.6 escalation) before the human verified the release was actually complete.

## Root Cause

`pforge-mcp/orchestrator.mjs` line ~1788:
```js
const output = execSync(command, {
  cwd,
  encoding: "utf-8",
  timeout: 120_000,   // ← 120s is too short for project-wide test suites
  env: { ...process.env, NO_COLOR: "1" },
});
```

## Fix Options

1. **Bump default to 600_000 (10 min)** — safe for all current suites with headroom
2. **Honor `PFORGE_GATE_TIMEOUT_MS` env override** — lets CI tune per-project
3. **Exit code + explicit completion marker over stderr presence** — already correct in execSync semantics; no change needed there

Recommended: 1 + 2 combined. 2 costs ~5 lines.

## Related

- This bug made Phase-28.1 Slice 6 look catastrophically broken when it was actually already complete. Cost us a ~$0.05 premium escalation to verify.
