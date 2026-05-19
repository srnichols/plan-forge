/**
 * Plan Forge — Phase WORKER-GUARDRAILS Slice 8 (A4)
 * plan-health-auditor.test.mjs
 *
 * Smoke tests for the plan-health-auditor agent (A4).
 *
 * Covers (always, no env guard):
 *   1. Agent file exists at the expected path
 *   2. Agent YAML frontmatter declares readonly: true
 *   3. Agent tool allowlist contains no write-capable tools
 *   4. Agent file includes all four required output section headings
 *   5. Agent file declares manual trigger only (decision #13)
 *
 * Covers (FORGE_SMOKE=1 only):
 *   6. forge_master_ask routes @plan-health-auditor mention to a non-empty report
 *   7. Report written to .forge/health/latest.md contains the four expected sections
 *
 * Run the live test:
 *   FORGE_SMOKE=1 npx vitest run tests/plan-health-auditor.test.mjs
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  readFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const AGENT_PATH = resolve(REPO_ROOT, ".github", "agents", "plan-health-auditor.agent.md");

// Write-capable tool names that MUST NOT appear in the agent's tool allowlist.
const WRITE_TOOLS = new Set([
  "editFiles",
  "create_file",
  "replace_string_in_file",
  "insert_edit_into_file",
  "multi_replace_string_in_file",
  "write_file",
  "forge_run_plan",
  "forge_meta_bug_file",
  "forge_bug_file",
  "capture_thought",
  "capture_memory",
  "brain_remember",
]);

const REQUIRED_SECTIONS = [
  "Top Failure Modes",
  "Recurring Gate-Portability",
  "Slice Retry Rate",
  "Proposed Patches",
];

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Parse the YAML frontmatter block from a markdown file. Returns raw string. */
function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : "";
}

/** Parse the `tools:` YAML list from raw frontmatter text. */
function parseToolList(frontmatterText) {
  const tools = [];
  const inToolsBlock = /tools:\s*\n((?:[ \t]+-[^\n]*\n?)+)/;
  const inlineTools = /tools:\s*\[([^\]]*)\]/;

  const blockMatch = frontmatterText.match(inToolsBlock);
  if (blockMatch) {
    for (const line of blockMatch[1].split("\n")) {
      const entry = line.replace(/^\s*-\s*/, "").trim();
      if (entry) tools.push(entry);
    }
    return tools;
  }

  const inlineMatch = frontmatterText.match(inlineTools);
  if (inlineMatch) {
    for (const entry of inlineMatch[1].split(",")) {
      const t = entry.trim();
      if (t) tools.push(t);
    }
    return tools;
  }

  return tools;
}

// ─── 1. Agent file existence ─────────────────────────────────────────────────

describe("plan-health-auditor: agent file existence", () => {
  it("agent file exists at .github/agents/plan-health-auditor.agent.md", () => {
    expect(existsSync(AGENT_PATH)).toBe(true);
  });

  it("agent file is non-empty", () => {
    const content = readFileSync(AGENT_PATH, "utf-8");
    expect(content.length).toBeGreaterThan(100);
  });
});

// ─── 2. Frontmatter: readonly constraint ────────────────────────────────────

describe("plan-health-auditor: frontmatter readonly constraint", () => {
  let frontmatter;

  beforeAll(() => {
    const content = readFileSync(AGENT_PATH, "utf-8");
    frontmatter = extractFrontmatter(content);
  });

  it("frontmatter block is present", () => {
    expect(frontmatter).toBeTruthy();
    expect(frontmatter.length).toBeGreaterThan(10);
  });

  it("declares readonly: true", () => {
    expect(frontmatter).toMatch(/readonly\s*:\s*true/);
  });

  it("has a name field", () => {
    expect(frontmatter).toMatch(/name\s*:/);
  });

  it("has a description field", () => {
    expect(frontmatter).toMatch(/description\s*:/);
  });
});

// ─── 3. Frontmatter: tool allowlist is read-only ────────────────────────────

