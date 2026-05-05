/**
 * mock-gh.mjs — Creates a fake `gh` CLI binary in a per-test tmpdir.
 *
 * The fake binary is a Node script that reads a `_scenarios.json` file from
 * its own directory and returns scripted stdout/stderr/exit responses.
 * Scenarios are matched in declaration order; the first whose `match` array
 * is a prefix of the invocation's argv wins.  Omit `match` to create a
 * catch-all default scenario.
 *
 * Usage:
 *
 *   const mock = createMockGh([
 *     { match: ["issue", "create"], stdout: "https://github.com/o/r/issues/42\n" },
 *     { match: ["pr", "list"],      stdout: "[]\n" },
 *   ]);
 *   try {
 *     dispatchSlice(slice, { env: mock.env });
 *   } finally {
 *     mock.cleanup();
 *   }
 */

import { mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ─── Embedded Node script that acts as `gh` ───────────────────────────────────

const MOCK_SCRIPT = `
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);

let scenarios = [];
const scenariosPath = join(__dir, "_scenarios.json");
if (existsSync(scenariosPath)) {
  try {
    scenarios = JSON.parse(readFileSync(scenariosPath, "utf8"));
  } catch {}
}

for (const s of scenarios) {
  const { match, stdout = "", stderr = "", exit: code = 0 } = s;
  const isMatch = !match || match.every((m, i) => args[i] === m);
  if (isMatch) {
    if (stderr) process.stderr.write(stderr);
    process.stdout.write(stdout);
    process.exit(code);
  }
}

process.stderr.write("mock-gh: no scenario matched for: gh " + args.join(" ") + "\\n");
process.exit(1);
`.trimStart();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {{ match?: string[], stdout?: string, stderr?: string, exit?: number }} Scenario
 */

/**
 * Create a tmpdir-based fake `gh` CLI wired to `scenarios`.
 *
 * On Windows creates `gh.cmd`; on Unix creates a chmod-755 `gh` shell script.
 * Both wrappers invoke the same `_gh.mjs` Node script.
 *
 * @param {Scenario[]} scenarios
 * @returns {{ dir: string, env: object, updateScenarios(s: Scenario[]): void, cleanup(): void }}
 */
export function createMockGh(scenarios = []) {
  const dir = join(tmpdir(), `mock-gh-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, "_gh.mjs"), MOCK_SCRIPT);
  writeFileSync(join(dir, "_scenarios.json"), JSON.stringify(scenarios));

  if (process.platform === "win32") {
    // `%~dp0` expands to the .cmd file's directory (with trailing backslash)
    writeFileSync(join(dir, "gh.cmd"), `@echo off\nnode "%~dp0_gh.mjs" %*\n`);
  } else {
    const ghPath = join(dir, "gh");
    writeFileSync(ghPath, `#!/bin/sh\nexec node "${join(dir, "_gh.mjs")}" "$@"\n`);
    chmodSync(ghPath, 0o755);
  }

  const env = {
    ...process.env,
    PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`,
  };

  return {
    dir,
    env,

    /** Replace the current scenario list without recreating the tmpdir. */
    updateScenarios(newScenarios) {
      writeFileSync(join(dir, "_scenarios.json"), JSON.stringify(newScenarios));
    },

    /** Remove the tmpdir. Always call in afterEach / finally. */
    cleanup() {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}
