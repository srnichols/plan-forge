import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AUDIT_ROOTS, AUDIT_EXEMPTIONS, auditGlobs, auditRoots } from "../../scripts/audit/scan-roots.mjs";

/**
 * Meta-bug #382 — the clean-code audit scripts each carried their own list of
 * the directories to scan. The copies disagreed, and pforge-sdk (an npm
 * workspace) was missing from all of them but dep-boundaries, so the package got
 * no complexity, size, duplication, TODO or test-smell coverage.
 *
 * The lists now live in scripts/audit/scan-roots.mjs. A workspace package is
 * either scanned by each script or exempted from it with a reason, so adding a
 * package forces a decision instead of leaving a silent gap.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const AUDIT_DIR = join(REPO_ROOT, "scripts", "audit");
const WORKSPACES = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).workspaces;
const SCRIPTS = Object.keys(AUDIT_ROOTS);

const scans = (roots, pkg) => roots.some((root) => root === pkg || root.startsWith(`${pkg}/`));
const read = (name) => readFileSync(join(AUDIT_DIR, name), "utf8");

describe("audit scan roots cover every workspace package (#382)", () => {
  it("the repository has workspace packages to check", () => {
    expect(WORKSPACES).toEqual(expect.arrayContaining(["pforge-mcp", "pforge-master", "pforge-sdk"]));
  });

  it.each(SCRIPTS)("%s scans each workspace package or exempts it with a reason", (script) => {
    for (const pkg of WORKSPACES) {
      const scanned = scans(AUDIT_ROOTS[script], pkg);
      const reason = AUDIT_EXEMPTIONS[script]?.[pkg];
      const hint = `Add ${pkg} to AUDIT_ROOTS["${script}"], or explain in AUDIT_EXEMPTIONS["${script}"]["${pkg}"] why the script skips it.`;
      expect(scanned || Boolean(reason), `${script} neither scans nor exempts ${pkg}. ${hint}`).toBe(true);
      expect(scanned && Boolean(reason), `${script} scans ${pkg} and also exempts it; drop the exemption`).toBe(false);
    }
  });

  it("every exemption names a configured script and a workspace package, with a reason", () => {
    for (const [script, packages] of Object.entries(AUDIT_EXEMPTIONS)) {
      expect(SCRIPTS, `AUDIT_EXEMPTIONS names "${script}", which has no AUDIT_ROOTS entry`).toContain(script);
      for (const [pkg, reason] of Object.entries(packages)) {
        expect(WORKSPACES, `AUDIT_EXEMPTIONS["${script}"] names "${pkg}", which is not a workspace package`).toContain(pkg);
        expect(String(reason).trim().length, `the "${script}" exemption for ${pkg} has no reason`).toBeGreaterThan(20);
      }
    }
  });
});

describe("audit scripts read their roots from scan-roots.mjs (#382)", () => {
  it.each(SCRIPTS)("%s.mjs takes its roots from the shared table", (script) => {
    const source = read(`${script}.mjs`);
    expect(source).toMatch(/from '\.\/scan-roots\.mjs'/);
    expect(source).toMatch(new RegExp(`audit(?:Roots|Globs)\\('${script}'\\)`));
  });

  it("the ESLint clean-code config applies its rules to the same roots as the wrapper that runs it", () => {
    const config = read("eslint-clean-code.config.mjs");
    expect(config).toMatch(/from '\.\/scan-roots\.mjs'/);
    expect(config).toMatch(/auditGlobs\('run-eslint-clean-code'\)/);
  });

  it("returns directories and .mjs globs for a script, and refuses an unknown one", () => {
    expect(auditRoots("run-jscpd")).toEqual([...AUDIT_ROOTS["run-jscpd"]]);
    expect(auditGlobs("run-jscpd")).toEqual(AUDIT_ROOTS["run-jscpd"].map((root) => `${root}/**/*.mjs`));
    expect(() => auditRoots("no-such-script")).toThrow(/no roots for audit script "no-such-script"/);
  });

  it("hands out copies, so a caller cannot change the table", () => {
    auditRoots("run-jscpd").push("elsewhere");
    expect(auditRoots("run-jscpd")).not.toContain("elsewhere");
    expect(Object.isFrozen(AUDIT_ROOTS)).toBe(true);
  });
});
