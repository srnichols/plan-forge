/**
 * parseSkill step detection (#301 follow-up).
 *
 * `forge_run_skill` executes the steps parseSkill finds. Seven shipped
 * security-audit skills (`## Phase N: …`) and azure-sweep (`### Step N — …`)
 * parsed to zero steps, so running them did nothing.
 */

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseSkill } from "../skill-runner.mjs";

const dir = mkdtempSync(join(tmpdir(), "pf-skill-parse-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
function skill(body) {
  const file = join(dir, `SKILL-${++n}.md`);
  writeFileSync(file, `---\nname: demo\ndescription: demo skill\n---\n\n# Demo\n\n${body}`);
  return parseSkill(file);
}

const SAFETY = "## Safety Rules\n\n- Never push\n- Never delete\n";

describe("parseSkill — step headings", () => {
  it("reads numbered ### steps", () => {
    const s = skill(`## Steps\n\n### 1. Discover\n\nrun a\n\n### 2. Report\n\nrun b\n\n${SAFETY}`);
    expect(s.steps.map((x) => [x.number, x.name])).toEqual([[1, "Discover"], [2, "Report"]]);
    expect(s.safetyRules).toEqual(["Never push", "Never delete"]);
  });

  it("reads ## Phase N: steps, keeping their ### subsections inside the phase", () => {
    const s = skill(`## Trigger\n\nask\n\n## Phase 1: OWASP Scan\n\n### A1: Access Control\n\ncheck\n\n## Phase 2: Dependency Audit\n\naudit\n\n${SAFETY}`);
    expect(s.steps.map((x) => [x.number, x.name])).toEqual([[1, "OWASP Scan"], [2, "Dependency Audit"]]);
    expect(s.steps[0].rawLines.join("\n")).toContain("### A1: Access Control");
  });

  it("reads ### Step N — steps", () => {
    const s = skill("## Steps\n\n### Step 0 — Scope & Setup\n\nset\n\n### Step 1 — WAF Layer\n\nscan\n");
    expect(s.steps.map((x) => [x.number, x.name])).toEqual([[0, "Scope & Setup"], [1, "WAF Layer"]]);
  });

  it("ends the last step at the next ## section", () => {
    const s = skill(`## Phase 1: Scan\n\nscan\n\n${SAFETY}\n## Temper Guards\n\n| a | b |\n`);
    const body = s.steps[0].rawLines.join("\n");
    expect(body).toContain("scan");
    expect(body).not.toContain("Safety Rules");
    expect(body).not.toContain("Temper Guards");
  });

  it("does not run a later section's commands as part of the last step", () => {
    // azure-iac infra-deploy ran its ## Rollback block (git revert HEAD, terraform apply) after "Verify".
    const s = skill("## Steps\n\n### 1. Verify\n\n```bash\naz deployment show\n```\n\n## Rollback\n\n```bash\ngit revert HEAD\nterraform apply\n```\n");
    const body = s.steps[0].rawLines.join("\n");
    expect(body).toContain("az deployment show");
    expect(body).not.toContain("git revert HEAD");
  });

  it("ignores step-like headings inside code blocks", () => {
    const s = skill("## Steps\n\n### 1. Run\n\n```md\n### 2. Not a step\n## Phase 3: Not a phase\n```\n");
    expect(s.steps).toHaveLength(1);
    expect(s.steps[0].rawLines.join("\n")).toContain("### 2. Not a step");
  });
});

describe("shipped skills", () => {
  const REPO = resolve(import.meta.dirname, "..", "..");
  const walk = (d) => (!existsSync(d) ? [] : readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(join(d, e.name));
    return e.name === "SKILL.md" ? [join(d, e.name)] : [];
  }));
  const files = [".github/skills", "templates", "presets", "extensions"].flatMap((d) => walk(join(REPO, d)));

  it.skipIf(files.length === 0)("every SKILL.md has steps forge_run_skill can execute", () => {
    const empty = files.filter((f) => parseSkill(f).steps.length === 0).map((f) => f.slice(REPO.length + 1).replace(/\\/g, "/"));
    expect(empty).toEqual([]);
  });
});
