/**
 * Tests for forge-master server (Phase-29).
 * Tests module exports and self-test mode without spawning full server.
 */

import { describe, it, expect } from "vitest";
import { getPromptCatalog, getPromptById } from "../src/prompts.mjs";
import { BASE_ALLOWLIST, WRITE_ALLOWLIST, PHASE29_FULL_ALLOWLIST, isAllowlisted } from "../src/allowlist.mjs";
import { createSseStream } from "../src/sse.mjs";
import { createHttpRoutes } from "../src/http-routes.mjs";

// ─── Prompt catalog ───────────────────────────────────────────────────

describe("getPromptCatalog", () => {
  it("returns version 1.0.0", () => {
    const catalog = getPromptCatalog();
    expect(catalog.version).toBe("1.0.0");
  });

  it("has at least 7 categories", () => {
    const catalog = getPromptCatalog();
    expect(catalog.categories.length).toBeGreaterThanOrEqual(7);
  });

  it("has at least 30 prompts total", () => {
    const catalog = getPromptCatalog();
    const total = catalog.categories.reduce((n, c) => n + c.prompts.length, 0);
    expect(total).toBeGreaterThanOrEqual(30);
  });

  it("each category has id, label, description, prompts array", () => {
    const catalog = getPromptCatalog();
    for (const cat of catalog.categories) {
      expect(cat.id).toBeTruthy();
      expect(cat.label).toBeTruthy();
      expect(cat.description).toBeTruthy();
      expect(Array.isArray(cat.prompts)).toBe(true);
      expect(cat.prompts.length).toBeGreaterThan(0);
    }
  });

  it("each prompt has required fields", () => {
    const catalog = getPromptCatalog();
    for (const cat of catalog.categories) {
      for (const p of cat.prompts) {
        expect(p.id).toBeTruthy();
        expect(p.title).toBeTruthy();
        expect(p.description).toBeTruthy();
        expect(p.template).toBeTruthy();
        expect(p.category).toBe(cat.id);
        expect(Array.isArray(p.suggestedTools)).toBe(true);
      }
    }
  });
});

describe("getPromptById", () => {
  it("finds an existing prompt", () => {
    const p = getPromptById("ps-current-status");
    expect(p).toBeTruthy();
    expect(p.id).toBe("ps-current-status");
  });

  it("returns null for unknown id", () => {
    expect(getPromptById("does-not-exist")).toBeNull();
  });
});

// ─── PHASE29 allowlist ────────────────────────────────────────────────

describe("PHASE29_FULL_ALLOWLIST", () => {
  it("contains all BASE_ALLOWLIST tools", () => {
    const set = new Set(PHASE29_FULL_ALLOWLIST);
    for (const t of BASE_ALLOWLIST) expect(set.has(t)).toBe(true);
  });

  it("contains all WRITE_ALLOWLIST tool names", () => {
    const set = new Set(PHASE29_FULL_ALLOWLIST);
    for (const t of WRITE_ALLOWLIST) expect(set.has(t.name)).toBe(true);
  });

  it("isAllowlisted accepts write tools when using PHASE29_FULL_ALLOWLIST", () => {
    const result = isAllowlisted("forge_run_plan", [...PHASE29_FULL_ALLOWLIST]);
    expect(result.allowed).toBe(true);
  });
});

// ─── SSE stream ───────────────────────────────────────────────────────

describe("createSseStream", () => {
  it("writes correct SSE headers", () => {
    const headers = {};
    const written = [];
    const res = {
      writeHead(code, h) { Object.assign(headers, h); },
      write(chunk) { written.push(chunk); },
      end() {},
    };
    const sse = createSseStream(res);
    expect(headers["Content-Type"]).toBe("text/event-stream");
    expect(headers["Cache-Control"]).toBe("no-cache");
  });

  it("sends correctly formatted SSE events", () => {
    const written = [];
    const res = {
      writeHead() {},
      write(chunk) { written.push(chunk); },
      end() {},
    };
    const sse = createSseStream(res);
    sse.send("test", { hello: "world" });
    expect(written[0]).toBe('event: test\ndata: {"hello":"world"}\n\n');
  });

  it("sends string data as-is", () => {
    const written = [];
    const res = { writeHead() {}, write(c) { written.push(c); }, end() {} };
    const sse = createSseStream(res);
    sse.send("msg", "plain text");
    expect(written[0]).toBe("event: msg\ndata: plain text\n\n");
  });

  it("close() calls res.end()", () => {
    const ended = { called: false };
    const res = { writeHead() {}, write() {}, end() { ended.called = true; } };
    const sse = createSseStream(res);
    sse.close();
    expect(ended.called).toBe(true);
  });
});

// ─── HTTP routes ──────────────────────────────────────────────────────

describe("createHttpRoutes", () => {
  it("returns a function when app is null", () => {
    const handler = createHttpRoutes(null);
    expect(typeof handler).toBe("function");
  });

  it("handler returns 404 for unknown API path", async () => {
    const handler = createHttpRoutes(null);
    const statusCodes = [];
    const res = {
      writeHead(code) { statusCodes.push(code); },
      end() {},
    };
    const req = {
      method: "GET",
      url: "/api/forge-master/unknown-endpoint",
      headers: { host: "localhost" },
    };
    await handler(req, res);
    expect(statusCodes[0]).toBe(404);
  });

  it("handler returns prompt catalog for /api/forge-master/prompts", async () => {
    const handler = createHttpRoutes(null);
    let responseBody = "";
    const res = {
      writeHead() {},
      end(body) { responseBody = body; },
    };
    const req = {
      method: "GET",
      url: "/api/forge-master/prompts",
      headers: { host: "localhost" },
    };
    await handler(req, res);
    const parsed = JSON.parse(responseBody);
    expect(parsed.version).toBe("1.0.0");
    expect(Array.isArray(parsed.categories)).toBe(true);
  });
});
