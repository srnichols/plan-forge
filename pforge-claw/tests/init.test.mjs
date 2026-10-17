import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXAMPLES, initFromExample } from "../src/init.mjs";
import { validateConfig } from "../src/config.mjs";

const tempDirs = [];
const tmpDir = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "claw-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("init", () => {
  it.each(EXAMPLES)("creates validated %s template with a UUID", async (example) => {
    const result = await initFromExample({ example, outDir: await tmpDir() });
    expect(result.ok).toBe(true);
    expect(result.instanceId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
    const config = JSON.parse(await readFile(result.configPath, "utf8"));
    expect((await validateConfig(config)).ok).toBe(true);
    expect(result.requiredSecrets.map(({ name }) => name)).not.toContain(result.instanceId);
  });

  it("preserves instance id when forced and rejects existing files otherwise", async () => {
    const outDir = await tmpDir();
    const first = await initFromExample({ example: "single-host", outDir });
    const denied = await initFromExample({ example: "single-host", outDir });
    expect(denied.errors[0].code).toBe("INIT_EXISTS");
    const second = await initFromExample({ example: "single-host", outDir, force: true });
    expect(second.instanceId).toBe(first.instanceId);
    expect(second.preservedInstanceId).toBe(true);
  });

  it("rejects unknown examples and exposes only secret names and reasons", async () => {
    const unknown = await initFromExample({ example: "../config", outDir: await tmpDir() });
    expect(unknown.errors[0].code).toBe("INIT_UNKNOWN_EXAMPLE");
    const result = await initFromExample({ example: "single-host", outDir: await tmpDir() });
    expect(result.requiredSecrets[0]).toMatchObject({ name: expect.any(String), reason: expect.any(String) });
    expect(JSON.stringify(result)).not.toMatch(/ghp_|sk-/);
  });

  it("runs init without a doctor and rejects non-interactive init without arguments", async () => {
    const outDir = await tmpDir();
    const result = await runCli(["init", "--example", "single-host", "--out", outDir, "--no-doctor"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Set these secrets");
    const noArgs = await runCli(["init"], { stdin: "ignore" });
    expect(noArgs.code).toBe(2);
  });

  it("emits redacted JSON doctor output and fails runtime placeholders", async () => {
    const home = await tmpDir();
    const canary = "canary-" + "s3cr3t-" + "x".repeat(8);
    const result = await runCli(["doctor", "--json", "--home", home], {
      env: { PFORGE_CLAW_TEST_SECRET: canary },
      scrubPath: true,
    });
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ ok: false, summary: expect.any(Object), checks: expect.any(Array) });
    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain(canary);
  });
});

function runCli(args, { env = {}, stdin = "pipe", scrubPath = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("cli.mjs"), ...args], {
      cwd: path.resolve("."),
      env: { ...process.env, ...env, ...(scrubPath ? { PATH: "" } : {}) },
      stdio: [stdin, "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}
