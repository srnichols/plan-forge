# Hook: PostSlice

> **Status**: 🚧 WIP — Planned for v2.29.0  
> **Lifecycle Event**: After a slice commit is detected in the current session  
> **Depends On**: v2.27.0 (`forge_drift_report` shipped)  
> **Blocks**: Nothing — advisory only (does not stop the next slice from starting)

---

## Purpose

Run a silent drift check after every slice commit. Surface score regressions inline — in the agent turn immediately following the commit — before the agent moves to the next slice. Catch guardrail erosion one slice at a time, not after the full plan has shipped.

---

## Trigger Conditions

Fire this hook when the PostToolUse hook detects **all** of the following in the same session turn:

1. A terminal command matching `git commit` completed with exit code 0
2. The commit message matches the conventional commit pattern: `^(feat|fix|refactor|perf|chore|style|test)\(`
3. The previous drift score exists in `.forge/drift-history.json` (i.e., at least one prior drift measurement)

Do **not** fire on:
- `docs:` or `ci:` commits (non-code changes don't affect drift score meaningfully)
- Merge commits
- The first commit of a session (no baseline to compare against)
- Commits with `--no-verify` flag (user has explicitly bypassed hooks)

---

## Actions

### 1. Read Prior Drift Score

Load the last entry from `.forge/drift-history.json`. Extract `score` as `priorScore`.

If the file does not exist → skip (no baseline, no action).

### 2. Run Silent Drift Check

```bash
pforge drift
```

Read the new score from `.forge/drift-history.json` last entry as `newScore`.

### 3. Evaluate Delta

| Condition | Action |
|-----------|--------|
| `newScore >= priorScore` | Proceed silently — score held or improved |
| `newScore < priorScore` AND `delta <= 5` | Proceed silently — minor fluctuation, within acceptable range |
| `newScore < priorScore` AND `delta > 5` AND `newScore >= 70` | Inject advisory (amber) |
| `newScore < priorScore` AND `delta > 10` OR `newScore < 70` | Inject warning (red) — recommend stopping before next slice |

### 4. Advisory Injection (delta > 5, score still >= 70)

```
🟡 PostSlice Hook — Drift Advisory

Drift score dropped {delta} points after this commit ({priorScore} → {newScore}).
Score is still above threshold (70) — proceeding is safe, but investigate before shipping.

Top new violations:
{violations.slice(0,3).map(v => `• ${v.file}: ${v.rule} (${v.severity})`).join('\n')}

Run `pforge drift` to see the full report.
```

### 5. Warning Injection (delta > 10 OR score < 70)

```
🔴 PostSlice Hook — Drift Warning

Drift score dropped {delta} points after this commit ({priorScore} → {newScore}).
{newScore < 70 ? `Score is BELOW threshold (70/${newScore}). ` : ''}
Recommend resolving violations before starting the next slice.

Top violations:
{violations.slice(0,5).map(v => `• ${v.file}: ${v.rule} (${v.severity})`).join('\n')}

Options:
1. Fix violations now and amend the commit
2. Accept and continue — run `pforge incident` if this causes a prod issue later
3. Run `pforge runbook docs/plans/<current-plan>` to update ops docs with new risk

The next slice will start with this reduced score as the new baseline.
```

---

## Configuration (`.forge.json`)

```json
{
  "hooks": {
    "postSlice": {
      "enabled": true,
      "silentDeltaThreshold": 5,
      "warnDeltaThreshold": 10,
      "scoreFloor": 70
    }
  }
}
```

If `hooks.postSlice` is absent, uses defaults shown above.

Set `"enabled": false` to disable entirely (e.g., during rapid iteration slices where drift is expected to fluctuate).

---

## Non-Goals

- Does NOT block the next slice from starting — advisory only
- Does NOT revert the commit — human decision
- Does NOT re-run the full test suite — drift analysis only (fast, read-only)
- Does NOT fire during quorum runs where multiple model outputs are being reconciled — wait for the human approval commit

---

## Implementation Notes (for v2.29.0 Slice)

- Wire into the existing `PostToolUse` hook: trigger on `git commit` terminal command detection
- The drift check result is already written to `.forge/drift-history.json` — delta calculation is pure file read, no subprocess needed if the cache is fresh (<30s)
- If `pforge drift` subprocess takes >10s → return cached result with `{ stale: true }` note rather than blocking the agent turn
- Advisory/warning text is injected as a **system message** in the next agent turn, not as a file write or git operation
- Track `postSliceHookFired: true` in the session's `.forge/session-meta.json` to prevent duplicate firings if the same commit is detected multiple times in one turn
