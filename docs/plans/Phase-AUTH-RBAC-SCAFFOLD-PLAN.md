# Phase-AUTH-RBAC-SCAFFOLD: Auth Model Docs + SSO Extension Point + RBAC Scaffold (HARDENED)

> **Status**: Hardened, ready for execution (Step 3)
> **Tracks**: Code (`pforge-mcp/bridge.mjs`, `pforge-mcp/server.mjs`, new `pforge-mcp/auth/`) + Tests + Docs
> **Estimated cost**: $3.00–$6.00 (8 slices, mix of small code + medium docs)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → **Harden ✅** → Execute → Sweep → Review → Ship
> **Source**: `docs/research/enterprise-fleet-readiness.md` §8.1 (current bearer-only state) + §9 Week 3 + §14 Priority C
> **Position in chain**: 4 of 4 — fully isolated from Phases 1-3 (touches `bridge.mjs` and `server.mjs` only). Goes last because RBAC scopes benefit from knowing which Phase 2 audit/OTel surfaces need authorization.

---

## Scope Contract

### In Scope

- `pforge-mcp/auth/` (new directory) — provider-pluggable auth model.
  - `pforge-mcp/auth/index.mjs` — public entry: `authenticate(req)` returning `{ identity, scopes }` or `null`.
  - `pforge-mcp/auth/providers/bearer.mjs` — extracted current `approvalSecret` bearer flow (unchanged behavior, refactored under the new interface).
  - `pforge-mcp/auth/providers/sso-stub.mjs` — SSO interface stub (no real SSO this phase, just the contract).
  - `pforge-mcp/auth/rbac.mjs` — config-driven role/permission resolver. Reads `.forge/rbac.json` (operator-editable).
  - `pforge-mcp/auth/middleware.mjs` — request gate that wraps tool dispatch + bridge edits with auth + RBAC checks.
- `pforge-mcp/bridge.mjs` — refactor `approvalSecret` check to call into the new `authenticate()` module. Behavior preserved when `.forge/rbac.json` is absent (open-by-default to maintain backward compat for solo operators).
- `pforge-mcp/server.mjs` — wire `auth/middleware.mjs` into the MCP tool dispatch path. Same backward-compat rule.
- `.forge/rbac.example.json` — example config showing roles, permissions, scope mappings.
- `pforge-mcp/tests/auth-rbac.test.mjs` — new test file.
- `docs/security/auth-model.md` — new doc, the canonical statement of how Plan Forge thinks about identity today and the planned model.
- `docs/security/sso-extension-point.md` — new doc, the SSO provider contract (interface, lifecycle, error handling).
- `docs/security/rbac-config.md` — new doc, the RBAC config schema and example walkthrough.
- `CHANGELOG.md` — `[Unreleased]` entry.

### Out of Scope

- **Real SAML / SCIM / Entra ID implementation** — out of scope. This phase ships the **interface** and **scaffold**, not a working SSO provider. A follow-on phase (`Phase-ENTRA-SSO`) implements the first real provider.
- Multi-tenant isolation enforcement (per-tenant data segregation) — orthogonal; out of scope. RBAC scopes can be tenant-prefixed by operators, but Plan Forge does not enforce tenant boundaries this phase.
- Audit logging of auth/RBAC decisions — Phase-OTEL-AUDIT-EXPORT events.log already captures `bridge-edit-blocked` / `bridge-edit-approved`. New `auth-decision` event added in Slice 4 piggybacks on existing infrastructure.
- Encryption at rest for `.forge/secrets.json` — orthogonal; operator concern.
- Network-level controls (mTLS, IP allowlists) — operator/infra concern.
- Approval workflows (n-of-m human approvers for high-risk slices) — surfaced as a future capability, not delivered here.
- UI for managing RBAC config — file-only this phase. Dashboard surface is a follow-on.
- Migration tool for converting `bridge.approvalSecret` consumers — we maintain backward compat; no migration needed.
- Removing or refactoring `approvalSecret` — kept as the default `bearer` provider's input.

### Forbidden Actions

