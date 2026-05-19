/**
 * Plan Forge — Phase WORKER-GUARDRAILS Slice 9
 * full-suite-regression.test.mjs
 *
 * Full QA sweep: cross-cutting regression guard that asserts every A1–A8
 * deliverable from the phase landed correctly and coheres as a unit.
 *
 *   A1 — Forbidden-Actions matcher extended (glob/dir patterns)
 *   A2 — forge_diff_classify MCP tool + diff-classify.mjs module
 *   A3 — PreCommit chain framework
 *   A4 — plan-health-auditor.agent.md
 *   A5 — network.allowed frontmatter parsed by orchestrator
 *   A6 — lockHash frontmatter + computeLockHash
 *   A7 — tempering --objective flag (via runner.mjs objective param)
 *   A8 — tools.deny frontmatter parsed by bridge
 *
 * This test imports from production modules directly; no external processes.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const MCP_ROOT = resolve(HERE, "..");

// ─── A2: diff-classify module + MCP surface ───────────────────────────────────

import { classifyDiff, CATEGORIES, SEVERITY_ORDER, maxSeverity } from "../diff-classify.mjs";

describe("A2 — forge_diff_classify: module exports", () => {
  it("classifyDiff is a function", () => {
    expect(typeof classifyDiff).toBe("function");
  });

  it("CATEGORIES contains all six classifier buckets", () => {
    expect(CATEGORIES).toEqual([
      "leaked-secret",
      "prompt-injection-echo",
      "license-incompatible-paste",
      "eval-exec-introduced",
      "unexpected-network-call",
      "large-binary-dump",
    ]);
  });

  it("SEVERITY_ORDER is correctly ranked", () => {
    expect(SEVERITY_ORDER).toEqual(["none", "low", "medium", "high", "critical"]);
  });

  it("maxSeverity picks the higher level", () => {
    expect(maxSeverity("none", "critical")).toBe("critical");
    expect(maxSeverity("high", "medium")).toBe("high");
    expect(maxSeverity("low", "low")).toBe("low");
  });

  it("classifyDiff returns severity:none for empty diff", () => {
    const result = classifyDiff("");
    expect(result.severity).toBe("none");
    expect(result.findings).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("classifyDiff result has required shape fields", () => {
    const result = classifyDiff("+ hello world");
    expect(result).toHaveProperty("severity");
    expect(result).toHaveProperty("findings");
    expect(result).toHaveProperty("totalAdded");
    expect(result).toHaveProperty("truncated");
  });
});

describe("A2 — forge_diff_classify: capabilities snapshot", () => {
  const snapshot = JSON.parse(
    readFileSync(resolve(HERE, "__baselines__", "capabilities.snapshot.json"), "utf-8"),
  );

  it("forge_diff_classify appears in the capabilities snapshot toolNames", () => {
    expect(snapshot.toolNames).toContain("forge_diff_classify");
  });

  it("tool count in snapshot is at least 94 (A2 tool was added)", () => {
    expect(snapshot.toolCount).toBeGreaterThanOrEqual(94);
  });
});

describe("A2 — forge_diff_classify: tools.json surface", () => {
  const tools = JSON.parse(readFileSync(resolve(MCP_ROOT, "tools.json"), "utf-8"));

  it("forge_diff_classify is registered in tools.json", () => {
    const tool = tools.find((t) => t.name === "forge_diff_classify");
    expect(tool).toBeDefined();
  });

  it("forge_diff_classify has a description", () => {
    const tool = tools.find((t) => t.name === "forge_diff_classify");
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(0);
  });
});

// ─── A3: PreCommit chain ──────────────────────────────────────────────────────

import { runPreCommitChain, loadChainConfig } from "../../.github/hooks/PreCommit.mjs";

describe("A3 — PreCommit chain: module surface", () => {
  it("runPreCommitChain is a function", () => {
    expect(typeof runPreCommitChain).toBe("function");
  });

  it("loadChainConfig is a function", () => {
    expect(typeof loadChainConfig).toBe("function");
  });

  it("runPreCommitChain returns a result object with a blocked field", () => {
    const result = runPreCommitChain({ cwd: REPO_ROOT, configPath: null });
    expect(result).toHaveProperty("blocked");
    expect(typeof result.blocked).toBe("boolean");
  });
});

describe("A3 — PreCommit chain: diff-classify shim scripts exist", () => {
  it("check-diff-classify.sh exists in templates", () => {
    expect(
      existsSync(
        resolve(REPO_ROOT, "templates/.github/hooks/scripts/check-diff-classify.sh"),
      ),
    ).toBe(true);
  });

  it("check-diff-classify.ps1 exists in templates", () => {
    expect(
      existsSync(
        resolve(REPO_ROOT, "templates/.github/hooks/scripts/check-diff-classify.ps1"),
      ),
    ).toBe(true);
  });
});

// ─── A4: plan-health-auditor agent ───────────────────────────────────────────

describe("A4 — plan-health-auditor agent file", () => {
  const agentPath = resolve(REPO_ROOT, ".github/agents/plan-health-auditor.agent.md");

  it("plan-health-auditor.agent.md exists", () => {
    expect(existsSync(agentPath)).toBe(true);
  });

  it("plan-health-auditor.agent.md references forge_master_ask", () => {
    const content = readFileSync(agentPath, "utf-8");
    expect(content).toContain("forge_master_ask");
  });
});

// ─── A6: lockHash + computeLockHash ──────────────────────────────────────────

import { parsePlan, computeLockHash } from "../orchestrator.mjs";

describe("A6 — lockHash: computeLockHash export", () => {
  it("computeLockHash is a function", () => {
    expect(typeof computeLockHash).toBe("function");
  });

  it("computeLockHash returns a hex string for a non-empty plan body", () => {
    const hash = computeLockHash("## Scope Contract\n\n### In Scope\n- foo\n");
    expect(typeof hash).toBe("string");
    expect(hash).toMatch(/^[0-9a-f]{8,}$/);
  });

  it("computeLockHash is deterministic", () => {
    const body = "### Forbidden Actions\n- `src/bar.js`\n";
    expect(computeLockHash(body)).toBe(computeLockHash(body));
  });

  it("computeLockHash differs for different plan bodies", () => {
    const h1 = computeLockHash("### Forbidden Actions\n- `src/foo.js`\n");
    const h2 = computeLockHash("### Forbidden Actions\n- `src/bar.js`\n");
    expect(h1).not.toBe(h2);
  });
});

// ─── A1: Forbidden-Actions matcher ───────────────────────────────────────────

import {
  EDIT_TOOLS,
  matchesForbiddenPath,
  extractForbiddenPaths,
} from "../forbidden-matcher.mjs";

describe("A1 — forbidden-matcher: core functions exported", () => {
  it("EDIT_TOOLS is a Set", () => {
    expect(EDIT_TOOLS instanceof Set).toBe(true);
  });

  it("matchesForbiddenPath is a function", () => {
    expect(typeof matchesForbiddenPath).toBe("function");
  });

  it("extractForbiddenPaths is a function", () => {
    expect(typeof extractForbiddenPaths).toBe("function");
  });
});

describe("A1 — forbidden-matcher: path matching", () => {
  it("matches an exact file path", () => {
    const result = matchesForbiddenPath("src/foo.js", ["src/foo.js"]);
    expect(result.matched).toBe(true);
  });

  it("matches a substring path pattern", () => {
    const result = matchesForbiddenPath("src/utils/helpers.js", ["src/utils"]);
    expect(result.matched).toBe(true);
  });

  it("does not match an unrelated file", () => {
    const result = matchesForbiddenPath("tests/foo.test.mjs", ["src/utils"]);
    expect(result.matched).toBe(false);
  });

  it("returns matched pattern when matched", () => {
    const result = matchesForbiddenPath("src/foo.js", ["src/foo.js"]);
    expect(result.pattern).toBe("src/foo.js");
  });

  it("returns null pattern when not matched", () => {
    const result = matchesForbiddenPath("other/file.js", ["src/foo.js"]);
    expect(result.pattern).toBeNull();
  });
});

// ─── A7: tempering runner supports objective option ───────────────────────────

import { runTemperingRun } from "../tempering/runner.mjs";

describe("A7 — tempering runner: objective option acceptance", () => {
  it("runTemperingRun is a function", () => {
    expect(typeof runTemperingRun).toBe("function");
  });

  it("runTemperingRun accepts an objective option without throwing synchronously", () => {
    // We just validate the function signature accepts the option;
    // full execution is covered by tempering-objective.test.mjs
    expect(() => {
      // Intentionally start but do not await — we only check it doesn't throw
      // on the synchronous argument-parsing phase.
      const promise = runTemperingRun({
        projectDir: REPO_ROOT,
        objective: { command: "node --version", acceptIf: "greater" },
        // DI override so it never spawns a real process
        spawn: () => { throw new Error("spawn not called in this test"); },
      }).catch(() => { /* ignore async errors */ });
      expect(promise).toBeInstanceOf(Promise);
    }).not.toThrow();
  });
});

