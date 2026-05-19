/**
 * Plan Forge — forbidden-matcher.test.mjs
 *
 * Unit tests for the Forbidden Actions matcher (forbidden-matcher.mjs).
 * These cover parsing, path normalisation, edge-cases, and deny-response
 * protocol so the PreToolUse hook behaviour stays correct across changes.
 */

import { describe, it, expect } from "vitest";
import {
  EDIT_TOOLS,
  parseForbiddenRequest,
  extractForbiddenPaths,
  matchesForbiddenPath,
  buildDenyResponse,
  ALLOW_RESPONSE,
} from "../forbidden-matcher.mjs";

// ─── EDIT_TOOLS set ───────────────────────────────────────────────────────────

describe("EDIT_TOOLS", () => {
  it("contains editFiles", () => {
    expect(EDIT_TOOLS.has("editFiles")).toBe(true);
  });

  it("contains create_file", () => {
    expect(EDIT_TOOLS.has("create_file")).toBe(true);
  });

  it("contains replace_string_in_file", () => {
    expect(EDIT_TOOLS.has("replace_string_in_file")).toBe(true);
  });

  it("contains insert_edit_into_file", () => {
    expect(EDIT_TOOLS.has("insert_edit_into_file")).toBe(true);
  });

  it("contains multi_replace_string_in_file", () => {
    expect(EDIT_TOOLS.has("multi_replace_string_in_file")).toBe(true);
  });

  it("does not contain read_file", () => {
    expect(EDIT_TOOLS.has("read_file")).toBe(false);
  });

  it("does not contain grep", () => {
    expect(EDIT_TOOLS.has("grep")).toBe(false);
  });
});

// ─── parseForbiddenRequest ────────────────────────────────────────────────────

describe("parseForbiddenRequest", () => {
  it("extracts tool_name and filePath from valid JSON", () => {
    const input = JSON.stringify({ tool_name: "editFiles", filePath: "src/foo.ts" });
    expect(parseForbiddenRequest(input)).toEqual({ toolName: "editFiles", filePath: "src/foo.ts" });
  });

  it("returns empty strings for invalid JSON", () => {
    expect(parseForbiddenRequest("not-json")).toEqual({ toolName: "", filePath: "" });
  });

  it("returns empty strings when fields are absent", () => {
    expect(parseForbiddenRequest("{}")).toEqual({ toolName: "", filePath: "" });
  });

  it("coerces numeric tool_name to string", () => {
    const input = JSON.stringify({ tool_name: 42, filePath: "x.ts" });
    const { toolName } = parseForbiddenRequest(input);
    expect(typeof toolName).toBe("string");
    expect(toolName).toBe("42");
  });

  it("handles filePath with spaces", () => {
    const input = JSON.stringify({ tool_name: "editFiles", filePath: "my dir/foo bar.ts" });
    expect(parseForbiddenRequest(input).filePath).toBe("my dir/foo bar.ts");
  });

  it("handles empty string input", () => {
    expect(parseForbiddenRequest("")).toEqual({ toolName: "", filePath: "" });
  });
});

// ─── extractForbiddenPaths ────────────────────────────────────────────────────

const SAMPLE_PLAN = `
# Phase-99 PLAN

## Scope Contract

### In Scope
- Build the widget

### Out of Scope
- Database migrations

### Forbidden Actions
- Do not modify: \`pforge-mcp/orchestrator.mjs\`
- Do not modify: \`templates/.github/hooks/scripts/check-forbidden.sh\`
- Do not modify: \`docs/plans/\`

## Execution Slices

### Slice 1: Widget Setup

Tasks here.
`;

