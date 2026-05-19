# Clean Code Audit Scripts — Phase 42

Run all audit scripts then view reports in `docs/plans/cleanup-findings/raw/`.

## Quick run (from repo root)

```bash
# S0 dry-run (verify tooling)
node scripts/audit/measure-modules.mjs
node scripts/audit/grep-matrix.mjs

# S1 full run
npm run audit:full  # (if wired) or run each script individually
```

## Threshold calibration (from Appendix C.5)
| Rule | Threshold |
|------|-----------|
| max-lines-per-function | warn 100, error 300 |
| max-params | warn 4, error 6 |
| complexity | warn 12, error 20 |
| jscpd token threshold | 75 |
| G14 LOC flag | >1000 medium, >3000 high |

## False-positive triage guide
See CATALOG.md "Excluded findings" section.
