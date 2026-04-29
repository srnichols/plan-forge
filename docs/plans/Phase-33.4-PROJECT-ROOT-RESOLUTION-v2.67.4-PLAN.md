---
phase: 33.4
version: 2.67.4
crucibleId: imported-meta-bug-125
lane: bug-fix
source: github-issues
linkedBugs: [125]
manualImport: true
manualImportSource: meta-bug-roadmap
manualImportReason: Server starts silently with wrong project root when launched outside repo root. Single targeted fix; release piggy-backed.
model: claude-sonnet-4.6
---

# Phase-33.4 — Project Root Resolution (v2.67.4)

## Goal

Fix bug #125 — `pforge-mcp` server pins `PROJECT_DIR` to `process.cwd()` at startup. When launched outside the repo root (systemd, NSSM, Task Scheduler, or `cd pforge-mcp && node server.mjs`), every `forge_run_plan` call fails with "Plan path must be within project directory". Resolution must:

1. Honor `PLAN_FORGE_PROJECT` env / `--project` CLI flag (already supported).
2. Otherwise walk up from the server file (`__dirname`) and from `process.cwd()` looking for a `.git` / `.forge.json` / `package.json` marker.
3. Log the resolved project root on startup so misconfigurations are immediately visible.

## Forbidden Actions

- Do not change `PLAN_FORGE_PROJECT` / `--project` precedence.
- Do not auto-create a `.forge.json` if none is found.
- Do not break the existing `findProjectRoot(startDir)` helper signature.

## Acceptance Criteria

### Criteria for Slice 1 — Project root walk-up + startup log

- `pforge-mcp/server.mjs` exports a new function `resolveProjectRoot({ env, argv, serverDir, cwd })` that:
  - Returns `env.PLAN_FORGE_PROJECT` (resolved) when set.
  - Returns the value following `--project` in `argv` when present.
  - Otherwise walks up first from `cwd`, then from `serverDir` (the server file's directory) looking for `.forge.json`, then `.git`, then `package.json`. Returns the first match.
  - Falls back to `cwd` and emits a structured `{ resolved, source: "fallback-cwd", warning: "no .git/.forge.json/package.json marker found" }` shape.
- The new function returns `{ resolved, source }` so the call site can log it. `source` is one of `"env"`, `"--project"`, `"marker:.forge.json"`, `"marker:.git"`, `"marker:package.json"`, `"fallback-cwd"`.
- The existing `PROJECT_DIR` const becomes `const { resolved: PROJECT_DIR, source: PROJECT_DIR_SOURCE } = resolveProjectRoot({ env: process.env, argv: process.argv, serverDir: __dirname, cwd: process.cwd() });`.
- Server startup writes a single `console.error` line: `[pforge-mcp] PROJECT_DIR=<path> (source=<source>)` exactly once, before any tool registration.
- Unit test `pforge-mcp/tests/resolve-project-root.test.js` covers all six branches using a temp-dir fixture and `vi.mock` is not required (function is pure given its inputs).
- Validation gate: `npx vitest run pforge-mcp/tests/resolve-project-root.test.js --reporter=basic`.

### Criteria for Slice 2 — Release v2.67.4

- `pforge-mcp/package.json` and `package.json` versions bumped to `2.67.4`.
- `CHANGELOG.md` has a new `## 2.67.4` section listing `fix(server): resolve project root via marker walk-up + log on startup (#125)`.
- A git tag `v2.67.4` is created on the resulting commit.
- Validation gate: `node -e "const p=require('./pforge-mcp/package.json'); if(p.version!=='2.67.4'){process.exit(1)}; const fs=require('fs'); if(!fs.readFileSync('CHANGELOG.md','utf8').includes('## 2.67.4')){process.exit(1)}"`.

## Slice Plan

### Slice 1 — Project root walk-up + startup log

- In `pforge-mcp/server.mjs`, add `export function resolveProjectRoot({ env, argv, serverDir, cwd })` near the existing `findProjectRoot` helper (≈ line 459). Implementation:
  1. If `env.PLAN_FORGE_PROJECT` truthy → return `{ resolved: resolve(env.PLAN_FORGE_PROJECT), source: "env" }`.
  2. Scan `argv` for `--project <value>` → return `{ resolved: resolve(value), source: "--project" }`.
  3. For each starting dir in `[cwd, serverDir]`, walk up until filesystem root, checking in order: `.forge.json`, `.git`, `package.json`. First match returns `{ resolved: dir, source: "marker:<file>" }`.
  4. Fall back: `{ resolved: cwd, source: "fallback-cwd" }`.
- Replace the existing `const PROJECT_DIR = ...` (≈ line 127) with the destructured form. Add `const PROJECT_DIR_SOURCE = ...`.
- Add a single `console.error(\`[pforge-mcp] PROJECT_DIR=${PROJECT_DIR} (source=${PROJECT_DIR_SOURCE})\`);` immediately after the destructure.
- Create `pforge-mcp/tests/resolve-project-root.test.js`:
  - Branch A: env set → returns `source: "env"`.
  - Branch B: argv `--project /tmp/x` → returns `source: "--project"`.
  - Branch C: cwd is a tempdir containing `.forge.json` → returns `source: "marker:.forge.json"`.
  - Branch D: cwd nested two levels under a dir containing `.git` → returns `source: "marker:.git"`.
  - Branch E: serverDir contains `package.json`, cwd is unrelated → returns `source: "marker:package.json"` from serverDir walk.
  - Branch F: nothing found → returns `source: "fallback-cwd"` and `resolved === cwd`.
- Validation: `npx vitest run pforge-mcp/tests/resolve-project-root.test.js --reporter=basic`.

### Slice 2 — Release v2.67.4

- Bump versions in `pforge-mcp/package.json` and root `package.json` to `2.67.4`.
- Prepend `## 2.67.4` to `CHANGELOG.md` with the fix entry referencing #125.
- Commit `chore(release): v2.67.4 — project root resolution (#125)` and tag `v2.67.4`.
- Validation: `node -e "const p=require('./pforge-mcp/package.json'); if(p.version!=='2.67.4'){process.exit(1)}; const fs=require('fs'); if(!fs.readFileSync('CHANGELOG.md','utf8').includes('## 2.67.4')){process.exit(1)}"`.
