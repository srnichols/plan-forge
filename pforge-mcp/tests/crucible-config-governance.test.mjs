/**
 * Plan Forge — Crucible Config + Governance tests (Slice 01.6).
 *
 * Covers:
 *   - crucible-config.mjs  (sanitize, load defaults, save, weight normalization)
 *   - /api/crucible/config GET + POST  (shape contract + sanitize pass-through)
 *   - /api/crucible/manual-imports      (shape contract, capped at 500)
 *   - /api/crucible/governance          (read-only, returns content + mtime)
 *   - computeStaleDefaultsWarnings       (triggers when principles newer than smelt)
 *   - handleFinalize emits hardener handoff event + payload
 */

import { afterAll, beforeAll, describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  DEFAULT_CRUCIBLE_CONFIG,
  configPath,
  loadCrucibleConfig,
  saveCrucibleConfig,
  sanitize,
} from "../crucible-config.mjs";
import { computeStaleDefaultsWarnings, handleFinalize } from "../crucible-server.mjs";
import { createSmelt, updateSmelt } from "../crucible-store.mjs";
import { createExpressApp } from "../server.mjs";

// ─── sanitize() ─────────────────────────────────────────────────────

describe("crucible-config sanitize", () => {
  it("returns defaults for null / non-object input", () => {
    expect(sanitize(null)).toEqual(DEFAULT_CRUCIBLE_CONFIG);
    expect(sanitize(undefined)).toEqual(DEFAULT_CRUCIBLE_CONFIG);
    expect(sanitize(42)).toEqual(DEFAULT_CRUCIBLE_CONFIG);
  });
  it("drops unknown fields", () => {
    const out = sanitize({ defaultLane: "tweak", mystery: 99 });
    expect(out.defaultLane).toBe("tweak");
    expect(out).not.toHaveProperty("mystery");
  });
  it("rejects invalid lane and falls back to default", () => {
    const out = sanitize({ defaultLane: "giant" });
    expect(out.defaultLane).toBe(DEFAULT_CRUCIBLE_CONFIG.defaultLane);
  });
  it("clamps recursionDepth to 0..3", () => {
    expect(sanitize({ recursionDepth: -5 }).recursionDepth).toBe(0);
    expect(sanitize({ recursionDepth: 99 }).recursionDepth).toBe(3);
    expect(sanitize({ recursionDepth: 2.7 }).recursionDepth).toBe(2);
  });
  it("clamps staleDefaultsHours to 1..168", () => {
    expect(sanitize({ staleDefaultsHours: 0 }).staleDefaultsHours).toBe(1);
    expect(sanitize({ staleDefaultsHours: 500 }).staleDefaultsHours).toBe(168);
  });
  it("coerces autoApproveAgent only if boolean", () => {
    expect(sanitize({ autoApproveAgent: true }).autoApproveAgent).toBe(true);
    expect(sanitize({ autoApproveAgent: "yes" }).autoApproveAgent).toBe(DEFAULT_CRUCIBLE_CONFIG.autoApproveAgent);
  });
  it("normalizes source weights to sum exactly 100", () => {
    const out = sanitize({ sourceWeights: { memory: 10, principles: 10, plans: 10 } });
    const sum = out.sourceWeights.memory + out.sourceWeights.principles + out.sourceWeights.plans;
    expect(sum).toBe(100);
  });
  it("handles lopsided weights", () => {
    const out = sanitize({ sourceWeights: { memory: 80, principles: 10, plans: 10 } });
    expect(out.sourceWeights.memory).toBeGreaterThan(60);
    const sum = out.sourceWeights.memory + out.sourceWeights.principles + out.sourceWeights.plans;
    expect(sum).toBe(100);
  });
  it("leaves default weights alone when all zero", () => {
    const out = sanitize({ sourceWeights: { memory: 0, principles: 0, plans: 0 } });
    expect(out.sourceWeights).toEqual(DEFAULT_CRUCIBLE_CONFIG.sourceWeights);
  });
});

// ─── load/save round-trip ──────────────────────────────────────────

describe("crucible-config load/save", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pforge-cfg-")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("returns defaults when file does not exist", () => {
    const cfg = loadCrucibleConfig(dir);
    expect(cfg.defaultLane).toBe(DEFAULT_CRUCIBLE_CONFIG.defaultLane);
  });
  it("returns defaults when file is malformed JSON", () => {
    mkdirSync(resolve(dir, ".forge", "crucible"), { recursive: true });
    writeFileSync(configPath(dir), "not json", "utf-8");
    const cfg = loadCrucibleConfig(dir);
    expect(cfg.defaultLane).toBe(DEFAULT_CRUCIBLE_CONFIG.defaultLane);
  });
  it("persists after save and loads back", () => {
    saveCrucibleConfig(dir, { defaultLane: "full", recursionDepth: 2 });
    const loaded = loadCrucibleConfig(dir);
    expect(loaded.defaultLane).toBe("full");
    expect(loaded.recursionDepth).toBe(2);
  });
  it("patch-merges without losing other fields", () => {
    saveCrucibleConfig(dir, { defaultLane: "full" });
    saveCrucibleConfig(dir, { recursionDepth: 3 });
    const loaded = loadCrucibleConfig(dir);
    expect(loaded.defaultLane).toBe("full");
    expect(loaded.recursionDepth).toBe(3);
  });
});

// ─── HTTP endpoints ────────────────────────────────────────────────

let server;
let baseUrl;
beforeAll(async () => {
  const app = createExpressApp();
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});
afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

