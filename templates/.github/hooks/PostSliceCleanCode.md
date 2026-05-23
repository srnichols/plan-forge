# PostSliceCleanCode Hook

> **Type**: Lifecycle hook — advisory only
> **Trigger**: After every slice commit (git `post-commit`)
> **Blocks**: Never (informational signal)

---

## Purpose

Surface clean-code regressions while they are still small. After each slice
commit, this hook measures a small set of cheap signals on the scoped files,
compares them to the on-disk baseline, and emits an advisory when any metric
regresses past the configured thresholds.

It is the *fast* counterpart to the on-demand `/clean-code-review` skill: the
skill runs the full audit (jscpd, ESLint, dep-boundaries, etc.) and is
designed to be invoked deliberately; this hook runs in well under a second
and is designed to fire automatically after every commit without slowing the
inner loop.

The advisory is **not actionable by the orchestrator** — it surfaces in the
post-commit terminal output so the human (or the next agent session) sees
the regression in context.

---

## Signals measured

| Signal | What it catches |
|--------|----------------|
| LOC | Module-size creep across the scoped tree |
| function count | New helpers / accidental duplication |
| TODO / FIXME / HACK / XXX markers | Deferred-fix debt |
| Long parameter lists (≥5 positional params) | C-series audit category — pass an options object instead |
| Modules over LOC ceiling | G14 high-severity threshold (default 3000 LOC) |

The thresholds are deliberately conservative. The first time the hook runs
in a repo it writes the baseline and emits no advisory. Every subsequent
commit is measured against that baseline.

---

## Trigger conditions

The hook **skips** (exit code 2, no advisory) when any of these are true:

- `.forge.json#hooks.postSliceCleanCode.enabled` is not `true` (default)
- The commit message matches a skip pattern: `docs(`, `ci(`, `Merge `, or contains `--no-verify`
- The commit message is not conventional-commit-shaped (`feat(`, `fix(`, `refactor(`, `perf(`, `chore(`, `style(`, `test(`)
- No files in the configured scope globs were touched in the diff range

The hook **runs and emits** (when not skipped) at one of three levels:

| Level | When | Output |
|-------|------|--------|
| `silent` | All deltas within thresholds | No stdout |
| `advisory` (🟡) | LOC growth exceeds threshold OR new TODOs ≥ threshold | Yellow advisory block |
| `warning` (🔴) | A new module crosses the LOC ceiling OR a new long-param-list appeared | Red warning block |

---

## Configuration

In `.forge.json`:

```jsonc
{
  "hooks": {
    "postSliceCleanCode": {
      "enabled": true,
      "scopeGlobs": [
        "pforge-mcp/**/*.mjs",
        "pforge-master/**/*.mjs"
      ],
      "warnThresholds": {
        "newTodos": 1,
        "newLongParams": 1,
        "newModulesOverHighThreshold": 1,
        "locIncrease": 200
      },
      "highLocThreshold": 3000,
      "longParamThreshold": 5
    }
  }
}
```

All keys are optional; defaults are documented in `scripts/audit/clean-code-delta.mjs`.

---

## Output artifacts

Both files live under `.forge/` (gitignored by default):

- `clean-code-baseline.json` — the most recent measured totals; the next commit diffs against this
- `clean-code-history.jsonl` — append-only log of every hook firing (skipped or not), keyed by commit SHA

The history file is the input for any future cross-slice trend analysis (e.g.
"did this phase reduce TODO count or grow it?").

---

## Install

`setup.ps1` / `setup.sh` installs both this script and its documentation into
the target project's `.github/hooks/` directory. To enable the hook, add the
config snippet above to `.forge.json` and wire it into `.git/hooks/post-commit`:

```sh
# .git/hooks/post-commit
#!/usr/bin/env sh
"$(git rev-parse --show-toplevel)/.github/hooks/postSlice"           || true
"$(git rev-parse --show-toplevel)/.github/hooks/postSliceCleanCode"  || true
```

(The graph-rebuild `postSlice` hook and the clean-code hook are independent
and safe to run in either order.)

---

## Running manually

The script is callable on its own — useful when reviewing a phase's clean-code
trajectory or warming the baseline:

```sh
# Run against the last commit
node scripts/audit/clean-code-delta.mjs

# Diff a longer range
node scripts/audit/clean-code-delta.mjs --since HEAD~10

# Get the structured result
node scripts/audit/clean-code-delta.mjs --json

# Bypass the commit-message skip patterns and the config gate
node scripts/audit/clean-code-delta.mjs --no-skip
```

See the file header in `scripts/audit/clean-code-delta.mjs` for the full
flag list.

---

## See also

- [Clean Code guardrails](../instructions/clean-code.instructions.md)
- `/clean-code-review` — the full on-demand audit (jscpd, ESLint, etc.)
- [PostSlice hook](PostSlice.md) — the sibling drift-score advisory
- `scripts/audit/clean-code-delta.mjs` — the implementation
