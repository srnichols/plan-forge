// Tests for the worker + runtime capability matrix introduced for issue #28.
// Covers: matrix loader, semver comparison, help-text detection, detectRuntimes
// shape, detectWorkers shape (structural — no assumption about what's installed
// on the CI box), and install-hint resolution.

import { describe, it, expect } from "vitest";
import {
  loadWorkerCapabilities,
  compareVersions,
  detectHelpTextOutput,
  detectRuntimes,
  detectWorkers,
  suggestInstall,
  detectPackageManager,
  detectSilentWorkerFailure,
  detectKilledBySignal,
} from "../orchestrator.mjs";

describe("worker-capabilities matrix", () => {
  it("loads and caches the matrix JSON with workers + runtimes + packageManagers", () => {
    const matrix = loadWorkerCapabilities();
    expect(matrix).toBeDefined();
    expect(matrix.workers).toBeDefined();
    expect(matrix.runtimes).toBeDefined();
    expect(matrix.packageManagers).toBeDefined();
    // Cache hit — same reference on second call
    expect(loadWorkerCapabilities()).toBe(matrix);
  });

  it("defines gh-copilot with agentic capability markers (issue #28 floor)", () => {
    const matrix = loadWorkerCapabilities();
    const gh = matrix.workers["gh-copilot"];
    expect(gh).toBeDefined();
    expect(gh.minVersion).toBeTruthy();
    expect(gh.probe.capabilityMarkers).toEqual(
      expect.arrayContaining(["--yolo", "--no-ask-user"])
    );
    expect(gh.invocation.baseArgs.some((a) => String(a).includes("{PROMPT_FILE}"))).toBe(true);
  });

  it("defines runtime minimums for git/gh/node/pwsh", () => {
    const matrix = loadWorkerCapabilities();
    for (const name of ["git", "gh", "node", "pwsh"]) {
      expect(matrix.runtimes[name], `missing runtime: ${name}`).toBeDefined();
      expect(matrix.runtimes[name].minVersion).toBeTruthy();
    }
  });
});

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
  });
  it("returns -1 when a < b", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.2.3", "1.3.0")).toBe(-1);
    expect(compareVersions("1.2.3", "2.0.0")).toBe(-1);
  });
  it("returns 1 when a > b", () => {
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.0.33", "1.0.32")).toBe(1);
  });
  it("tolerates 'v' prefixes and pre-release suffixes", () => {
    expect(compareVersions("v2.90.0", "2.88.0")).toBe(1);
    expect(compareVersions("1.0.0-beta.3", "1.0.0")).toBe(0); // 3-part only
  });
});

describe("detectHelpTextOutput", () => {
  it("flags output with multiple help-text markers as help (issue #28)", () => {
    const ghHelp = `
USAGE
  gh copilot <command> [flags]

Commands:
  suggest
  explain
`;
    expect(detectHelpTextOutput(ghHelp, "", "gh-copilot")).toBe(true);
  });

  it("flags output with usage: + Options: + Run '... --help' for", () => {
    const stdout = `usage: foo [options]
Options:
  --help     show help
Run 'foo --help' for more info
`;
    expect(detectHelpTextOutput(stdout, "", "claude")).toBe(true);
  });

  it("does NOT flag real agent output that happens to mention usage", () => {
    const realOutput = `I analyzed the file and found a bug in the usage of the mutex. Here's the fix:\n\n` +
      "```js\nconst lock = new Mutex();\nlock.acquire();\n```\n" +
      "I also added tests. The fix is complete.";
    expect(detectHelpTextOutput(realOutput, "", "gh-copilot")).toBe(false);
  });

  it("does NOT flag empty output", () => {
    expect(detectHelpTextOutput("", "", "gh-copilot")).toBe(false);
    expect(detectHelpTextOutput(null, null, "gh-copilot")).toBe(false);
  });

  it("does NOT flag long output even if it contains one marker", () => {
    // 5000+ chars of real-looking content with one "usage:" mention
    const long = "Here is the analysis.\n".repeat(300) + "\nThe usage: of this API is deprecated.\n";
    expect(detectHelpTextOutput(long, "", "claude")).toBe(false);
  });
});

describe("detectSilentWorkerFailure (issue #77)", () => {
  it("flags exit-0 with empty stdout as a silent failure", () => {
    const result = detectSilentWorkerFailure(
      { output: "", worker: "gh-copilot", exitCode: 0, looksLikeHelpText: false },
      "autonomous",
      "1",
    );
    expect(result).toMatch(/exited 0 but produced only 0 bytes/);
    expect(result).toMatch(/gh-copilot/);
  });

  it("flags exit-0 with under-50-byte stdout as a silent failure", () => {
    const result = detectSilentWorkerFailure(
      { output: "error: unknown option\n", worker: "gh-copilot", exitCode: 0, looksLikeHelpText: false },
      "autonomous",
      "2",
    );
    expect(result).toMatch(/bytes of stdout/);
  });

  it("flags help-text output as a silent failure even when stdout is long enough", () => {
    const longHelp = "x".repeat(80); // >= MIN_WORKER_STDOUT
    const result = detectSilentWorkerFailure(
      { output: longHelp, worker: "gh-copilot", exitCode: 0, looksLikeHelpText: true },
      "autonomous",
      "3",
    );
    expect(result).toMatch(/help\/usage text/);
  });

  it("does NOT flag healthy worker output", () => {
    const healthy = "I analyzed the slice and updated 3 files.\n".repeat(20);
    const result = detectSilentWorkerFailure(
      { output: healthy, worker: "gh-copilot", exitCode: 0, looksLikeHelpText: false },
      "autonomous",
      "4",
    );
    expect(result).toBeNull();
  });

  it("does NOT flag non-zero exit (those fail via the normal path)", () => {
    const result = detectSilentWorkerFailure(
      { output: "", worker: "gh-copilot", exitCode: 1, looksLikeHelpText: false },
      "autonomous",
      "5",
    );
    expect(result).toBeNull();
  });

  it("does NOT flag the human assisted-mode sentinel", () => {
    const result = detectSilentWorkerFailure(
      { output: "Assisted mode", worker: "human", exitCode: 0, looksLikeHelpText: false },
      "assisted",
      "6",
    );
    expect(result).toBeNull();
  });

  it("returns null when workerResult is missing", () => {
    expect(detectSilentWorkerFailure(null, "autonomous", "7")).toBeNull();
    expect(detectSilentWorkerFailure(undefined, "autonomous", "8")).toBeNull();
  });
});

