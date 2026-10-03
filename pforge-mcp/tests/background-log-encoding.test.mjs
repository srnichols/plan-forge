/**
 * Background `pforge run-plan` (pforge.ps1) runs node inside a hidden pwsh host
 * and tees its output to .forge/orchestrator-logs/orch-<stamp>.log. The hidden
 * console uses the OEM code page, so the log read "Γ£à Slice 1 ΓÇö passed"
 * instead of "✅ Slice 1 — passed". This launches the real host command the
 * way run-plan does and reads the log back.
 *
 * pforge.sh redirects node straight to the log file, so bytes pass through.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { IS_PLAN_FORGE_SOURCE } from "./helpers/source-repo.mjs";

const REPO = join(import.meta.dirname, "..", "..");
const hasPwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "1"], { encoding: "utf8" }).status === 0;
const canRun = IS_PLAN_FORGE_SOURCE && process.platform === "win32" && hasPwsh;

function extractFunction(opener) {
  const src = readFileSync(join(REPO, "pforge.ps1"), "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf(opener);
  if (start < 0) throw new Error(`${opener} not found in pforge.ps1`);
  return src.slice(start, src.indexOf("\n}\n", start) + 2);
}

describe.skipIf(!canRun)("background run-plan log encoding (pforge.ps1)", () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("keeps node's UTF-8 output intact in the orchestrator log", () => {
    dir = mkdtempSync(join(tmpdir(), "pf bg-log '"));
    const script = join(dir, "emit's.mjs");
    const log = join(dir, "orch.log");
    writeFileSync(script, `console.log("✅ Slice 1 — passed"); console.error("⏳ stderr line");`);
    const quote = (s) => `'${s.replace(/'/g, "''")}'`;
    const driver = `${extractFunction("function Get-BackgroundHostCommand")}
$cmd = Get-BackgroundHostCommand -NodeArgs @(${quote(script)}) -LogPath ${quote(log)}
$p = Start-Process -FilePath 'pwsh' -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile', '-NoLogo', '-NonInteractive', '-Command', $cmd
$p.WaitForExit()`;
    const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", driver], { encoding: "utf8", timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    const text = readFileSync(log, "utf8");
    expect(text).toContain("✅ Slice 1 — passed");
    expect(text).toContain("⏳ stderr line");
  }, 90_000);
});