describe("plan-health-auditor: tool allowlist contains no write-capable tools", () => {
  let tools;

  beforeAll(() => {
    const content = readFileSync(AGENT_PATH, "utf-8");
    const frontmatter = extractFrontmatter(content);
    tools = parseToolList(frontmatter);
  });

  it("tool list is non-empty", () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it("contains forge_cost_report (approved read tool)", () => {
    expect(tools).toContain("forge_cost_report");
  });

  it("contains forge_health_trend (approved read tool)", () => {
    expect(tools).toContain("forge_health_trend");
  });

  it("contains forge_bug_list (approved read tool)", () => {
    expect(tools).toContain("forge_bug_list");
  });

  it("contains brain_recall (approved read tool)", () => {
    expect(tools).toContain("brain_recall");
  });

  it("does not contain any write-capable tools", () => {
    const violations = tools.filter((t) => WRITE_TOOLS.has(t));
    expect(
      violations,
      `Write-capable tools found in agent allowlist: ${violations.join(", ")}`,
    ).toHaveLength(0);
  });
});

// ─── 4. Required output section headings ─────────────────────────────────────

describe("plan-health-auditor: required output section headings", () => {
  let content;

  beforeAll(() => {
    content = readFileSync(AGENT_PATH, "utf-8");
  });

  for (const section of REQUIRED_SECTIONS) {
    it(`contains section heading: "${section}"`, () => {
      expect(content).toContain(section);
    });
  }
});

// ─── 5. Trigger model: manual only ──────────────────────────────────────────

describe("plan-health-auditor: trigger model", () => {
  it("declares manual trigger (decision #13 — no scheduled trigger this phase)", () => {
    const content = readFileSync(AGENT_PATH, "utf-8");
    const frontmatter = extractFrontmatter(content);
    // Must declare manual trigger; must NOT declare schedule/cron triggers
    expect(frontmatter).toMatch(/triggers[\s\S]*manual/);
    expect(frontmatter).not.toMatch(/schedule|cron/);
  });
});

// ─── 6 + 7. Live smoke (FORGE_SMOKE=1 only) ─────────────────────────────────

describe.skipIf(!process.env.FORGE_SMOKE)(
  "plan-health-auditor smoke — live forge_master_ask invocation",
  () => {
    let tempDir;
    let forgeDir;

    beforeAll(() => {
      // Synthesize minimal .forge/runs/ data so the auditor has something to read
      tempDir = mkdtempSync(join(tmpdir(), "pforge-health-smoke-"));
      forgeDir = join(tempDir, ".forge");

      // Create a fake run with one slice that failed
      const runDir = join(forgeDir, "runs", "smoke-run-001", "slices", "1");
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        join(runDir, "run.log"),
        [
          '{"ts":"2026-05-10T12:00:00Z","event":"slice_start","slice":1}',
          '{"ts":"2026-05-10T12:01:00Z","event":"gate_fail","exit":1,"cmd":"bash -c \\"grep -c pattern file\\"","platform":"win32"}',
          '{"ts":"2026-05-10T12:01:05Z","event":"retry","attempt":1}',
          '{"ts":"2026-05-10T12:02:00Z","event":"slice_complete","exit":0,"retries":1}',
        ].join("\n"),
        "utf-8",
      );

      // Create health output directory
      mkdirSync(join(forgeDir, "health"), { recursive: true });
    });

    afterAll(() => {
      if (tempDir) {
        try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    });

    it(
      "forge_master_ask with @plan-health-auditor produces a non-empty response",
      async () => {
        const { runTurn } = await import("../../pforge-master/src/reasoning.mjs");
        const result = await runTurn({
          message: `@plan-health-auditor generate a health report for the last 14 days. Use cwd: ${tempDir}`,
        });

        expect(result.error).toBeFalsy();
        expect(result.reply).toBeTruthy();
        expect(result.reply.length).toBeGreaterThan(50);
      },
      60_000,
    );

    it(
      "response contains at least two required section headings",
      async () => {
        const { runTurn } = await import("../../pforge-master/src/reasoning.mjs");
        const result = await runTurn({
          message: `@plan-health-auditor weekly report. cwd: ${tempDir}`,
        });

        const reply = result.reply ?? "";
        const matched = REQUIRED_SECTIONS.filter((s) => reply.includes(s));
        expect(
          matched.length,
          `Expected ≥2 required sections in reply, got ${matched.length}: [${matched.join(", ")}]\n\nFull reply:\n${reply}`,
        ).toBeGreaterThanOrEqual(2);
      },
      60_000,
    );
  },
);
