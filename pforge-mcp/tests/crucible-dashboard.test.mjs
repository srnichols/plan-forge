/**
 * Plan Forge — Crucible Dashboard REST endpoint tests (Slice 01.5).
 *
 * The happy-path state flow (submit → ask → preview → finalize) is
 * exhaustively covered in `tests/crucible-server.test.mjs`. This file
 * locks in the HTTP layer: URL/method contracts, input validation
 * (400s), not-found handling (404s), and no-regression shape tests on
 * the dashboard assets (index.html + app.js) that back the tab.
 *
 * We start the Express app on port 0 (OS-assigned) so the tests don't
 * collide with a running `forge_dashboard_start`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExpressApp } from "../server.mjs";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let server;
let baseUrl;

beforeAll(async () => {
  const app = createExpressApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
});

// Helpers

async function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function get(path) {
  return fetch(`${baseUrl}${path}`);
}

// ─── /api/crucible/submit ───────────────────────────────────────────

describe("POST /api/crucible/submit", () => {
  it("rejects a request without rawIdea (400)", async () => {
    const res = await post("/api/crucible/submit", {});
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toMatch(/rawIdea/);
  });

  it("rejects an empty rawIdea (400)", async () => {
    const res = await post("/api/crucible/submit", { rawIdea: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects a non-string rawIdea (400)", async () => {
    const res = await post("/api/crucible/submit", { rawIdea: 42 });
    expect(res.status).toBe(400);
  });
});

// ─── /api/crucible/ask ──────────────────────────────────────────────

describe("POST /api/crucible/ask", () => {
  it("rejects a request without id (400)", async () => {
    const res = await post("/api/crucible/ask", { answer: "x" });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toMatch(/id/);
  });

  it("returns 404 for an unknown smelt id", async () => {
    const res = await post("/api/crucible/ask", { id: "does-not-exist-" + Date.now() });
    expect(res.status).toBe(404);
  });
});

// ─── /api/crucible/preview ──────────────────────────────────────────

describe("GET /api/crucible/preview", () => {
  it("rejects when id is missing (400)", async () => {
    const res = await get("/api/crucible/preview");
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toMatch(/id/);
  });

  it("returns 404 for an unknown smelt id", async () => {
    const res = await get("/api/crucible/preview?id=nope-" + Date.now());
    expect(res.status).toBe(404);
  });
});

// ─── /api/crucible/finalize ─────────────────────────────────────────

describe("POST /api/crucible/finalize", () => {
  it("rejects when id is missing (400)", async () => {
    const res = await post("/api/crucible/finalize", {});
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown smelt id", async () => {
    const res = await post("/api/crucible/finalize", { id: "missing-" + Date.now() });
    expect(res.status).toBe(404);
  });
});

// ─── /api/crucible/abandon ──────────────────────────────────────────

describe("POST /api/crucible/abandon", () => {
  it("rejects when id is missing (400)", async () => {
    const res = await post("/api/crucible/abandon", {});
    expect(res.status).toBe(400);
  });

  it("is idempotent — unknown ids return 200 with abandoned:false (no throw)", async () => {
    const res = await post("/api/crucible/abandon", { id: "nope-" + Date.now() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("abandoned");
    expect(body.abandoned).toBe(false);
  });
});

// ─── /api/crucible/list ─────────────────────────────────────────────

describe("GET /api/crucible/list", () => {
  it("returns 200 with a { smelts: [...] } shape", async () => {
    const res = await get("/api/crucible/list");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("smelts");
    expect(Array.isArray(body.smelts)).toBe(true);
  });

  it("accepts an optional ?status= query string without erroring", async () => {
    const res = await get("/api/crucible/list?status=finalized");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.smelts)).toBe(true);
  });
});

// ─── Dashboard asset wiring ─────────────────────────────────────────

describe("Dashboard Crucible tab wiring", () => {
  const html = readFileSync(resolve(__dirname, "..", "dashboard", "index.html"), "utf-8");
  const js = readFileSync(resolve(__dirname, "..", "dashboard", "app.js"), "utf-8");

  it("index.html contains the Crucible tab button at a fixed position", () => {
    expect(html).toContain('data-tab="crucible"');
    expect(html).toContain('id="tab-crucible"');
  });

  it("index.html wires the three Crucible panels", () => {
    expect(html).toContain('id="crucible-smelt-list"');
    expect(html).toContain('id="crucible-interview"');
    expect(html).toContain('id="crucible-preview"');
  });

  it("app.js registers loadCrucible under TAB_LOADERS and defines handlers", () => {
    expect(js).toMatch(/crucible:\s*loadCrucible/);
    expect(js).toMatch(/async function loadCrucible/);
    expect(js).toMatch(/function startNewSmelt/);
    expect(js).toMatch(/function submitAnswer/);
    expect(js).toMatch(/function finalizeSmelt/);
    expect(js).toMatch(/function abandonSmelt/);
  });

  it("app.js exposes loadCrucible + onCrucibleHubEvent on window for live updates", () => {
    expect(js).toContain("window.loadCrucible = loadCrucible");
    expect(js).toContain("window.onCrucibleHubEvent = onCrucibleHubEvent");
  });

  // ─── Phase CRUCIBLE-02 Slice 02.1 — slice-card badges ──────────────
  it("app.js renderSliceCards defines complexity + total-spend badges", () => {
    expect(js).toContain("complexityBadge");
    expect(js).toContain("spendBadge");
    // Complexity thresholds — green 1-3, amber 4-6, red 7-10
    expect(js).toMatch(/c\s*>=\s*7/);
    expect(js).toMatch(/c\s*>=\s*4/);
    // Badge titles for accessibility/tooltips
    expect(js).toContain('Complexity score (1-10)');
    expect(js).toContain('Model spend for this slice');
  });

  it("app.js handleSliceStarted hydrates complexityScore from event data", () => {
    // The handler must assign data.complexityScore onto the slice record so
    // renderSliceCards can render the pill before the slice completes.
    expect(js).toMatch(/slice\.complexityScore\s*=\s*data\.complexityScore/);
  });
});
