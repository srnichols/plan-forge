# Hook: PreDeploy

> **Status**: ✅ Implemented — v2.29.0  
> **Lifecycle Event**: Before any deploy-related file write or deploy command  
> **Depends On**: v2.27.0 (`forge_secret_scan`, `forge_env_diff` shipped)  
> **Blocks**: Proceed with deploy only on clean scan results

---

## Purpose

Run LiveGuard's two security-focused tools automatically before any deploy action reaches the repository. Catch secrets and env-key gaps at the last safe moment — **before** the commit is recorded, before the push fires, before the pipeline starts.

This hook converts `forge_secret_scan` and `forge_env_diff` from on-demand tools into a deploy gate.

---

## Trigger Conditions

Fire this hook when the agent:

1. Writes to any path matching `deploy/**`, `Dockerfile*`, `*.bicep`, `*.tf`, `k8s/**`, or `docker-compose*.yml`
2. Executes a terminal command matching `pforge deploy-log`, `docker push`, `az deploy`, `kubectl apply`, `azd up`, `git push`
3. The user prompt contains trigger phrases: `"deploy"`, `"push to"`, `"ship it"`, `"go live"`, `"promote to"`, `"release"`

---

## Actions (in order)

### 1. Run `forge_secret_scan`

```bash
pforge secret-scan --since HEAD~1
```

Parse the result from `.forge/secret-scan-cache.json`:

- If `clean: true` → proceed silently (no interruption)
- If `clean: false` and `findings.length > 0`:
  - **BLOCK the deploy write / command**
  - Inject the following into the agent turn before any further tool calls:

```
⛔ PreDeploy Hook — Secret Scan Alert

LiveGuard detected {findings.length} potential secret(s) in recent changes. Deploy is blocked until resolved.

Findings:
{findings.map(f => `• ${f.file}:${f.line} — ${f.type} (confidence: ${f.confidence}, entropy: ${f.entropyScore.toFixed(2)})`).join('\n')}

Resolution options:
1. Remove the secret from the diff and rotate the credential
2. Add the line to .forge/secret-scan-allowlist.json if it is a test fixture
3. Set threshold higher: pforge secret-scan --threshold 4.8

Run `pforge secret-scan --since HEAD~1` again to confirm clean before proceeding.
```

### 2. Run `forge_env_diff`

```bash
pforge env-diff
```

Parse the result from `.forge/env-diff-cache.json`:

- If `summary.clean: true` → proceed silently
- If `summary.totalMissing > 0`:
  - Do **not** block (env gaps are warnings, not hard stops)
  - Inject the following advisory:

```
⚠️ PreDeploy Hook — Environment Key Gap

LiveGuard detected {summary.totalMissing} missing key(s) across environment files.

{pairs.filter(p => p.missing.length > 0).map(p =>
  `• ${p.compareTo}: missing ${p.missing.join(', ')}`
).join('\n')}

This deploy may succeed but the target environment is missing required config.
Resolve before promoting to production.
```

### 3. Proceed

If both scans pass (or only env warnings), allow the original deploy action to continue unmodified.

---

## Configuration (`.forge.json`)

```json
{
  "hooks": {
    "preDeploy": {
      "enabled": true,
      "blockOnSecrets": true,
      "warnOnEnvGaps": true,
      "scanSince": "HEAD~1"
    }
  }
}
```

If `hooks.preDeploy` is absent from `.forge.json`, the hook runs with defaults (`blockOnSecrets: true`, `warnOnEnvGaps: true`).

---

## Non-Goals

- Does NOT replace `git` pre-push hooks — this is an agent-session gate, not a git hook
- Does NOT scan the entire repository history — only the current diff (`--since HEAD~1`)
- Does NOT auto-fix or auto-remove the offending lines — human action required
- Does NOT fire on read-only operations (viewing deploy files, running `forge_runbook`)

---

## Implementation Notes (for v2.29.0 Slice)

- Wire into the existing `PreToolUse` hook mechanism: check trigger conditions before allowing tool calls that match deploy patterns
- The scan results are already written to `.forge/` by the tool — this hook reads the cache, it does not re-invoke the tools unless cache is >10 minutes stale
- Both tools respect `gitAvailable: false` graceful degradation — if git is unavailable, PreDeploy does not block (logs a warning only)
- `blockOnSecrets` enforcement: return `{ "blocked": true, "reason": "secret-scan-found-{count}-findings" }` from the PreToolUse hook handler; the agent session sees this as a hard stop before the file write occurs

### v2.29.0 Implementation (Slice 4)

**Core logic**: `runPreDeployHook()` in `pforge-mcp/orchestrator.mjs` — pure function using `readForgeJson` for cache reads.

**Hook scripts**: `check-predeploy.sh` / `check-predeploy.ps1` in `templates/.github/hooks/scripts/` — registered as a second `PreToolUse` entry in `plan-forge.json` (runs after `check-forbidden`).

**Trigger detection**: `isDeployTrigger(toolName, filePath, command)` checks:
- File paths: `deploy/**`, `Dockerfile*`, `*.bicep`, `*.tf`, `k8s/**`, `docker-compose*.yml`
- Commands: `pforge deploy-log`, `docker push`, `az deploy`, `kubectl apply`, `azd up`, `git push`

**Blocking mechanism**: The hook returns `permissionDecision: "deny"` via the Copilot extension's PreToolUse protocol — this is a hard block, not advisory-only. The existing hook API fully supports `{ blocked: true }` semantics via the `permissionDecision` field.

**Config**: Reads `.forge.json` → `hooks.preDeploy`. Falls back to defaults (`blockOnSecrets: true`, `warnOnEnvGaps: true`) when absent.

**Test coverage**: 24 tests in `server.test.mjs` covering trigger detection (16 tests), blocking on secrets (3 tests), env gap advisory (2 tests), and non-trigger / graceful degradation (3 tests).
