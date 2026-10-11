import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, "..", "..");
const MCP_PACKAGE = "@modelcontextprotocol/sdk";
const PATCHED_RUNTIMES = Object.freeze([
  { name: MCP_PACKAGE, minimum: "1.31.0", entry: `${MCP_PACKAGE}/client/index.js` },
  { name: "proxy-addr", minimum: "2.0.8", entry: "proxy-addr" },
  { name: "sharp", minimum: "0.35.5", entry: "sharp" },
  { name: "source-map-js", minimum: "1.2.2", entry: "source-map-js" },
]);
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

function expectPatched(version, minimum) {
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  const actual = version.split(".").map(Number);
  const required = minimum.split(".").map(Number);
  const difference = actual.map((part, index) => part - required[index]).find((part) => part !== 0) ?? 0;
  expect(difference, `${version} must be at least ${minimum}`).toBeGreaterThanOrEqual(0);
}

function installedPackage({ name, entry }, resolver = require) {
  let directory = dirname(resolver.resolve(entry));
  for (;;) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      const candidate = readJson(manifest);
      if (candidate.name === name) return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Installed package manifest not found: ${name}`);
    directory = parent;
  }
}

const workspaces = ["pforge-mcp", "pforge-master", "pforge-claw"]
  .filter((name) => existsSync(join(root, name, "package.json")));
const locks = [{ name: "standalone MCP", file: join(root, "pforge-mcp", "package-lock.json") }];
const rootManifest = join(root, "package.json");
if (existsSync(rootManifest) && readJson(rootManifest).name === "plan-forge") {
  locks.push({ name: "framework workspace", file: join(root, "package-lock.json") });
}

describe("patched shipped runtime dependencies", () => {
  it.each(workspaces)("%s cannot resolve an affected MCP SDK version from its declared range", (workspace) => {
    const manifest = readJson(join(root, workspace, "package.json"));
    const range = manifest.dependencies[MCP_PACKAGE];
    expect(range).toMatch(/^\^\d+\.\d+\.\d+$/);
    expectPatched(range.slice(1), PATCHED_RUNTIMES[0].minimum);
  });

  it("the standalone image runtime declares the patched sharp floor", () => {
    const range = readJson(join(root, "pforge-mcp", "package.json")).dependencies.sharp;
    expect(range).toMatch(/^\^\d+\.\d+\.\d+$/);
    expectPatched(range.slice(1), PATCHED_RUNTIMES.find(({ name }) => name === "sharp").minimum);
  });

  for (const lock of locks) {
    it.each(PATCHED_RUNTIMES)(`${lock.name} locks every $name occurrence at the patched floor`, ({ name, minimum }) => {
      const suffix = `node_modules/${name}`;
      const occurrences = Object.entries(readJson(lock.file).packages)
        .filter(([key]) => key === suffix || key.endsWith(`/${suffix}`));
      expect(occurrences.length, `${lock.name} is missing ${name}`).toBeGreaterThan(0);
      for (const [, dependency] of occurrences) expectPatched(dependency.version, minimum);
    });
  }

  it.each(workspaces)("%s resolves its actual installed SDK at the patched floor", (workspace) => {
    const resolver = createRequire(join(root, workspace, "package.json"));
    const sdk = PATCHED_RUNTIMES[0];
    expectPatched(installedPackage(sdk, resolver).version, sdk.minimum);
  });

  it.each(PATCHED_RUNTIMES.filter(({ name }) => name !== MCP_PACKAGE))(
    "the actual installed $name runtime meets the same floor", (dependency) => {
    expectPatched(installedPackage(dependency).version, dependency.minimum);
    },
  );
});
