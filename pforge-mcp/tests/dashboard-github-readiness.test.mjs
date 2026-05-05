/**
 * Plan Forge — Dashboard GitHub Readiness Widget tests (Phase Hotfix-v2.90.8 Slice 4).
 *
 * Covers:
 *   - Widget renders all 8 standard checks
 *   - Widget skips the assignable probe row when gh-token is false (status "na")
 *   - Widget shows the assignable probe row with fix-hint when probe returns "warn"
 *   - Widget renders empty-state when checks array is empty
 *   - Summary line counts are accurate
 *   - HTML output is properly escaped (XSS)
 */

import { describe, expect, it } from "vitest";
import { renderReadinessWidget } from "../../pforge-mcp/dashboard/github-readiness-widget.mjs";

// ─── fixtures ────────────────────────────────────────────────────────────────

const STANDARD_CHECKS = [
  { id: "copilot-instructions", label: ".github/copilot-instructions.md", status: "pass", detail: "present" },
  { id: "agents-md", label: "AGENTS.md", status: "pass", detail: "present at repo root" },
  { id: "instructions-dir", label: ".github/instructions/*.instructions.md", status: "pass", detail: "3 instruction files found" },
  { id: "prompts-dir", label: ".github/prompts/*.prompt.md", status: "pass", detail: "5 prompt files found" },
  { id: "vscode-mcp", label: ".vscode/mcp.json", status: "pass", detail: "Plan-Forge MCP server registered" },
  { id: "actions-workflows", label: ".github/workflows/", status: "pass", detail: "2 workflow files found" },
  { id: "github-remote", label: "git remote → github.com", status: "pass", detail: "github.com remote configured" },
  { id: "gh-cli", label: "gh CLI on PATH", status: "pass", detail: "gh CLI available" },
];

const ASSIGNABLE_NA = {
  id: "copilot-coding-agent-assignable",
  label: "Copilot coding agent assignable",
  status: "na",
  detail: "requires ghToken — pass opts.ghToken to enable this network check",
};

const ASSIGNABLE_WARN = {
  id: "copilot-coding-agent-assignable",
  label: "Copilot coding agent assignable",
  status: "warn",
  detail: "network check not yet implemented for this token scope",
  fixHint: "Ensure the repo has Copilot coding agent enabled via GitHub settings.",
};

// ─── widget renders 8 standard checks ────────────────────────────────────────

describe("renderReadinessWidget — standard 8 checks", () => {
  it("renders all 8 check rows", () => {
    const html = renderReadinessWidget([...STANDARD_CHECKS, ASSIGNABLE_NA]);
    for (const c of STANDARD_CHECKS) {
      expect(html).toContain(`data-check-id="${c.id}"`);
    }
  });

  it("renders check labels", () => {
    const html = renderReadinessWidget([...STANDARD_CHECKS, ASSIGNABLE_NA]);
    expect(html).toContain(".github/copilot-instructions.md");
    expect(html).toContain("AGENTS.md");
    expect(html).toContain("gh CLI on PATH");
  });

  it("renders pass glyph for passing checks", () => {
    const html = renderReadinessWidget([...STANDARD_CHECKS, ASSIGNABLE_NA]);
    expect(html).toContain("✓");
  });

  it("wraps output in gm-readiness container", () => {
    const html = renderReadinessWidget([...STANDARD_CHECKS, ASSIGNABLE_NA]);
    expect(html).toContain('data-widget="github-readiness"');
    expect(html).toContain('class="gm-readiness"');
  });

  it("includes a summary line", () => {
    const html = renderReadinessWidget([...STANDARD_CHECKS, ASSIGNABLE_NA]);
    expect(html).toContain("gm-readiness__summary");
    expect(html).toContain("pass");
  });
});

// ─── assignable probe skipped when gh-token is false ────────────────────────

