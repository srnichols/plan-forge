# Phase-41 ENUMS-CENTRALIZATION — Retro

> **Phase**: 41  
> **Name**: ENUMS-CENTRALIZATION  
> **Status**: COMPLETE  
> **Completed**: 2026-05-19  
> **Slices**: S0–S7 (8 commits)  
> **Branch**: `planning/main`

---

## What Shipped

| Slice | Commit | What |
|-------|--------|------|
| S0 | `test(enums-centralization): S0 — baseline goldens + red-state enum test` | Golden fixtures for smith output, capabilities doc, error catalog |
| S1 | `feat(enums): add enums.mjs single source of truth + tests (Phase-41 S1)` | `pforge-mcp/enums.mjs` with 8 frozen enum exports + `enums.test.mjs` |
| S2 | `feat(phase-41): S2 — enums-cli.mjs + smith hook migration (ps1+sh) + golden test` | `bin/enums-cli.mjs`; `pforge.ps1`/`pforge.sh` smith reads from enums; smith-golden test |
| S3 | `refactor(capabilities): capabilities.mjs reads from TOOL_NAMES; docs/capabilities.md auto-generated` | `scripts/generate-capabilities-doc.mjs` + `scripts/check-capabilities-doc.mjs`; doc auto-gen wired into preCommit |
| S4 | `refactor(errors): named error codes centralized in enums.mjs; errors-and-exit-codes.html auto-generated` | `ERROR_CODES` in `enums.mjs`; `scripts/generate-error-catalog.mjs` + `scripts/check-error-catalog.mjs` |
| S5 | `refactor: quorum/cost-source/mode strings migrated to enums.mjs` | Orchestrator, cost-service, forge-master config use enum refs instead of string literals |
| S6 | `test(enums-centralization): S6 — full QA sweep, golden behavior preservation verified` | 305 test files / 6475 tests passed; check scripts in sync |
| S7 | `docs(enums-centralization): S7 — reference links + Temper Guard + CHANGELOG + retro` | This file + doc cross-links + Temper Guard + CHANGELOG entry |

---

## What Went Well

1. **enum-first strategy worked** — building `enums.mjs` in S1 before any consumer migration kept every subsequent slice mechanical and low-risk.
2. **CI guards prevent future drift** — `check-capabilities-doc.mjs` and `check-error-catalog.mjs` in the preCommit chain mean doc drift is now a CI failure, not a human memory burden.
3. **enums-cli.mjs approach** — giving PowerShell and bash a way to shell-out for enum values (rather than replicating the array in two shell scripts) incidentally fixed the pre-existing asymmetry where `pforge.sh` smith never enumerated LiveGuard hooks.
4. **smith-golden.test.mjs** — byte-identical output verification gave high confidence the migration was behaviorally invisible.
5. **Zero test regressions** — 305/305 test files pass in `pforge-mcp`; `pforge-master` session-store timeouts are pre-existing flakes (pass in isolation), not Phase-41 regressions.

---

## What Was Harder Than Expected

1. **capabilities.md drift on S6** — The `forge_run_plan` tool description had been updated after S3 committed the doc snapshot. The check script caught it correctly; required regenerating `docs/capabilities.md` as part of S6. No issue, but the check-on-commit timing window (S3 committed the doc, then a later commit updated tool descriptions) means drift can accumulate between explicit `generate-capabilities-doc.mjs` runs. The preCommit guard mitigates this going forward.
2. **S5 scope judgment** — The plan left quorum-mode parsing in `pforge.ps1`/`pforge.sh` `run-plan` path as an in-slice judgment call. Decided to defer: `node` is invoked by `run-plan` but the quorum flag is parsed before the node spawn, making `enums-cli.mjs` awkward there. Tagged with `# TODO: enum migration` comment. This is the largest remaining non-centralized surface.
3. **pforge-master session-store timeout flakes** — 3 tests timeout under parallel load but pass in isolation. These are pre-existing (not Phase-41). Filed as ambient tech debt to watch.

---

## Surfaces Still NOT Centralized (and Why)

| Surface | Why Deferred |
|---------|-------------|
| `--quorum=` flag parsing in `pforge.ps1`/`pforge.sh` `run-plan` path | `node` is already invoked for the plan execution, but the flag is parsed before that spawn. `enums-cli.mjs` call here would add a cold-start node invoke on every `run-plan` invocation. Tagged `# TODO: enum migration`. |
| Throw sites in `pforge-mcp/` that didn't map cleanly to `ERROR_CODES` in S4 | Tagged `// TODO: enum migration` per plan contract. ~6 sites. Follow-up phase if the backlog grows. |
| `docs/manual/forge-json-reference.html` — auto-gen | Too much hand-curated prose. Reference-link approach only (implemented in S7). Auto-gen is a future phase. |
| `docs/manual/customization.html` — auto-gen | Same reason. Reference-link only. |

---

## CI Guard Status (post-phase)

| Guard | Location | Trigger |
|-------|----------|---------|
| `check-capabilities-doc.mjs` | preCommit chain | Fails commit if `docs/capabilities.md` tool table drifts from `TOOL_NAMES` |
| `check-error-catalog.mjs` | preCommit chain | Fails commit if `errors-and-exit-codes.html` drifts from `ERROR_CODES` |
| `enums.test.mjs` | vitest suite | Frozen-ness, assert helpers, cross-check HOOK_CATEGORY, TOOL_NAMES.length vs TOOLS.length |
| `smith-golden.test.mjs` | vitest suite | Byte-identical smith output vs S2 golden fixture |

---

## Recommendations for Future Phases

1. When adding a new hook, tool, or error code: update `enums.mjs` first, then update consumers — the CI guards will catch any drift.
2. If the `--quorum=` parsing TODO becomes painful, the cleanest fix is a tiny pre-parse node one-liner that doesn't require `enums-cli.mjs` startup cost.
3. Consider periodic `generate-capabilities-doc.mjs --dry-run` in CI (not just preCommit) to catch drift from PRs that bypass the commit hook.
