import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoTierForSlice, loadAutoTierConfig } from "../orchestrator/auto-tier.mjs";

describe("loadAutoTierConfig", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-auto-tier-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const write = (routing) => writeFileSync(join(dir, ".forge.json"), JSON.stringify({ routing }));

  it("defaults to complexity-based tiers", () => {
    expect(loadAutoTierConfig(dir)).toBe("complexity");
  });

  it("accepts a fixed tier", () => {
    write({ autoTier: "intelligence" });
    expect(loadAutoTierConfig(dir)).toBe("intelligence");
  });

  it("accepts off", () => {
    write({ autoTier: "off" });
    expect(loadAutoTierConfig(dir)).toBe("off");
  });

  it("falls back to the default for an unknown value or invalid JSON", () => {
    write({ autoTier: "turbo" });
    expect(loadAutoTierConfig(dir)).toBe("complexity");
    writeFileSync(join(dir, ".forge.json"), "{ nope");
    expect(loadAutoTierConfig(dir)).toBe("complexity");
  });
});

describe("autoTierForSlice", () => {
  it("maps slice complexity onto the SDK tiers", () => {
    expect(autoTierForSlice({ complexityScore: 1, config: "complexity" })).toBe("efficiency");
    expect(autoTierForSlice({ complexityScore: 3, config: "complexity" })).toBe("efficiency");
    expect(autoTierForSlice({ complexityScore: 4, config: "complexity" })).toBe("balance");
    expect(autoTierForSlice({ complexityScore: 6, config: "complexity" })).toBe("balance");
    expect(autoTierForSlice({ complexityScore: 7, config: "complexity" })).toBe("intelligence");
    expect(autoTierForSlice({ complexityScore: 10, config: "complexity" })).toBe("intelligence");
  });

  it("uses balance when the slice has no complexity score", () => {
    expect(autoTierForSlice({ complexityScore: undefined, config: "complexity" })).toBe("balance");
  });

  it("returns the fixed tier regardless of complexity", () => {
    expect(autoTierForSlice({ complexityScore: 9, config: "efficiency" })).toBe("efficiency");
  });

  it("returns null when tiers are off", () => {
    expect(autoTierForSlice({ complexityScore: 9, config: "off" })).toBeNull();
  });
});
