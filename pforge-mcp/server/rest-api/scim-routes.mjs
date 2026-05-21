/**
 * SCIM 2.0 route handlers for Plan Forge MCP.
 *
 * Implements the SCIM 2.0 protocol endpoints used by identity providers
 * (Okta, Entra ID, etc.) to provision and deprovision users and groups:
 *
 *   GET  /scim/v2/ServiceProviderConfig
 *   GET  /scim/v2/Schemas
 *   GET  /scim/v2/Users               list + filter
 *   POST /scim/v2/Users               create
 *   GET  /scim/v2/Users/:id           read
 *   PUT  /scim/v2/Users/:id           replace
 *   PATCH /scim/v2/Users/:id          update (PatchOp)
 *   DELETE /scim/v2/Users/:id         delete
 *   GET  /scim/v2/Groups              list + filter
 *   POST /scim/v2/Groups              create
 *   GET  /scim/v2/Groups/:id          read
 *   PUT  /scim/v2/Groups/:id          replace
 *   PATCH /scim/v2/Groups/:id         update (PatchOp)
 *   DELETE /scim/v2/Groups/:id        delete
 *
 * Authentication: Bearer token validated against `PFORGE_SCIM_TOKEN` env var
 * or `.forge/secrets.json#scimBearerToken`. Requests without a valid token
 * receive HTTP 401.
 *
 * @module server/rest-api/scim-routes
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ScimStore,
  SCIM_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
  SCIM_LIST_SCHEMA,
  SCIM_ERROR_SCHEMA,
  SCIM_PATCH_SCHEMA,
} from "../../auth/scim-store.mjs";
import { PROJECT_DIR } from "../state.mjs";

const SCIM_CONTENT_TYPE = "application/scim+json";

// ─── Token resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the SCIM bearer token from env or secrets file.
 * Returns null when no token is configured (SCIM disabled).
 * @param {string} cwd
 * @returns {string|null}
 */
function resolveScimToken(cwd) {
  if (process.env.PFORGE_SCIM_TOKEN) return process.env.PFORGE_SCIM_TOKEN;
  try {
    const secretsPath = resolve(cwd, ".forge", "secrets.json");
    if (existsSync(secretsPath)) {
      const secrets = JSON.parse(readFileSync(secretsPath, "utf-8"));
      if (secrets.scimBearerToken) return secrets.scimBearerToken;
    }
  } catch {
    /* fall through — token not configured */
  }
  return null;
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function sendScim(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": SCIM_CONTENT_TYPE,
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function scimError(res, status, detail, scimType) {
  sendScim(res, status, {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    scimType: scimType ?? undefined,
    detail,
  });
}

function buildListResponse(resources, total, startIndex, count) {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: total,
    startIndex,
    itemsPerPage: count,
    Resources: resources,
  };
}

// ─── Authentication middleware ────────────────────────────────────────────────

/**
 * Express middleware that enforces SCIM bearer token authentication.
 * When no token is configured, SCIM is treated as disabled and all
 * requests return 503 to prevent accidental open access.
 */
function makeScimAuthMiddleware(cwd) {
  return function scimAuth(req, res, next) {
    const expectedToken = resolveScimToken(cwd);
    if (!expectedToken) {
      return scimError(res, 503, "SCIM provisioning is not configured. Set PFORGE_SCIM_TOKEN or scimBearerToken in .forge/secrets.json.");
    }
    const authHeader = req.headers["authorization"] ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return scimError(res, 401, "SCIM requires a Bearer token in the Authorization header.", "invalidCredentials");
    }
    const provided = authHeader.slice(7).trim();
    if (provided !== expectedToken) {
      return scimError(res, 401, "Invalid SCIM bearer token.", "invalidCredentials");
    }
    next();
  };
}

// ─── Query param helpers ──────────────────────────────────────────────────────

