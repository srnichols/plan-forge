---
lane: full
source: human
hardened: true
hardened_by: Claude Opus 4.7 (in-session hotfix plan)
hardened_at: 2026-04-22
---

# Phase-34.1 — Windows Gate Dispatch via Bash (hotfix for meta-bug #95)

> **Target release**: v2.68.1
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-34 shipped (v2.68.0)
> **Scope**: ONE functional slice + release. This is a hotfix.

---

## Specification Source

- **Field input**: Phase-33 Slice 4 (meta-bug [#94](https://github.com/srnichols/plan-forge/issues/94)) and Phase-34 Slice 4 (meta-bug [#95](https://github.com/srnichols/plan-forge/issues/95)) both false-negative'd on Windows because `runGate` in [pforge-mcp/orchestrator.mjs](pforge-mcp/orchestrator.mjs) dispatches via `execSync(command, ...)` which on Windows resolves through cmd.exe. cmd has no Unix builtins (`test`, `grep`, `sed`, `awk`, `wc`, `head`, `tail`, etc.). Plan-authoring workarounds just hit the next missing tool.
- **Existing detection**: `lintGateCommands` (line 4558) already has a `WINDOWS_UNAVAILABLE` list and warns when a Unix tool is used without `bash -c` wrapper. But it's a `warn`, not a failure, and the runtime dispatch doesn't act on it.
- **Fix**: At `runGate` dispatch time on Windows, detect Unix tools in the command and auto-wrap through bash.exe. Probe for bash at first use (cached), fall back gracefully, fail loudly when no bash is available — no silent success, no silent false-failure.
- **Architecture anchor**: Principle 10 (Keep Gates Boring) — the gate dispatch layer should Just Work on both platforms. Principle 7 (Evidence Over Assumption) — two consecutive release phases hitting the same class of bug is sufficient evidence to fix it at the dispatch layer, not keep papering over it in plan authoring.

---

## Scope Contract

### In scope

- [pforge-mcp/orchestrator.mjs](pforge-mcp/orchestrator.mjs) — `runGate` function: add Windows bash-wrapping path
- `pforge-mcp/tests/orchestrator-gate-dispatch.test.mjs` — NEW unit tests for the dispatch logic
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — release metadata
- `.github/prompts/step2-harden-plan.prompt.md` — update plan-authoring guidance: noting bash auto-wrap behavior

### Out of scope

- Any change to `GATE_ALLOWED_PREFIXES` allowlist (leave as-is)
- Any change to `lintGateCommands` warnings or severity
- Any change to plan files from Phase-33 or Phase-34 (fix is at dispatch layer, not in plans)
- Any change to non-Windows platforms (Linux/macOS pass-through unchanged)
- Any change to the orchestrator's code-writing worker spawn (`gh copilot -p` dispatch)
- WSL integration or WSL probe — `wsl.exe` dispatch deferred; Phase-34.1 relies on git bash only

### Forbidden actions

- Do NOT add a new dependency. Node built-ins only (`child_process`, `fs`, `path`, `os`).
- Do NOT change dispatch behavior on non-Windows platforms (`process.platform !== "win32"` must keep current behavior exactly).
- Do NOT remove the existing `GATE_ALLOWED_PREFIXES` allowlist check — allowlist runs BEFORE bash-wrap decision.
- Do NOT wrap ALL gate commands in bash on Windows — only wrap when the detected leading token is a Unix-only tool. `npx vitest` etc. MUST pass through unchanged (they rely on npm shim resolution).
- Do NOT swallow bash-probe errors silently. If a Unix tool is detected AND no bash is available, return a failure with a specific actionable error message.
- Do NOT use `test -f`, `grep`, or any Unix tool in this plan's validation gates (this is the bug we're fixing). Gates use `node` or `npx vitest run` only.

---

## Acceptance Criteria

### Criteria for Slice 1 (Windows bash dispatch)

- **MUST**: `runGate` in `pforge-mcp/orchestrator.mjs` detects whether the first token of the command is a Unix-only tool from a list including at minimum: `grep`, `sed`, `awk`, `test`, `wc`, `head`, `tail`, `sort`, `diff`, `tr`, `xargs`.
- **MUST**: On `process.platform === "win32"` AND Unix tool detected AND the command is not already wrapped in `bash -c`, `runGate` probes for bash in this order: (a) `process.env.PFORGE_BASH_PATH` if set and file exists, (b) `C:\Program Files\Git\bin\bash.exe`, (c) `C:\Program Files (x86)\Git\bin\bash.exe`, (d) result of `where bash` subprocess if exit code 0. First match wins. Result cached in module scope for subsequent calls.
- **MUST**: When bash is found, `runGate` invokes `execFileSync(bashPath, ["-c", command], { cwd, encoding: "utf-8", timeout, env: { ...process.env, NO_COLOR: "1" } })` instead of `execSync(command, ...)`.
- **MUST**: When bash is NOT found and a Unix tool was detected, `runGate` returns `{ success: false, output: "", error: <msg> }` where `<msg>` contains the exact phrase `"gate requires bash but none found on Windows"` and suggests installing Git for Windows or setting `PFORGE_BASH_PATH`.
- **MUST**: On non-Windows platforms, `runGate` behavior is unchanged — still uses `execSync(command, ...)` directly.
- **MUST**: On Windows when the command's first token is NOT a Unix tool (e.g., `npx`, `node`, `npm`), `runGate` behavior is unchanged — still uses `execSync(command, ...)` directly. `npx vitest run ...` MUST continue to work exactly as before.
- **MUST**: The bash probe is cached — at most one `where bash` subprocess and one filesystem stat per module lifetime.
- **MUST**: `pforge-mcp/tests/orchestrator-gate-dispatch.test.mjs` contains at least 6 tests covering: (a) non-Windows platform passes through unchanged, (b) Windows + `npx` command passes through unchanged, (c) Windows + `grep` command with bash available gets wrapped, (d) Windows + `grep` command with no bash available returns the specific error, (e) `PFORGE_BASH_PATH` env overrides probe, (f) already-wrapped `bash -c "..."` command is not double-wrapped.

### Criteria for Slice 2 (release v2.68.1)

- **MUST**: `VERSION` contains `2.68.1`.
- **MUST**: `CHANGELOG.md` has a `[2.68.1] — 2026-04-22` section under `[Unreleased]`, headlined with the phrase `"Windows gate dispatch"` or `"hotfix"` or both.
- **MUST**: `ROADMAP.md` reflects v2.68.1 as shipped.
- **MUST**: `.github/prompts/step2-harden-plan.prompt.md` notes that on Windows, `runGate` auto-wraps Unix-tool commands in bash when git bash is available; plan authors MAY use `grep -q ...` gates and expect them to work on Windows with git bash installed.
- **MUST**: Git tag `v2.68.1` exists on the Slice 2 release commit.

### Quality bar

- **SHOULD**: Release commit message format `chore(release): v2.68.1 — Windows gate bash dispatch (hotfix #95)`.
- **SHOULD**: The new unit test file's test names clearly map to the 6 scenarios above for easy triage.

---

## Execution Slices

### Slice 1 — Windows bash dispatch in runGate

**Complexity**: 3 (modify one function, add bash probe helper, 6 unit tests).

**Files to modify**:
- `pforge-mcp/orchestrator.mjs` — `runGate` function and a new `resolveBashPath()` helper

**Files to create**:
- `pforge-mcp/tests/orchestrator-gate-dispatch.test.mjs`

**Steps**:
1. Read `pforge-mcp/orchestrator.mjs` around `runGate` (line 1913) and `WINDOWS_UNAVAILABLE` (line 4558) to reuse the tool list.
2. Extract `WINDOWS_UNAVAILABLE` into a module-scope constant `UNIX_TOOLS` so both `runGate` and `lintGateCommands` reference it. Keep the existing `lintGateCommands` behavior unchanged — this is just a rename / hoist.
3. Add module-scope `let cachedBashPath = undefined;` (undefined = not probed yet; null = probed, not found; string = probed, found).
4. Add `resolveBashPath()` function: returns cached value if already probed; otherwise iterates the probe order (`PFORGE_BASH_PATH` env → `C:\Program Files\Git\bin\bash.exe` → `C:\Program Files (x86)\Git\bin\bash.exe` → `where bash` subprocess). Uses `fs.existsSync` for file paths and `execFileSync("where", ["bash"], { ... })` for the PATH probe, wrapped in try/catch. Caches and returns result.
5. Modify `runGate` after the allowlist check: extract `cmdBase`. If `process.platform === "win32"` AND `UNIX_TOOLS.includes(cmdBase)` AND the command does NOT start with `bash ` or contain `bash -c`, call `resolveBashPath()`. If result is a string, invoke via `execFileSync(bashPath, ["-c", command], ...)` and return `{success, output, error}` accordingly. If result is null (no bash found), return `{ success: false, output: "", error: "gate requires bash but none found on Windows. Install Git for Windows or set PFORGE_BASH_PATH to a bash.exe path. Detected Unix tool: '<cmdBase>'." }`.
6. All other code paths (non-Windows, Windows + non-Unix-tool command) continue to use the existing `execSync(command, ...)` path unchanged.
7. Write the 6 unit tests. Use `vi.stubGlobal("process", { ...process, platform: "linux" })` pattern and mock `child_process.execFileSync` / `execSync` and `fs.existsSync` via vitest `vi.mock`. Stub `resolveBashPath` cache between tests by exporting a `__resetBashPathCache()` test helper.

**Validation gate**:
```bash
npx vitest run pforge-mcp/tests/orchestrator-gate-dispatch.test.mjs --reporter=default
```
Expected: `Tests  6 passed (6)` (or more).

**Commit**: `fix(orchestrator): Windows bash dispatch for Unix-tool gates (#95)`

---

### Slice 2 — Release v2.68.1

**Complexity**: 2 (docs + version-bump + tag; no Unix tools in gate).

**Files to modify**:
- `VERSION`
- `CHANGELOG.md`
- `ROADMAP.md`
- `.github/prompts/step2-harden-plan.prompt.md`

**Steps**:
1. Run `.\pforge.ps1 version-bump 2.68.1 --strict`. Require `Updated 5/5`.
2. Add `[2.68.1] — 2026-04-22 — Windows gate dispatch hotfix` section to CHANGELOG under `[Unreleased]`. One-paragraph description: bug, fix, impact. Link #94 and #95.
3. Update `ROADMAP.md` to mark Phase-34.1 shipped.
4. Update `.github/prompts/step2-harden-plan.prompt.md`: in the plan-authoring guidance section about gates, add a note that Windows users with Git for Windows installed can use `grep`, `test`, `sed` etc. in gates — the orchestrator auto-wraps them in bash. Without git bash, only `node`/`npx`/`npm` commands work in gates on Windows.
5. Commit as `chore(release): v2.68.1 — Windows gate bash dispatch (hotfix #95)`.
6. Tag: `git tag v2.68.1 && git push origin v2.68.1`.

**Validation gate**:
```bash
node -e "const v=require('fs').readFileSync('VERSION','utf8').trim(); const c=require('fs').readFileSync('CHANGELOG.md','utf8'); if(v!=='2.68.1') throw new Error('VERSION='+v); if(!c.includes('[2.68.1]')) throw new Error('CHANGELOG missing 2.68.1'); if(!/Windows gate|hotfix/i.test(c.split('[2.68.0]')[0])) throw new Error('CHANGELOG headline missing'); console.log('ok');"
```
Expected: prints `ok`, exit 0. (Pure `node -e` gate — no Unix tools, tests the fix-target behavior itself.)

**Commit**: `chore(release): v2.68.1 — Windows gate bash dispatch (hotfix #95)`

---

## Execution Order

1 → 2. No parallelism.

## Risks and Mitigations

- **Risk**: Workers on CI / Linux agents see no behavior change — good, but confirm the non-Windows path is truly untouched. *Mitigation*: Slice 1 test (a) explicitly asserts non-Windows passes through via the original `execSync` path.
- **Risk**: Git bash stderr encoding differs from cmd.exe — output parsing downstream might break. *Mitigation*: bash stderr is UTF-8 by default; cmd.exe stderr is codepage-dependent. bash wrap is strictly better for consistency. Monitor the first post-hotfix run.
- **Risk**: `PFORGE_BASH_PATH` set to invalid path silently fails. *Mitigation*: `resolveBashPath` uses `fs.existsSync` after reading the env var; invalid path falls through to next probe step.
- **Risk**: Cached probe result wrong after user installs git bash mid-session. *Mitigation*: cache is per-process; restart orchestrator to re-probe. Document in step2 guidance.

## Session Break Points

- None — this is a hotfix. Complete in one session.
