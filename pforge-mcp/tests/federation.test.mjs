/**
 * Plan Forge — Phase-25 Slice 6 (Cross-project memory federation) tests
 *
 * Covers validateFederationRepo(), loadFederationConfig(),
 * validateFederationConfig(), and federationRead() integration into
 * brain.recall() for cross.* keys.
 *
 * D9 contract: absolute local paths only; URLs + relative paths rejected.
 * D9 posture: opt-in via brain.federation.enabled === true.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  validateFederationRepo,
  loadFederationConfig,
  validateFederationConfig,
  federationRead,
  recall,
} from "../brain.mjs";

function seedFederatedRepo({ repoRoot, entity, id, value }) {
  const brainDir = resolve(repoRoot, ".forge", "brain", entity);
  mkdirSync(brainDir, { recursive: true });
  const fileName = id ? `${id}.json` : "state.json";
  writeFileSync(resolve(brainDir, fileName), JSON.stringify(value, null, 2), "utf-8");
}

function writeForgeConfig(cwd, block) {
  writeFileSync(resolve(cwd, ".forge.json"), JSON.stringify(block, null, 2), "utf-8");
}

describe("validateFederationRepo (D9 contract)", () => {
  it("accepts POSIX absolute paths", () => {
    expect(validateFederationRepo("/var/data/forge-a").ok).toBe(true);
  });
  it("accepts Windows absolute paths", () => {
    expect(validateFederationRepo("C:\\Users\\me\\repo").ok).toBe(true);
    expect(validateFederationRepo("E:/repos/forge-b").ok).toBe(true);
  });
  it("rejects relative paths", () => {
    const r = validateFederationRepo("./sibling-repo");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/absolute/i);
  });
  it("rejects URL-style repos", () => {
    expect(validateFederationRepo("https://github.com/x/y").ok).toBe(false);
    expect(validateFederationRepo("ssh://git@host/x.git").ok).toBe(false);
    expect(validateFederationRepo("git://host/x.git").ok).toBe(false);
  });
  it("rejects paths with ..", () => {
    expect(validateFederationRepo("/var/../etc").ok).toBe(false);
  });
  it("rejects empty / non-string", () => {
    expect(validateFederationRepo("").ok).toBe(false);
    expect(validateFederationRepo(null).ok).toBe(false);
    expect(validateFederationRepo(undefined).ok).toBe(false);
  });
});

describe("loadFederationConfig", () => {
  let cwd;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "pforge-fed-")); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("defaults to disabled + empty repos when .forge.json is absent", () => {
    expect(loadFederationConfig(cwd)).toEqual({ enabled: false, repos: [] });
  });
  it("parses brain.federation block from .forge.json", () => {
    writeForgeConfig(cwd, { brain: { federation: { enabled: true, repos: ["/a", "/b"] } } });
    expect(loadFederationConfig(cwd)).toEqual({ enabled: true, repos: ["/a", "/b"] });
  });
  it("coerces missing booleans to enabled=false (opt-in invariant)", () => {
    writeForgeConfig(cwd, { brain: { federation: { repos: ["/a"] } } });
    expect(loadFederationConfig(cwd).enabled).toBe(false);
  });
  it("filters non-string repo entries", () => {
    writeForgeConfig(cwd, { brain: { federation: { enabled: true, repos: ["/a", 42, null, "/b"] } } });
    expect(loadFederationConfig(cwd).repos).toEqual(["/a", "/b"]);
  });
});

describe("validateFederationConfig", () => {
  let cwd;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "pforge-fed-")); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("returns [] when federation is disabled", () => {
    writeForgeConfig(cwd, { brain: { federation: { enabled: false, repos: ["./bad"] } } });
    expect(validateFederationConfig(cwd)).toEqual([]);
  });
  it("returns error list when enabled but entries are invalid", () => {
    writeForgeConfig(cwd, { brain: { federation: { enabled: true, repos: ["./bad", "https://x.com"] } } });
    const out = validateFederationConfig(cwd);
    expect(out).toHaveLength(2);
    expect(out[0].repo).toBe("./bad");
    expect(out[1].repo).toBe("https://x.com");
  });
  it("returns [] when enabled and all entries pass", () => {
    writeForgeConfig(cwd, { brain: { federation: { enabled: true, repos: ["/var/a"] } } });
    expect(validateFederationConfig(cwd)).toEqual([]);
  });
});

describe("federationRead", () => {
  let cwd, repoA, repoB;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "pforge-fed-"));
    repoA = mkdtempSync(join(tmpdir(), "pforge-repoA-"));
    repoB = mkdtempSync(join(tmpdir(), "pforge-repoB-"));
  });
  afterEach(() => {
    for (const d of [cwd, repoA, repoB]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("returns [] when federation is disabled", () => {
    seedFederatedRepo({ repoRoot: repoA, entity: "skill", id: "deploy-v1", value: { ok: true } });
    writeForgeConfig(cwd, { brain: { federation: { enabled: false, repos: [repoA] } } });
    expect(federationRead("cross.skill.deploy-v1", { cwd })).toEqual([]);
  });

  it("returns hits from each repo that holds the key when enabled", () => {
    seedFederatedRepo({ repoRoot: repoA, entity: "skill", id: "deploy-v1", value: { from: "A" } });
    seedFederatedRepo({ repoRoot: repoB, entity: "skill", id: "deploy-v1", value: { from: "B" } });
    writeForgeConfig(cwd, { brain: { federation: { enabled: true, repos: [repoA, repoB] } } });
    const hits = federationRead("cross.skill.deploy-v1", { cwd });
    expect(hits).toHaveLength(2);
    expect(hits[0].value).toEqual({ from: "A" });
    expect(hits[1].value).toEqual({ from: "B" });
  });

  it("skips repos that pass validation but do not hold the key", () => {
    seedFederatedRepo({ repoRoot: repoA, entity: "skill", id: "deploy-v1", value: { from: "A" } });
    writeForgeConfig(cwd, { brain: { federation: { enabled: true, repos: [repoA, repoB] } } });
    const hits = federationRead("cross.skill.deploy-v1", { cwd });
    expect(hits).toHaveLength(1);
    expect(hits[0].repo).toBe(repoA);
  });

  it("silently skips invalid repo entries (relative + URL)", () => {
    seedFederatedRepo({ repoRoot: repoA, entity: "skill", id: "deploy-v1", value: { from: "A" } });
    writeForgeConfig(cwd, { brain: { federation: { enabled: true, repos: ["./nope", "https://x.com", repoA] } } });
    const hits = federationRead("cross.skill.deploy-v1", { cwd });
    expect(hits).toHaveLength(1);
    expect(hits[0].repo).toBe(repoA);
  });

  it("returns [] for non-cross scopes", () => {
    seedFederatedRepo({ repoRoot: repoA, entity: "skill", id: "deploy-v1", value: { from: "A" } });
    writeForgeConfig(cwd, { brain: { federation: { enabled: true, repos: [repoA] } } });
    expect(federationRead("project.bug.BUG-1", { cwd })).toEqual([]);
  });

  it("supports keys without an id (reads state.json)", () => {
    seedFederatedRepo({ repoRoot: repoA, entity: "ops", id: null, value: { state: "ok" } });
    writeForgeConfig(cwd, { brain: { federation: { enabled: true, repos: [repoA] } } });
    const hits = federationRead("cross.ops", { cwd });
    expect(hits).toHaveLength(1);
    expect(hits[0].value).toEqual({ state: "ok" });
  });

  it("tolerates malformed JSON (skips, no throw)", () => {
    const brainDir = resolve(repoA, ".forge", "brain", "skill");
    mkdirSync(brainDir, { recursive: true });
    writeFileSync(resolve(brainDir, "deploy-v1.json"), "not json {{{", "utf-8");
    writeForgeConfig(cwd, { brain: { federation: { enabled: true, repos: [repoA] } } });
    expect(federationRead("cross.skill.deploy-v1", { cwd })).toEqual([]);
  });
});

describe("brain.recall — federation integration (cross.* path)", () => {
  let cwd, repoA;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "pforge-fed-"));
    repoA = mkdtempSync(join(tmpdir(), "pforge-repoA-"));
  });
  afterEach(() => {
    for (const d of [cwd, repoA]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("returns federated value for cross.* key when L3 is unavailable and federation is enabled", async () => {
    seedFederatedRepo({ repoRoot: repoA, entity: "skill", id: "deploy-v1", value: { from: "A" } });
    writeForgeConfig(cwd, { brain: { federation: { enabled: true, repos: [repoA] } } });
    const out = await recall("cross.skill.deploy-v1", {}, { cwd });
    expect(out).toEqual({ from: "A" });
  });

  it("returns null when federation is disabled and L3 is unavailable", async () => {
    seedFederatedRepo({ repoRoot: repoA, entity: "skill", id: "deploy-v1", value: { from: "A" } });
    writeForgeConfig(cwd, { brain: { federation: { enabled: false, repos: [repoA] } } });
    const out = await recall("cross.skill.deploy-v1", {}, { cwd });
    expect(out).toBeNull();
  });

  it("federation does not affect project.* or session.* keys", async () => {
    seedFederatedRepo({ repoRoot: repoA, entity: "skill", id: "deploy-v1", value: { from: "A" } });
    writeForgeConfig(cwd, { brain: { federation: { enabled: true, repos: [repoA] } } });
    const out = await recall("project.skill.deploy-v1", {}, { cwd });
    // project scope never consults federation
    expect(out).toBeNull();
  });
});
