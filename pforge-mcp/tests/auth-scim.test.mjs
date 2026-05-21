/**
 * Tests for the SCIM 2.0 provisioning feature.
 *
 * Covers:
 *   - auth/scim-store.mjs  — ScimStore CRUD, filter, pagination, PatchOp
 *   - server/rest-api/scim-routes.mjs — HTTP endpoint behaviour, auth, errors
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ScimStore,
  SCIM_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
  SCIM_LIST_SCHEMA,
  SCIM_ERROR_SCHEMA,
  SCIM_PATCH_SCHEMA,
  _resetDefaultStore,
} from "../auth/scim-store.mjs";
import { _registerScimRoutes } from "../server/rest-api/scim-routes.mjs";

// ─── ScimStore unit tests ────────────────────────────────────────────────────

describe("ScimStore — users", () => {
  let store;

  beforeEach(() => {
    store = new ScimStore({ persist: false });
  });

  it("creates a user and returns a SCIM resource", () => {
    const user = store.createUser({ userName: "alice@example.com" });
    expect(user.schemas).toContain(SCIM_USER_SCHEMA);
    expect(user.userName).toBe("alice@example.com");
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.active).toBe(true);
    expect(user.meta.resourceType).toBe("User");
    expect(user.meta.location).toMatch(/^\/scim\/v2\/Users\//);
  });

  it("getUser returns the created user by id", () => {
    const created = store.createUser({ userName: "bob@example.com" });
    const fetched = store.getUser(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched.userName).toBe("bob@example.com");
  });

  it("getUser returns null for unknown id", () => {
    expect(store.getUser("no-such-id")).toBeNull();
  });

  it("findUserBy locates a user by userName", () => {
    store.createUser({ userName: "carol@example.com" });
    const found = store.findUserBy("userName", "carol@example.com");
    expect(found).not.toBeNull();
    expect(found.userName).toBe("carol@example.com");
  });

  it("findUserBy returns null when not found", () => {
    expect(store.findUserBy("userName", "nobody@example.com")).toBeNull();
  });

  it("replaceUser updates all fields", () => {
    const user = store.createUser({ userName: "dave@example.com" });
    const updated = store.replaceUser(user.id, {
      userName: "dave.new@example.com",
      displayName: "Dave New",
    });
    expect(updated.userName).toBe("dave.new@example.com");
    expect(updated.displayName).toBe("Dave New");
    expect(updated.meta.created).toBe(user.meta.created);
  });

  it("replaceUser returns null for unknown id", () => {
    expect(store.replaceUser("no-such-id", { userName: "x" })).toBeNull();
  });

  it("patchUser applies replace operations", () => {
    const user = store.createUser({ userName: "eve@example.com", active: true });
    const patched = store.patchUser(user.id, [
      { op: "replace", path: "active", value: false },
    ]);
    expect(patched.active).toBe(false);
  });

  it("patchUser applies add operations", () => {
    const user = store.createUser({ userName: "frank@example.com" });
    const patched = store.patchUser(user.id, [
      { op: "add", path: "displayName", value: "Frank O" },
    ]);
    expect(patched.displayName).toBe("Frank O");
  });

  it("patchUser returns null for unknown id", () => {
    expect(store.patchUser("no-such-id", [])).toBeNull();
  });

  it("deleteUser removes the user and returns true", () => {
    const user = store.createUser({ userName: "grace@example.com" });
    expect(store.deleteUser(user.id)).toBe(true);
    expect(store.getUser(user.id)).toBeNull();
  });

  it("deleteUser returns false for unknown id", () => {
    expect(store.deleteUser("no-such-id")).toBe(false);
  });

  it("listUsers returns all users without filter", () => {
    store.createUser({ userName: "u1@example.com" });
    store.createUser({ userName: "u2@example.com" });
    const { resources, total } = store.listUsers();
    expect(total).toBe(2);
    expect(resources).toHaveLength(2);
  });

  it("listUsers applies simple eq filter on userName", () => {
    store.createUser({ userName: "target@example.com" });
    store.createUser({ userName: "other@example.com" });
    const { resources, total } = store.listUsers({
      filter: 'userName eq "target@example.com"',
    });
    expect(total).toBe(1);
    expect(resources[0].userName).toBe("target@example.com");
  });

  it("listUsers paginates correctly", () => {
    for (let i = 0; i < 5; i++) store.createUser({ userName: `p${i}@example.com` });
    const page1 = store.listUsers({ startIndex: 1, count: 2 });
    expect(page1.resources).toHaveLength(2);
    expect(page1.total).toBe(5);
    const page3 = store.listUsers({ startIndex: 5, count: 2 });
    expect(page3.resources).toHaveLength(1);
  });
});

describe("ScimStore — groups", () => {
  let store;

  beforeEach(() => {
    store = new ScimStore({ persist: false });
  });

  it("creates a group", () => {
    const group = store.createGroup({ displayName: "Engineering" });
    expect(group.schemas).toContain(SCIM_GROUP_SCHEMA);
    expect(group.displayName).toBe("Engineering");
    expect(group.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(group.meta.resourceType).toBe("Group");
  });

  it("replaceGroup updates displayName", () => {
    const g = store.createGroup({ displayName: "Old Name" });
    const updated = store.replaceGroup(g.id, { displayName: "New Name" });
    expect(updated.displayName).toBe("New Name");
  });

  it("patchGroup replaces members", () => {
    const g = store.createGroup({ displayName: "G1", members: [] });
    const members = [{ value: "user-id-1", display: "Alice" }];
    const patched = store.patchGroup(g.id, [
      { op: "replace", path: "members", value: members },
    ]);
    expect(patched.members).toEqual(members);
  });

  it("deleteGroup removes group", () => {
    const g = store.createGroup({ displayName: "ToDelete" });
    expect(store.deleteGroup(g.id)).toBe(true);
    expect(store.getGroup(g.id)).toBeNull();
  });

  it("listGroups filters by displayName", () => {
    store.createGroup({ displayName: "Alpha" });
    store.createGroup({ displayName: "Beta" });
    const { resources } = store.listGroups({ filter: 'displayName eq "Alpha"' });
    expect(resources).toHaveLength(1);
    expect(resources[0].displayName).toBe("Alpha");
  });
});

// ─── HTTP route tests ────────────────────────────────────────────────────────

const VALID_TOKEN = "test-scim-token-123";

function buildMockApp() {
  const routes = [];
  const use = () => {};
  const addRoute = (method, path, ...handlers) => {
    routes.push({ method: method.toUpperCase(), path, handlers });
  };
  const app = {
    get: (p, ...h) => addRoute("GET", p, ...h),
    post: (p, ...h) => addRoute("POST", p, ...h),
    put: (p, ...h) => addRoute("PUT", p, ...h),
    patch: (p, ...h) => addRoute("PATCH", p, ...h),
    delete: (p, ...h) => addRoute("DELETE", p, ...h),
    use,
    _routes: routes,
  };
  return app;
}

function buildMockReqRes(overrides = {}) {
  const responseData = {};
  const headers = {};
  const res = {
    statusCode: 200,
    headersSent: false,
    writeHead(status, hdrs) {
      this.statusCode = status;
      Object.assign(headers, hdrs ?? {});
      this.headersSent = true;
    },
    end(body) {
      responseData.body = body;
      responseData.parsed = body ? JSON.parse(body) : null;
    },
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { headers[k] = v; },
    json(obj) { responseData.parsed = obj; },
    _headers: headers,
    _data: responseData,
  };
  const req = {
    headers: { authorization: `Bearer ${VALID_TOKEN}` },
    query: {},
    body: {},
    params: {},
    ...overrides,
  };
  return { req, res };
}

async function invokeRoute(app, method, path, req, res) {
  const route = app._routes.find(
    (r) => r.method === method.toUpperCase() && r.path === path
  );
  if (!route) throw new Error(`No route found: ${method} ${path}`);
  for (const handler of route.handlers) {
    let calledNext = false;
    await handler(req, res, () => { calledNext = true; });
    if (!calledNext && res._data.body !== undefined) break;
  }
}

describe("SCIM HTTP routes — authentication", () => {
  let app, store;

  beforeEach(() => {
    vi.stubEnv("PFORGE_SCIM_TOKEN", VALID_TOKEN);
    app = buildMockApp();
    store = new ScimStore({ persist: false });
    _registerScimRoutes(app, { store });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetDefaultStore();
  });

  it("GET /scim/v2/ServiceProviderConfig requires no auth", async () => {
    const { req, res } = buildMockReqRes({ headers: {} });
    await invokeRoute(app, "GET", "/scim/v2/ServiceProviderConfig", req, res);
    expect(res._data.parsed).toHaveProperty("patch");
    expect(res.statusCode).toBe(200);
  });

  it("GET /scim/v2/Schemas requires no auth", async () => {
    const { req, res } = buildMockReqRes({ headers: {} });
    await invokeRoute(app, "GET", "/scim/v2/Schemas", req, res);
    expect(res._data.parsed.totalResults).toBe(2);
  });

  it("GET /scim/v2/Users returns 401 without token", async () => {
    const { req, res } = buildMockReqRes({ headers: {} });
    await invokeRoute(app, "GET", "/scim/v2/Users", req, res);
    expect(res.statusCode).toBe(401);
    expect(res._data.parsed.schemas).toContain(SCIM_ERROR_SCHEMA);
  });

  it("GET /scim/v2/Users returns 401 with wrong token", async () => {
    const { req, res } = buildMockReqRes({
      headers: { authorization: "Bearer wrong-token" },
    });
    await invokeRoute(app, "GET", "/scim/v2/Users", req, res);
    expect(res.statusCode).toBe(401);
  });

  it("returns 503 when PFORGE_SCIM_TOKEN is not configured", async () => {
    vi.unstubAllEnvs();
    const app2 = buildMockApp();
    _registerScimRoutes(app2, { store });
    const { req, res } = buildMockReqRes();
    await invokeRoute(app2, "GET", "/scim/v2/Users", req, res);
    expect(res.statusCode).toBe(503);
  });
});

describe("SCIM HTTP routes — Users CRUD", () => {
  let app, store;

  beforeEach(() => {
    vi.stubEnv("PFORGE_SCIM_TOKEN", VALID_TOKEN);
    app = buildMockApp();
    store = new ScimStore({ persist: false });
    _registerScimRoutes(app, { store });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetDefaultStore();
  });

  it("POST /scim/v2/Users creates a user", async () => {
    const { req, res } = buildMockReqRes({
      body: { userName: "newuser@example.com", schemas: [SCIM_USER_SCHEMA] },
    });
    await invokeRoute(app, "POST", "/scim/v2/Users", req, res);
    expect(res.statusCode).toBe(201);
    expect(res._data.parsed.userName).toBe("newuser@example.com");
    expect(res._headers["Location"]).toMatch(/\/scim\/v2\/Users\//);
  });

  it("POST /scim/v2/Users returns 400 when userName is missing", async () => {
    const { req, res } = buildMockReqRes({ body: { displayName: "No Username" } });
    await invokeRoute(app, "POST", "/scim/v2/Users", req, res);
    expect(res.statusCode).toBe(400);
    expect(res._data.parsed.scimType).toBe("invalidValue");
  });

  it("POST /scim/v2/Users returns 409 on duplicate userName", async () => {
    store.createUser({ userName: "dup@example.com" });
    const { req, res } = buildMockReqRes({ body: { userName: "dup@example.com" } });
    await invokeRoute(app, "POST", "/scim/v2/Users", req, res);
    expect(res.statusCode).toBe(409);
    expect(res._data.parsed.scimType).toBe("uniqueness");
  });

  it("GET /scim/v2/Users/:id returns the user", async () => {
    const user = store.createUser({ userName: "known@example.com" });
    const { req, res } = buildMockReqRes({ params: { id: user.id } });
    await invokeRoute(app, "GET", "/scim/v2/Users/:id", req, res);
    expect(res.statusCode).toBe(200);
    expect(res._data.parsed.id).toBe(user.id);
  });

  it("GET /scim/v2/Users/:id returns 404 for unknown id", async () => {
    const { req, res } = buildMockReqRes({ params: { id: "no-such-id" } });
    await invokeRoute(app, "GET", "/scim/v2/Users/:id", req, res);
    expect(res.statusCode).toBe(404);
  });

  it("PUT /scim/v2/Users/:id replaces the user", async () => {
    const user = store.createUser({ userName: "old@example.com" });
    const { req, res } = buildMockReqRes({
      params: { id: user.id },
      body: { userName: "new@example.com" },
    });
    await invokeRoute(app, "PUT", "/scim/v2/Users/:id", req, res);
    expect(res.statusCode).toBe(200);
    expect(res._data.parsed.userName).toBe("new@example.com");
  });

  it("PATCH /scim/v2/Users/:id deactivates a user", async () => {
    const user = store.createUser({ userName: "patch@example.com", active: true });
    const { req, res } = buildMockReqRes({
      params: { id: user.id },
      body: {
        schemas: [SCIM_PATCH_SCHEMA],
        Operations: [{ op: "replace", path: "active", value: false }],
      },
    });
    await invokeRoute(app, "PATCH", "/scim/v2/Users/:id", req, res);
    expect(res.statusCode).toBe(200);
    expect(res._data.parsed.active).toBe(false);
  });

  it("PATCH /scim/v2/Users/:id returns 400 when schema missing", async () => {
    const user = store.createUser({ userName: "nopatch@example.com" });
    const { req, res } = buildMockReqRes({
      params: { id: user.id },
      body: { Operations: [] },
    });
    await invokeRoute(app, "PATCH", "/scim/v2/Users/:id", req, res);
    expect(res.statusCode).toBe(400);
    expect(res._data.parsed.scimType).toBe("invalidSyntax");
  });

  it("DELETE /scim/v2/Users/:id deletes the user", async () => {
    const user = store.createUser({ userName: "del@example.com" });
    const { req, res } = buildMockReqRes({ params: { id: user.id } });
    await invokeRoute(app, "DELETE", "/scim/v2/Users/:id", req, res);
    expect(res.statusCode).toBe(204);
    expect(store.getUser(user.id)).toBeNull();
  });

  it("DELETE /scim/v2/Users/:id returns 404 for unknown id", async () => {
    const { req, res } = buildMockReqRes({ params: { id: "no-such-id" } });
    await invokeRoute(app, "DELETE", "/scim/v2/Users/:id", req, res);
    expect(res.statusCode).toBe(404);
  });
});

describe("SCIM HTTP routes — Groups CRUD", () => {
  let app, store;

  beforeEach(() => {
    vi.stubEnv("PFORGE_SCIM_TOKEN", VALID_TOKEN);
    app = buildMockApp();
    store = new ScimStore({ persist: false });
    _registerScimRoutes(app, { store });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetDefaultStore();
  });

  it("POST /scim/v2/Groups creates a group", async () => {
    const { req, res } = buildMockReqRes({
      body: { displayName: "Devs", schemas: [SCIM_GROUP_SCHEMA] },
    });
    await invokeRoute(app, "POST", "/scim/v2/Groups", req, res);
    expect(res.statusCode).toBe(201);
    expect(res._data.parsed.displayName).toBe("Devs");
  });

  it("POST /scim/v2/Groups returns 400 when displayName missing", async () => {
    const { req, res } = buildMockReqRes({ body: {} });
    await invokeRoute(app, "POST", "/scim/v2/Groups", req, res);
    expect(res.statusCode).toBe(400);
    expect(res._data.parsed.scimType).toBe("invalidValue");
  });

  it("GET /scim/v2/Groups lists all groups", async () => {
    store.createGroup({ displayName: "G1" });
    store.createGroup({ displayName: "G2" });
    const { req, res } = buildMockReqRes({ query: {} });
    await invokeRoute(app, "GET", "/scim/v2/Groups", req, res);
    expect(res.statusCode).toBe(200);
    expect(res._data.parsed.totalResults).toBe(2);
    expect(res._data.parsed.schemas).toContain(SCIM_LIST_SCHEMA);
  });

  it("DELETE /scim/v2/Groups/:id deletes a group", async () => {
    const g = store.createGroup({ displayName: "ToGo" });
    const { req, res } = buildMockReqRes({ params: { id: g.id } });
    await invokeRoute(app, "DELETE", "/scim/v2/Groups/:id", req, res);
    expect(res.statusCode).toBe(204);
  });
});
