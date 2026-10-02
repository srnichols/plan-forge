/**
 * #306 — VERSION, the package.json files and their lockfile entries move together.
 *
 * Releases used to bump only VERSION and pforge-mcp/package.json, so the root and
 * pforge-master package.json files sat at 3.8.1 for twenty minor releases.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "sync-versions.mjs");

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

describe("repository versions agree", () => {
  it("every package version matches VERSION", () => {
    const r = run(["--check"]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});

describe("sync-versions.mjs", () => {
  let root;
  const write = (rel, text) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const read = (rel) => readFileSync(join(root, rel), "utf8");

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pf-sync-versions-"));
    write("VERSION", "1.0.0-dev");
    write("package.json", '{\r\n  "name": "plan-forge",\r\n  "version": "0.9.0",\r\n  "devDependencies": { "x": { "version": "9.9.9" } }\r\n}\r\n');
    write("pforge-mcp/package.json", '{\n  "name": "plan-forge-mcp",\n  "version": "1.0.0-dev"\n}\n');
    write("pforge-master/package.json", '{\n    "name": "@pforge/pforge-master",\n    "version": "0.8.1"\n}\n');
    write("pforge-sdk/package.json", '{\n  "name": "pforge-sdk",\n  "version": "0.12.0"\n}\n');
    write("package-lock.json", `${JSON.stringify({
      name: "plan-forge", version: "0.9.0", lockfileVersion: 3,
      packages: {
        "": { name: "plan-forge", version: "0.9.0" },
        "pforge-mcp": { name: "plan-forge-mcp", version: "0.7.0" },
        "pforge-master": { name: "@pforge/pforge-master", version: "0.8.1" },
        "pforge-sdk": { version: "0.12.0" },
        "node_modules/x": { version: "9.9.9" },
      },
    }, null, 2)}\n`);
    write("pforge-mcp/package-lock.json", `${JSON.stringify({ name: "plan-forge-mcp", version: "0.7.0", packages: { "": { version: "0.7.0" } } }, null, 2)}\n`);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("--check names every field that disagrees and exits 1", () => {
    const r = run(["--check", "--root", root]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("package.json version is 0.9.0");
    expect(r.stderr).toContain("pforge-master/package.json version is 0.8.1");
    expect(r.stderr).toContain('package-lock.json packages["pforge-mcp"].version is 0.7.0');
    expect(r.stderr).not.toContain("pforge-sdk");
  });

  it("with a version, writes VERSION and every package, preserving formatting", () => {
    const r = run(["2.0.0", "--root", root]);
    expect(r.status, r.stderr).toBe(0);
    expect(read("VERSION")).toBe("2.0.0");
    expect(read("package.json")).toBe('{\r\n  "name": "plan-forge",\r\n  "version": "2.0.0",\r\n  "devDependencies": { "x": { "version": "9.9.9" } }\r\n}\r\n');
    expect(read("pforge-master/package.json")).toBe('{\n    "name": "@pforge/pforge-master",\n    "version": "2.0.0"\n}\n');
    expect(JSON.parse(read("pforge-sdk/package.json")).version).toBe("0.12.0");
    const lock = JSON.parse(read("package-lock.json"));
    expect([lock.version, lock.packages[""].version, lock.packages["pforge-mcp"].version, lock.packages["pforge-master"].version]).toEqual(["2.0.0", "2.0.0", "2.0.0", "2.0.0"]);
    expect(lock.packages["pforge-sdk"].version).toBe("0.12.0");
    expect(lock.packages["node_modules/x"].version).toBe("9.9.9");
    expect(JSON.parse(read("pforge-mcp/package-lock.json")).packages[""].version).toBe("2.0.0");
    expect(run(["--check", "--root", root]).status).toBe(0);
  });

  it("without a version, syncs the packages to VERSION", () => {
    expect(run(["--root", root]).status).toBe(0);
    expect(read("VERSION")).toBe("1.0.0-dev");
    expect(JSON.parse(read("package.json")).version).toBe("1.0.0-dev");
    expect(run(["--root", root]).stdout).toContain("already 1.0.0-dev");
  });

  it("rejects a malformed version without touching anything", () => {
    const r = run(["2.0", "--root", root]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("not a version");
    expect(read("VERSION")).toBe("1.0.0-dev");
  });

  it("skips packages a checkout does not have", () => {
    rmSync(join(root, "pforge-master"), { recursive: true });
    expect(run(["3.0.0", "--root", root]).status).toBe(0);
    expect(existsSync(join(root, "pforge-master"))).toBe(false);
  });
});
