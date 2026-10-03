import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkInstallConsistency, runCli } from "../install-consistency.mjs";

const dirs = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function project({ template, mcp, master }) {
  const dir = mkdtempSync(join(tmpdir(), "pf-install-consistency-"));
  dirs.push(dir);
  if (template) writeFileSync(join(dir, ".forge.json"), JSON.stringify({ templateVersion: template }));
  for (const [pkg, version] of [["pforge-mcp", mcp], ["pforge-master", master]]) {
    if (!version) continue;
    mkdirSync(join(dir, pkg), { recursive: true });
    writeFileSync(join(dir, pkg, "package.json"), JSON.stringify({ name: pkg, version }));
  }
  return dir;
}

describe("checkInstallConsistency", () => {
  it("reports the installed Plan Forge version from pforge-mcp", () => {
    const r = checkInstallConsistency(project({ template: "3.31.1", mcp: "3.31.1", master: "3.31.1" }));
    expect(r).toMatchObject({ frameworkVersion: "3.31.1", issues: [] });
  });

  it("flags a package an older update left behind", () => {
    // What a 3.29 wrapper's self-update to 3.31.1 left: pforge-master at 3.29.
    const r = checkInstallConsistency(project({ template: "3.31.1", mcp: "3.31.1", master: "3.29.0-dev" }));
    expect(r.issues).toEqual([expect.objectContaining({ code: "PACKAGES_DISAGREE", fix: expect.stringMatching(/pforge update/) })]);
    expect(r.issues[0].message).toMatch(/pforge-master is v3\.29\.0-dev.*pforge-mcp is v3\.31\.1/);
  });

  it("flags .forge.json disagreeing with the installed packages", () => {
    const r = checkInstallConsistency(project({ template: "3.29.0-dev", mcp: "3.31.1", master: "3.31.1" }));
    expect(r.issues.map((i) => i.code)).toEqual(["TEMPLATE_VERSION_MISMATCH"]);
  });

  it("does not complain about a package that is not installed", () => {
    expect(checkInstallConsistency(project({ template: "3.31.1", mcp: "3.31.1" })).issues).toEqual([]);
  });

  it("says so when Plan Forge is not installed", () => {
    const r = checkInstallConsistency(project({}));
    expect(r.frameworkVersion).toBeNull();
    expect(r.message).toMatch(/not installed/);
  });

  it("prints JSON from the CLI", () => {
    const out = [];
    const code = runCli(["--project", project({ template: "3.31.1", mcp: "3.31.1", master: "3.31.1" })], { stdout: { write: (s) => out.push(s) } });
    expect(code).toBe(0);
    expect(JSON.parse(out.join(""))).toMatchObject({ frameworkVersion: "3.31.1" });
  });
});
