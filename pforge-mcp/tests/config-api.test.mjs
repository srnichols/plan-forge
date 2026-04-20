/**
 * Plan Forge — /api/config tests (v2.56.0, S5 of UPDATE-SOURCE-PREF).
 *
 * Covers the server-side validation of the updateSource enum introduced
 * in S3 (dashboard UI + server POST endpoint). The full source-selection
 * matrix lives in pforge.ps1 / pforge.sh and is exercised by the testbed
 * happy-path — these tests lock in just the HTTP contract.
 *
 * We start Express on port 0 so we don't collide with a running server.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ─── Harness ────────────────────────────────────────────────────

let server;
let baseUrl;
let tmpProject;
let savedCwd;

beforeAll(async () => {
  // PROJECT_DIR is resolved at server.mjs module load time, so we must
  // set PLAN_FORGE_PROJECT before importing createExpressApp. This also
  // means the import has to be dynamic, inside beforeAll.
  tmpProject = mkdtempSync(join(tmpdir(), "pforge-config-test-"));
  savedCwd = process.cwd();
  process.env.PLAN_FORGE_PROJECT = tmpProject;
  process.chdir(tmpProject);
  // Seed a minimal existing config so we exercise the merge path too.
  writeFileSync(
    join(tmpProject, ".forge.json"),
    JSON.stringify({ preset: "dotnet", templateVersion: "2.56.0" }, null, 2),
  );

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
  if (tmpProject && existsSync(tmpProject)) rmSync(tmpProject, { recursive: true, force: true });
});

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

function readConfig() {
  return JSON.parse(readFileSync(join(tmpProject, ".forge.json"), "utf-8"));
}

// ─── GET /api/config ────────────────────────────────────────────

describe("GET /api/config", () => {
  it("returns the current .forge.json", async () => {
    const res = await get("/api/config");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preset).toBe("dotnet");
    expect(body.templateVersion).toBe("2.56.0");
  });
});

// ─── POST /api/config — updateSource validation (v2.56.0) ──────

describe("POST /api/config — updateSource validation", () => {
  it("rejects updateSource='invalid' with 400", async () => {
    const res = await post("/api/config", { preset: "dotnet", updateSource: "bogus" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/updateSource must be one of/);
    expect(body.error).toMatch(/auto/);
    expect(body.error).toMatch(/github-tags/);
    expect(body.error).toMatch(/local-sibling/);
  });

  it("rejects updateSource as a non-string with 400", async () => {
    const res = await post("/api/config", { preset: "dotnet", updateSource: 42 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/updateSource must be one of/);
  });

  it("accepts updateSource='auto' and persists to disk", async () => {
    const res = await post("/api/config", { preset: "dotnet", templateVersion: "2.56.0", updateSource: "auto" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(readConfig().updateSource).toBe("auto");
  });

  it("accepts updateSource='github-tags' and persists to disk", async () => {
    const res = await post("/api/config", { preset: "dotnet", templateVersion: "2.56.0", updateSource: "github-tags" });
    expect(res.status).toBe(200);
    expect(readConfig().updateSource).toBe("github-tags");
  });

  it("accepts updateSource='local-sibling' and persists to disk", async () => {
    const res = await post("/api/config", { preset: "dotnet", templateVersion: "2.56.0", updateSource: "local-sibling" });
    expect(res.status).toBe(200);
    expect(readConfig().updateSource).toBe("local-sibling");
  });

  it("accepts a config body without updateSource (key is optional)", async () => {
    const res = await post("/api/config", { preset: "dotnet", templateVersion: "2.56.0" });
    expect(res.status).toBe(200);
    const persisted = readConfig();
    expect(persisted.preset).toBe("dotnet");
    // updateSource should NOT be present if the client omitted it
    expect(persisted.updateSource).toBeUndefined();
  });

  it("preserves other fields when updateSource changes", async () => {
    await post("/api/config", {
      preset: "dotnet",
      templateVersion: "2.56.0",
      modelRouting: { default: "gpt-5.3-codex" },
      updateSource: "github-tags",
    });
    const persisted = readConfig();
    expect(persisted.preset).toBe("dotnet");
    expect(persisted.modelRouting?.default).toBe("gpt-5.3-codex");
    expect(persisted.updateSource).toBe("github-tags");
  });
});