- **Do NOT break existing solo-operator workflows.** When `.forge/rbac.json` is absent, the system MUST behave identically to today (bearer-only, no scope checks). Verified in Slice 7 case 1.
- **Do NOT change the public `bridge.approvalSecret` config key.** It feeds the default `bearer` provider. Renaming it would break every existing install.
- **Do NOT log secret values in any auth path.** Use `redactSecrets` from `pforge-mcp/secrets.mjs`.
- **Do NOT add `passport`, `next-auth`, or any heavy auth framework as required dep.** SSO provider stub uses a minimal interface; first real provider will choose its own dep in a follow-on phase.
- **Do NOT introduce a new dependency in this phase.** All work uses Node built-ins. (`@azure/identity` from Phase 3 stays optional and Foundry-scoped.)
- **Do NOT enforce RBAC on read-only tools by default.** `forge_capabilities`, `forge_status`, `forge_search`, `forge_timeline`, `forge_watch_live` (read shape) are open by default. Operators can lock them down via `.forge/rbac.json` if desired.
- **Do NOT modify Phase-1 event schema or Phase-2 OTel emission.** New `auth-decision` event uses the schema established by Phase 1 (`source: 'auth'`, `security_risk: 'medium'` baseline, `'high'` for denials).
- **Do NOT change `costForLeg()`, `priceSlice()`, or any cost path.** Auth is orthogonal.
- **Do NOT publish a release in this phase.**

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|---|---|---|
| 1 | Backward-compat default | RESOLVED | Open-by-default. Absent `.forge/rbac.json` → bearer-only auth, no scope enforcement. Identical to today's behavior. |
| 2 | Identity shape | RESOLVED | `{ id: string, displayName?: string, email?: string, provider: string, claims?: object }`. Minimal — extensible by SSO providers via `claims`. |
| 3 | Scope shape | RESOLVED | Array of scope strings. Hierarchical via `:` separator. Examples: `forge:run`, `forge:read`, `bridge:edit`, `bridge:edit:plan-files`, `audit:export`. Wildcard `*` matches anything. |
| 4 | Role-to-scopes mapping | RESOLVED | In `.forge/rbac.json`: `{ "roles": { "operator": ["forge:*"], "developer": ["forge:run", "forge:read", "bridge:edit:plan-files"], "viewer": ["forge:read", "audit:export"] }, "identityRoles": { "<id>": ["operator"], "*@example.com": ["developer"] } }`. Patterns supported on identity match. |
| 5 | SSO provider interface | RESOLVED | `{ name: string, authenticate(req) -> Promise<Identity \| null>, healthCheck() -> Promise<bool> }`. Minimal contract — first real provider extends as needed. |
| 6 | Where bearer provider gets its secret | RESOLVED | Same as today: `.forge/config.json` `bridge.approvalSecret` field, env override `PFORGE_APPROVAL_SECRET`. No change. |
| 7 | What happens on auth failure | RESOLVED | Tool dispatch returns `{ ok: false, error: 'unauthenticated', message: 'Missing or invalid auth' }`. Bridge edit returns 401. Both emit `auth-decision` event with `security_risk: 'high'`. |
| 8 | What happens on scope failure | RESOLVED | Tool dispatch returns `{ ok: false, error: 'forbidden', message: 'Identity <id> lacks scope <scope>' }`. Same event emitted with `result: 'denied'`. |
| 9 | Read-only tool list (open by default) | RESOLVED | `forge_capabilities`, `forge_status`, `forge_search`, `forge_timeline`, `forge_watch_live`, `forge_home_snapshot`, `forge_cost_report` (read-only), `forge_plan_status`, `forge_diff` (read-only). Operators can lock them down by adding explicit scope requirements in `rbac.json`. |
| 10 | Where the middleware is wired | RESOLVED | `server.mjs` MCP tool dispatch + `bridge.mjs` edit-approval check. Two integration points only. |
| 11 | RBAC config hot-reload | DEFERRED | Out of scope. Config read at process start. Operators restart Plan Forge to apply changes. |
| 12 | Identity claim verification | RESOLVED | Bearer provider verifies the secret string match. SSO providers verify per their own protocol. The middleware does NOT verify claims — providers are trusted to return valid identities. |

---

## Acceptance Criteria

### Backward compatibility (highest priority)

- **MUST**: When `.forge/rbac.json` is absent, behavior is byte-identical to today. All existing tests pass without modification.
- **MUST**: `bridge.approvalSecret` config key continues to work unchanged.
- **MUST**: `PFORGE_APPROVAL_SECRET` env override continues to work unchanged.
- **MUST**: No tests in `pforge-mcp/tests/` require updates to keep passing.

### Auth interface

- **MUST**: `pforge-mcp/auth/index.mjs` exports `authenticate(req)` returning `Identity | null`.
- **MUST**: Bearer provider extracted to `auth/providers/bearer.mjs` with no behavior change. Verified by snapshot of pre/post bearer-flow test.
- **MUST**: SSO stub provider exists at `auth/providers/sso-stub.mjs` with the documented interface, returns `null` from `authenticate()` (placeholder), `false` from `healthCheck()`.
- **MUST**: `auth/middleware.mjs` exports `withAuth(handler, requiredScopes)` middleware that calls `authenticate()` then checks scopes via `auth/rbac.mjs`.

### RBAC scaffold

