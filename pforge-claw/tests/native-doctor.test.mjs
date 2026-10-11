import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../src/cli/doctor.mjs";
import { NATIVE_SCOPE_ERRORS } from "../src/jobs/native-command-supervisor.mjs";
import { g1Directory } from "./g1-runner-fixture.mjs";

const homes = [];

async function fixture({ local = true } = {}) {
  const home = await g1Directory("native-doctor-");
  homes.push(home);
  const config = JSON.parse(await readFile(new URL("../examples/single-host.json", import.meta.url), "utf8"));
  config.instanceId = "native-doctor";
  config.allowlist[0].userId = "owner";
  config.channels.telegram.generalChat = { chatId: "42" };
  config.projects[0].channel = { adapter: "telegram", chatId: "42", topicId: "101" };
  config.projects[0].repo.path = path.join(home, "repo");
  config.lanes[0].labels = [];
  if (!local) config.lanes[0].kind = "remote";
  await mkdir(config.projects[0].repo.path);
  await writeFile(path.join(home, "config.json"), JSON.stringify(config));
  return {
    home, env: { PFORGE_CLAW_TELEGRAM_TOKEN: "fixture-doctor-token" },
    which: async () => true, isGitRepo: async () => true, features: [],
    readFile: async () => '{"servers":{"plan-forge":{"command":"node","args":[]}}}',
  };
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("doctor verifies local native ownership rather than command availability alone", () => {
  it("requires actual root readiness and zero owned membership proof before reporting native execution available", async () => {
    const options = await fixture();
    const processRunner = vi.fn(async () => ({
      code: 0, stdout: "native-scope-probe", stderr: "", settlementConfirmed: true,
      settlement: {
        rootPid: 100, rootStartedAt: "native-birth", rootReady: true,
        stoppedPids: [100], settlementConfirmed: true, unknownProcesses: 0,
      },
    }));
    const report = await runDoctor({ ...options, processRunner });
    expect(report.checks).toContainEqual(expect.objectContaining({
      id: "process.ownership", status: "ok", code: "NATIVE_PROCESS_SCOPE_OK",
    }));
    expect(processRunner).toHaveBeenCalledWith(process.execPath, expect.any(Array), expect.objectContaining({
      requireSettlement: true, timeoutMs: 5000,
    }));
  });

  it.each([
    { code: 0, stdout: "native-scope-probe", settlementConfirmed: false },
    { code: 0, stdout: "native-scope-probe", settlementConfirmed: true, settlement: { rootReady: false } },
    { code: -1, stdout: "", error: { code: "PRIVATE_CREDENTIAL_CANARY" }, settlementConfirmed: false },
  ])("fails explicitly for missing or success-shaped native proof without leaking arbitrary errors", async (result) => {
    const report = await runDoctor({ ...await fixture(), processRunner: async () => result });
    expect(report.checks).toContainEqual(expect.objectContaining({
      id: "process.ownership", status: "fail", code: NATIVE_SCOPE_ERRORS.UNAVAILABLE,
    }));
    expect(JSON.stringify(report)).not.toContain("PRIVATE_CREDENTIAL_CANARY");
  });

  it("does not require a dispatcher-only remote home to control local execution processes", async () => {
    const processRunner = vi.fn();
    const report = await runDoctor({ ...await fixture({ local: false }), processRunner });
    expect(processRunner).not.toHaveBeenCalled();
    expect(report.checks).toContainEqual(expect.objectContaining({ id: "process.ownership", status: "skip" }));
  });
});
