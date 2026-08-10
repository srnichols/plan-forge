/**
 * Plan Forge — gate-cwd-drive-case: runGate tolerates mixed Windows drive-letter case.
 *
 * Windows is case-insensitive for paths: `E:\foo` and `e:\foo` refer to the same
 * directory. However, string comparisons (e.g., path.startsWith) are case-sensitive,
 * which can cause silent failures when a caller passes a lowercase drive letter and
 * the OS returns uppercase from process.cwd().
 *
 * This suite exercises runGate (specifically _runInlineNodeGate) with both
 * uppercase and lowercase drive-letter variants of the project's actual cwd so
 * regressions are caught before they reach production.
 *
 * Non-Windows: the drive-case tests are skipped (paths are POSIX — no drive letters).
 */

import { describe, it, expect } from "vitest";
import { runGate } from "../orchestrator/schedulers.mjs";
import { resolve } from "node:path";

const isWindows = process.platform === "win32";

/**
 * Flip the case of the drive letter in a Windows absolute path.
 * "E:\\foo" → "e:\\foo", "e:\\foo" → "E:\\foo".
 * Returns the path unchanged when it has no Windows drive letter.
 */
function flipDriveCase(p) {
  if (!p || typeof p !== "string") return p;
  const m = p.match(/^([A-Za-z]):(.*)/);
  if (!m) return p;
  const flipped = m[1] === m[1].toUpperCase() ? m[1].toLowerCase() : m[1].toUpperCase();
  return `${flipped}:${m[2]}`;
}

// Use the pforge-mcp directory as the cwd for gate execution.
const projectCwd = resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "..");
// A minimal node -e gate that always exits 0.
const PASS_GATE = `node -e "require('node:assert').strictEqual(1, 1)"`;

describe("flipDriveCase helper", () => {
  it("uppercases a lowercase drive letter", () => {
    expect(flipDriveCase("e:\\foo\\bar")).toBe("E:\\foo\\bar");
  });
  it("lowercases an uppercase drive letter", () => {
    expect(flipDriveCase("C:\\Users\\test")).toBe("c:\\Users\\test");
  });
  it("returns POSIX paths unchanged", () => {
    expect(flipDriveCase("/home/user")).toBe("/home/user");
  });
  it("returns empty string unchanged", () => {
    expect(flipDriveCase("")).toBe("");
  });
});

describe("runGate — Windows drive-letter case tolerance", () => {
  it.skipIf(!isWindows)(
    "succeeds with the canonical (uppercase-drive) cwd",
    () => {
      const cwd = projectCwd;
      const result = runGate(PASS_GATE, cwd);
      expect(result.success).toBe(true);
    }
  );

  it.skipIf(!isWindows)(
    "succeeds with a lowercase-drive cwd pointing to the same directory",
    () => {
      const cwd = flipDriveCase(projectCwd);
      // Confirm the flip actually produced a different string (i.e., we are on Windows
      // with a drive letter present).
      expect(cwd).not.toBe(projectCwd);
      const result = runGate(PASS_GATE, cwd);
      expect(result.success).toBe(true);
    }
  );

  it.skipIf(!isWindows)(
    "uppercase-drive and lowercase-drive runs produce identical output",
    () => {
      const cwdUpper = projectCwd;
      const cwdLower = flipDriveCase(projectCwd);
      const upper = runGate(`node -e "process.stdout.write('ok')"`, cwdUpper);
      const lower = runGate(`node -e "process.stdout.write('ok')"`, cwdLower);
      expect(upper.success).toBe(true);
      expect(lower.success).toBe(true);
      expect(upper.output).toBe(lower.output);
    }
  );

  it.skipIf(!isWindows)(
    "a failing gate returns success=false regardless of drive-letter case",
    () => {
      const cwd = flipDriveCase(projectCwd);
      const result = runGate(`node -e "process.exit(1)"`, cwd);
      expect(result.success).toBe(false);
    }
  );

  it.skipIf(isWindows)(
    "POSIX: runGate works normally with a standard POSIX cwd",
    () => {
      const result = runGate(PASS_GATE, projectCwd);
      expect(result.success).toBe(true);
    }
  );
});