- **MUST**: `auth/rbac.mjs` exports `resolveRoles(identity, config)` returning an array of role names matching the identity (literal id, then wildcard patterns).
- **MUST**: `auth/rbac.mjs` exports `expandScopes(roles, config)` returning the union of scopes across all matched roles.
- **MUST**: `auth/rbac.mjs` exports `hasScope(scopes, required)` supporting `:` hierarchy and `*` wildcard.
- **MUST**: `.forge/rbac.example.json` ships an annotated example with `operator`, `developer`, `viewer` roles.

### Wiring

- **MUST**: `pforge-mcp/server.mjs` MCP tool dispatch wraps every tool handler with `withAuth(handler, scopesForTool)`. Read-only tools (per Decision #9) require no scopes.
- **MUST**: `pforge-mcp/bridge.mjs` edit-approval check calls `authenticate()` + `hasScope(scopes, 'bridge:edit')` before allowing the edit.
- **MUST**: Auth/RBAC denials emit `auth-decision` events using Phase-1 schema (`source: 'auth'`, `security_risk: 'medium'` for allows, `'high'` for denies).

### Tests

- **MUST**: `pforge-mcp/tests/auth-rbac.test.mjs` covers:
  1. Absent `.forge/rbac.json` → all tool calls succeed identically to today (backward-compat invariant)
  2. Bearer provider with valid secret → identity resolved
  3. Bearer provider with invalid secret → `null`
  4. SSO stub provider exists with correct interface shape
  5. `resolveRoles` matches literal identity ID
  6. `resolveRoles` matches wildcard pattern (`*@example.com`)
  7. `expandScopes` unions across multiple roles
  8. `hasScope('bridge:edit:plan-files', 'bridge:edit')` returns true (hierarchy)
  9. `hasScope('forge:run', 'forge:*')` returns true (wildcard)
  10. `withAuth(handler, ['bridge:edit'])` rejects when scope missing
  11. Auth denial emits `auth-decision` event with `security_risk: 'high'`
  12. Read-only tool with no scope requirement succeeds without identity (open default)
- **MUST**: Existing tests pass: `tests/orchestrator.test.mjs`, `tests/bridge.test.mjs` (if exists), `tests/hub.test.mjs`, all Phase 1/2/3 test files.

### Documentation

- **MUST**: `docs/security/auth-model.md` — current state (bearer-only), the new pluggable model, how to add a new provider, security boundaries.
- **MUST**: `docs/security/sso-extension-point.md` — provider interface, lifecycle, error handling, example skeleton implementation.
- **MUST**: `docs/security/rbac-config.md` — `.forge/rbac.json` schema, scope hierarchy, role examples, common patterns (admin, dev, read-only).
- **MUST**: `CHANGELOG.md` `[Unreleased]` entry under "### Phase-AUTH-RBAC-SCAFFOLD — Auth model + SSO extension point + RBAC scaffold".

---

## Execution Slices

8 slices, sequential.

### Slice 1: Create auth module skeleton + extract bearer provider [sequential]

**Goal**: New `pforge-mcp/auth/` directory. `index.mjs`, `providers/bearer.mjs` (extracted from current `bridge.mjs` logic, behavior-preserving), `providers/sso-stub.mjs` (interface skeleton).

**Files**:
- `pforge-mcp/auth/index.mjs` (new)
- `pforge-mcp/auth/providers/bearer.mjs` (new)
- `pforge-mcp/auth/providers/sso-stub.mjs` (new)

**Validation Gate**:
```bash
bash -c "node -e \"import('./pforge-mcp/auth/index.mjs').then(m=>{if(typeof m.authenticate!=='function')process.exit(1);console.log('ok')})\""
```

---

### Slice 2: RBAC resolver — roles, scopes, hierarchy [sequential]

**Goal**: `pforge-mcp/auth/rbac.mjs` with `resolveRoles`, `expandScopes`, `hasScope`. Plus `.forge/rbac.example.json`.

**Files**:
- `pforge-mcp/auth/rbac.mjs` (new)
- `.forge/rbac.example.json` (new)

**Depends On**: Slice 1

**Validation Gate**:
```bash
bash -c "node -e \"import('./pforge-mcp/auth/rbac.mjs').then(m=>{if(typeof m.resolveRoles!=='function'||typeof m.hasScope!=='function')process.exit(1);console.log('ok')})\" && test -f .forge/rbac.example.json && echo ok"
```

---

### Slice 3: Auth middleware [sequential]

**Goal**: `pforge-mcp/auth/middleware.mjs` exports `withAuth(handler, requiredScopes)` that calls `authenticate()` and checks scopes via `rbac.mjs`. Backward-compat: when `.forge/rbac.json` is absent, scope checks are skipped (allow).

**Files**:
- `pforge-mcp/auth/middleware.mjs` (new)

**Depends On**: Slice 2

**Validation Gate**:
```bash
bash -c "node -e \"import('./pforge-mcp/auth/middleware.mjs').then(m=>{if(typeof m.withAuth!=='function')process.exit(1);console.log('ok')})\""
```

---

### Slice 4: Refactor bridge.mjs to use new auth module [sequential]

**Goal**: Replace inline `approvalSecret` check in `bridge.mjs` with a call to `auth/index.mjs` `authenticate()` + `hasScope(scopes, 'bridge:edit')`. Emit `auth-decision` event (Phase-1 schema). Behavior preserved when no rbac.json.

**Files**:
- `pforge-mcp/bridge.mjs`

**Depends On**: Slice 3

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator.test.mjs --reporter=dot 2>&1 | tail -5 | grep -qE 'Test Files.*passed' && echo ok"
```

---

### Slice 5: Wire middleware into server.mjs MCP tool dispatch [sequential]

**Goal**: Every tool handler in `server.mjs` is wrapped by `withAuth(handler, scopesForTool)`. Read-only tools per Decision #9 require no scopes (empty array).

**Files**:
- `pforge-mcp/server.mjs`

**Depends On**: Slice 4

**Validation Gate**:
```bash
bash -c "grep -q 'withAuth' pforge-mcp/server.mjs && cd pforge-mcp && npx vitest run tests/hub.test.mjs --reporter=dot 2>&1 | tail -5 | grep -qE 'Test Files.*passed' && echo ok"
```

---

### Slice 6: New test file auth-rbac.test.mjs [sequential]

**Goal**: Twelve test cases per Acceptance Criteria.

**Files**:
- `pforge-mcp/tests/auth-rbac.test.mjs` (new)

**Depends On**: Slice 5

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/auth-rbac.test.mjs --reporter=dot 2>&1 | tail -5 | grep -qE 'Test Files.*1 passed' && echo ok"
```

---

### Slice 7: Run the full test suite — backward-compat verification [sequential]

**Goal**: Run every existing test file to verify backward-compat invariant. Document any pre-existing baseline failures (per `docs/RELEASE-CHECKLIST.md` §5).

**Files**: (none — verification slice only)

**Depends On**: Slice 6

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run --reporter=dot 2>&1 | tail -10 | grep -qE 'Test Files' && echo ok"
```

---

### Slice 8: Three docs + CHANGELOG [sequential]

**Goal**: Three new docs under `docs/security/` plus CHANGELOG entry.

**Files**:
- `docs/security/auth-model.md` (new)
- `docs/security/sso-extension-point.md` (new)
- `docs/security/rbac-config.md` (new)
- `CHANGELOG.md`

**Depends On**: Slice 7

**Validation Gate**:
```bash
bash -c "test -f docs/security/auth-model.md && test -f docs/security/sso-extension-point.md && test -f docs/security/rbac-config.md && grep -q 'Phase-AUTH-RBAC-SCAFFOLD' CHANGELOG.md && echo ok"
```

---

## Files Modified (Exhaustive)

| File | Slice(s) |
|---|---|
| `pforge-mcp/auth/index.mjs` | 1 (new) |
| `pforge-mcp/auth/providers/bearer.mjs` | 1 (new) |
| `pforge-mcp/auth/providers/sso-stub.mjs` | 1 (new) |
| `pforge-mcp/auth/rbac.mjs` | 2 (new) |
| `.forge/rbac.example.json` | 2 (new) |
| `pforge-mcp/auth/middleware.mjs` | 3 (new) |
| `pforge-mcp/bridge.mjs` | 4 |
| `pforge-mcp/server.mjs` | 5 |
| `pforge-mcp/tests/auth-rbac.test.mjs` | 6 (new) |
| `docs/security/auth-model.md` | 8 (new) |
| `docs/security/sso-extension-point.md` | 8 (new) |
| `docs/security/rbac-config.md` | 8 (new) |
| `CHANGELOG.md` | 8 |

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Backward-compat regression — existing solo operators broken | Open-by-default when `.forge/rbac.json` absent. Slice 7 runs full suite to verify. |
| Bearer secret rotation breaks running sessions | Existing behavior — no change. Out of scope. |
| Operator misconfigures `rbac.json` and locks themselves out | `bridge.mjs` always honors local-filesystem-direct edits (operator can edit `rbac.json` directly to recover). Documented in `rbac-config.md`. |
| SSO stub provider gets shipped to consumers and they think it works | Stub returns `null` + `false`. Documented as "interface scaffold, not a working provider". |
| `auth-decision` event volume floods events.log on heavy use | Same volume as existing `bridge-edit-blocked` events. Audit-export CLI (Phase 2) handles filtering. |
| Future SSO provider needs to extend the identity shape | Identity has open `claims` object — extensible without breaking the contract. |
| Read-only tool list drifts as new tools are added | Decision #9 list is a starting set; new tools require explicit scope decision in their PR. Documented in `auth-model.md`. |
