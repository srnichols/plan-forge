/**
 * Tests for pforge-mcp/github-introspect.mjs.
 *
 * Verifies all 8 default checks plus the 2 SHOULD-tier extra checks across
 * three programmatically-built fixture trees (green / partial / empty).
 *
 * Fixtures are built in a per-suite tmpdir at runtime — NOT checked in —
 * because git refuses to track paths containing `.git/` (which we need for
 * the github-remote check) and because `.vscode/` is gitignored at the repo
 * root. Building fresh each run also keeps the tests hermetic.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { inspectGithubStack } from "../github-introspect.mjs";

// Fixture builders ──────────────────────────────────────────────────────────
function writeFile(root, relPath, content) {
  const abs = join(root, relPath);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

function buildGreenFixture(root) {
  // copilot-instructions ≥ 50 lines for the depth check
  const longCopilotMd = [
    "# Copilot Instructions (fixture)",
    "",
    "## Project",
    "Test fixture for the green-path scenario.",
    "",
    "## Architecture",
    "Layer: Test fixture.",
    "Purpose: exercise the pass branch of every check.",
    "",
    "## Coding standards",
    "- Be deterministic",
    "- Be small",
    "- Be readable",
    "",
    "## Quick commands",
    "```bash",
    "npm test",
    "```",
    "",
    "## Notes",
    "This file intentionally exceeds 50 lines to satisfy the --extra depth check.",
    "",
    ...Array.from({ length: 35 }, (_, i) => `Line ${i + 1} of padding to clear the depth threshold.`),
  ].join("\n");

  writeFile(root, ".github/copilot-instructions.md", longCopilotMd);
  writeFile(root, "AGENTS.md", "# AGENTS.md\nFixture for green path.\n");
  writeFile(
    root,
    ".github/instructions/architecture.instructions.md",
    "---\napplyTo: \"**\"\n---\n# Architecture instructions (fixture)\nUses applyTo to satisfy the path-scoping check.\n"
  );
  writeFile(
    root,
    ".github/prompts/step0-specify.prompt.md",
    "# Step 0 — Specify (fixture)\n"
  );
  writeFile(
    root,
    ".vscode/mcp.json",
    JSON.stringify(
      { servers: { "plan-forge": { command: "node", args: ["pforge-mcp/server.mjs"] } } },
      null,
      2
    )
  );
  writeFile(
    root,
    ".github/workflows/ci.yml",
    "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n"
  );
  writeFile(
    root,
    ".git/config",
    '[remote "origin"]\n\turl = https://github.com/example-org/green-fixture.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n'
  );
}

function buildPartialFixture(root) {
  // Stub copilot-instructions (under 50 lines) — depth check warns
  writeFile(
    root,
    ".github/copilot-instructions.md",
    "# Stub copilot-instructions\n\nIntentionally short.\n"
  );
  // No AGENTS.md → warn
  // Instructions exist but no applyTo → applyTo check warns
  writeFile(
    root,
    ".github/instructions/architecture.instructions.md",
    "# Architecture (no applyTo)\nFixture without applyTo frontmatter.\n"
  );
  // No prompts/ → warn
  // mcp.json present but no Plan-Forge entry → warn
  writeFile(
    root,
    ".vscode/mcp.json",
    JSON.stringify({ servers: { "some-other-mcp": { command: "node", args: ["other.mjs"] } } }, null, 2)
  );
  // No workflows/ → warn
  // Non-github remote → warn
  writeFile(
    root,
    ".git/config",
    '[remote "origin"]\n\turl = https://gitlab.example.com/example/repo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n'
  );
}

function buildEmptyFixture(root) {
  // Just create the directory; deliberately empty so every default check
  // produces fail / warn / na as appropriate.
  mkdirSync(root, { recursive: true });
}

// Suite-level tmpdir ─────────────────────────────────────────────────────────
let TMP_ROOT;
let GREEN, PARTIAL, EMPTY;

beforeAll(() => {
  TMP_ROOT = resolve(tmpdir(), `pf-github-introspect-${randomUUID()}`);
  GREEN = join(TMP_ROOT, "green");
  PARTIAL = join(TMP_ROOT, "partial");
  EMPTY = join(TMP_ROOT, "empty");
  buildGreenFixture(GREEN);
  buildPartialFixture(PARTIAL);
  buildEmptyFixture(EMPTY);
});

afterAll(() => {
  if (TMP_ROOT) rmSync(TMP_ROOT, { recursive: true, force: true });
});

function findCheck(result, id) {
  return result.checks.find((c) => c.id === id);
}

describe("inspectGithubStack — shape", () => {
  it("returns projectRoot, checks array, and summary object", () => {
    const r = inspectGithubStack(GREEN);
    expect(r.projectRoot).toBe(GREEN);
    expect(Array.isArray(r.checks)).toBe(true);
    expect(r.checks.length).toBeGreaterThanOrEqual(8);
    expect(r.summary).toMatchObject({
      pass: expect.any(Number),
      warn: expect.any(Number),
      fail: expect.any(Number),
      na: expect.any(Number),
      total: expect.any(Number),
    });
    expect(r.summary.total).toBe(r.checks.length);
  });

  it("returns 9 checks by default, 11 with extra:true (Phase GITHUB-A scope)", () => {
    // Default: copilot-instructions, agents-md, instructions-dir, prompts-dir,
    //          vscode-mcp, actions-workflows, github-remote, gh-cli,
    //          copilot-coding-agent-assignable.
    // Extra adds: copilot-instructions-depth, instructions-applyto.
    expect(inspectGithubStack(GREEN).checks).toHaveLength(9);
    expect(inspectGithubStack(GREEN, { extra: true }).checks).toHaveLength(11);
  });

  it("every check row has id, label, status, detail", () => {
    const r = inspectGithubStack(GREEN, { extra: true });
    for (const c of r.checks) {
      expect(c.id).toBeTruthy();
      expect(c.label).toBeTruthy();
      expect(["pass", "warn", "fail", "na"]).toContain(c.status);
      expect(c.detail).toBeTruthy();
    }
  });
});

describe("inspectGithubStack — green fixture (all wired up)", () => {
  it("copilot-instructions present", () => {
    expect(findCheck(inspectGithubStack(GREEN), "copilot-instructions").status).toBe("pass");
  });
  it("AGENTS.md present", () => {
    expect(findCheck(inspectGithubStack(GREEN), "agents-md").status).toBe("pass");
  });
  it("instructions directory has *.instructions.md", () => {
    expect(findCheck(inspectGithubStack(GREEN), "instructions-dir").status).toBe("pass");
  });
  it("prompts directory has *.prompt.md", () => {
    expect(findCheck(inspectGithubStack(GREEN), "prompts-dir").status).toBe("pass");
  });
  it("vscode/mcp.json registers a Plan-Forge entry", () => {
    expect(findCheck(inspectGithubStack(GREEN), "vscode-mcp").status).toBe("pass");
  });
  it("github actions workflows present", () => {
    expect(findCheck(inspectGithubStack(GREEN), "actions-workflows").status).toBe("pass");
  });
  it("github.com remote configured", () => {
    expect(findCheck(inspectGithubStack(GREEN), "github-remote").status).toBe("pass");
  });
  it("copilot-instructions depth >= 50 lines", () => {
    expect(findCheck(inspectGithubStack(GREEN, { extra: true }), "copilot-instructions-depth").status).toBe("pass");
  });
  it("at least one instruction file uses applyTo", () => {
    expect(findCheck(inspectGithubStack(GREEN, { extra: true }), "instructions-applyto").status).toBe("pass");
  });
  // gh-cli is environment-dependent (CI may or may not have it on PATH).
  it("gh-cli check produces a valid status", () => {
    expect(["pass", "warn"]).toContain(findCheck(inspectGithubStack(GREEN), "gh-cli").status);
  });
});

describe("inspectGithubStack — partial fixture (mixed)", () => {
  it("copilot-instructions present (stub)", () => {
    expect(findCheck(inspectGithubStack(PARTIAL), "copilot-instructions").status).toBe("pass");
  });
  it("AGENTS.md missing → warn", () => {
    const c = findCheck(inspectGithubStack(PARTIAL), "agents-md");
    expect(c.status).toBe("warn");
    expect(c.fixHint).toBeTruthy();
  });
  it("instructions directory has files (no applyTo)", () => {
    expect(findCheck(inspectGithubStack(PARTIAL), "instructions-dir").status).toBe("pass");
  });
  it("prompts directory missing → warn", () => {
    const c = findCheck(inspectGithubStack(PARTIAL), "prompts-dir");
    expect(c.status).toBe("warn");
    expect(c.fixHint).toBeTruthy();
  });
  it("vscode/mcp.json present but no Plan-Forge entry → warn", () => {
    const c = findCheck(inspectGithubStack(PARTIAL), "vscode-mcp");
    expect(c.status).toBe("warn");
    expect(c.fixHint).toBeTruthy();
  });
  it("no actions workflows → warn", () => {
    const c = findCheck(inspectGithubStack(PARTIAL), "actions-workflows");
    expect(c.status).toBe("warn");
    expect(c.fixHint).toBeTruthy();
  });
  it("non-github remote → warn", () => {
    const c = findCheck(inspectGithubStack(PARTIAL), "github-remote");
    expect(c.status).toBe("warn");
    expect(c.fixHint).toBeTruthy();
  });
  it("copilot-instructions under 50 lines → warn", () => {
    const c = findCheck(inspectGithubStack(PARTIAL, { extra: true }), "copilot-instructions-depth");
    expect(c.status).toBe("warn");
    expect(c.fixHint).toBeTruthy();
  });
  it("no instruction file uses applyTo → warn", () => {
    const c = findCheck(inspectGithubStack(PARTIAL, { extra: true }), "instructions-applyto");
    expect(c.status).toBe("warn");
    expect(c.fixHint).toBeTruthy();
  });
});

describe("inspectGithubStack — empty fixture (nothing)", () => {
  it("copilot-instructions missing → fail", () => {
    const c = findCheck(inspectGithubStack(EMPTY), "copilot-instructions");
    expect(c.status).toBe("fail");
    expect(c.fixHint).toBeTruthy();
  });
  it("AGENTS.md missing → warn", () => {
    expect(findCheck(inspectGithubStack(EMPTY), "agents-md").status).toBe("warn");
  });
  it("instructions directory missing → fail", () => {
    const c = findCheck(inspectGithubStack(EMPTY), "instructions-dir");
    expect(c.status).toBe("fail");
    expect(c.fixHint).toBeTruthy();
  });
  it("prompts directory missing → warn", () => {
    expect(findCheck(inspectGithubStack(EMPTY), "prompts-dir").status).toBe("warn");
  });
  it("vscode/mcp.json missing → warn", () => {
    expect(findCheck(inspectGithubStack(EMPTY), "vscode-mcp").status).toBe("warn");
  });
  it("actions workflows missing → warn", () => {
    expect(findCheck(inspectGithubStack(EMPTY), "actions-workflows").status).toBe("warn");
  });
  it("no .git → na (not applicable)", () => {
    const c = findCheck(inspectGithubStack(EMPTY), "github-remote");
    expect(c.status).toBe("na");
    expect(c.fixHint).toBeUndefined();
  });
  it("copilot-instructions-depth → na when file absent", () => {
    expect(findCheck(inspectGithubStack(EMPTY, { extra: true }), "copilot-instructions-depth").status).toBe("na");
  });
  it("instructions-applyto → na when directory absent", () => {
    expect(findCheck(inspectGithubStack(EMPTY, { extra: true }), "instructions-applyto").status).toBe("na");
  });
  it("summary reports at least one fail", () => {
    expect(inspectGithubStack(EMPTY).summary.fail).toBeGreaterThan(0);
  });
});

describe("inspectGithubStack — summary math", () => {
  it("pass + warn + fail + na = total", () => {
    for (const fixture of [GREEN, PARTIAL, EMPTY]) {
      const r = inspectGithubStack(fixture, { extra: true });
      expect(r.summary.pass + r.summary.warn + r.summary.fail + r.summary.na).toBe(
        r.summary.total
      );
      expect(r.summary.total).toBe(r.checks.length);
    }
  });
});

describe("inspectGithubStack — check ordering is stable", () => {
  it("default checks come in the same order across fixtures", () => {
    const ids = (root) => inspectGithubStack(root).checks.map((c) => c.id);
    expect(ids(GREEN)).toEqual(ids(PARTIAL));
    expect(ids(GREEN)).toEqual(ids(EMPTY));
  });
});
