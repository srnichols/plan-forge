---
name: audit-loop
description: "Run a recursive audit drain loop — discover findings from the running system, triage each into bug/spec/classifier lanes, repeat until convergence. USE FOR: end-to-end audit of a deployed or locally-running app, draining findings to zero. DO NOT USE FOR: single-shot tempering runs (use forge_tempering_run), one-off bug filing (use forge_bug_register), security-only scans (use /security-audit skill), code complexity review (use /forge-quench skill)."
argument-hint: "[optional: --max=N to cap rounds, --env=dev|staging, --dry-run to preview without side effects]"
tools:
  - forge_tempering_drain
  - forge_triage_route
---

# Audit Loop Skill

## Trigger
"Run an audit loop" / "Drain findings" / "Audit my app" / "Find bugs in the running system" / "Recursive audit"

## Steps

### 1. Start the Drain Loop
Call the `forge_tempering_drain` MCP tool to run a multi-round tempering drain. The drain discovers findings from the running system, applies the classifier, and repeats until convergence (zero real findings) or the round cap is hit.

Pass through any user-supplied options:
- `maxRounds` — cap on iterations (default 5)
- `env` — target environment (default `dev`)
- `dryRun` — if true, discover findings but skip triage side effects

Review the drain result for:
- Number of rounds executed
- Per-round finding counts (the drain curve)
- Whether the loop converged or hit the round cap
- The final set of unresolved findings

### 2. Triage Each Finding
For every finding returned by the drain, call the `forge_triage_route` MCP tool to classify it into one of three lanes:

| Lane | Meaning | Next Action |
|------|---------|-------------|
| **bug** | Real product defect | File via `forge_bug_register` |
| **spec** | Feature or spec gap | Route to plan pipeline |
| **classifier** | Noise / false positive | Propose classifier PR |

Collect triage results and group by lane.

### 3. Report the Drain Curve
Present a summary showing the drain trajectory and triage breakdown:

```
Audit Loop Results:
  Rounds:      N executed (converged: yes/no)
  Drain curve: R1: 12 → R2: 5 → R3: 1 → R4: 0

  Triage:
    🐛 Bug:        N findings → filed / ready to file
    📋 Spec:       N findings → routed to plan pipeline
    🔇 Classifier: N findings → classifier PR proposed

  Overall: CONVERGED at round N / HIT CAP at round N
```

## Safety Rules
- Default environment is `dev` — never target production unless explicitly requested
- `--dry-run` skips all side effects (bug filing, spec routing, classifier PRs)
- Respect `audit.mode` in `.forge.json` — if set to `off`, warn the user and stop
- This skill orchestrates existing tools; it does NOT crawl or classify directly

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "All classifier findings are noise — ignore them" | Classifier findings indicate the classifier itself needs tuning. Route them to the classifier lane so the loop converges in future runs. |
| "One round found zero — skip remaining rounds" | A single clean round is necessary but the drain contract requires convergence confirmation. Let the drain tool handle termination. |
| "File all findings as bugs" | Spec gaps and classifier noise are not bugs. Mis-filing pollutes the bug registry and wastes fix effort. Triage each finding individually. |

## Exit Proof

After completing this skill, confirm:
- [ ] `forge_tempering_drain` executed and returned a drain result
- [ ] Every finding triaged via `forge_triage_route` with a lane assignment
- [ ] Drain curve printed showing per-round finding counts
- [ ] Triage breakdown shows counts per lane (bug, spec, classifier)
