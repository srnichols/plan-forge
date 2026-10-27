import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { optionalGuidanceUnavailable } from "./helpers/optional-guidance.mjs";

const projects = [];
afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true });
});

function fixture({ preset, assetPresent = false, framework = false } = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), "pf-optional-guidance-"));
  projects.push(projectRoot);
  if (preset) writeFileSync(join(projectRoot, ".forge.json"), JSON.stringify({ preset }));
  if (framework) {
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({
      name: "plan-forge", workspaces: ["pforge-mcp"],
    }));
  }
  const assetPath = join(projectRoot, ".github", "hooks", "PreCommit.mjs");
  if (assetPresent) {
    mkdirSync(join(projectRoot, ".github", "hooks"), { recursive: true });
    writeFileSync(assetPath, "export {};\n");
  }
  return { assetPath, projectRoot };
}

describe("optional installed guidance", () => {
  it("permits absent guidance only for a declared installed custom preset", () => {
    const { assetPath, projectRoot } = fixture({ preset: "custom" });
    expect(optionalGuidanceUnavailable(assetPath, { projectRoot })).toBe(true);
  });

  it.each(["typescript", "dotnet", "custom"])("still exercises present guidance for %s", (preset) => {
    const { assetPath, projectRoot } = fixture({ preset, assetPresent: true });
    expect(optionalGuidanceUnavailable(assetPath, { projectRoot })).toBe(false);
  });

  it.each(["typescript", "dotnet", undefined])("does not hide missing required guidance for %s", (preset) => {
    const { assetPath, projectRoot } = fixture({ preset });
    expect(optionalGuidanceUnavailable(assetPath, { projectRoot })).toBe(false);
  });

  it("never hides a missing source-repository asset behind its preset", () => {
    const { assetPath, projectRoot } = fixture({ preset: "custom", framework: true });
    expect(optionalGuidanceUnavailable(assetPath, { projectRoot })).toBe(false);
  });

  it("never excuses an absent required core runbook in an installed custom preset", () => {
    const { projectRoot } = fixture({ preset: "custom" });
    const runbook = join(projectRoot, "docs", "plans", "AI-Plan-Hardening-Runbook-Instructions.md");
    expect(optionalGuidanceUnavailable(runbook, { projectRoot })).toBe(false);
  });

  it("does not treat a broken installed asset link as an intentional omission", () => {
    const { assetPath, projectRoot } = fixture({ preset: "custom" });
    const target = join(projectRoot, "link-target");
    mkdirSync(target);
    mkdirSync(join(projectRoot, ".github", "hooks"), { recursive: true });
    symlinkSync(target, assetPath, process.platform === "win32" ? "junction" : "dir");
    rmSync(target, { recursive: true });
    expect(optionalGuidanceUnavailable(assetPath, { projectRoot })).toBe(false);
  });

  it("fails explicitly when a guidance ancestor link is broken", () => {
    const { assetPath, projectRoot } = fixture({ preset: "custom" });
    const target = join(projectRoot, "link-target");
    mkdirSync(target);
    symlinkSync(target, join(projectRoot, ".github"), process.platform === "win32" ? "junction" : "dir");
    rmSync(target, { recursive: true });
    expect(() => optionalGuidanceUnavailable(assetPath, { projectRoot }))
      .toThrowError(expect.objectContaining({ code: "ENOENT" }));
  });

  it("fails explicitly on invalid project configuration", () => {
    const { assetPath, projectRoot } = fixture({ preset: "custom" });
    writeFileSync(join(projectRoot, ".forge.json"), "{");
    expect(() => optionalGuidanceUnavailable(assetPath, { projectRoot })).toThrow(SyntaxError);
  });
});
