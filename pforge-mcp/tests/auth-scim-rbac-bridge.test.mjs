/**
 * Tests for the SCIM Group → RBAC Role bridge.
 *
 * Covers:
 *   - auth/scim-rbac-bridge.mjs → resolveRolesFromScim, buildScimAssignments
 *   - Integration with auth/rbac.mjs → resolveRoles, hasScope
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ScimStore } from "../auth/scim-store.mjs";
import {
  resolveRolesFromScim,
  buildScimAssignments,
} from "../auth/scim-rbac-bridge.mjs";
import { resolveRoles, hasScope } from "../auth/rbac.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeStore() {
  return new ScimStore({ persist: false });
}

// ─── resolveRolesFromScim ─────────────────────────────────────────────────────

describe("resolveRolesFromScim", () => {
  let store;

  beforeEach(() => {
    store = makeStore();
  });

  it("returns [] for null userId", () => {
    expect(resolveRolesFromScim(null, store, { eng: ["developer"] })).toEqual(
      []
    );
  });

  it("returns [] for null scimStore", () => {
    expect(resolveRolesFromScim("uid-1", null, { eng: ["developer"] })).toEqual(
      []
    );
  });

  it("returns [] for null groupRoleMappings", () => {
    expect(resolveRolesFromScim("uid-1", store, null)).toEqual([]);
  });

  it("returns [] when user is not in any group", () => {
    const user = store.createUser({ userName: "alice@example.com" });
    store.createGroup({ displayName: "engineers", members: [] });

    expect(
      resolveRolesFromScim(user.id, store, { engineers: ["developer"] })
    ).toEqual([]);
  });

  it("returns mapped roles when user is a member of a group", () => {
    const user = store.createUser({ userName: "alice@example.com" });
    store.createGroup({
      displayName: "engineers",
      members: [{ value: user.id, display: "Alice" }],
    });

    const roles = resolveRolesFromScim(user.id, store, {
      engineers: ["developer"],
    });
    expect(roles).toContain("developer");
  });

  it("returns roles from all matching groups when user is in multiple groups", () => {
    const user = store.createUser({ userName: "bob@example.com" });
    store.createGroup({
      displayName: "engineers",
      members: [{ value: user.id, display: "Bob" }],
    });
    store.createGroup({
      displayName: "admins",
      members: [{ value: user.id, display: "Bob" }],
    });

    const roles = resolveRolesFromScim(user.id, store, {
      engineers: ["developer"],
      admins: ["admin"],
    });
    expect(roles).toContain("developer");
    expect(roles).toContain("admin");
  });

  it("deduplicates roles when multiple groups map to the same role", () => {
    const user = store.createUser({ userName: "carol@example.com" });
    store.createGroup({
      displayName: "team-a",
      members: [{ value: user.id, display: "Carol" }],
    });
    store.createGroup({
      displayName: "team-b",
      members: [{ value: user.id, display: "Carol" }],
    });

    const roles = resolveRolesFromScim(user.id, store, {
      "team-a": ["developer"],
      "team-b": ["developer"],
    });
    expect(roles).toEqual(["developer"]);
    expect(roles.length).toBe(1);
  });

  it("ignores groups whose displayName has no mapping", () => {
    const user = store.createUser({ userName: "dave@example.com" });
    store.createGroup({
      displayName: "unmapped-group",
      members: [{ value: user.id, display: "Dave" }],
    });

    const roles = resolveRolesFromScim(user.id, store, {
      engineers: ["developer"],
    });
    expect(roles).toEqual([]);
  });

  it("does not include roles for other users in the same group", () => {
    const alice = store.createUser({ userName: "alice@example.com" });
    const bob = store.createUser({ userName: "bob@example.com" });
    store.createGroup({
      displayName: "engineers",
      members: [{ value: alice.id, display: "Alice" }],
    });

    expect(
      resolveRolesFromScim(bob.id, store, { engineers: ["developer"] })
    ).toEqual([]);
  });

  it("returns [] when store has no groups", () => {
    const user = store.createUser({ userName: "eve@example.com" });
    expect(
      resolveRolesFromScim(user.id, store, { engineers: ["developer"] })
    ).toEqual([]);
  });

  it("handles a group with multiple role mappings", () => {
    const user = store.createUser({ userName: "frank@example.com" });
    store.createGroup({
      displayName: "power-users",
      members: [{ value: user.id, display: "Frank" }],
    });

    const roles = resolveRolesFromScim(user.id, store, {
      "power-users": ["developer", "reviewer", "tester"],
    });
    expect(roles).toContain("developer");
    expect(roles).toContain("reviewer");
    expect(roles).toContain("tester");
    expect(roles.length).toBe(3);
  });
});

// ─── buildScimAssignments ─────────────────────────────────────────────────────

describe("buildScimAssignments", () => {
  let store;

  beforeEach(() => {
    store = makeStore();
  });

  it("returns empty assignments for null scimStore", () => {
    expect(buildScimAssignments(null, { eng: ["developer"] })).toEqual({
      assignments: {},
    });
  });

  it("returns empty assignments for null groupRoleMappings", () => {
    expect(buildScimAssignments(store, null)).toEqual({ assignments: {} });
  });

  it("returns empty assignments when store has no users", () => {
    expect(
      buildScimAssignments(store, { engineers: ["developer"] })
    ).toEqual({ assignments: {} });
  });

  it("omits users with no group memberships matching any mapping", () => {
    store.createUser({ userName: "nobody@example.com" });
    const { assignments } = buildScimAssignments(store, {
      engineers: ["developer"],
    });
    expect(Object.keys(assignments)).toHaveLength(0);
  });

  it("maps a single user to their group-derived roles", () => {
    const user = store.createUser({ userName: "alice@example.com" });
    store.createGroup({
      displayName: "engineers",
      members: [{ value: user.id, display: "Alice" }],
    });

    const { assignments } = buildScimAssignments(store, {
      engineers: ["developer"],
    });
    expect(assignments[user.id]).toContain("developer");
  });

  it("maps multiple users independently", () => {
    const alice = store.createUser({ userName: "alice@example.com" });
    const bob = store.createUser({ userName: "bob@example.com" });
    store.createGroup({
      displayName: "engineers",
      members: [{ value: alice.id, display: "Alice" }],
    });
    store.createGroup({
      displayName: "admins",
      members: [{ value: bob.id, display: "Bob" }],
    });

    const { assignments } = buildScimAssignments(store, {
      engineers: ["developer"],
      admins: ["admin"],
    });
    expect(assignments[alice.id]).toContain("developer");
    expect(assignments[bob.id]).toContain("admin");
    expect(assignments[alice.id]).not.toContain("admin");
  });

  it("includes multiple roles per user when they belong to multiple mapped groups", () => {
    const user = store.createUser({ userName: "super@example.com" });
    store.createGroup({
      displayName: "engineers",
      members: [{ value: user.id, display: "Super" }],
    });
    store.createGroup({
      displayName: "admins",
      members: [{ value: user.id, display: "Super" }],
    });

    const { assignments } = buildScimAssignments(store, {
      engineers: ["developer"],
      admins: ["admin"],
    });
    expect(assignments[user.id]).toContain("developer");
    expect(assignments[user.id]).toContain("admin");
  });
});

// ─── Integration: resolveRolesFromScim → resolveRoles → hasScope ──────────────

describe("SCIM-RBAC integration", () => {
  const ROLE_DEFS = {
    roles: {
      admin: { scopes: ["*"] },
      developer: { scopes: ["plans:read", "plans:write", "runs:read"] },
      viewer: { scopes: ["plans:read"] },
    },
  };

  it("grants scoped access to a user provisioned into a group", () => {
    const store = makeStore();
    const user = store.createUser({ userName: "alice@example.com" });
    store.createGroup({
      displayName: "dev-team",
      members: [{ value: user.id, display: "Alice" }],
    });

    const mappings = { "dev-team": ["developer"] };
    const scimRoles = resolveRolesFromScim(user.id, store, mappings);

    const rbac = { ...ROLE_DEFS, assignments: { [user.id]: scimRoles } };
    const resolved = resolveRoles(user.id, rbac);

    expect(hasScope(resolved, "plans:read", rbac)).toBe(true);
    expect(hasScope(resolved, "plans:write", rbac)).toBe(true);
    expect(hasScope(resolved, "runs:read", rbac)).toBe(true);
    expect(hasScope(resolved, "admin:delete", rbac)).toBe(false);
  });

  it("grants full access to an admin user provisioned via SCIM", () => {
    const store = makeStore();
    const user = store.createUser({ userName: "admin@example.com" });
    store.createGroup({
      displayName: "platform-admins",
      members: [{ value: user.id, display: "Admin" }],
    });

    const mappings = { "platform-admins": ["admin"] };
    const scimRoles = resolveRolesFromScim(user.id, store, mappings);

    const rbac = { ...ROLE_DEFS, assignments: { [user.id]: scimRoles } };
    const resolved = resolveRoles(user.id, rbac);

    expect(hasScope(resolved, "anything:at:all", rbac)).toBe(true);
  });

  it("denies access when user is not in any mapped group", () => {
    const store = makeStore();
    const user = store.createUser({ userName: "bob@example.com" });
    store.createGroup({ displayName: "engineers", members: [] });

    const mappings = { engineers: ["developer"] };
    const scimRoles = resolveRolesFromScim(user.id, store, mappings);

    const rbac = { ...ROLE_DEFS, assignments: { [user.id]: scimRoles } };
    const resolved = resolveRoles(user.id, rbac);

    expect(hasScope(resolved, "plans:read", rbac)).toBe(false);
  });

  it("buildScimAssignments produces assignments usable with resolveRoles", () => {
    const store = makeStore();
    const alice = store.createUser({ userName: "alice@example.com" });
    const bob = store.createUser({ userName: "bob@example.com" });
    store.createGroup({
      displayName: "dev-team",
      members: [{ value: alice.id, display: "Alice" }],
    });

    const mappings = { "dev-team": ["developer"] };
    const { assignments } = buildScimAssignments(store, mappings);
    const rbac = { ...ROLE_DEFS, assignments };

    const aliceRoles = resolveRoles(alice.id, rbac);
    const bobRoles = resolveRoles(bob.id, rbac);

    expect(hasScope(aliceRoles, "plans:write", rbac)).toBe(true);
    expect(hasScope(bobRoles, "plans:write", rbac)).toBe(false);
  });
});
