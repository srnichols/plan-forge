/**
 * SCIM Group → RBAC Role bridge for Plan Forge MCP.
 *
 * Connects the SCIM provisioning layer (ScimStore) with the RBAC
 * authorization layer (rbac.mjs) by mapping SCIM group memberships to
 * RBAC roles. Allows Okta / Entra ID (or any SCIM 2.0 IdP) to drive
 * authorization by provisioning users into groups.
 *
 * Typical usage:
 *   1. IdP provisions users and groups via the `/scim/v2/` endpoints.
 *   2. `.forge.json#auth.scimGroupRoles` maps group displayNames → role names.
 *   3. At request time, `resolveRolesFromScim` turns a SCIM user ID into a
 *      list of RBAC role names that can be fed directly to `hasScope`.
 *
 * @module auth/scim-rbac-bridge
 */

/**
 * @typedef {Record<string, string[]>} GroupRoleMappings
 * Maps SCIM group `displayName` values to arrays of RBAC role names.
 * Example:
 *   { "engineers": ["developer"], "admins": ["admin", "developer"] }
 */

/**
 * Resolve RBAC roles for a user based on their SCIM group memberships.
 *
 * Iterates all SCIM groups, finds those whose `members` array contains an
 * entry with `value === userId`, then maps each matching group's `displayName`
 * to zero or more RBAC role names using `groupRoleMappings`.
 *
 * @param {string}            userId            - SCIM user ID (the `id` UUID field)
 * @param {import("./scim-store.mjs").ScimStore} scimStore - Active SCIM store
 * @param {GroupRoleMappings} groupRoleMappings  - displayName → role[] mappings
 * @returns {string[]} Deduplicated list of RBAC role names
 */
export function resolveRolesFromScim(userId, scimStore, groupRoleMappings) {
  if (!userId || !scimStore || !groupRoleMappings) return [];

  const { resources: allGroups } = scimStore.listGroups();
  const roles = new Set();

  for (const group of allGroups) {
    const isMember =
      Array.isArray(group.members) &&
      group.members.some((m) => m.value === userId);
    if (!isMember) continue;

    const mappedRoles = groupRoleMappings[group.displayName] ?? [];
    for (const role of mappedRoles) {
      roles.add(role);
    }
  }

  return [...roles];
}

/**
 * Build an RBAC `assignments` map from all users currently in the SCIM store.
 *
 * For each user, calls `resolveRolesFromScim` and records the result.
 * Users with no mapped roles are omitted from the returned assignments.
 *
 * The returned object is intended to be merged with an existing RBAC config:
 *   const rbac = { roles: myRoleDefs, ...buildScimAssignments(store, mappings) };
 * Then pass `rbac` to `resolveRoles` / `hasScope` from `auth/rbac.mjs`.
 *
 * @param {import("./scim-store.mjs").ScimStore} scimStore
 * @param {GroupRoleMappings} groupRoleMappings
 * @returns {{ assignments: Record<string, string[]> }}
 */
export function buildScimAssignments(scimStore, groupRoleMappings) {
  if (!scimStore || !groupRoleMappings) return { assignments: {} };

  const { resources: allUsers } = scimStore.listUsers();
  const assignments = {};

  for (const user of allUsers) {
    const roles = resolveRolesFromScim(user.id, scimStore, groupRoleMappings);
    if (roles.length > 0) {
      assignments[user.id] = roles;
    }
  }

  return { assignments };
}
