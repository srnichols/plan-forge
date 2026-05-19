---
description: Testing rules for Plan Forge — vitest patterns, fake-timers vs tolerance, mocking conventions, and how to read test output without hallucinating failures. Auto-loads when editing test files.
applyTo: '**/*.test.mjs,**/*.test.js,**/tests/**'
priority: HIGH
---

# Testing Instructions

> **When this loads**: every time you edit, write, debug, or report on a test file.
> **Sister script**: `scripts/audit/test-smells.mjs` — mechanical scan for the patterns this file rules against.

---

## The 5 Rules

### 1. Time-sensitive tests must declare tolerance OR use fake timers

The single biggest source of CI flake. **Phase 41 Slice 5 reference incident**: `timeline-core` cache-invalidation test used a `+5ms` tolerance — too tight for the Windows scheduler. Fix: bumped to `+50ms` (commit `0630fb5`). Same class of bug has shipped at least three times in different files.

Two acceptable patterns. Anything else is a flake waiting to land on the worst possible PR.

**Pattern A — fake timers (preferred when the test is *about* timing)**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('cache TTL', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('expires after 5 minutes', () => {
    const cache = makeCache({ ttlMs: 5 * 60 * 1000 });
    cache.set('k', 'v');
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(cache.get('k')).toBeUndefined();
  });
});
```

**Pattern B — explicit tolerance (only when you must measure real wall-clock)**

```js
const start = Date.now();
await operationUnderTest();
const elapsed = Date.now() - start;
// Comment required — names the tolerance + the reason for it.
// +50ms accommodates the Windows scheduler; Phase 41 S5 used +5ms and flaked.
expect(elapsed).toBeGreaterThanOrEqual(target);
expect(elapsed).toBeLessThan(target + 50);
```

**Banned patterns** (caught by `test-smells.mjs` as `TIME-FLAKE`):

- `setTimeout(fn, N)` in a test body without `vi.useFakeTimers()`
- `Math.random()` anywhere in a test — use a seeded RNG or fixture
- `Date.now()` / `new Date()` without `vi.setSystemTime()` or an explicit tolerance comment
- `performance.now()` without a tolerance comment

### 2. Never commit `.only` or focused tests

`.only` on `it` / `test` / `describe` skips every other test in the file. Vitest does not fail on `.only` by default — it silently runs only what you focused. Catch in pre-merge:

```bash
node scripts/audit/test-smells.mjs --severity error
```

Exits non-zero on `FOCUS-LEAK`. Wire into CI if not already.

`.skip` / `xit` / `xtest` are warnings — fine for short-term debugging but should never reach `main`. Convert to `it.todo("name", ...)` with a tracked issue and the test gets surfaced in the vitest summary as pending instead of invisibly skipped.

### 3. Reading test output before reporting it

> **Field bug (Issue #198)**: subagents have hallucinated `"1 failed"` summaries on **fully green** vitest runs because they confused in-test log lines with vitest's own summary. Cost: false-positive failure reports trigger unnecessary investigation and risk shipping reverts for non-existent bugs.

**The trap**: Plan Forge's own test suite contains many tests that *exercise* slice-failure code paths. Those tests legitimately emit log lines like:

```
❌ Slice 1: Fix the login bug — FAILED
Run complete: 0 passed, 1 failed
```

…**inside** a passing test, to assert the failure-handling code did the right thing. These are NOT vitest failures — they are application logs printed during a successful assertion.

**The rule** when reading captured test output to determine pass/fail counts:

1. **ONLY trust vitest's own summary block** — the lines that look like:
   ```
   Test Files  271 passed | 2 skipped (273)
        Tests  5699 passed | 35 skipped (5734)
     Duration  459.65s
   ```
2. **NEVER count grep hits on `FAILED`, `failed`, `❌`, or `Slice N — FAILED`** — those match in-test logs from tests that pass while asserting failure behavior.
3. **If the suite times out before the summary block appears** (>120s is common for the full sweep, ~460s for `pforge-mcp` end-to-end), say so explicitly: *"timed out before vitest emitted the summary block — re-run with a longer timeout or scope to a specific file."* Do NOT guess from partial output.
4. **For programmatic capture**, grep the literal anchor:
   ```powershell
   Get-Content $log | Select-String -Pattern '^\s*Test Files\s+\d+\s+passed' -Context 0,3
   ```
   This anchors to vitest's actual summary line and captures the next three lines (`Tests`, `Start at`, `Duration`).
5. **The exit code is authoritative** — if `$LASTEXITCODE` is 0 AND the summary block shows `0 failed` (or no `failed` token at all), the suite is green. Any other interpretation is a hallucination.

**Quick template for reporting test results:**

```
## Test Sweep

