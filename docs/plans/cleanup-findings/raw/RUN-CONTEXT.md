# RUN-CONTEXT — Phase 42 Audit Run

> Generated: 2026-05-19 07:45:08 -06:00

## Repository State

| Field | Value |
|-------|-------|
| Commit | `d30c5f19afcd8abb4ea2abd125a2e5da8ebc84b9` |
| Commit date | 2026-05-19 07:25:33 -0600 |
| Branch | `planning/main` |
| Working tree clean | No |

## Tool Versions

| Tool | Version |
|------|---------|
| Node.js | v24.11.1 |
| npm | 11.6.2 |
| ESLint | v9.39.4 |
| jscpd | 4.2.3 |
| madge | 7.0.0 |

## Scripts Executed

| Script | Output |
|--------|--------|
| eslint-clean-code.config.mjs | eslint-report.json |
| run-jscpd.mjs | duplication-report.json |
| grep-matrix.mjs | grep-matrix-report.json |
| measure-modules.mjs | module-metrics.json |
| long-param-walker.mjs | long-param-report.json |
| scan-architecture.mjs | architecture-report.json |

## Thresholds (from Appendix C.5)

| Rule | Warn | Error |
|------|------|-------|
| max-lines-per-function | 100 | 300 |
| max-params | 4 | 6 |
| complexity | 12 | 20 |
| jscpd min-tokens | 75 | n/a |
| G14 LOC | >1000 (medium) | >3000 (high) |
