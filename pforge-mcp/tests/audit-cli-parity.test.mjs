import { describe, it, expect } from "vitest";
import {
  mcpToCli,
  extractPsCommands,
  extractShCommands,
  audit,
} from "../../scripts/audit-cli-parity.mjs";
// Test file located in pforge-mcp/tests/ for vitest discovery; script lives in scripts/

describe("audit-cli-parity", () => {
  describe("mcpToCli", () => {
    it("strips forge_ prefix and converts underscores to hyphens", () => {
      expect(mcpToCli("forge_run_plan")).toBe("run-plan");
    });

    it("handles single-word tool names", () => {
      expect(mcpToCli("forge_smith")).toBe("smith");
    });

    it("handles multi-segment names", () => {
      expect(mcpToCli("forge_secret_scan")).toBe("secret-scan");
    });

    it("handles testbed tools", () => {
      expect(mcpToCli("forge_testbed_run")).toBe("testbed-run");
    });
  });

  describe("extractPsCommands", () => {
    it("extracts commands from PowerShell switch block", () => {
      const content = `
switch ($Command) {
    'init'         { Invoke-Init }
    'check'        { Invoke-Check }
    'run-plan'     { Invoke-RunPlan }
    'help'         { Show-Help }
    ''             { Show-Help }
    default { Write-Host "Unknown" }
}`;
      const commands = extractPsCommands(content);
      expect(commands.has("init")).toBe(true);
      expect(commands.has("check")).toBe(true);
      expect(commands.has("run-plan")).toBe(true);
      expect(commands.has("help")).toBe(false);
      expect(commands.has("")).toBe(false);
    });

    it("returns empty set for content without switch block", () => {
      const commands = extractPsCommands("no switch here");
      expect(commands.size).toBe(0);
    });
  });

  describe("extractShCommands", () => {
    it("extracts commands from bash case block", () => {
      const content = `
command="$1"
case "$command" in
    init)         cmd_init "$@" ;;
    check)        cmd_check "$@" ;;
    run-plan)     cmd_run_plan "$@" ;;
    help|--help)  show_help ;;
    *)
        echo "ERROR" >&2
        exit 1
        ;;
esac`;
      const commands = extractShCommands(content);
      expect(commands.has("init")).toBe(true);
      expect(commands.has("check")).toBe(true);
      expect(commands.has("run-plan")).toBe(true);
      expect(commands.has("help")).toBe(false);
    });

    it("returns empty set for content without case block", () => {
      const commands = extractShCommands("no case here");
      expect(commands.size).toBe(0);
    });
  });

  describe("audit()", () => {
    it("runs full audit against real project files and returns structured result", async () => {
      const result = await audit();
      expect(result).toHaveProperty("matched");
      expect(result).toHaveProperty("mcpOnly");
      expect(result).toHaveProperty("cliOnly");
      expect(result).toHaveProperty("matchedCount");
      expect(result).toHaveProperty("totalMcp");
      expect(result).toHaveProperty("totalCli");
      expect(result.matchedCount).toBeGreaterThan(0);
      expect(result.totalMcp).toBeGreaterThan(0);
      expect(result.totalCli).toBeGreaterThan(0);
      expect(Array.isArray(result.matched)).toBe(true);
      expect(Array.isArray(result.mcpOnly)).toBe(true);
      expect(Array.isArray(result.cliOnly)).toBe(true);
    });

    it("matched items have tool and cliCommand fields", async () => {
      const result = await audit();
      if (result.matched.length > 0) {
        expect(result.matched[0]).toHaveProperty("tool");
        expect(result.matched[0]).toHaveProperty("cliCommand");
      }
    });

    it("mcpOnly items have knownException flag", async () => {
      const result = await audit();
      if (result.mcpOnly.length > 0) {
        expect(result.mcpOnly[0]).toHaveProperty("knownException");
        expect(typeof result.mcpOnly[0].knownException).toBe("boolean");
      }
    });
  });
});