describe("detectKilledBySignal (meta-bug #99)", () => {
  it("flags Windows STATUS_CONTROL_C_EXIT (3221225786 / 0xC000013A)", () => {
    expect(detectKilledBySignal(3221225786)).toMatch(/STATUS_CONTROL_C_EXIT/);
    expect(detectKilledBySignal(3221225786)).toMatch(/Ctrl\+C/);
  });

  it("flags Windows STATUS_BREAK (3221225787)", () => {
    expect(detectKilledBySignal(3221225787)).toMatch(/STATUS_BREAK/);
  });

  it("flags Unix SIGINT (exit 130)", () => {
    expect(detectKilledBySignal(130)).toMatch(/SIGINT/);
  });

  it("flags Unix SIGKILL (exit 137)", () => {
    expect(detectKilledBySignal(137)).toMatch(/SIGKILL/);
  });

  it("flags Unix SIGTERM (exit 143)", () => {
    expect(detectKilledBySignal(143)).toMatch(/SIGTERM/);
  });

  it("flags unnamed signal exit codes in range 129..159", () => {
    expect(detectKilledBySignal(135)).toMatch(/signal 7/);
  });

  it("does NOT flag exit 0", () => {
    expect(detectKilledBySignal(0)).toBeNull();
  });

  it("does NOT flag ordinary non-zero exits (1, 2, 64)", () => {
    expect(detectKilledBySignal(1)).toBeNull();
    expect(detectKilledBySignal(2)).toBeNull();
    expect(detectKilledBySignal(64)).toBeNull();
  });

  it("does NOT flag orchestrator timeout sentinel (-1)", () => {
    expect(detectKilledBySignal(-1)).toBeNull();
  });

  it("returns null for null/undefined/non-numeric input", () => {
    expect(detectKilledBySignal(null)).toBeNull();
    expect(detectKilledBySignal(undefined)).toBeNull();
    expect(detectKilledBySignal("130")).toBeNull();
  });
});

describe("detectRuntimes", () => {
  it("returns one entry per matrix runtime with expected shape", () => {
    const runtimes = detectRuntimes();
    expect(Array.isArray(runtimes)).toBe(true);
    expect(runtimes.length).toBeGreaterThan(0);
    for (const r of runtimes) {
      expect(r).toHaveProperty("name");
      expect(r).toHaveProperty("available");
      expect(r).toHaveProperty("required");
      expect(r).toHaveProperty("minVersion");
      expect(r).toHaveProperty("version");
      expect(r).toHaveProperty("reason");
      expect(r).toHaveProperty("installHint");
    }
  });

  it("marks node as available when tests are running (we're on node right now)", () => {
    const runtimes = detectRuntimes();
    const node = runtimes.find((r) => r.name === "node");
    expect(node).toBeDefined();
    expect(node.available).toBe(true);
    expect(node.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("detectWorkers", () => {
  it("returns structured results with capability fields for CLI workers", () => {
    const workers = detectWorkers();
    expect(Array.isArray(workers)).toBe(true);
    const cli = workers.filter((w) => w.type === "cli");
    expect(cli.length).toBeGreaterThan(0);
    for (const w of cli) {
      expect(w).toHaveProperty("name");
      expect(w).toHaveProperty("available");
      expect(w).toHaveProperty("capable");
      expect(w).toHaveProperty("version");
      expect(w).toHaveProperty("minVersion");
      expect(w).toHaveProperty("reason");
      // When unavailable, installHint should be populated
      if (!w.available) {
        expect(w.reason).toBeTruthy();
      }
    }
  });

  it("includes API provider entries", () => {
    const workers = detectWorkers();
    const apiNames = workers.filter((w) => w.type === "api").map((w) => w.name);
    expect(apiNames).toEqual(expect.arrayContaining(["api-xai", "api-openai"]));
  });
});

describe("suggestInstall / detectPackageManager", () => {
  it("returns an OS hint keyed to the current platform", () => {
    const pm = detectPackageManager();
    expect(["windows", "macos", "linux"]).toContain(pm.os);
  });

  it("resolves install hint for a known worker", () => {
    const hint = suggestInstall("claude");
    expect(hint).toHaveProperty("os");
    expect(hint).toHaveProperty("docs");
    // command may be null on unknown OS but not for windows/macos/linux in the matrix
    expect(hint.command).toBeTruthy();
  });

  it("resolves install hint for a runtime", () => {
    const hint = suggestInstall("gh");
    expect(hint.command).toBeTruthy();
  });

  it("returns nulls for an unknown tool", () => {
    const hint = suggestInstall("definitely-not-a-real-tool-xyz123");
    expect(hint.command).toBeNull();
    expect(hint.docs).toBeNull();
  });
});