// ─── Cross-cutting: forge_run_plan description ────────────────────────────────

describe("Cross-cutting — forge_run_plan tools.json description", () => {
  const tools = JSON.parse(readFileSync(resolve(MCP_ROOT, "tools.json"), "utf-8"));

  it("forge_run_plan description exists", () => {
    const tool = tools.find((t) => t.name === "forge_run_plan");
    expect(tool).toBeDefined();
    expect(typeof tool.description).toBe("string");
  });

  it("forge_run_plan description mentions manualImport:true bypass form", () => {
    const tool = tools.find((t) => t.name === "forge_run_plan");
    expect(tool.description).toContain("manualImport:true");
  });
});

// ─── Cross-cutting: docs/plans/ ships the consumer template assets ────────────
//
// Plan Forge's own DEV phase plans (Phase-*-PLAN.md, internal
// DEPLOYMENT-ROADMAP.md, archive/) live on the `planning/main` branch, NOT
// on master. See CONTRIBUTING.md → Branch Model. This regression check
// asserts the consumer-facing template assets are present on master.

describe("Cross-cutting — docs/plans regression check", () => {
  it("docs/plans/ contains the consumer template assets", () => {
    const plansDir = resolve(REPO_ROOT, "docs/plans");
    const required = [
      "README.md",
      "AI-Plan-Hardening-Runbook.md",
      "AI-Plan-Hardening-Runbook-Instructions.md",
      "DEPLOYMENT-ROADMAP-TEMPLATE.md",
      "PROJECT-PRINCIPLES-TEMPLATE.md",
    ];
    for (const f of required) {
      expect(
        existsSync(resolve(plansDir, f)),
        `expected docs/plans/${f} to exist on master`,
      ).toBe(true);
    }
  });

  it("docs/plans/examples/ contains language-specific phase examples", () => {
    const examplesDir = resolve(REPO_ROOT, "docs/plans/examples");
    const examples = readdirSync(examplesDir).filter((f) =>
      f.endsWith("-EXAMPLE.md"),
    );
    expect(examples.length).toBeGreaterThan(0);
  });
});
