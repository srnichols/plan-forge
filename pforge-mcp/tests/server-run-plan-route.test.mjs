/**
 * server-run-plan-route.test.mjs — /api/tool/run-plan route validation tests
 *
 * Verifies that the dedicated POST /api/tool/run-plan route in server.mjs:
 *   - Accepts valid --only-slices expressions (e.g. "2,4-6") and forwards to pforge
 *   - Rejects invalid --only-slices values with HTTP 400
 *   - Accepts --no-tempering as a bare boolean flag
 *
 * Harness pattern mirrors api-innerloop.test.mjs: set PLAN_FORGE_PROJECT before
 * importing server.mjs so PROJECT_DIR binds to our tmp fixture directory.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server;
let baseUrl;
let tmpProject;
let savedCwd;

beforeAll(async () => {
  tmpProject = mkdtempSync(join(tmpdir(), "pforge-run-plan-route-"));
  savedCwd = process.cwd();
  process.env.PLAN_FORGE_PROJECT = tmpProject;
  process.chdir(tmpProject);

  // Create minimal .forge.json so server.mjs initialises without errors
  writeFileSync(join(tmpProject, ".forge.json"), "{}", "utf-8");

  const { createExpressApp } = await import("../server.mjs");
  const app = createExpressApp();
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (savedCwd) process.chdir(savedCwd);
  delete process.env.PLAN_FORGE_PROJECT;
  if (tmpProject && existsSync(tmpProject)) rmSync(tmpProject, { recursive: true, force: true });
});

async function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── --only-slices validation ────────────────────────────────────────────────

describe("POST /api/tool/run-plan", () => {
  it("accepts valid --only-slices expression (e.g. '2,4-6')", async () => {
    const res = await post("/api/tool/run-plan", { args: "docs/plans/test.md --only-slices 2,4-6" });
    // Validation passes; pforge may fail (plan doesn't exist) but the response must NOT be 400 validation error
    expect(res.status).not.toBe(400);
    const body = await res.json();
    // The error (if any) comes from pforge itself, not from our validation layer
    expect(body.error ?? "").not.toMatch(/invalid --only-slices value/);
  });

  it("rejects malicious --only-slices value with HTTP 400", async () => {
    const res = await post("/api/tool/run-plan", { args: "docs/plans/test.md --only-slices ;rm-rf" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid --only-slices value");
  });

  it("rejects shell-injection attempt in --only-slices value with HTTP 400", async () => {
    const res = await post("/api/tool/run-plan", { args: "docs/plans/test.md --only-slices $(evil)" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid --only-slices value");
  });

  it("accepts --no-tempering as a bare flag (no 400)", async () => {
    const res = await post("/api/tool/run-plan", { args: "docs/plans/test.md --no-tempering" });
    // No --only-slices present — validation is skipped; response is NOT 400
    expect(res.status).not.toBe(400);
    const body = await res.json();
    expect(body.error ?? "").not.toMatch(/invalid --only-slices value/);
  });

  it("accepts --only-slices single number", async () => {
    const res = await post("/api/tool/run-plan", { args: "docs/plans/test.md --only-slices 3" });
    expect(res.status).not.toBe(400);
  });

  it("rejects --only-slices with no following value", async () => {
    const res = await post("/api/tool/run-plan", { args: "docs/plans/test.md --only-slices" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid --only-slices value");
  });
});
