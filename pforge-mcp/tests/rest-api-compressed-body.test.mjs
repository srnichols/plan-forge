/**
 * The REST API does not inflate a compressed request body.
 *
 * body-parser before 2.4.0 is open to denial of service through trailing bytes after a compressed
 * request body (GHSA-27r3-jxmh-p828), and no fixed release is published yet. Nothing sends this API a
 * compressed body, so it refuses one outright: express.json({ inflate: false }).
 *
 * Harness pattern mirrors tests/config-api.test.mjs: PLAN_FORGE_PROJECT is set before server.mjs is
 * imported so the config route writes into a temporary project.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";

let server;
let baseUrl;
let tmpProject;
let savedCwd;

beforeAll(async () => {
  tmpProject = mkdtempSync(join(tmpdir(), "pforge-rest-inflate-"));
  savedCwd = process.cwd();
  process.env.PLAN_FORGE_PROJECT = tmpProject;
  process.chdir(tmpProject);

  const { createExpressApp } = await import("../server.mjs");
  server = createExpressApp().listen(0);
  await new Promise((resolveListening) => server.once("listening", resolveListening));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 120_000);

afterAll(async () => {
  if (server) await new Promise((resolveClosed) => server.close(resolveClosed));
  if (savedCwd) process.chdir(savedCwd);
  if (tmpProject && existsSync(tmpProject)) rmSync(tmpProject, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(tmpProject, ".forge.json"), { force: true });
});

const CONFIG = JSON.stringify({ preset: "dotnet", templateVersion: "2.56.0", updateSource: "auto" });

function postConfig(body, encoding) {
  return fetch(`${baseUrl}/api/config`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(encoding ? { "content-encoding": encoding } : {}) },
    body,
  });
}

describe("POST /api/config body encodings", () => {
  it("still takes a plain JSON body", async () => {
    const res = await postConfig(CONFIG);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(existsSync(join(tmpProject, ".forge.json"))).toBe(true);
  });

  it.each([
    ["gzip", gzipSync],
    ["deflate", deflateSync],
    ["br", brotliCompressSync],
  ])("refuses a %s body with 415 and writes nothing", async (encoding, compress) => {
    const res = await postConfig(compress(Buffer.from(CONFIG)), encoding);
    expect(res.status).toBe(415);
    expect(existsSync(join(tmpProject, ".forge.json"))).toBe(false);
  });

  it("refuses a gzip body with bytes after it, the shape the advisory describes", async () => {
    const body = Buffer.concat([gzipSync(Buffer.from(CONFIG)), Buffer.from("trailing bytes")]);
    const res = await postConfig(body, "gzip");
    expect(res.status).toBe(415);
    expect(existsSync(join(tmpProject, ".forge.json"))).toBe(false);
  });
});
