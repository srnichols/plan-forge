/**
 * Issue #250 — when Plan Forge is vendored into a host project,
 * resolveFrameworkVersion() reported the HOST's version.
 *
 * Candidate #1 was `<serverDir>/../VERSION`, which is the install root for a
 * standalone plan-forge checkout but is `<host>/VERSION` when vendored at
 * `<host>/pforge-mcp`. The reported install logged FRAMEWORK_VERSION=3.38.1
 * (the host app's version) against a real installed 3.26.4, so the update
 * check compared 3.38.1 > 3.26.5, concluded it was ahead of latest, and
 * never offered the available patch. Silent, and in the direction that
 * suppresses updates rather than nagging about them.
 *
 * This is the same failure Issue #106 was meant to prevent — see the "report
 * the install's VERSION, NOT the project's" comments in server/main.mjs. The
 * #106 tests all pass; they simply never modelled a vendored layout.
 *
 * The fix is additive: `<serverDir>/package.json` is consulted first. It is
 * the install's own manifest, always co-located with server.mjs, and cannot
 * be the host's. Every #106 case still resolves exactly as before.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFrameworkVersion } from "../update-check.mjs";

let host;
let serverDir;

beforeEach(() => {
  host = mkdtempSync(join(tmpdir(), "pforge-250-"));
  serverDir = join(host, "pforge-mcp");
  mkdirSync(serverDir, { recursive: true });
});

afterEach(() => {
  rmSync(host, { recursive: true, force: true });
});

/** Reproduce the reported install exactly. */
function vendorIntoHost({ hostVersion = "3.38.1", hostName = "my-app", mcpVersion = "3.26.4" } = {}) {
  writeFileSync(join(host, "VERSION"), `${hostVersion}\n`);
  writeFileSync(join(host, "package.json"), JSON.stringify({ name: hostName, version: hostVersion }));
  writeFileSync(join(serverDir, "package.json"), JSON.stringify({ name: "plan-forge-mcp", version: mcpVersion }));
}

describe("vendored install reports its own version, not the host's (#250)", () => {
  it("returns the MCP package version, not the host VERSION file", () => {
    vendorIntoHost();
    expect(resolveFrameworkVersion({ serverDir })).toBe("3.26.4");
  });

  it("is not fooled by a projectDir pointing at the host either", () => {
    vendorIntoHost();
    expect(resolveFrameworkVersion({ serverDir, projectDir: host })).toBe("3.26.4");
  });

  it("ignores a stale VERSION file sitting next to the server", () => {
    // The reported install also carried pforge-mcp/VERSION=3.16.0 alongside
    // pforge-mcp/package.json=3.26.4 — a second, unmaintained source of truth.
    vendorIntoHost();
    writeFileSync(join(serverDir, "VERSION"), "3.16.0\n");
    expect(resolveFrameworkVersion({ serverDir })).toBe("3.26.4");
  });

  it("does not trust a parent VERSION when the parent package is not plan-forge", () => {
    // No MCP package.json at all — the last line of defence.
    writeFileSync(join(host, "VERSION"), "3.38.1\n");
    writeFileSync(join(host, "package.json"), JSON.stringify({ name: "my-app", version: "3.38.1" }));
    expect(resolveFrameworkVersion({ serverDir })).toBe("unknown");
  });

  it("still trusts the parent VERSION inside the plan-forge repo itself", () => {
    writeFileSync(join(host, "VERSION"), "3.26.6-dev\n");
    writeFileSync(join(host, "package.json"), JSON.stringify({ name: "plan-forge", version: "3.26.6-dev" }));
    expect(resolveFrameworkVersion({ serverDir })).toBe("3.26.6-dev");
  });

  it("strips a leading v and preserves a -dev suffix from package.json", () => {
    writeFileSync(join(serverDir, "package.json"), JSON.stringify({ version: "v3.26.6-dev" }));
    expect(resolveFrameworkVersion({ serverDir })).toBe("3.26.6-dev");
  });

  it("falls through when the MCP package.json has no usable version", () => {
    writeFileSync(join(host, "VERSION"), "3.26.6-dev\n");
    writeFileSync(join(host, "package.json"), JSON.stringify({ name: "plan-forge" }));
    writeFileSync(join(serverDir, "package.json"), JSON.stringify({ name: "plan-forge-mcp" }));
    expect(resolveFrameworkVersion({ serverDir })).toBe("3.26.6-dev");
  });

  it("falls through when the MCP package.json is malformed", () => {
    writeFileSync(join(host, "VERSION"), "3.26.6-dev\n");
    writeFileSync(join(host, "package.json"), JSON.stringify({ name: "plan-forge" }));
    writeFileSync(join(serverDir, "package.json"), "{ not json");
    expect(resolveFrameworkVersion({ serverDir })).toBe("3.26.6-dev");
  });
});

describe("this repo's own layout resolves correctly (#250)", () => {
  it("agrees with the shipped pforge-mcp/package.json", async () => {
    const { readFileSync } = await import("node:fs");
    const here = import.meta.dirname;
    const mcpDir = join(here, "..");
    const pkg = JSON.parse(readFileSync(join(mcpDir, "package.json"), "utf-8"));
    expect(resolveFrameworkVersion({ serverDir: mcpDir })).toBe(pkg.version.replace(/^v/i, ""));
  });
});
