import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanEnvironment } from "../../src/cli/dev.mjs";

const CLI = fileURLToPath(new URL("../../cli.mjs", import.meta.url));
let temporary;

afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

async function runDev(args, env = {}) {
  return new Promise((resolve, reject) => {
    const childEnvironment = { ...process.env, ...env };
    for (const [key, value] of Object.entries(childEnvironment)) {
      if (value === undefined) delete childEnvironment[key];
    }
    const child = spawn(process.execPath, [CLI, "dev", ...args], {
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function tempEnvironment() {
  temporary = await mkdtemp(path.join(os.tmpdir(), "claw-dev-e2e-"));
  return { TEMP: temporary, TMP: temporary, TMPDIR: temporary };
}

describe("scenario dev isolated topology controls", () => {
  it("rejects conflicting fake/live flags and requires a live token", async () => {
    const env = await tempEnvironment();
    const conflict = await runDev(["up", "--fake", "--live"], {
      ...env,
      PFORGE_CLAW_TELEGRAM_TOKEN: undefined,
    });
    expect(conflict.code).toBe(2);
    expect(conflict.stderr).toContain("Usage:");

    const missingLiveToken = await runDev(["up", "--live"], {
      ...env,
      PFORGE_CLAW_TELEGRAM_TOKEN: undefined,
    });
    expect(missingLiveToken.code).toBe(1);
    expect(missingLiveToken.stderr).toContain("LIVE_TOKEN_REQUIRED");
    expect(missingLiveToken.stderr).not.toContain("123456:");
  });

  it("makes down idempotent and refuses to kill a stale PID reused by this process", async () => {
    const env = await tempEnvironment();
    const home = path.join(temporary, "pforge-claw-dev");
    const stateFile = path.join(home, "dev.json");
    await mkdir(home, { recursive: true });
    await writeFile(stateFile, JSON.stringify({
      v: 1,
      processes: [{ pid: process.pid, startToken: "stale-start-time", role: "supervisor" }],
    }));

    const first = await runDev(["down"], env);
    const second = await runDev(["down"], env);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(() => process.kill(process.pid, 0)).not.toThrow();
  });

  it("scrubs inherited provider credentials from the child environment", async () => {
    const env = cleanEnvironment({
      PATH: "safe-path",
      GH_TOKEN: "gh-test-inherited",
      GITHUB_TOKEN: "github-test-inherited",
      PFORGE_CLAW_TELEGRAM_TOKEN: "telegram-test-inherited",
      COPILOT_TOKEN: "copilot-test-inherited",
      COPILOT_GITHUB_TOKEN: "copilot-github-test-inherited",
    });
    expect(env).toEqual({ PATH: "safe-path" });
  });
});
