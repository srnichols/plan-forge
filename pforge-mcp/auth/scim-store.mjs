/**
 * SCIM 2.0 user and group store for Plan Forge MCP.
 *
 * Provides in-memory storage with optional persistence to
 * `.forge/scim-users.json` and `.forge/scim-groups.json`.
 *
 * Supports the SCIM 2.0 User and Group schemas:
 *   User:  urn:ietf:params:scim:schemas:core:2.0:User
 *   Group: urn:ietf:params:scim:schemas:core:2.0:Group
 *
 * Persistence is best-effort — write failures are logged but do not
 * surface as errors to callers, matching Plan Forge's offline-first model.
 *
 * @module auth/scim-store
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
export const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

// ─── Persistence helpers ──────────────────────────────────────────────────────

function getForgeDir(cwd) {
  return resolve(cwd ?? process.cwd(), ".forge");
}

function readJsonFile(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  try {
    const dir = join(filePath, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    /* best-effort persistence */
  }
}

// ─── ScimStore class ──────────────────────────────────────────────────────────

/**
 * In-memory SCIM user and group store with optional file-based persistence.
 */
export class ScimStore {
  /**
   * @param {Object} [opts]
   * @param {string}  [opts.cwd]    - Project root for .forge/ persistence
   * @param {boolean} [opts.persist=true] - Whether to persist to disk
   */
  constructor(opts = {}) {
    this._cwd = opts.cwd ?? process.cwd();
    this._persist = opts.persist !== false;

    /** @type {Map<string, Object>} id → user resource */
    this._users = new Map();
    /** @type {Map<string, Object>} id → group resource */
    this._groups = new Map();

    this._load();
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  _usersPath() {
    return join(getForgeDir(this._cwd), "scim-users.json");
  }

  _groupsPath() {
    return join(getForgeDir(this._cwd), "scim-groups.json");
  }

  _load() {
    if (!this._persist) return;
    const users = readJsonFile(this._usersPath(), []);
    const groups = readJsonFile(this._groupsPath(), []);
    for (const u of users) this._users.set(u.id, u);
    for (const g of groups) this._groups.set(g.id, g);
  }

  _saveUsers() {
    if (!this._persist) return;
    writeJsonFile(this._usersPath(), [...this._users.values()]);
  }

  _saveGroups() {
    if (!this._persist) return;
    writeJsonFile(this._groupsPath(), [...this._groups.values()]);
  }

  // ── User CRUD ────────────────────────────────────────────────────────────────

  /**
   * Create a new SCIM user.
   * @param {Object} attrs - SCIM User attributes
   * @returns {Object} Created user resource
   */
  createUser(attrs) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const user = buildUserResource(id, attrs, now, now);
    this._users.set(id, user);
    this._saveUsers();
    return user;
  }

  /**
   * Get a user by ID.
   * @param {string} id
   * @returns {Object|null}
   */
  getUser(id) {
    return this._users.get(id) ?? null;
  }

  /**
   * Find a user by a field equality check.
   * @param {string} field - e.g. "userName", "externalId"
   * @param {string} value
   * @returns {Object|null}
   */
  findUserBy(field, value) {
    for (const user of this._users.values()) {
      if (user[field] === value) return user;
    }
    return null;
  }

  /**
   * Replace a user (PUT semantics — full replacement).
   * @param {string} id
   * @param {Object} attrs
   * @returns {Object|null} Updated resource, or null if not found
   */
  replaceUser(id, attrs) {
    const existing = this._users.get(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const user = buildUserResource(id, attrs, existing.meta.created, now);
    this._users.set(id, user);
    this._saveUsers();
    return user;
  }

  /**
   * Patch a user (PATCH semantics — partial update via PatchOp operations).
   * Only `add`, `replace`, and `remove` operations are supported.
   * @param {string}   id
   * @param {Object[]} operations - Array of PatchOp `{ op, path, value }` objects
   * @returns {Object|null} Updated resource, or null if not found
   */
  patchUser(id, operations) {
    const existing = this._users.get(id);
    if (!existing) return null;
    const attrs = applyPatchOps(toPlainAttrs(existing), operations);
    const now = new Date().toISOString();
    const user = buildUserResource(id, attrs, existing.meta.created, now);
    this._users.set(id, user);
    this._saveUsers();
    return user;
  }

  /**
   * Delete a user by ID.
   * @param {string} id
   * @returns {boolean} true if the user existed and was deleted
   */
  deleteUser(id) {
    const existed = this._users.has(id);
    if (existed) {
      this._users.delete(id);
      this._saveUsers();
    }
    return existed;
  }

  /**
   * List users with optional filter and pagination.
   * @param {Object} [opts]
   * @param {string}  [opts.filter]     - SCIM filter expression (simple eq only)
   * @param {number}  [opts.startIndex] - 1-based start index
   * @param {number}  [opts.count]      - Max results
   * @returns {{ resources: Object[], total: number }}
   */
  listUsers({ filter, startIndex = 1, count = 100 } = {}) {
    let all = [...this._users.values()];
    if (filter) all = all.filter((u) => matchesScimFilter(u, filter));
    const total = all.length;
    const resources = all.slice(startIndex - 1, startIndex - 1 + count);
    return { resources, total };
  }

  // ── Group CRUD ───────────────────────────────────────────────────────────────

  /**
   * Create a new SCIM group.
   * @param {Object} attrs
   * @returns {Object}
   */
  createGroup(attrs) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const group = buildGroupResource(id, attrs, now, now);
    this._groups.set(id, group);
    this._saveGroups();
    return group;
  }