describe("extractForbiddenPaths", () => {
  it("returns backtick-wrapped paths from Forbidden Actions section", () => {
    const paths = extractForbiddenPaths(SAMPLE_PLAN);
    expect(paths).toContain("pforge-mcp/orchestrator.mjs");
    expect(paths).toContain("templates/.github/hooks/scripts/check-forbidden.sh");
    expect(paths).toContain("docs/plans/");
  });

  it("returns correct count of forbidden paths", () => {
    const paths = extractForbiddenPaths(SAMPLE_PLAN);
    expect(paths).toHaveLength(3);
  });

  it("returns empty array when plan has no Forbidden Actions heading", () => {
    const plan = "# My Plan\n\n## Scope Contract\n\n### In Scope\n- Stuff\n";
    expect(extractForbiddenPaths(plan)).toEqual([]);
  });

  it("returns empty array for empty plan content", () => {
    expect(extractForbiddenPaths("")).toEqual([]);
  });

  it("stops extraction at the next ## heading", () => {
    const plan = `
## Scope Contract

### Forbidden Actions
- Do not modify: \`src/auth.ts\`

## Execution Slices

### Slice 1
Some content with \`backtick\` here.
`;
    const paths = extractForbiddenPaths(plan);
    expect(paths).toContain("src/auth.ts");
    expect(paths).not.toContain("backtick");
  });

  it("stops extraction at the next ### heading", () => {
    const plan = `
### Forbidden Actions
- Do not touch: \`locked-file.ts\`

### In Scope
- Work on \`allowed-file.ts\`
`;
    const paths = extractForbiddenPaths(plan);
    expect(paths).toContain("locked-file.ts");
    expect(paths).not.toContain("allowed-file.ts");
  });

  it("is case-insensitive for the Forbidden Actions heading", () => {
    const plan = "### forbidden actions\n- Do not edit: `secret.mjs`\n";
    expect(extractForbiddenPaths(plan)).toContain("secret.mjs");
  });

  it("handles CRLF line endings", () => {
    const plan = "### Forbidden Actions\r\n- No: `crlf-file.ts`\r\n";
    expect(extractForbiddenPaths(plan)).toContain("crlf-file.ts");
  });

  it("returns multiple backtick tokens from a single line", () => {
    const plan = "### Forbidden Actions\n- No: `file-a.ts` or `file-b.ts`\n";
    const paths = extractForbiddenPaths(plan);
    expect(paths).toContain("file-a.ts");
    expect(paths).toContain("file-b.ts");
  });
});

// ─── matchesForbiddenPath ────────────────────────────────────────────────────

describe("matchesForbiddenPath", () => {
  it("returns matched=true when filePath contains the forbidden pattern", () => {
    const result = matchesForbiddenPath("src/auth/login.ts", ["src/auth"]);
    expect(result.matched).toBe(true);
    expect(result.pattern).toBe("src/auth");
  });

  it("returns matched=false when filePath does not match any pattern", () => {
    const result = matchesForbiddenPath("src/widget/button.ts", ["src/auth"]);
    expect(result.matched).toBe(false);
    expect(result.pattern).toBeNull();
  });

  it("returns matched=false for empty forbidden list", () => {
    const result = matchesForbiddenPath("anything.ts", []);
    expect(result.matched).toBe(false);
  });

  it("matches exact file names", () => {
    const result = matchesForbiddenPath("pforge-mcp/orchestrator.mjs", ["orchestrator.mjs"]);
    expect(result.matched).toBe(true);
  });

  it("matches exact full paths", () => {
    const result = matchesForbiddenPath(
      "pforge-mcp/orchestrator.mjs",
      ["pforge-mcp/orchestrator.mjs"],
    );
    expect(result.matched).toBe(true);
  });

  it("normalises Windows backslash paths before matching", () => {
    const result = matchesForbiddenPath(
      "pforge-mcp\\orchestrator.mjs",
      ["pforge-mcp/orchestrator.mjs"],
    );
    expect(result.matched).toBe(true);
  });

  it("normalises backslash in pattern too", () => {
    const result = matchesForbiddenPath(
      "src/auth/login.ts",
      ["src\\auth"],
    );
    expect(result.matched).toBe(true);
  });

  it("returns the first matching pattern when multiple patterns match", () => {
    const result = matchesForbiddenPath(
      "src/auth/login.ts",
      ["src/auth", "src/"],
    );
    expect(result.matched).toBe(true);
    expect(result.pattern).toBe("src/auth");
  });

  it("matches directory prefix patterns (docs/plans/)", () => {
    const result = matchesForbiddenPath(
      "docs/plans/Phase-99-PLAN.md",
      ["docs/plans/"],
    );
    expect(result.matched).toBe(true);
  });

  it("does not match a path that is a prefix of the pattern", () => {
    // "src" should not match a forbidden pattern of "src/auth/secret.ts"
    // because "src" does NOT contain "src/auth/secret.ts"
    const result = matchesForbiddenPath("src", ["src/auth/secret.ts"]);
    expect(result.matched).toBe(false);
  });
});

