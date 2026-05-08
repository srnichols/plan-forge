/**
 * RBAC resolver for Plan Forge MCP.
 *
 * Provides role resolution with hierarchy (inheritance) support and
 * scope checking with wildcard matching.
 *
 * Roles define the scopes they grant and may inherit from parent roles.
 * `resolveRoles` expands the full transitive role set for a principal.
 * `hasScope` checks whether a resolved role set grants a given scope.
 *
 * @module auth/rbac
 */

/**
 * @typedef {Object} RoleDefinition
 * @property {string[]} [inherits] - Role names this role inherits scopes from
 * @property {string[]} [scopes]   - Scope strings this role grants directly
 */

/**
 * @typedef {Object} RbacConfig
 * @property {Record<string, RoleDefinition>} roles       - Named role definitions
 * @property {Record<string, string[]>}       assignments - Principal → role name[] map
 */

/**
 * Resolve the full, deduplicated set of roles for a principal, following
 * inheritance chains. Cycles are silently broken (each role expanded once).
 *
 * @param {string}     principal - Token subject, user ID, or any principal key
 * @param {RbacConfig} config    - RBAC configuration object
 * @returns {string[]} Ordered list of all resolved role names (direct + inherited)
 */
export function resolveRoles(principal, config) {
  const assignments = config?.assignments ?? {};
  const directRoles = assignments[principal] ?? [];
  const resolved = new Set();

  function expand(role, visited = new Set()) {
    if (visited.has(role)) return; // cycle guard
    visited.add(role);
    resolved.add(role);

    const inherits = config?.roles?.[role]?.inherits ?? [];
    for (const parent of inherits) {
      expand(parent, visited);
    }
  }

  for (const role of directRoles) {
    expand(role);
  }

  return [...resolved];
}

/**
 * Check whether a resolved role set grants a specific scope.
 *
 * Matching rules (applied in order):
 *   1. Exact match  — `"plans:read"` grants `"plans:read"`
 *   2. Prefix wildcard — `"plans:*"` grants any scope starting with `"plans:"`
 *   3. Global wildcard — `"*"` grants every scope
 *
 * @param {string[]}   roles  - Resolved role names (output of `resolveRoles`)
 * @param {string}     scope  - Scope string to authorise (e.g. `"plans:write"`)
 * @param {RbacConfig} config - RBAC configuration object
 * @returns {boolean} `true` if any role in the set grants the scope
 */
export function hasScope(roles, scope, config) {
  const roleDefs = config?.roles ?? {};

  for (const role of roles) {
    const granted = roleDefs[role]?.scopes ?? [];

    for (const s of granted) {
      if (s === scope) return true;
      if (s === "*") return true;
      if (s.endsWith(":*") && scope.startsWith(s.slice(0, -1))) return true;
    }
  }

  return false;
}
