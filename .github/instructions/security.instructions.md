---
description: Security rules for Plan Forge — input validation, command-injection avoidance, secret handling, and the "mutate user repo" contract. Auto-loads broadly because every file is a potential boundary.
applyTo: '**'
priority: HIGH
---

# Security Instructions

> **Plan Forge runs with the user's full shell privileges** and orchestrates writes into the user's repository. Every `forge_*` tool handler, every CLI command, every spawn, and every file write is a security boundary. This file rules the boundaries.

---

## The 6 Rules

### 1. Use `spawn(cmd, [arg, arg])` — never `exec(stringWithInput)`

`exec` parses its argument as a shell command. Any user-supplied substring becomes a shell injection vector. `spawn` with an args array passes each argument literally to the kernel, no shell involved.

```js
// ✅ correct
import { spawn } from 'node:child_process';
const child = spawn('gh', ['issue', 'create', '--title', userTitle, '--body', userBody]);

// ❌ injection vector
import { exec } from 'node:child_process';
exec(`gh issue create --title "${userTitle}" --body "${userBody}"`);
```

`userTitle = '"; rm -rf ~ #'` exploits the `exec` form. The `spawn` form passes it as a literal title containing punctuation.

**Same rule applies to `spawnSync`, `execFile`, and PowerShell `Start-Process` / `Invoke-Expression`.** Use args arrays. If you need shell features (pipes, redirects), pipe the data in code, not via the shell.

### 2. No `eval`, no `new Function(string)`, no dynamic `require(userInput)`

These accept code from a string and execute it. There is no input value sanitisation that makes this safe.

Common smells caught at review:
- `eval(json)` — use `JSON.parse(json)`
- `new Function('return ' + expr)` — use a parser library or a small DSL
- `require(path.join(userDir, file))` — use `import()` with a validated allowlist of paths

### 3. Validate input at the `forge_*` handler boundary

Every MCP tool handler is a system boundary. Validate before doing any work:

```js
function handle_forge_thing({ projectPath, mode }) {
  if (typeof projectPath !== 'string' || !projectPath) {
    return { ok: false, error: 'projectPath required' };
  }
  if (mode !== 'fast' && mode !== 'thorough') {
    return { ok: false, error: 'mode must be "fast" or "thorough"' };
  }
  const resolved = path.resolve(projectPath);
  if (!resolved.startsWith(allowedRoot)) {
    return { ok: false, error: 'projectPath escapes allowed root' };
  }
  // ...real work below this line
}
```

The `inputSchema` declared in the tool registration is a hint to the agent, **not** a runtime enforcement. The handler is the runtime enforcement.

### 4. Path inputs must resist directory traversal

Any path that came from outside the process (tool arg, CLI arg, config file, HTTP body) must be:

1. Resolved via `path.resolve()` (canonicalises `..` and symlinks)
2. Checked against an allowed root: `resolved.startsWith(allowedRoot)`
3. Rejected if it escapes — return an error, do not silently fall back

```js
const allowedRoot = path.resolve(workspaceRoot);
const target = path.resolve(workspaceRoot, userPath);
if (!target.startsWith(allowedRoot + path.sep) && target !== allowedRoot) {
  throw new Error(`path escapes workspace: ${userPath}`);
}
```

Beware: on Windows `C:\Foo` and `c:\foo` are the same directory but compare unequal. Lowercase both sides on Windows or use `path.relative()` and check the result doesn't start with `..`.

### 5. Secrets live in `.forge/secrets.json` or env vars — never in code or git

| Where it can live | Notes |
|-------------------|-------|
| `.forge/secrets.json` | Gitignored by `setup.ps1/sh`. Read at startup. Plan Forge's own pattern. |
| `process.env.*` | CI secrets, GitHub Actions, hosted runs. |
| OS keychain via `keytar` / `wincred` | Acceptable for desktop tools; overkill for CLI. |
| **Source code** | **Never.** Even commented-out. Even in tests. Even "just for now." |
| **Tracked config (`.forge.json`, `package.json`)** | **Never.** These ship to consumers. |
| **Plan files (`Phase-*-PLAN.md`)** | **Never.** Plans are committed. |

Run `forge_secret_scan` before every release. The pre-deploy LiveGuard hook runs it automatically — do not bypass it with `--no-verify`.

### 6. Mutating the user's repo requires dry-run + confirmation

A `forge_*` tool that writes to the user's workspace (not Plan Forge's own `.forge/` directory) MUST:

1. Default to `dryRun: true` in its `inputSchema`
2. Return the list of intended changes (paths + diff stats) on dry-run
3. Require the caller to explicitly pass `dryRun: false` to actually mutate
4. Log every mutation to the audit trail at `.forge/runs/<id>/audit.jsonl`

This is a Plan Forge **Project Principle forbidden pattern** (PROJECT-PRINCIPLES.md): silent mutation of the user's repo. Never collapse the dry-run/confirm step "just for this one tool."

The audit trail is what makes `forge_diagnose` and `forge_drift_report` useful — if the mutation isn't logged, the orchestrator can't reason about it later.

---

## What Plan Forge specifically does NOT face

For perspective — these are common application-security concerns that Plan Forge does NOT have because of its deployment model. Don't write defensive code for them:

- **SQL injection** — Plan Forge has no SQL surface. OpenBrain (Postgres) is an optional remote service accessed through a typed client; the user manages its own auth.
- **XSS in the dashboard** — the dashboard renders only data the user's own machine produced; no untrusted HTML is ever inserted.
- **CSRF** — the dashboard listens on localhost only; no cross-origin browser context can reach it.
- **Authn/Authz for tools** — MCP runs inside the user's editor session; the trust boundary is the OS user.

This list is here so we don't waste time inventing protections we don't need. If Plan Forge ever grows a hosted surface, this list gets revisited.

---

## Pre-merge security checklist (`/code-review` Step 4)

- [ ] Every new `spawn`/`execFile` call uses an args array, not a constructed string
- [ ] No new `eval` / `Function` / dynamic require of user input
- [ ] Every new `forge_*` handler validates its inputs before any work
- [ ] Every new path input is resolved + checked against an allowed root
- [ ] No secrets in the diff (`git diff | grep -iE 'api[_-]?key|secret|password|token'` shows only test fixtures)
- [ ] Any new mutating tool defaults `dryRun: true` and logs to the audit trail

---

## See also

- [architecture-principles.instructions.md](architecture-principles.instructions.md) — Dependency Rule (security boundaries are layer boundaries)
- [aci-design.instructions.md](aci-design.instructions.md) — ACI rules govern *agent* safety; this file governs *system* safety
- `docs/plans/PROJECT-PRINCIPLES.md` — forbidden patterns (mutating user repos without dry-run)
- `forge_secret_scan` — pre-deploy gate; run before every release
- `forge_env_diff` — pre-deploy gate; surfaces env-var changes that might leak secrets to the wrong scope
