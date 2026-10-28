/**
 * dotenv and the MCP stdio transport.
 *
 * server.mjs starts with `import "dotenv/config"`, and the MCP server speaks JSON-RPC over stdout. Whatever
 * dotenv prints there when it loads a .env file corrupts the stream: dotenv 17.0 began printing an
 * "injecting env" line, and `dotenv/config` was made quiet by default again in 18.0.4. This keeps a later
 * dotenv release from putting a line on stdout without anyone noticing.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DOTENV_CONFIG = pathToFileURL(createRequire(import.meta.url).resolve("dotenv/config")).href;
const PROBE_KEY = "PFORGE_DOTENV_PROBE";

/** The environment a server starts in, minus any dotenv setting that would make the result depend on the host. */
function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("DOTENV_") && name !== PROBE_KEY));
}

function loadInDirectory(directory) {
  const script = `import ${JSON.stringify(DOTENV_CONFIG)}; process.stderr.write(String(process.env.${PROBE_KEY}));`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: directory, env: cleanEnv(), encoding: "utf8", timeout: 30_000 });
}

describe("import \"dotenv/config\"", () => {
  it("loads a .env file and prints nothing to stdout", () => {
    const directory = mkdtempSync(join(tmpdir(), "pf-dotenv-"));
    try {
      writeFileSync(join(directory, ".env"), `${PROBE_KEY}=loaded\n`);
      const run = loadInDirectory(directory);
      expect(run.status, run.stderr).toBe(0);
      expect(run.stderr, "the value from .env reaches process.env").toBe("loaded");
      expect(run.stdout, "stdout belongs to the MCP transport").toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("prints nothing to stdout when there is no .env file", () => {
    const directory = mkdtempSync(join(tmpdir(), "pf-dotenv-"));
    try {
      const run = loadInDirectory(directory);
      expect(run.status, run.stderr).toBe(0);
      expect(run.stderr, "nothing is loaded").toBe("undefined");
      expect(run.stdout).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
