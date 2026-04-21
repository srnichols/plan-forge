/**
 * Tests for pforge-mcp/secrets.mjs — loadSecretFromForge.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { loadSecretFromForge } from "../secrets.mjs";

function makeTmpDir() {
  const d = resolve(tmpdir(), `pf-secrets-test-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

describe("loadSecretFromForge", () => {
  let tmp;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("returns value when key exists in .forge/secrets.json", () => {
    tmp = makeTmpDir();
    const forgeDir = resolve(tmp, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(resolve(forgeDir, "secrets.json"), JSON.stringify({ MY_KEY: "secret-123" }));

    expect(loadSecretFromForge("MY_KEY", tmp)).toBe("secret-123");
  });

  it("returns null when key does not exist", () => {
    tmp = makeTmpDir();
    const forgeDir = resolve(tmp, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(resolve(forgeDir, "secrets.json"), JSON.stringify({ OTHER: "val" }));

    expect(loadSecretFromForge("MY_KEY", tmp)).toBeNull();
  });

  it("returns null when .forge/secrets.json does not exist", () => {
    tmp = makeTmpDir();
    expect(loadSecretFromForge("MY_KEY", tmp)).toBeNull();
  });

  it("returns null on invalid JSON", () => {
    tmp = makeTmpDir();
    const forgeDir = resolve(tmp, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(resolve(forgeDir, "secrets.json"), "NOT JSON");

    expect(loadSecretFromForge("MY_KEY", tmp)).toBeNull();
  });

  it("returns null for empty-string values", () => {
    tmp = makeTmpDir();
    const forgeDir = resolve(tmp, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(resolve(forgeDir, "secrets.json"), JSON.stringify({ MY_KEY: "" }));

    expect(loadSecretFromForge("MY_KEY", tmp)).toBeNull();
  });
});
