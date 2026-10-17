import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const mcpRoot = join(import.meta.dirname, "..");
const runner = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const SDK_PACKAGE = "@modelcontextprotocol/sdk";
const STALE_VERSION = "1.29.0";
const fixtures = [];

afterEach(async () => {
  for (const directory of fixtures.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function writeSdk(directory, version) {
  const packageRoot = join(directory, "node_modules", SDK_PACKAGE);
  await mkdir(join(packageRoot, "client"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: SDK_PACKAGE, version, type: "module",
    exports: { "./client/index.js": "./client/index.js" },
  }));
  await writeFile(join(packageRoot, "client", "index.js"), "export {};\n");
}

async function createFixture(staleWorkspace) {
  const directory = await mkdtemp(join(import.meta.dirname, ".runtime-floor-fixture-"));
  fixtures.push(directory);
  const manifest = JSON.parse(await readFile(join(mcpRoot, "package.json"), "utf8"));
  const lockFile = join(mcpRoot, "package-lock.json");
  const lock = JSON.parse(await readFile(lockFile, "utf8"));
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "plan-forge", type: "module" }));
  await copyFile(lockFile, join(directory, "package-lock.json"));
  for (const workspace of ["pforge-mcp", "pforge-master", "pforge-claw"]) {
    const workspaceRoot = join(directory, workspace);
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(join(workspaceRoot, "package.json"), JSON.stringify({
      name: workspace, dependencies: manifest.dependencies,
    }));
  }
  const fixtureMcp = join(directory, "pforge-mcp");
  await mkdir(join(fixtureMcp, "tests"));
  await copyFile(lockFile, join(fixtureMcp, "package-lock.json"));
  await copyFile(join(import.meta.dirname, "runtime-dependency-floor.test.mjs"),
    join(fixtureMcp, "tests", "runtime-dependency-floor.test.mjs"));
  await writeSdk(directory, lock.packages[`node_modules/${SDK_PACKAGE}`].version);
  if (staleWorkspace) await writeSdk(join(directory, staleWorkspace), STALE_VERSION);
  return { directory, fixtureMcp };
}

async function runGuard(fixture) {
  const reportFile = join(fixture.directory, "result.json");
  const child = spawn(process.execPath, [
    runner, "run", "tests/runtime-dependency-floor.test.mjs",
    "--root", fixture.fixtureMcp, "--config", join(mcpRoot, "vitest.config.mjs"),
    "--configLoader", "runner", "--no-cache", "--maxWorkers", "1",
    "--reporter", "json", "--outputFile.json", reportFile,
  ], { cwd: fixture.fixtureMcp, stdio: ["ignore", "ignore", "inherit"], shell: false });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
  return { exitCode, report: JSON.parse(await readFile(reportFile, "utf8")) };
}

describe("runtime floor guard workspace resolution", () => {
  it("accepts independently patched workspace resolution", async () => {
    const { exitCode, report } = await runGuard(await createFixture());
    expect(exitCode).toBe(0);
    expect(report.numFailedTests).toBe(0);
    expect(report.numPassedTests).toBeGreaterThan(0);
  });

  it.each(["pforge-master", "pforge-claw"])(
    "rejects a stale nested SDK in %s while MCP remains patched", async (workspace) => {
      const { exitCode, report } = await runGuard(await createFixture(workspace));
      expect(exitCode).toBe(1);
      expect(report.numFailedTests).toBe(1);
      const failures = report.testResults.flatMap(({ assertionResults }) =>
        assertionResults.filter(({ status }) => status === "failed"));
      expect(failures).toHaveLength(1);
      expect(failures[0].fullName).toContain(workspace);
      expect(failures[0].failureMessages.join("\n")).toContain(`${STALE_VERSION} must be at least`);
    },
  );
});
