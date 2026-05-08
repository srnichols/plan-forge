/**
 * Tests for the auth/RBAC subsystem.
 *
 * Covers:
 *   - auth/rbac.mjs          → resolveRoles, hasScope
 *   - auth/providers/bearer  → authenticateBearer
 *   - auth/providers/sso-stub→ authenticateSso
 *   - auth/index.mjs         → authenticate (provider dispatch)
 *   - auth/middleware.mjs    → withAuth (401 / 403 / 500 / pass-through)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveRoles, hasScope } from "../auth/rbac.mjs";
import { authenticateBearer } from "../auth/providers/bearer.mjs";
import { authenticateSso } from "../auth/providers/sso-stub.mjs";
import { authenticate } from "../auth/index.mjs";
import { withAuth } from "../auth/middleware.mjs";

// ─── Shared RBAC fixture ────────────────────────────────────────────────────

const BASE_RBAC = {
  roles: {
    admin: { scopes: ["*"] },
    editor: { scopes: ["plans:read", "plans:write"], inherits: ["viewer"] },
    viewer: { scopes: ["plans:read"] },
    wildcard: { scopes: ["plans:*"] },
  },
  assignments: {
    "tok-admin": ["admin"],
    "tok-editor": ["editor"],
    "tok-viewer": ["viewer"],
    "tok-wildcard": ["wildcard"],
  },
};

// ─── resolveRoles ────────────────────────────────────────────────────────────

describe("resolveRoles", () => {
  it("returns empty array for unknown principal", () => {
    expect(resolveRoles("nobody", BASE_RBAC)).toEqual([]);
  });

  it("returns direct roles for a principal", () => {
    expect(resolveRoles("tok-viewer", BASE_RBAC)).toContain("viewer");
  });

  it("expands inherited roles transitively", () => {
    const roles = resolveRoles("tok-editor", BASE_RBAC);
    expect(roles).toContain("editor");
    expect(roles).toContain("viewer"); // inherited
  });

  it("deduplicates roles appearing via multiple inheritance paths", () => {
    const config = {
      roles: {
        a: { inherits: ["c"] },
        b: { inherits: ["c"] },
        c: { scopes: ["x:read"] },
      },
      assignments: { principal: ["a", "b"] },
    };
    const roles = resolveRoles("principal", config);
    const cCount = roles.filter((r) => r === "c").length;
    expect(cCount).toBe(1);
  });

  it("breaks cycles in role inheritance without throwing", () => {
    const config = {
      roles: {
        loopA: { inherits: ["loopB"] },
        loopB: { inherits: ["loopA"] },
      },
      assignments: { cycler: ["loopA"] },
    };
    expect(() => resolveRoles("cycler", config)).not.toThrow();
    const roles = resolveRoles("cycler", config);
    expect(roles).toContain("loopA");
    expect(roles).toContain("loopB");
  });

  it("handles null/undefined config gracefully", () => {
    expect(resolveRoles("someone", null)).toEqual([]);
    expect(resolveRoles("someone", undefined)).toEqual([]);
  });
});

// ─── hasScope ────────────────────────────────────────────────────────────────

describe("hasScope", () => {
  it("returns true on exact scope match", () => {
    const roles = resolveRoles("tok-viewer", BASE_RBAC);
    expect(hasScope(roles, "plans:read", BASE_RBAC)).toBe(true);
  });

  it("returns false for scope not granted", () => {
    const roles = resolveRoles("tok-viewer", BASE_RBAC);
    expect(hasScope(roles, "plans:write", BASE_RBAC)).toBe(false);
  });

  it("grants all scopes via global wildcard (*)", () => {
    const roles = resolveRoles("tok-admin", BASE_RBAC);
    expect(hasScope(roles, "plans:read", BASE_RBAC)).toBe(true);
    expect(hasScope(roles, "secrets:delete", BASE_RBAC)).toBe(true);
    expect(hasScope(roles, "anything:at:all", BASE_RBAC)).toBe(true);
  });

  it("grants matching scopes via prefix wildcard (plans:*)", () => {
    const roles = resolveRoles("tok-wildcard", BASE_RBAC);
    expect(hasScope(roles, "plans:read", BASE_RBAC)).toBe(true);
    expect(hasScope(roles, "plans:write", BASE_RBAC)).toBe(true);
    expect(hasScope(roles, "plans:delete", BASE_RBAC)).toBe(true);
  });

  it("does NOT grant non-matching scopes via prefix wildcard", () => {
    const roles = resolveRoles("tok-wildcard", BASE_RBAC);
    expect(hasScope(roles, "secrets:read", BASE_RBAC)).toBe(false);
  });

  it("returns false for empty role set", () => {
    expect(hasScope([], "plans:read", BASE_RBAC)).toBe(false);
  });

  it("checks inherited role scopes when roles are resolved transitively", () => {
    // editor inherits viewer; viewer has plans:read
    const roles = resolveRoles("tok-editor", BASE_RBAC);
    expect(hasScope(roles, "plans:read", BASE_RBAC)).toBe(true);
    expect(hasScope(roles, "plans:write", BASE_RBAC)).toBe(true);
  });
});

// ─── authenticateBearer ──────────────────────────────────────────────────────

describe("authenticateBearer", () => {
  const savedEnv = process.env.PFORGE_AUTH_TOKEN;

  beforeEach(() => {
    delete process.env.PFORGE_AUTH_TOKEN;
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.PFORGE_AUTH_TOKEN = savedEnv;
    } else {
      delete process.env.PFORGE_AUTH_TOKEN;
    }
  });

  it("accepts a valid Authorization: Bearer <token> header", () => {
    const result = authenticateBearer(
      { headers: { authorization: "Bearer my-secret" } },
      {}
    );
    expect(result.ok).toBe(true);
    expect(result.token).toBe("my-secret");
  });

  it("is case-insensitive for the 'Bearer' prefix", () => {
    const result = authenticateBearer(
      { headers: { authorization: "bearer lowercase-token" } },
      {}
    );
    expect(result.ok).toBe(true);
    expect(result.token).toBe("lowercase-token");
  });

  it("falls back to PFORGE_AUTH_TOKEN env var when no header is present", () => {
    process.env.PFORGE_AUTH_TOKEN = "env-token";
    const result = authenticateBearer({ headers: {} }, {});
    expect(result.ok).toBe(true);
    expect(result.token).toBe("env-token");
  });

  it("returns ok:false when no token source is available", () => {
    const result = authenticateBearer({ headers: {} }, {});
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("validates against opts.token when provided — match succeeds", () => {
    const result = authenticateBearer(
      { headers: { authorization: "Bearer correct-token" } },
      { token: "correct-token" }
    );
    expect(result.ok).toBe(true);
  });

  it("validates against opts.token when provided — mismatch fails", () => {
    const result = authenticateBearer(
      { headers: { authorization: "Bearer wrong-token" } },
      { token: "correct-token" }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/mismatch/i);
  });

  it("accepts any non-empty token in permissive mode (no opts.token)", () => {
    const result = authenticateBearer(
      { headers: { authorization: "Bearer anything" } },
      {}
    );
    expect(result.ok).toBe(true);
    expect(result.token).toBe("anything");
  });

  it("handles mixed-case Authorization header key", () => {
    const result = authenticateBearer(
      { headers: { Authorization: "Bearer mixed-case" } },
      {}
    );
    expect(result.ok).toBe(true);
    expect(result.token).toBe("mixed-case");
  });
});

// ─── authenticateSso ─────────────────────────────────────────────────────────

describe("authenticateSso", () => {
  it("always returns ok:false (not yet implemented)", () => {
    const result = authenticateSso({}, {});
    expect(result.ok).toBe(false);
  });

  it("returns an empty token string", () => {
    const result = authenticateSso({}, {});
    expect(result.token).toBe("");
  });

  it("returns an error message explaining the stub status", () => {
    const result = authenticateSso({}, {});
    expect(typeof result.error).toBe("string");
    expect(result.error.length).toBeGreaterThan(0);
  });
});

// ─── authenticate (provider dispatch) ────────────────────────────────────────

describe("authenticate", () => {
  const savedEnv = process.env.PFORGE_AUTH_TOKEN;

  beforeEach(() => {
    delete process.env.PFORGE_AUTH_TOKEN;
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.PFORGE_AUTH_TOKEN = savedEnv;
    } else {
      delete process.env.PFORGE_AUTH_TOKEN;
    }
  });

  it("uses bearer provider by default", () => {
    const result = authenticate(
      { headers: { authorization: "Bearer tok" } },
      {}
    );
    expect(result.provider).toBe("bearer");
    expect(result.ok).toBe(true);
  });

  it("provider='none' always returns ok:true", () => {
    const result = authenticate({}, { provider: "none" });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("none");
  });

  it("provider='sso' returns ok:false (stub)", () => {
    const result = authenticate({}, { provider: "sso" });
    expect(result.ok).toBe(false);
    expect(result.provider).toBe("sso");
  });

  it("provider='bearer' with valid header returns ok:true", () => {
    const result = authenticate(
      { headers: { authorization: "Bearer good-token" } },
      { provider: "bearer" }
    );
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("bearer");
  });

  it("provider='bearer' with no token returns ok:false", () => {
    const result = authenticate({ headers: {} }, { provider: "bearer" });
    expect(result.ok).toBe(false);
  });
});

// ─── withAuth middleware ──────────────────────────────────────────────────────

function makeMockRes() {
  const res = {
    _status: null,
    _headers: {},
    _body: "",
    headersSent: false,
    writeHead(status, headers) {
      this._status = status;
      this._headers = { ...headers };
      this.headersSent = true;
    },
    end(body = "") {
      this._body = body;
    },
  };
  return res;
}

describe("withAuth middleware", () => {
  const savedEnv = process.env.PFORGE_AUTH_TOKEN;

  beforeEach(() => {
    delete process.env.PFORGE_AUTH_TOKEN;
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.PFORGE_AUTH_TOKEN = savedEnv;
    } else {
      delete process.env.PFORGE_AUTH_TOKEN;
    }
  });

  it("calls the handler when authentication succeeds", async () => {
    const handler = vi.fn();
    const guarded = withAuth(handler, { provider: "none" });
    const req = { headers: {} };
    const res = makeMockRes();

    await guarded(req, res);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("enriches req.auth before calling the handler", async () => {
    let capturedAuth;
    const handler = vi.fn((req) => { capturedAuth = req.auth; });
    const guarded = withAuth(handler, { provider: "none" });
    await guarded({ headers: {} }, makeMockRes());

    expect(capturedAuth).toBeDefined();
    expect(capturedAuth.ok).toBe(true);
    expect(capturedAuth.provider).toBe("none");
  });

  it("returns 401 when authentication fails", async () => {
    const handler = vi.fn();
    const guarded = withAuth(handler, {
      provider: "bearer",
      token: "expected",
    });
    const req = { headers: { authorization: "Bearer wrong" } };
    const res = makeMockRes();

    await guarded(req, res);
    expect(res._status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    const parsed = JSON.parse(res._body);
    expect(parsed.ok).toBe(false);
  });

  it("returns 403 when authenticated but scope is not granted", async () => {
    const handler = vi.fn();
    const guarded = withAuth(handler, {
      provider: "bearer",
      scope: "plans:write",
      rbac: BASE_RBAC,
    });
    const req = { headers: { authorization: "Bearer tok-viewer" } };
    const res = makeMockRes();

    await guarded(req, res);
    expect(res._status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    const parsed = JSON.parse(res._body);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/plans:write/);
  });

  it("returns 500 when scope is set but rbac config is missing", async () => {
    const handler = vi.fn();
    const guarded = withAuth(handler, {
      provider: "none",
      scope: "plans:read",
      // rbac intentionally omitted
    });
    const res = makeMockRes();

    await guarded({ headers: {} }, res);
    expect(res._status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls handler when authenticated and scope is granted", async () => {
    const handler = vi.fn();
    const guarded = withAuth(handler, {
      provider: "bearer",
      scope: "plans:read",
      rbac: BASE_RBAC,
    });
    const req = { headers: { authorization: "Bearer tok-viewer" } };
    const res = makeMockRes();

    await guarded(req, res);
    expect(handler).toHaveBeenCalledOnce();
    expect(res._status).toBeNull(); // no error written
  });

  it("admin with wildcard (*) scope passes any scope check", async () => {
    const handler = vi.fn();
    const guarded = withAuth(handler, {
      provider: "bearer",
      scope: "secrets:delete",
      rbac: BASE_RBAC,
    });
    const req = { headers: { authorization: "Bearer tok-admin" } };
    const res = makeMockRes();

    await guarded(req, res);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("passes extra rest arguments through to the handler", async () => {
    const handler = vi.fn();
    const guarded = withAuth(handler, { provider: "none" });
    const req = { headers: {} };
    const res = makeMockRes();
    const extra = { extra: true };

    await guarded(req, res, extra);
    expect(handler).toHaveBeenCalledWith(req, res, extra);
  });
});
