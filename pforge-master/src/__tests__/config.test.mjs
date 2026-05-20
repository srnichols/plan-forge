import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { getForgeMasterConfig } from "../config.mjs";

const cleanup = [];

afterEach(() => {
  while (cleanup.length) {
    rmSync(cleanup.pop(), { recursive: true, force: true });
  }
});

function writeConfig(forgeMaster) {
  const dir = mkdtempSync(join(tmpdir(), "forge-master-config-"));
  cleanup.push(dir);
  writeFileSync(join(dir, ".forge.json"), JSON.stringify({ forgeMaster }, null, 2));
  return dir;
}

describe("getForgeMasterConfig", () => {
  it("throws on invalid observer modelTier", () => {
    const cwd = writeConfig({ observer: { modelTier: "slow" } });
    expect(() => getForgeMasterConfig({ cwd })).toThrow(/forgeMaster\.observer\.modelTier/);
  });

  it("throws on invalid auditor modelTier", () => {
    const cwd = writeConfig({ auditor: { modelTier: "slow" } });
    expect(() => getForgeMasterConfig({ cwd })).toThrow(/forgeMaster\.auditor\.modelTier/);
  });

  it("throws on invalid forgeMaster.mode when present", () => {
    const cwd = writeConfig({ mode: "listen" });
    expect(() => getForgeMasterConfig({ cwd })).toThrow(/forgeMaster\.mode/);
  });
});