function parseListParams(query) {
  const startIndex = Math.max(1, parseInt(query.startIndex ?? "1", 10) || 1);
  const count = Math.min(200, Math.max(1, parseInt(query.count ?? "100", 10) || 100));
  const filter = query.filter ?? undefined;
  return { startIndex, count, filter };
}

// ─── ServiceProviderConfig ────────────────────────────────────────────────────

function buildServiceProviderConfig() {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: "https://github.com/srnichols/plan-forge",
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        name: "OAuth Bearer Token",
        description: "Authentication using an OAuth bearer token",
        specUri: "https://www.rfc-editor.org/rfc/rfc6750",
        type: "oauthbearertoken",
        primary: true,
      },
    ],
    meta: {
      resourceType: "ServiceProviderConfig",
      location: "/scim/v2/ServiceProviderConfig",
    },
  };
}

// ─── Schema definitions ───────────────────────────────────────────────────────

function buildSchemas() {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 2,
    startIndex: 1,
    itemsPerPage: 2,
    Resources: [
      {
        id: SCIM_USER_SCHEMA,
        name: "User",
        description: "Plan Forge User",
        schemas: ["urn:ietf:params:scim:meta:1.0:Schema"],
        attributes: [
          { name: "userName", type: "string", required: true, uniqueness: "server" },
          { name: "name", type: "complex" },
          { name: "displayName", type: "string" },
          { name: "emails", type: "complex", multiValued: true },
          { name: "active", type: "boolean" },
        ],
        meta: { resourceType: "Schema", location: `/scim/v2/Schemas/${SCIM_USER_SCHEMA}` },
      },
      {
        id: SCIM_GROUP_SCHEMA,
        name: "Group",
        description: "Plan Forge Group",
        schemas: ["urn:ietf:params:scim:meta:1.0:Schema"],
        attributes: [
          { name: "displayName", type: "string", required: true },
          { name: "members", type: "complex", multiValued: true },
        ],
        meta: { resourceType: "Schema", location: `/scim/v2/Schemas/${SCIM_GROUP_SCHEMA}` },
      },
    ],
  };
}

// ─── Route registration ───────────────────────────────────────────────────────

/**
 * Register all SCIM 2.0 routes on the given Express app.
 *
 * Discovery endpoints (`/scim/v2/ServiceProviderConfig`, `/scim/v2/Schemas`)
 * are unauthenticated — identity providers probe these before supplying
 * credentials. All provisioning endpoints require the SCIM bearer token.
 *
 * @param {import("express").Application} app
 * @param {Object}    [opts]
 * @param {string}    [opts.cwd]   - Project root for token + store resolution
 * @param {ScimStore} [opts.store] - Override the store (for testing)
 */
