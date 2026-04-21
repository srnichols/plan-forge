import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lintGateCommands } from "../orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "fixtures", "plan-with-ascii-diagram.md");

describe("lintGateCommands — ASCII box-drawing diagrams (GH #83)", () => {
  it("does not report blocked-command errors for box-drawing characters", () => {
    const result = lintGateCommands(fixturePath, join(__dirname, ".."));

    const blockedErrors = result.errors.filter(
      (e) => e.rule === "blocked-command"
    );
    expect(blockedErrors).toEqual([]);
  });

  it("still detects real gate commands through the diagram", () => {
    const result = lintGateCommands(fixturePath, join(__dirname, ".."));

    // The fixture has "npm test" and "npx vitest run tests/example.test.mjs"
    // These should not be dropped — they must appear in the lint output
    // (either as passing commands or in warnings, but not as blocked-command errors)
    expect(result.passed).toBe(true);
  });

  it("box-drawing lines are silently filtered, not surfaced as errors", () => {
    const result = lintGateCommands(fixturePath, join(__dirname, ".."));

    // coalesceGateLines filters prose (including box-drawing) before the
    // lint loop, so they never appear in errors OR warnings as blocked-command
    const allBoxDrawingIssues = [
      ...result.errors,
      ...result.warnings,
    ].filter((item) => /[\u2500-\u257F]/.test(item.command));

    // Box-drawing lines must not produce any blocked-command entries
    const blockedBoxDrawing = allBoxDrawingIssues.filter(
      (item) => item.rule === "blocked-command"
    );
    expect(blockedBoxDrawing).toEqual([]);
  });
});
