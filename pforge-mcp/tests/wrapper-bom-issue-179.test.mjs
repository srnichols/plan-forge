/**
 * Issue #179 — pforge.ps1 must ship with a UTF-8 BOM (EF BB BF) so that
 * PowerShell on Windows correctly renders Unicode glyphs (✓ ╔ ╚ ↑ ↓ • etc.).
 * Without the BOM, PowerShell 5.1 falls back to the Windows-1252 codepage
 * and these characters render as garbage (â–', âœ"). Updaters and CI must
 * preserve the BOM.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

function firstThreeBytes(filePath) {
  const buf = readFileSync(filePath);
  return [buf[0], buf[1], buf[2]];
}

describe("Issue #179 — PowerShell wrappers must ship with UTF-8 BOM", () => {
  it("pforge.ps1 starts with UTF-8 BOM (239,187,191)", () => {
    const bytes = firstThreeBytes(resolve(repoRoot, "pforge.ps1"));
    expect(bytes).toEqual([0xEF, 0xBB, 0xBF]);
  });

  it("validate-setup.ps1 starts with UTF-8 BOM", () => {
    const bytes = firstThreeBytes(resolve(repoRoot, "validate-setup.ps1"));
    expect(bytes).toEqual([0xEF, 0xBB, 0xBF]);
  });
});
