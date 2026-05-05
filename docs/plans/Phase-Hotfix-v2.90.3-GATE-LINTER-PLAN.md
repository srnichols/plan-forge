# Hotfix v2.90.3 — Plan-Gate Linter (Catch Windows / WSL Pitfalls Pre-Run)

> **Status**: Drafted, awaiting hardening (Step 2)
> **Tracks**: Code (lint extension) + Tests
> **Estimated cost**: $0.20–$0.40 (4 slices)
> **VERSION target**: 2.90.2 → 2.90.3 (patch)
> **Depends on**: None directly; does not need v2.90.1 or v2.90.2 to land first

---

## Feature Specification

### Problem Statement

Two slices in the May 5 chapter dogfood failed at the gate stage because of authoring bugs the orchestrator could have caught **before** running the slice:

1. **Phase D Slice 3** — `bash pforge.sh github metrics --help | grep -q pull` ran on Windows cmd.exe (because `bash` is the first token, not a Unix tool, so auto-routing didn't engage). `grep` not found.
2. **Phase B Slice 7** — `node -e "...if(!/##\\s+Slice/...)"` looked for `## Slice` but the SARIF generator emits `### Slice` (3 hashes). Regex never matched. (This one is content-level, not portability-level — but the linter could flag the `\\s` double-escape pattern.)

The orchestrator already has `lintGateCommands()` (called from `pforge analyze`). This hotfix extends it with Windows-portability rules:

- **Rule W1**: Detect `bash <script>` or `bash -c "<...>"` as the leading token. These don't auto-route through Git Bash; they hit `where bash` which finds WSL bash first on Windows. → Suggest: drop the `bash` prefix; orchestrator auto-routes Unix tools via Git Bash for you.
- **Rule W2**: Detect shell pipelines (`cmd1 | cmd2`) where `cmd1` is `node`/`npx`/`pwsh` (not Unix tools). Pipeline still works on Windows because of orchestrator's hasShellChain detection, but warn that `node -e "..."` wrapping is more portable.
- **Rule W3**: Detect `node -e "...\\\\s..."` patterns where the regex backslash count looks wrong. Heuristic: any `\\\\s\\+` or `\\\\d\\+` is suspicious in a `node -e` because cmd.exe strips one backslash level — show the user what regex will actually compile.
- **Rule W4**: Detect `cd <dir> && <cmd>` patterns. Suggest `node --prefix <dir> ...` or use the orchestrator's `cwd` option in test gates.

The work is **strictly additive**. Existing gates that pass `lintGateCommands` keep passing. New rules emit warnings (not errors) by default; can be promoted to errors via `PFORGE_GATE_LINT_STRICT=1`.

### User Scenarios

**Scenario 1: Plan author runs `pforge analyze` before execution**
1. Plan has the Phase D Slice 3-style gate `bash pforge.sh github metrics --help | grep -q pull`.
2. `pforge analyze` runs `lintGateCommands` and reports:
   ```
   Slice 3: warning [W1] gate begins with `bash` — bypasses orchestrator auto-routing.
     suggestion: rewrite as `node -e "const cp=require('child_process'); const out=cp.execFileSync('bash',['pforge.sh','github','metrics','--help'],{encoding:'utf8'}); if(!/pull/i.test(out)){...}"`
     reason: on Windows, leading `bash` resolves to WSL bash via PATH lookup; WSL has no Windows node/npx on PATH
   ```
3. User fixes the gate before running. Saves a 6-min worker-execute round trip.

**Scenario 2: Strict mode in CI**
1. CI sets `PFORGE_GATE_LINT_STRICT=1` and runs `pforge analyze` as a pre-run check.
2. Any W-rule warning becomes an error. CI fails fast.
3. No partial slice execution; user fixes the plan locally.

**Scenario 3: False positive on a legitimate `bash` gate**
1. User legitimately needs `bash -c` for a heredoc gate (rare).
2. They suppress the rule per-slice with a magic comment in the gate: `# pforge-lint-disable W1`.
3. Lint warning suppressed for that gate only.

### Acceptance Criteria

- [ ] **MUST**: Four new rules (W1, W2, W3, W4) added to `lintGateCommands` in `pforge-mcp/orchestrator.mjs` (or a sibling module if cleaner — Hardener decides).
- [ ] **MUST**: Each rule emits a structured finding `{ ruleId, severity: "warn"|"error", line, suggestion, explanation }`.
- [ ] **MUST**: Default severity is `warn`. `PFORGE_GATE_LINT_STRICT=1` upgrades all W-rules to `error`.
- [ ] **MUST**: Per-gate suppression via `# pforge-lint-disable <RULE_ID>` (or `<RULE_ID1>,<RULE_ID2>`) inside the gate text. Multiple rules per line allowed.
- [ ] **MUST**: `pforge analyze` output groups findings by slice, prints rule + suggestion, and shows a final count by severity.
- [ ] **MUST**: New vitest cases in `pforge-mcp/tests/lint-gate-windows-portability.test.mjs` cover all 4 rules + the `disable` directive + strict-mode promotion.
- [ ] **MUST**: Existing `lint-gate-portability.test.mjs` cases still pass.
- [ ] **MUST**: Documentation in `.github/instructions/plan-gate-command-rules.md` lists the 4 rules with examples and the suppression syntax.
- [ ] **SHOULD**: `pforge analyze --json` output includes the structured findings under `lint.findings`.

### Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Gate has zero rule violations | No output for that gate (silent pass). |
| Gate has multiple violations on one line | All emitted. |
| Suppression directive applies to a rule that's not violated | No-op (no warning about an unused suppression). |
| Strict mode + suppression directive | Suppression still wins. Suppressed rule never errors. |
| Gate is multi-line (rare today) | Each line linted independently. |
| Gate uses an unusual but legitimate pattern (e.g. `bash -lc 'source ~/.bashrc && ...'`) | W1 fires (warn). User suppresses if intentional. |

### Out of Scope

- Auto-fixing gates (just suggesting). A future hotfix could offer `pforge analyze --fix-gates`.
- Linting non-gate fields (acceptance criteria, scope, etc.).
- Macro / template support (`{{var}}` expansion) — gates are still raw strings.
- Linting MCP-tool-call patterns (out of scope; this is shell-only).

---

## Scope Contract

### Inputs
- [pforge-mcp/orchestrator.mjs](../../pforge-mcp/orchestrator.mjs) — `lintGateCommands` (existing)
- [pforge-mcp/tests/lint-gate-portability.test.mjs](../../pforge-mcp/tests/lint-gate-portability.test.mjs) — for shape + style reference
- Memory note `plan-gate-command-rules.md`

### Outputs
- **Modified**: `pforge-mcp/orchestrator.mjs` (additive lint rules)
- **New**: `pforge-mcp/tests/lint-gate-windows-portability.test.mjs`
- **Modified**: `.github/instructions/plan-gate-command-rules.md` (rule list + suppression syntax)
- **Modified**: `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`

### Forbidden Actions
- ❌ Modifying any existing rule's behavior or severity (additive only)
- ❌ Changing the linter's default (must stay `warn`)
- ❌ Modifying `runGate` execution behavior (lint is upstream of run)

---

## Slice Plan

### Slice 1 — W1 + W4 rules (the bash-prefix and cd-chain pitfalls)
**Files in scope**: `pforge-mcp/orchestrator.mjs`
**Validation gate**:
```bash
node -e "const m=await import('./pforge-mcp/orchestrator.mjs'); const findings=m.lintGateCommands({slices:[{number:'1',validationGate:'bash -c \"node -e xyz\"'},{number:'2',validationGate:'cd pforge-mcp && npx vitest'}]}); const w1=findings.find(f=>f.ruleId==='W1'); const w4=findings.find(f=>f.ruleId==='W4'); if(!w1||!w4){console.error('W1/W4 not detected');process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0.10

### Slice 2 — W2 + W3 rules (pipelines + regex-escape heuristic)
**Files in scope**: `pforge-mcp/orchestrator.mjs`
**Validation gate**:
```bash
node -e "const m=await import('./pforge-mcp/orchestrator.mjs'); const findings=m.lintGateCommands({slices:[{number:'1',validationGate:'node -e \"console.log(/##\\\\\\\\s+Slice/.test(\\\"x\\\"))\"'},{number:'2',validationGate:'node -e \"x\" | grep ok'}]}); const w2=findings.find(f=>f.ruleId==='W2'); const w3=findings.find(f=>f.ruleId==='W3'); if(!w2||!w3){console.error('W2/W3 not detected');process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0.10

### Slice 3 — Suppression directive + strict mode
**Files in scope**: `pforge-mcp/orchestrator.mjs`, `pforge-mcp/tests/lint-gate-windows-portability.test.mjs`
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/lint-gate-windows-portability.test.mjs
```
**Estimated cost**: $0.15

### Slice 4 — Docs + version + CHANGELOG
**Files in scope**: `.github/instructions/plan-gate-command-rules.md`, `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`
**Validation gate**:
```bash
node -e "const fs=require('fs'); const v=fs.readFileSync('VERSION','utf8').trim(); const cl=fs.readFileSync('CHANGELOG.md','utf8'); const inst=fs.readFileSync('.github/instructions/plan-gate-command-rules.md','utf8'); const checks={version:v==='2.90.3', changelog:/2\\.90\\.3/.test(cl), w1:/W1/.test(inst), w4:/W4/.test(inst), strict:/PFORGE_GATE_LINT_STRICT/.test(inst), suppress:/pforge-lint-disable/.test(inst)}; const failed=Object.entries(checks).filter(([_,v])=>!v); if(failed.length){console.error('failed:',failed.map(([k])=>k).join(','));process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0.10

---

## Branch Strategy
- Branch: `hotfix/v2.90.3-gate-linter`
- Base: `master` (after v2.90.2)

## Rollback Plan
- All rules emit `warn` by default — no behavior change to gate execution.
- `PFORGE_GATE_LINT_STRICT` is opt-in.
- Full rollback: `git revert <merge-commit>` removes all 4 rules wholesale.