describe("renderReadinessWidget — assignable probe skipped when na", () => {
  it("does not render the assignable row when status is na", () => {
    const html = renderReadinessWidget([...STANDARD_CHECKS, ASSIGNABLE_NA]);
    expect(html).not.toContain('data-check-id="copilot-coding-agent-assignable"');
  });

  it("still renders all 8 standard check rows when assignable is na", () => {
    const html = renderReadinessWidget([...STANDARD_CHECKS, ASSIGNABLE_NA]);
    const matches = (html.match(/data-check-id=/g) || []).length;
    expect(matches).toBe(8);
  });

  it("summary reflects only the 8 visible checks", () => {
    const html = renderReadinessWidget([...STANDARD_CHECKS, ASSIGNABLE_NA]);
    // All 8 are pass, none are warn/fail/na in summary
    expect(html).toContain("8 pass");
    expect(html).toContain("(8 checks)");
  });
});

// ─── assignable probe shown with fix-hint when warn ──────────────────────────

describe("renderReadinessWidget — assignable probe shown on warn", () => {
  it("renders the assignable row when status is warn", () => {
    const html = renderReadinessWidget([...STANDARD_CHECKS, ASSIGNABLE_WARN]);
    expect(html).toContain('data-check-id="copilot-coding-agent-assignable"');
  });

  it("renders the warn glyph for the assignable row", () => {
    const html = renderReadinessWidget([...STANDARD_CHECKS, ASSIGNABLE_WARN]);
    // ⚠ should appear somewhere in the widget output
    expect(html).toContain("⚠");
  });

  it("renders the fix-hint for the assignable warn row", () => {
    const html = renderReadinessWidget([...STANDARD_CHECKS, ASSIGNABLE_WARN]);
    expect(html).toContain("gm-readiness__hint");
    expect(html).toContain(ASSIGNABLE_WARN.fixHint);
  });

  it("summary reflects 9 checks when assignable is visible", () => {
    const html = renderReadinessWidget([...STANDARD_CHECKS, ASSIGNABLE_WARN]);
    expect(html).toContain("(9 checks)");
    expect(html).toContain("1 warn");
  });
});

// ─── fix-hint for standard fail/warn rows ────────────────────────────────────

describe("renderReadinessWidget — fix hints for warn/fail rows", () => {
  it("renders fix-hint for a failing check", () => {
    const checks = [
      ...STANDARD_CHECKS.slice(0, 7),
      {
        id: "gh-cli",
        label: "gh CLI on PATH",
        status: "fail",
        detail: "gh CLI not found on PATH",
        fixHint: "Install GitHub CLI: https://cli.github.com",
      },
    ];
    const html = renderReadinessWidget(checks);
    expect(html).toContain("gm-readiness__hint");
    expect(html).toContain("Install GitHub CLI");
  });

  it("does not render fix-hint for passing checks", () => {
    const html = renderReadinessWidget(STANDARD_CHECKS);
    expect(html).not.toContain("gm-readiness__hint");
  });
});

// ─── empty state ─────────────────────────────────────────────────────────────

describe("renderReadinessWidget — empty state", () => {
  it("renders empty-state when checks array is empty", () => {
    const html = renderReadinessWidget([]);
    expect(html).toContain("gm-readiness__empty");
    expect(html).not.toContain("gm-readiness__list");
  });

  it("renders empty-state when checks is null", () => {
    const html = renderReadinessWidget(null);
    expect(html).toContain("gm-readiness__empty");
  });
});

// ─── XSS escaping ────────────────────────────────────────────────────────────

describe("renderReadinessWidget — XSS escaping", () => {
  it("escapes malicious label text", () => {
    const checks = [
      {
        id: "copilot-instructions",
        label: '<script>alert(1)</script>',
        status: "pass",
        detail: "present",
      },
    ];
    const html = renderReadinessWidget(checks);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes malicious fix-hint text", () => {
    const checks = [
      {
        id: "gh-cli",
        label: "gh CLI on PATH",
        status: "warn",
        detail: "not found",
        fixHint: '<img onerror="alert(1)" src=x>',
      },
    ];
    const html = renderReadinessWidget(checks);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
