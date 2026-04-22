// Meta-bug #88 regression guard:
// When a worker times out but its commit already landed on master, the
// retry loop must detect the HEAD advance and break instead of spawning a
// new worker that wastes a premium request re-doing committed work.
//
// This is a source-level check (no live orchestrator spawn) — it verifies
// the fix is present and wired into the timeout-retry branch.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const ORCHESTRATOR = readFileSync(
  resolve(__dirname, "..", "orchestrator.mjs"),
  "utf-8"
);

describe("orchestrator — meta-bug #88 timeout-but-committed guard", () => {
  it("captures sliceStartHead at slice start", () => {
    expect(ORCHESTRATOR).toMatch(/let\s+sliceStartHead\s*=\s*null/);
    // Capture must use rev-parse HEAD with a short timeout (non-blocking).
    expect(ORCHESTRATOR).toMatch(/sliceStartHead\s*=\s*execSync\(\s*["']git rev-parse HEAD["']/);
  });

  it("re-reads HEAD inside the timeout branch before retrying", () => {
    // The timeout-retry block must re-check HEAD against sliceStartHead.
    const timeoutBlock = ORCHESTRATOR.split(/if\s*\(\s*workerResult\.timedOut\s*\)\s*{/)[1] ?? "";
    expect(timeoutBlock).toMatch(/postTimeoutHead/);
    expect(timeoutBlock).toMatch(/sliceStartHead/);
  });

  it("breaks out of retry loop when HEAD advanced during timeout", () => {
    // Break must be preceded by a HEAD-comparison conditional — no early
    // break on unconditional timeout.
    expect(ORCHESTRATOR).toMatch(
      /postTimeoutHead\s*!==\s*sliceStartHead[\s\S]{0,2000}?workerResult\.exitCode\s*=\s*0[\s\S]{0,500}?break;/
    );
  });

  it("marks the slice with committedBeforeTimeout for downstream consumers", () => {
    expect(ORCHESTRATOR).toMatch(/workerResult\.committedBeforeTimeout\s*=\s*true/);
  });

  it("emits a slice-timeout-but-committed event on the bus when available", () => {
    expect(ORCHESTRATOR).toMatch(/eventBus\.emit\(\s*["']slice-timeout-but-committed["']/);
  });
});
