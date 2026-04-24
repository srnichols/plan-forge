# Rummag Field Test — Audit Loop (Plan Forge v2.80.0)

> **Goal**: Validate the promoted audit-loop feature against a real codebase with real findings. Reproduce or improve on the 88 → 0 drain curve originally observed during Phase-39 design.

---

## 1. Upgrade Plan Forge

From the Rummag repo root:

```powershell
pforge self-update
pforge smith                 # confirm environment is healthy
pforge audit-loop --help     # should print usage, no side effects
```

Expected version: **v2.80.0** (tag `v2.80.0`, commit `bf6f57c` or newer).

---

## 2. Wire Rummag's Scanners

The audit-loop framework ships; the scanners that produce findings are project-specific. Register Rummag's content scanners in `.forge.json`:

```json
{
  "audit": {
    "mode": "off"
  },
  "tempering": {
    "scanners": [
      { "name": "rummag-content-audit", "command": "npm run audit:content -- --json" }
      // add Rummag's actual scanner commands here
    ]
  }
}
```

`audit.mode` stays `off` for now — we run manually with the CLI flag.

---

## 3. Dry-Run First

```powershell
pforge audit-loop --dry-run --env=dev
```

Expect: "Dry Run — would run drain with maxRounds=5". No files written.

---

## 4. Run the Loop

```powershell
pforge audit-loop --max=5 --env=dev
```

What happens per round:
1. Scanners run → findings collected
2. `forge_triage_route` classifies each finding into a lane (bug / crucible / classifier-noise)
3. Bugs get registered, crucibles get drafted, noise gets suppressed
4. Next round scans again — descending curve if the feature works

---

## 5. Artifacts to Send Back

| File | What it tells us |
|---|---|
| `.forge/audits/dev-<timestamp>.json` | Final audit artifact — finding counts per round, triage distribution, total duration |
| `.forge/tempering/drain-history.jsonl` | Per-round curve (one line per drain), the key evidence |
| `.forge/tempering/drain-<timestamp>.log` | Raw scanner output for any failing round |

Zip those three paths and send them back. That's the evidence.

---

## 6. What Good Looks Like

- **Round 1**: meaningful finding count (not 0 — if 0, scanners aren't wired right)
- **Rounds 2–N**: monotonically descending count
- **Convergence**: 0 findings before hitting `--max=5`, or a clear plateau showing which findings need human attention
- **Triage distribution**: lane assignments match what a human would pick (this is what the classifier-reviewer agent audits)

## 7. What Bad Looks Like (and what to report)

| Symptom | Likely cause |
|---|---|
| Round 1 returns 0 findings | Scanners not registered or not emitting JSON |
| Count oscillates round-to-round | Classifier noise — findings mis-routed, not real regressions |
| Count plateaus above 0 | Expected for findings needing human fix; check triage lanes |
| CLI crashes or hangs | File a meta-bug via `forge_meta_bug_file` (class: `orchestrator-defect`) |
| Triage sends obvious bugs to `classifier-noise` | File a meta-bug (class: `prompt-defect`) and attach the finding |

---

## 8. Caveats

- **Router regression (non-blocking)**: Phase-38 made the classifier keyword-only at 100% pass rate on 84 stress prompts, so the `detectApiProvider` misrouting in `pforge-master/src/reasoning.mjs` shouldn't affect this run. If triage accuracy degrades noticeably, mention it in the report.
- **Windows Ctrl+C caveat**: If the run is interrupted, the orchestrator currently marks partially-complete rounds as "passed" (meta-bug #99). Use `Get-Content .forge/tempering/drain-history.jsonl` to verify actual round count before trusting the artifact.

---

## 9. One-Liner for the Impatient

```powershell
pforge self-update; pforge audit-loop --dry-run --env=dev; pforge audit-loop --max=5 --env=dev
```

---

**Plan Forge version**: v2.80.0
**Phase**: 39 (Audit Loop Promotion)
**Originating proposal**: [0001-recursive-audit-loop.md](../0001-recursive-audit-loop.md)