**Command:** <exact command>
**Exit code:** <0|N>
**Summary (verbatim from vitest):**
  Test Files  <X> passed | <Y> skipped (<total>)
       Tests  <X> passed | <Y> skipped (<total>)
    Duration  <X>s
**Failures:** <None | list of file:test names from the FAIL block>
```

If you cannot find the verbatim summary in the output, the right answer is *"unknown — re-run is needed"* — not a guess.

### 4. Mock the edge, not the interior

Mocks are for **external dependencies the test can't or shouldn't reach** — network, `gh` CLI, OpenBrain, file system at the project boundary, child processes.

**Acceptable to mock:**
- `spawn`/`execFile` to the `gh` CLI
- HTTP calls to OpenBrain / GitHub / xAI
- `fs.writeFile` to user-repo paths (so the test doesn't touch the workspace)
- `Date.now()` / `setTimeout` via `vi.useFakeTimers()`

**Do NOT mock:**
- Functions exported from the module under test (use the real function)
- Internal helpers in the same package (use the real function)
- The orchestrator's own state machine when testing tool handlers (use a real instance with test fixtures)

When in doubt, prefer a real in-memory fixture (temporary directory, in-memory hub) over a mock. Mocks rot — fixtures stay valid across refactors.

### 5. Vitest gate portability (Windows + Bash + npx)

Tests run inside plan gates. The gate command must work on Windows under both `cmd.exe` and Git Bash.

**Banned gate patterns** (also in [plan-gate-command-rules.md](plan-gate-command-rules.md)):

- `npx vitest run "pforge-mcp/tests/foo-*.test.mjs"` — quoted glob does NOT expand on Windows; vitest reports "no test files found" and exits 0 (false pass)
- `bash -c "npx vitest run ..."` — picks WSL bash on modern Windows; WSL bash has no Windows `node`/`npx` on PATH
- Vitest `--reporter dot` — emits to stdout in chunks that can interleave with the orchestrator's watchdog reads; use the default reporter or `--reporter verbose`

**Recommended pattern** for a slice gate:

```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/specific-file.test.mjs
```

Pass individual file paths (no glob), drop the `bash -c` wrapper, use the default reporter.

---

## When the test fails — diagnostic order

1. **Re-run the single failing test in isolation** — `npx vitest run path/to/file.test.mjs -t "exact test name"`. Most "intermittent" failures are deterministic when isolated.
2. **Check for time sensitivity** — does the failure mention an elapsed time, a timeout, or a comparison against `Date.now()`? Apply Rule 1.
3. **Check for shared state** — does the failure only happen after other tests run? Look for module-level `let` variables, file-system writes to a shared path, or `beforeAll` setup without matching `afterAll` cleanup.
4. **Check for Windows-specific path issues** — does the test use `/` literals or assume `\n` line endings? Use `path.join` and `os.EOL`.
5. **Only then suspect the code under test.**

---

## Coverage expectations

| Code path | Required coverage |
|-----------|------------------|
| New `forge_*` tool handler | happy path, empty-state path, pagination path, error path — minimum 4 tests |
| New orchestrator state transition | the transition itself + at least one negative case (invalid prior state) |
| New audit script | smoke test that runs the script and asserts the report JSON shape |
| New CLI command | one test per dispatch branch in both `.ps1` and `.sh` |
| Bug fix | a regression test that fails before the fix and passes after |

A new feature without tests is rejected at code-review (`/code-review` Step 5).

---

## See also

- [plan-gate-command-rules.md](plan-gate-command-rules.md) — gate portability (where test commands actually run)
- [architecture-principles.instructions.md](architecture-principles.instructions.md) — TDD discipline, Boy Scout Rule
- [clean-code.instructions.md](clean-code.instructions.md) — function/module size limits
- `scripts/audit/test-smells.mjs` — mechanical scan for the patterns ruled against above
- `/clean-code-review` Step 9 — runs test-smells against the current branch
