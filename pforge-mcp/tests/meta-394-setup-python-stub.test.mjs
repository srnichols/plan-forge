/**
 * #394 — setup.sh must not depend on python3.
 *
 * On Windows, Git Bash's `command -v python3` finds the Microsoft Store App
 * Execution Alias stub, which exists but cannot run Python: it prints "Python
 * was not found" and exits 49. setup.sh runs under `set -euo pipefail`, so its
 * unprobed `python3 -` call aborted the install after pforge-mcp/ was copied,
 * and the Git Bash half of the release rehearsal failed on such a machine. The
 * step merges one JSON entry into .vscode/mcp.json; Node is already required.
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { IS_PLAN_FORGE_SOURCE } from "./helpers/source-repo.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SCRIPTS = ["setup.sh", "validate-setup.sh"];
const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";

const read = (file) => readFileSync(join(REPO_ROOT, file), "utf8");
const codeLines = (file) => read(file).split("\n").filter((line) => !/^\s*#/.test(line));

const FORGE_MASTER_ENTRY = { type: "stdio", command: "node", args: ["pforge-master/server.mjs"], cwd: "${workspaceFolder}" };
const MERGE_SNIPPET = /node - "\$VSCODE_MCP"[^\n]*<<'JSEOF'[^\n]*\n([\s\S]*?)\nJSEOF\n/;

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function mcpFile(contents) {
  const dir = mkdtempSync(join(tmpdir(), "pf-meta-394-"));
  tmpDirs.push(dir);
  const file = join(dir, "mcp.json");
  writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
  return file;
}

function runMerge(file) {
  const match = read("setup.sh").match(MERGE_SNIPPET);
  expect(match, "setup.sh merges the forge-master-chat server with node").not.toBeNull();
  return spawnSync(process.execPath, ["-", file], { input: match[1], encoding: "utf8" });
}

// Framework repository only: a project can own a setup.sh of its own (#360).
describe.skipIf(!IS_PLAN_FORGE_SOURCE)("#394 the installers do not depend on python3", () => {
  it.each(SCRIPTS)("%s never calls python3 (Windows resolves it to the Microsoft Store stub)", (file) => {
    expect(codeLines(file).filter((line) => /\bpython3\b/.test(line))).toEqual([]);
  });

  describe.skipIf(!BASH)("with bash available", () => {
    it.each(SCRIPTS)("%s still parses as bash", (file) => {
      const result = spawnSync(BASH, ["-n", file], { cwd: REPO_ROOT, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    });
  });
});

describe.skipIf(!IS_PLAN_FORGE_SOURCE)("#394 setup.sh adds the forge-master-chat MCP server with node", () => {
  it("adds the entry beside the existing servers and keeps every other key", () => {
    const plan = { type: "stdio", command: "node", args: ["pforge-mcp/server.mjs"] };
    const file = mcpFile({ servers: { "plan-forge": plan }, inputs: [] });
    const result = runMerge(file);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("MERGE .vscode/mcp.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ servers: { "plan-forge": plan, "forge-master-chat": FORGE_MASTER_ENTRY }, inputs: [] });
  });

  it("creates the servers object when the file has none", () => {
    const file = mcpFile({});
    expect(runMerge(file).status).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ servers: { "forge-master-chat": FORGE_MASTER_ENTRY } });
  });

  it("reads a file that starts with a byte-order mark", () => {
    const file = mcpFile(`\uFEFF${JSON.stringify({ servers: {} })}`);
    const result = runMerge(file);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).servers["forge-master-chat"]).toEqual(FORGE_MASTER_ENTRY);
  });

  it("is idempotent: a second run changes nothing and prints nothing", () => {
    const file = mcpFile({ servers: {} });
    runMerge(file);
    const once = readFileSync(file, "utf8");
    const second = runMerge(file);
    expect(second.status).toBe(0);
    expect(second.stdout).toBe("");
    expect(readFileSync(file, "utf8")).toBe(once);
  });

  it("keeps an entry the user already customized", () => {
    const custom = { command: "my-launcher" };
    const file = mcpFile({ servers: { "forge-master-chat": custom } });
    const result = runMerge(file);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(JSON.parse(readFileSync(file, "utf8")).servers["forge-master-chat"]).toEqual(custom);
  });

  it("exits non-zero on unreadable JSON so setup.sh can fall back to its NOTE", () => {
    const file = mcpFile("{ not json");
    expect(runMerge(file).status).not.toBe(0);
    expect(readFileSync(file, "utf8")).toBe("{ not json");
  });

  it("falls back to a NOTE instead of aborting when the merge fails", () => {
    const source = read("setup.sh");
    // setup.sh runs under `set -e`: a failing merge must be followed by `||`.
    const mergeLine = source.split("\n").find((line) => line.includes("node - \"$VSCODE_MCP\""));
    expect(mergeLine, "the node merge line").toBeDefined();
    expect(mergeLine).toMatch(/<<'JSEOF'\s*\|\|\s*yellow\s+"/);
    expect(source).toContain("(node not found)");
  });
});
