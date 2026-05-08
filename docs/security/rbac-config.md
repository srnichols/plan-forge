# Plan Forge — RBAC Configuration

> **Phase**: Phase-AUTH-RBAC-SCAFFOLD  
> **Config file**: `.forge/rbac.json`  
> **Example**: `.forge/rbac.example.json`  
> **Source**: `docs/research/enterprise-fleet-readiness.md` §8.1, Required Decisions #3 and #4

---

## Overview

Role-Based Access Control in Plan Forge is config-driven. Operators define roles, the scopes each role grants, and which principals (token values or user IDs) are assigned to which roles — all in a single JSON file at `.forge/rbac.json`.

When this file is absent, Plan Forge behaves identically to the pre-RBAC state: bearer-only, no scope enforcement. Existing solo-operator installs are unaffected.

---

## File Schema

```json
{
  "_comment": "Optional — ignored by the loader",
  "roles": {
    "<role-name>": {
      "inherits": ["<parent-role>"],
      "scopes":   ["<scope-string>"]
    }
  },
  "assignments": {
    "<principal-key>": ["<role-name>"]
  }
}
```

### `roles`

A map of named role definitions. Each role has:

| Field | Type | Description |
|---|---|---|
| `inherits` | `string[]` | Parent role names. Scopes are unioned across the inheritance chain. Cycles are silently broken. |
| `scopes` | `string[]` | Scope strings directly granted by this role (see [Scope Syntax](#scope-syntax) below). |

### `assignments`

A map from principal key to an array of role names. The principal key is the `token` value returned by the active auth provider:

- **Bearer provider**: the literal bearer token string (or a named identifier like `"token:my-ci-token"` — use descriptive prefixes for readability)
- **SSO providers**: the subject claim value (`sub` or `oid`) from the verified JWT

---

## Scope Syntax

Scopes are hierarchical strings separated by `:`.

### Exact match

```
"plans:read"
```

Grants access only to the `plans:read` scope.

### Prefix wildcard

```
"plans:*"
```

Grants any scope whose prefix is `plans:` — for example `plans:read`, `plans:write`, `plans:execute`, `plans:delete`.

### Global wildcard

```
"*"
```

Grants every scope. Assign only to fully-trusted administrator roles.

### Hierarchy examples

| Scope granted | Authorizes |
|---|---|
| `"forge:read"` | `forge:read` only |
| `"forge:*"` | `forge:read`, `forge:write`, `forge:run`, and any future `forge:` scope |
| `"bridge:edit"` | `bridge:edit` only |
| `"bridge:edit:plan-files"` | `bridge:edit:plan-files` only (more restrictive than `bridge:edit`) |
| `"*"` | Everything |

> **Note**: `hasScope` checks whether any granted scope *covers* the required scope. A required `bridge:edit` is satisfied by a granted `bridge:*` or `*`, but NOT by `bridge:edit:plan-files` (a sub-scope does not cover its parent).

---

## Built-in Scope Catalogue

### Forge operations

| Scope | Description |
|---|---|
| `forge:read` | Read forge state (plans, runs, cost, search) |
| `forge:write` | Modify forge config (not plan execution) |
| `forge:run` | Execute plans and slices |
| `forge:*` | All forge operations |

### Bridge edits

| Scope | Description |
|---|---|
| `bridge:edit` | Approve any file edit via the bridge |
| `bridge:edit:plan-files` | Approve edits to plan files only (`docs/plans/**`) |
| `bridge:*` | All bridge operations |

### Audit and export

| Scope | Description |
|---|---|
| `audit:export` | Run `pforge audit export` and read events.log |
| `audit:*` | All audit operations |

### Admin

| Scope | Description |
|---|---|
| `admin:*` | All admin operations (user management, config changes) |

### Read-only tools (open by default)

These tools require no scope when `rbac.json` is absent or the tool is not listed with a scope requirement:

- `forge_capabilities`, `forge_status`, `forge_search`, `forge_timeline`
- `forge_watch_live`, `forge_home_snapshot`, `forge_cost_report`
- `forge_plan_status`, `forge_diff`

To restrict them, add explicit scope requirements in your `rbac.json` configuration.

---

## Example Configuration

The annotated example at `.forge/rbac.example.json` ships with Plan Forge:

```json
{
  "_comment": "Example RBAC configuration for Plan Forge MCP. Copy to .forge/rbac.json and customise.",
  "roles": {
    "admin": {
      "inherits": ["developer"],
      "scopes": ["admin:*", "users:delete", "plans:delete", "secrets:read"]
    },
    "developer": {
      "inherits": ["reader"],
      "scopes": ["plans:write", "plans:execute", "deploy:staging", "forge:write"]
    },
    "reader": {
      "inherits": [],
      "scopes": ["plans:read", "forge:read", "dashboard:view"]
    },
    "ci": {
      "inherits": [],
      "scopes": ["plans:read", "plans:execute", "deploy:staging"]
    }
  },
  "assignments": {
    "token:replace-with-admin-token": ["admin"],
    "token:replace-with-dev-token": ["developer"],
    "token:replace-with-ci-token": ["ci"],
    "user:alice": ["developer"],
    "user:bob": ["reader"]
  }
}
```

---

## Common Patterns

### Admin / operator (full access)

```json
{
  "roles": {
    "admin": { "inherits": [], "scopes": ["*"] }
  },
  "assignments": {
    "token:my-admin-secret": ["admin"]
  }
}
```

### Developer (run plans, edit plan files)

```json
{
  "roles": {
    "developer": {
      "inherits": [],
      "scopes": ["forge:run", "forge:read", "bridge:edit:plan-files", "audit:export"]
    }
  },
  "assignments": {
    "token:dev-token": ["developer"]
  }
}
```

### Read-only viewer

```json
{
  "roles": {
    "viewer": {
      "inherits": [],
      "scopes": ["forge:read", "audit:export"]
    }
  },
  "assignments": {
    "token:readonly-token": ["viewer"]
  }
}
```

### CI/CD automation

```json
{
  "roles": {
    "ci": {
      "inherits": [],
      "scopes": ["forge:run", "forge:read", "bridge:edit:plan-files"]
    }
  },
  "assignments": {
    "token:ci-pipeline-token": ["ci"]
  }
}
```

### Role inheritance chain

```json
{
  "roles": {
    "reader":    { "inherits": [],           "scopes": ["forge:read"] },
    "developer": { "inherits": ["reader"],   "scopes": ["forge:run", "bridge:edit:plan-files"] },
    "admin":     { "inherits": ["developer"],"scopes": ["forge:write", "bridge:edit", "admin:*"] }
  }
}
```

An `admin` principal automatically gains all `developer` and `reader` scopes through inheritance, plus their own admin scopes.

---

## Recovery

If a misconfigured `rbac.json` locks all operators out of the bridge, recover by editing the file directly on the filesystem:

```bash
# On the machine running Plan Forge:
nano .forge/rbac.json   # add your token to the admin role assignments
# Restart Plan Forge to reload the config
```

Because `rbac.json` is read at process start (hot-reload is deferred to a future phase), a restart is always sufficient to apply changes.

---

## Operational Notes

- **Config is read once at startup.** Restart Plan Forge after editing `rbac.json` to apply changes.
- **No migration needed from pre-RBAC installs.** Absent `rbac.json` = open-by-default.
- **Token values in assignments are matched literally.** Use descriptive prefixes (`token:`, `user:`, `ci:`) to make logs and config readable without exposing secrets.
- **Wildcard patterns on assignment keys are not supported** in this phase. Patterns on scope strings are supported (`:*`). Identity wildcard matching (e.g., `*@example.com → developer`) is planned for a follow-on phase.
- **The `_comment` field is ignored by the loader** — use it freely for inline documentation.