export function _registerScimRoutes(app, { cwd, store } = {}) {
  const effectiveCwd = cwd ?? PROJECT_DIR ?? process.cwd();
  const scimStore = store ?? new ScimStore({ cwd: effectiveCwd });
  const authMw = makeScimAuthMiddleware(effectiveCwd);

  // ── Discovery (no auth) ──────────────────────────────────────────────────
  app.get("/scim/v2/ServiceProviderConfig", (_req, res) => {
    sendScim(res, 200, buildServiceProviderConfig());
  });

  app.get("/scim/v2/Schemas", (_req, res) => {
    sendScim(res, 200, buildSchemas());
  });

  // ── Users (auth required) ────────────────────────────────────────────────
  app.get("/scim/v2/Users", authMw, (req, res) => {
    const { startIndex, count, filter } = parseListParams(req.query);
    const { resources, total } = scimStore.listUsers({ filter, startIndex, count });
    sendScim(res, 200, buildListResponse(resources, total, startIndex, count));
  });

  app.post("/scim/v2/Users", authMw, (req, res) => {
    const attrs = req.body ?? {};
    if (!attrs.userName) {
      return scimError(res, 400, "userName is required.", "invalidValue");
    }
    const existing = scimStore.findUserBy("userName", attrs.userName);
    if (existing) {
      return scimError(res, 409, `User with userName "${attrs.userName}" already exists.`, "uniqueness");
    }
    const user = scimStore.createUser(attrs);
    res.setHeader("Location", user.meta.location);
    sendScim(res, 201, user);
  });

  app.get("/scim/v2/Users/:id", authMw, (req, res) => {
    const user = scimStore.getUser(req.params.id);
    if (!user) return scimError(res, 404, `User ${req.params.id} not found.`);
    sendScim(res, 200, user);
  });

  app.put("/scim/v2/Users/:id", authMw, (req, res) => {
    const attrs = req.body ?? {};
    if (!attrs.userName) {
      return scimError(res, 400, "userName is required.", "invalidValue");
    }
    const user = scimStore.replaceUser(req.params.id, attrs);
    if (!user) return scimError(res, 404, `User ${req.params.id} not found.`);
    sendScim(res, 200, user);
  });

  app.patch("/scim/v2/Users/:id", authMw, (req, res) => {
    const body = req.body ?? {};
    const schemas = body.schemas ?? [];
    if (!schemas.includes(SCIM_PATCH_SCHEMA)) {
      return scimError(res, 400, `Request body must include schema "${SCIM_PATCH_SCHEMA}".`, "invalidSyntax");
    }
    const user = scimStore.patchUser(req.params.id, body.Operations ?? []);
    if (!user) return scimError(res, 404, `User ${req.params.id} not found.`);
    sendScim(res, 200, user);
  });

  app.delete("/scim/v2/Users/:id", authMw, (req, res) => {
    const deleted = scimStore.deleteUser(req.params.id);
    if (!deleted) return scimError(res, 404, `User ${req.params.id} not found.`);
    res.status(204).end();
  });

  // ── Groups (auth required) ───────────────────────────────────────────────
  app.get("/scim/v2/Groups", authMw, (req, res) => {
    const { startIndex, count, filter } = parseListParams(req.query);
    const { resources, total } = scimStore.listGroups({ filter, startIndex, count });
    sendScim(res, 200, buildListResponse(resources, total, startIndex, count));
  });

  app.post("/scim/v2/Groups", authMw, (req, res) => {
    const attrs = req.body ?? {};
    if (!attrs.displayName) {
      return scimError(res, 400, "displayName is required.", "invalidValue");
    }
    const group = scimStore.createGroup(attrs);
    res.setHeader("Location", group.meta.location);
    sendScim(res, 201, group);
  });

  app.get("/scim/v2/Groups/:id", authMw, (req, res) => {
    const group = scimStore.getGroup(req.params.id);
    if (!group) return scimError(res, 404, `Group ${req.params.id} not found.`);
    sendScim(res, 200, group);
  });

  app.put("/scim/v2/Groups/:id", authMw, (req, res) => {
    const attrs = req.body ?? {};
    if (!attrs.displayName) {
      return scimError(res, 400, "displayName is required.", "invalidValue");
    }
    const group = scimStore.replaceGroup(req.params.id, attrs);
    if (!group) return scimError(res, 404, `Group ${req.params.id} not found.`);
    sendScim(res, 200, group);
  });

  app.patch("/scim/v2/Groups/:id", authMw, (req, res) => {
    const body = req.body ?? {};
    const schemas = body.schemas ?? [];
    if (!schemas.includes(SCIM_PATCH_SCHEMA)) {
      return scimError(res, 400, `Request body must include schema "${SCIM_PATCH_SCHEMA}".`, "invalidSyntax");
    }
    const group = scimStore.patchGroup(req.params.id, body.Operations ?? []);
    if (!group) return scimError(res, 404, `Group ${req.params.id} not found.`);
    sendScim(res, 200, group);
  });

  app.delete("/scim/v2/Groups/:id", authMw, (req, res) => {
    const deleted = scimStore.deleteGroup(req.params.id);
    if (!deleted) return scimError(res, 404, `Group ${req.params.id} not found.`);
    res.status(204).end();
  });
}
