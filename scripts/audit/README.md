# Clean Code Audit Scripts — Phase 42

Run all audit scripts then view reports in `docs/plans/cleanup-findings/raw/`.

## Quick run (from repo root)

```bash
# Run the full aggregator (executes every script + merges results)
node scripts/audit/clean-code-review.mjs

# Or run scripts individually
node scripts/audit/measure-modules.mjs       # module-size (G14)
node scripts/audit/long-param-walker.mjs     # functions with >4 positional args
node scripts/audit/grep-matrix.mjs           # TODO/FIXME/HACK + commented-code
node scripts/audit/dead-exports.mjs          # exports nobody imports (Round 2)
node scripts/audit/test-smells.mjs           # focus/skip/time-flake/console-leak (Round 2)
node scripts/audit/shell-parity.mjs          # .ps1/.sh twin coverage (Round 4)
node scripts/audit/dep-boundaries.mjs        # cross-package import rules (Round 4)
node scripts/audit/frozen-arrays-drift.mjs   # hand-typed enum literals (Round 4)
```

## Threshold calibration (from Appendix C.5)
| Rule | Threshold |
|------|-----------|
| max-lines-per-function | warn 100, error 300 |
| max-params | warn 4, error 6 |
| complexity | warn 12, error 20 |
| jscpd token threshold | 75 |
| G14 LOC flag | >1000 medium, >3000 high |
| shell-parity size-delta | <40% smaller/larger → SIZE-MISMATCH warn |

## False-positive triage guide
See CATALOG.md "Excluded findings" section.