describe("/api/crucible/config", () => {
  it("GET returns a config with all known fields", async () => {
    const res = await fetch(`${baseUrl}/api/crucible/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("defaultLane");
    expect(body).toHaveProperty("recursionDepth");
    expect(body).toHaveProperty("sourceWeights");
    expect(body.sourceWeights).toHaveProperty("memory");
  });
  it("POST rejects a non-object body", async () => {
    const res = await fetch(`${baseUrl}/api/crucible/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify("not an object"),
    });
    expect(res.status).toBe(400);
  });
  it("POST sanitizes invalid values and returns normalized config", async () => {
    const res = await fetch(`${baseUrl}/api/crucible/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultLane: "giant", recursionDepth: 99 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(["tweak", "feature", "full"]).toContain(body.defaultLane);
    expect(body.recursionDepth).toBeLessThanOrEqual(3);
  });
});

describe("/api/crucible/manual-imports", () => {
  it("returns a JSON envelope with total/showing/entries", async () => {
    const res = await fetch(`${baseUrl}/api/crucible/manual-imports`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("showing");
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.showing).toBeLessThanOrEqual(500);
  });
});

describe("/api/crucible/governance", () => {
  it("returns files array + readOnly flag", async () => {
    const res = await fetch(`${baseUrl}/api/crucible/governance`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("files");
    expect(Array.isArray(body.files)).toBe(true);
    expect(body.readOnly).toBe(true);
    // Each file (if any) carries content + mtime + absolutePath
    for (const f of body.files) {
      expect(f).toHaveProperty("content");
      expect(f).toHaveProperty("mtime");
      expect(f).toHaveProperty("absolutePath");
      expect(f).toHaveProperty("role");
    }
  });
});

// ─── computeStaleDefaultsWarnings ───────────────────────────────────

describe("computeStaleDefaultsWarnings", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pforge-stale-"));
    mkdirSync(resolve(dir, "docs", "plans"), { recursive: true });
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("returns empty when no principles file exists", () => {
    const smelt = { updatedAt: new Date().toISOString() };
    expect(computeStaleDefaultsWarnings(smelt, dir)).toEqual([]);
  });

  it("fires when principles file is much newer than smelt", () => {
    const principlesPath = resolve(dir, "docs", "plans", "PROJECT-PRINCIPLES.md");
    writeFileSync(principlesPath, "# Principles\n", "utf-8");
    // Force mtime to now + 48h (future) vs smelt = now
    const future = (Date.now() + 48 * 60 * 60 * 1000) / 1000;
    utimesSync(principlesPath, future, future);
    const smelt = { updatedAt: new Date().toISOString() };
    const warnings = computeStaleDefaultsWarnings(smelt, dir);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0].code).toBe("STALE_PRINCIPLES");
  });

  it("stays quiet when principles are newer but still within threshold", () => {
    const principlesPath = resolve(dir, "docs", "plans", "PROJECT-PRINCIPLES.md");
    writeFileSync(principlesPath, "# Principles\n", "utf-8");
    // 1 hour newer, threshold default 24h
    const soon = (Date.now() + 60 * 60 * 1000) / 1000;
    utimesSync(principlesPath, soon, soon);
    const smelt = { updatedAt: new Date().toISOString() };
    expect(computeStaleDefaultsWarnings(smelt, dir)).toEqual([]);
  });

  it("tolerates invalid smelt.updatedAt", () => {
    expect(computeStaleDefaultsWarnings({ updatedAt: "nope" }, dir)).toEqual([]);
    expect(computeStaleDefaultsWarnings({}, dir)).toEqual([]);
  });
});

// ─── Hardener handoff ───────────────────────────────────────────────

describe("handleFinalize Hardener handoff", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pforge-handoff-"));
    mkdirSync(resolve(dir, "docs", "plans"), { recursive: true });
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("emits crucible-handoff-to-hardener alongside crucible-smelt-finalized", () => {
    const smelt = createSmelt({
      lane: "tweak",
      rawIdea: "bump a dependency version",
      source: "human",
      projectDir: dir,
    });
    // Issue #135 \u2014 finalize refuses smelts missing CRITICAL_FIELDS
    // (scope-files, validation-gates, forbidden-actions). Provide answers
    // covering all four tweak questions so finalize reaches the handoff.
    const now = new Date().toISOString();
    updateSmelt(smelt.id, {
      answers: [
        { questionId: "scope-file", answer: "package.json", recordedAt: now },
        { questionId: "validation", answer: "npm test", recordedAt: now },
        { questionId: "forbidden-actions", answer: "no schema changes", recordedAt: now },
        { questionId: "rollback", answer: "git revert HEAD", recordedAt: now },
      ],
    }, dir);

    const events = [];
    const fakeHub = { broadcast: (e) => events.push(e) };
    const result = handleFinalize({ id: smelt.id, projectDir: dir, hub: fakeHub });

    expect(result).toHaveProperty("phaseName");
    expect(result).toHaveProperty("planPath");
    expect(result.hardenerHandoff).toMatchObject({
      event: "crucible-handoff-to-hardener",
      nextStep: "step2-harden-plan.prompt.md",
    });
    const types = events.map((e) => e.type);
    expect(types).toContain("crucible-smelt-finalized");
    expect(types).toContain("crucible-handoff-to-hardener");
    const handoff = events.find((e) => e.type === "crucible-handoff-to-hardener");
    expect(handoff.data.phaseName).toBe(result.phaseName);
    expect(handoff.data.planPath).toBe(result.planPath);
  });
});