// ─── buildDenyResponse ────────────────────────────────────────────────────────

describe("buildDenyResponse", () => {
  const deny = JSON.parse(buildDenyResponse("src/auth.ts", "src/auth"));

  it("has hookSpecificOutput", () => {
    expect(deny).toHaveProperty("hookSpecificOutput");
  });

  it("hookEventName is PreToolUse", () => {
    expect(deny.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  });

  it("permissionDecision is deny", () => {
    expect(deny.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("permissionDecisionReason starts with BLOCKED", () => {
    expect(deny.hookSpecificOutput.permissionDecisionReason).toMatch(/^BLOCKED/);
  });

  it("permissionDecisionReason includes the file path", () => {
    expect(deny.hookSpecificOutput.permissionDecisionReason).toContain("src/auth.ts");
  });

  it("permissionDecisionReason includes the forbidden pattern", () => {
    expect(deny.hookSpecificOutput.permissionDecisionReason).toContain("src/auth");
  });

  it("produces valid JSON", () => {
    expect(() => JSON.parse(buildDenyResponse("x.ts", "x"))).not.toThrow();
  });
});

// ─── ALLOW_RESPONSE ──────────────────────────────────────────────────────────

describe("ALLOW_RESPONSE", () => {
  it('is the string "{}"', () => {
    expect(ALLOW_RESPONSE).toBe("{}");
  });

  it("is valid JSON", () => {
    expect(() => JSON.parse(ALLOW_RESPONSE)).not.toThrow();
  });
});

// ─── End-to-end scenario ────────────────────────────────────────────────────

describe("End-to-end: hook request through full matcher pipeline", () => {
  const plan = `
## Scope Contract

### Forbidden Actions
- Do not modify: \`pforge-mcp/orchestrator.mjs\`
- Do not modify: \`docs/plans/\`
`;

  it("blocks an edit to a forbidden file", () => {
    const { filePath } = parseForbiddenRequest(
      JSON.stringify({ tool_name: "editFiles", filePath: "pforge-mcp/orchestrator.mjs" }),
    );
    const paths = extractForbiddenPaths(plan);
    const { matched } = matchesForbiddenPath(filePath, paths);
    expect(matched).toBe(true);
  });

  it("allows an edit to a non-forbidden file", () => {
    const { filePath } = parseForbiddenRequest(
      JSON.stringify({ tool_name: "editFiles", filePath: "pforge-mcp/forbidden-matcher.mjs" }),
    );
    const paths = extractForbiddenPaths(plan);
    const { matched } = matchesForbiddenPath(filePath, paths);
    expect(matched).toBe(false);
  });

  it("non-edit tool is not blocked regardless of forbidden paths", () => {
    const { toolName } = parseForbiddenRequest(
      JSON.stringify({ tool_name: "read_file", filePath: "pforge-mcp/orchestrator.mjs" }),
    );
    expect(EDIT_TOOLS.has(toolName)).toBe(false);
  });

  it("produces correct deny JSON for a blocked edit", () => {
    const { filePath } = parseForbiddenRequest(
      JSON.stringify({ tool_name: "editFiles", filePath: "docs/plans/Phase-99-PLAN.md" }),
    );
    const paths = extractForbiddenPaths(plan);
    const { matched, pattern } = matchesForbiddenPath(filePath, paths);
    expect(matched).toBe(true);
    const deny = JSON.parse(buildDenyResponse(filePath, pattern));
    expect(deny.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(deny.hookSpecificOutput.permissionDecisionReason).toContain("BLOCKED");
    expect(deny.hookSpecificOutput.permissionDecisionReason).toContain("docs/plans/Phase-99-PLAN.md");
  });
});