  /**
   * Get a group by ID.
   * @param {string} id
   * @returns {Object|null}
   */
  getGroup(id) {
    return this._groups.get(id) ?? null;
  }

  /**
   * Replace a group (PUT semantics).
   * @param {string} id
   * @param {Object} attrs
   * @returns {Object|null}
   */
  replaceGroup(id, attrs) {
    const existing = this._groups.get(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const group = buildGroupResource(id, attrs, existing.meta.created, now);
    this._groups.set(id, group);
    this._saveGroups();
    return group;
  }

  /**
   * Patch a group (PATCH semantics).
   * @param {string}   id
   * @param {Object[]} operations
   * @returns {Object|null}
   */
  patchGroup(id, operations) {
    const existing = this._groups.get(id);
    if (!existing) return null;
    const attrs = applyPatchOps(toPlainAttrs(existing), operations);
    const now = new Date().toISOString();
    const group = buildGroupResource(id, attrs, existing.meta.created, now);
    this._groups.set(id, group);
    this._saveGroups();
    return group;
  }

  /**
   * Delete a group by ID.
   * @param {string} id
   * @returns {boolean}
   */
  deleteGroup(id) {
    const existed = this._groups.has(id);
    if (existed) {
      this._groups.delete(id);
      this._saveGroups();
    }
    return existed;
  }

  /**
   * List groups with optional filter and pagination.
   * @param {Object} [opts]
   * @returns {{ resources: Object[], total: number }}
   */
  listGroups({ filter, startIndex = 1, count = 100 } = {}) {
    let all = [...this._groups.values()];
    if (filter) all = all.filter((g) => matchesScimFilter(g, filter));
    const total = all.length;
    const resources = all.slice(startIndex - 1, startIndex - 1 + count);
    return { resources, total };
  }
}

// ─── Resource builders ────────────────────────────────────────────────────────

/**
 * Build a SCIM 2.0 User resource object from raw attributes.
 */
function buildUserResource(id, attrs, created, lastModified) {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id,
    externalId: attrs.externalId ?? undefined,
    userName: attrs.userName ?? "",
    name: attrs.name ?? {},
    displayName: attrs.displayName ?? attrs.name?.formatted ?? attrs.userName ?? "",
    emails: attrs.emails ?? [],
    active: attrs.active !== false,
    groups: attrs.groups ?? [],
    roles: attrs.roles ?? [],
    meta: {
      resourceType: "User",
      created,
      lastModified,
      location: `/scim/v2/Users/${id}`,
      version: `W/"${lastModified}"`,
    },
  };
}

/**
 * Build a SCIM 2.0 Group resource object from raw attributes.
 */
function buildGroupResource(id, attrs, created, lastModified) {
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id,
    externalId: attrs.externalId ?? undefined,
    displayName: attrs.displayName ?? "",
    members: attrs.members ?? [],
    meta: {
      resourceType: "Group",
      created,
      lastModified,
      location: `/scim/v2/Groups/${id}`,
      version: `W/"${lastModified}"`,
    },
  };
}

// ─── Filter support ───────────────────────────────────────────────────────────

const FILTER_RE = /^(\w+(?:\.\w+)?)\s+eq\s+"([^"]*)"$/i;

/**
 * Evaluate a simple SCIM `eq` filter against a resource.
 * Supports dotted paths (e.g. `emails.value`).
 * @param {Object} resource
 * @param {string} filter
 * @returns {boolean}
 */
function matchesScimFilter(resource, filter) {
  const m = filter.trim().match(FILTER_RE);
  if (!m) return true; // unsupported filter → include all
  const [, path, value] = m;
  const parts = path.split(".");
  if (parts.length === 1) {
    const v = resource[parts[0]];
    return String(v ?? "") === value;
  }
  // dotted path — check array members
  const [arrayField, subField] = parts;
  const arr = resource[arrayField];
  if (!Array.isArray(arr)) return false;
  return arr.some((item) => String(item[subField] ?? "") === value);
}

// ─── PatchOp helpers ──────────────────────────────────────────────────────────

/**
 * Apply an array of SCIM PatchOp operations to a plain attribute object.
 * Supports `add`, `replace`, and `remove` ops on simple and array fields.
 * @param {Object}   attrs
 * @param {Object[]} operations
 * @returns {Object} Updated attributes
 */
function applyPatchOps(attrs, operations) {
  const result = { ...attrs };
  for (const op of operations) {
    const { op: opType, path, value } = op;
    const key = path ? String(path).split("[")[0] : null;
    if (!key) continue;

    switch (String(opType).toLowerCase()) {
      case "add":
      case "replace":
        result[key] = value;
        break;
      case "remove":
        delete result[key];
        break;
    }
  }
  return result;
}

/**
 * Convert a full SCIM resource object back to a plain attributes object
 * suitable for `buildUserResource` / `buildGroupResource`.
 */
function toPlainAttrs(resource) {
  const { schemas: _s, id: _i, meta: _m, ...rest } = resource;
  return rest;
}

// ─── Module-level singleton (lazy) ───────────────────────────────────────────

let _defaultStore = null;

/**
 * Get (or create) the module-level default store.
 * @param {string} [cwd]
 * @returns {ScimStore}
 */
export function getDefaultStore(cwd) {
  if (!_defaultStore) _defaultStore = new ScimStore({ cwd });
  return _defaultStore;
}

/** Reset the module-level default store (for testing). */
export function _resetDefaultStore() {
  _defaultStore = null;
}
