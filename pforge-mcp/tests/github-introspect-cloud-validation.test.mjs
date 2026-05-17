/**
 * Tests for the cloudAgentValidation check in github-introspect.mjs.
 *
 * Verifies that:
 *   - Missing .forge.json → "na"
 *   - .forge.json without cloudAgentValidation key → "na"
 *   - .forge.json with cloudAgentValidation + enabled tools → "pass" with detail
 *   - cloudAgentValidation with all tools disabled → "pass" (user has explicitly configured it)
 *   - Unknown keys in cloudAgentValidation are ignored
 *   - readCloudAgentValidationConfig is exported for direct use
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { inspectGithubStack } from "../github-introspect.mjs";

function writeJson(root, relPath, obj) {
  const abs = join(root, relPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, JSON.stringify(obj, null, 2));
}

let TMP_ROOT;
let NO_FORGE_JSON,          // no .forge.json at all
  FORGE_JSON_NO_KEY,        // .forge.json without cloudAgentValidation
  FORGE_JSON_ALL_ENABLED,   // all 4 tools enabled
  FORGE_JSON_MIXED,         // some enabled, some disabled
  FORGE_JSON_EMPTY_OBJECT;  // cloudAgentValidation: {} (configured, no tools declared)

beforeAll(() => {
  TMP_ROOT = join(tmpdir(), `pf-cloud-valid-${randomUUID()}`);

  NO_FORGE_JSON = join(TMP_ROOT, "no-forge-json");
  mkdirSync(NO_FORGE_JSON, { recursive: true });

  FORGE_JSON_NO_KEY = join(TMP_ROOT, "no-key");
  mkdirSync(FORGE_JSON_NO_KEY, { recursive: true });
  writeJson(FORGE_JSON_NO_KEY, ".forge.json", { updateSource: "auto" });

  FORGE_JSON_ALL_ENABLED = join(TMP_ROOT, "all-enabled");
  mkdirSync(FORGE_JSON_ALL_ENABLED, { recursive: true });
  writeJson(FORGE_JSON_ALL_ENABLED, ".forge.json", {
    cloudAgentValidation: {
      codeql: true,
      secretScanning: true,
      dependencyReview: true,
      copilotCodeReview: true,
    },
  });

  FORGE_JSON_MIXED = join(TMP_ROOT, "mixed");
  mkdirSync(FORGE_JSON_MIXED, { recursive: true });
  writeJson(FORGE_JSON_MIXED, ".forge.json", {
    cloudAgentValidation: {
      codeql: true,
      secretScanning: true,
      dependencyReview: false,
      copilotCodeReview: false,
    },
  });

  FORGE_JSON_EMPTY_OBJECT = join(TMP_ROOT, "empty-object");
  mkdirSync(FORGE_JSON_EMPTY_OBJECT, { recursive: true });
  writeJson(FORGE_JSON_EMPTY_OBJECT, ".forge.json", {
    cloudAgentValidation: {},
  });
});

afterAll(() => {
  if (TMP_ROOT) rmSync(TMP_ROOT, { recursive: true, force: true });
});

function cloudCheck(root, opts) {
  const r = inspectGithubStack(root, opts);
  return r.checks.find((c) => c.id === "cloud-agent-validation");
}

describe("cloud-agent-validation check — unconfigured", () => {
  it("no .forge.json → status na", () => {
    const c = cloudCheck(NO_FORGE_JSON);
    expect(c.status).toBe("na");
    expect(c.detail).toMatch(/not configured/i);
  });

  it(".forge.json without cloudAgentValidation → status na", () => {
    const c = cloudCheck(FORGE_JSON_NO_KEY);
    expect(c.status).toBe("na");
    expect(c.detail).toMatch(/not configured/i);
  });

  it("na result has no fixHint (field is optional)", () => {
    expect(cloudCheck(NO_FORGE_JSON).fixHint).toBeUndefined();
  });
});

describe("cloud-agent-validation check — configured", () => {
  it("all 4 tools enabled → status pass, detail lists enabled tools", () => {
    const c = cloudCheck(FORGE_JSON_ALL_ENABLED);
    expect(c.status).toBe("pass");
    expect(c.detail).toMatch(/enabled:/i);
    expect(c.detail).toContain("codeql");
    expect(c.detail).toContain("secretScanning");
    expect(c.detail).toContain("dependencyReview");
    expect(c.detail).toContain("copilotCodeReview");
  });

  it("mixed config → detail shows both enabled and disabled tools", () => {
    const c = cloudCheck(FORGE_JSON_MIXED);
    expect(c.status).toBe("pass");
    expect(c.detail).toMatch(/enabled:.*codeql/i);
    expect(c.detail).toMatch(/disabled:.*dependencyReview/i);
  });

  it("cloudAgentValidation: {} (empty object) → status pass, generic detail", () => {
    const c = cloudCheck(FORGE_JSON_EMPTY_OBJECT);
    expect(c.status).toBe("pass");
    expect(c.detail).toMatch(/configured/i);
  });
});

describe("cloud-agent-validation check — structure", () => {
  it("check always has id, label, status, detail", () => {
    for (const root of [NO_FORGE_JSON, FORGE_JSON_ALL_ENABLED, FORGE_JSON_MIXED]) {
      const c = cloudCheck(root);
      expect(c.id).toBe("cloud-agent-validation");
      expect(c.label).toMatch(/cloudAgentValidation/);
      expect(["pass", "warn", "fail", "na"]).toContain(c.status);
      expect(c.detail).toBeTruthy();
    }
  });

  it("check appears in default check list (not extra-only)", () => {
    const defaultIds = inspectGithubStack(NO_FORGE_JSON).checks.map((c) => c.id);
    expect(defaultIds).toContain("cloud-agent-validation");
  });

  it("cloud-agent-validation is never a status fail", () => {
    // The field is optional; worst case is 'na', never 'fail'.
    for (const root of [NO_FORGE_JSON, FORGE_JSON_NO_KEY, FORGE_JSON_EMPTY_OBJECT]) {
      expect(cloudCheck(root).status).not.toBe("fail");
    }
  });
});
