import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runK8sE2e } from "../../scripts/k8s-e2e.mjs";

const RUN_K8S = process.env.PFORGE_CLAW_E2E_K8S === "1";
const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MAX_OUTPUT_BYTES = 10 * 1024;
const ACCEPTANCE_TIMEOUT_MS = 10 * 60_000;

function configuredOptions() {
  const options = {
    namespace: process.env.PFORGE_CLAW_E2E_K8S_NAMESPACE,
    context: process.env.PFORGE_CLAW_E2E_K8S_CONTEXT,
    dispatcherImage: process.env.PFORGE_CLAW_E2E_K8S_DISPATCHER_IMAGE,
    workerImage: process.env.PFORGE_CLAW_E2E_K8S_WORKER_IMAGE,
    fixtureConfig: process.env.PFORGE_CLAW_E2E_K8S_CONFIG,
  };
  if (![options.namespace, options.context, options.dispatcherImage, options.workerImage].every(Boolean)) {
    throw new Error("Explicit disposable namespace, local context, and both prebuilt fixture images are required.");
  }
  return options;
}

function shellInvocation(options) {
  const windows = process.platform === "win32";
  const flags = windows
    ? ["-Namespace", "-Context", "-DispatcherFixtureImage", "-WorkerFixtureImage"]
    : ["--namespace", "--context", "--dispatcher-fixture-image", "--worker-fixture-image"];
  const args = windows ? ["-NoProfile", "-File", path.join("scripts", "e2e-k8s.ps1")] : [path.join("scripts", "e2e-k8s.sh")];
  for (const [index, value] of [options.namespace, options.context, options.dispatcherImage, options.workerImage].entries()) {
    args.push(flags[index], value);
  }
  if (options.fixtureConfig) args.push(windows ? "-FixtureConfig" : "--fixture-config", options.fixtureConfig);
  return { command: windows ? "pwsh" : "bash", args };
}

function execute({ command, args }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: PACKAGE_ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("K8S acceptance timed out")); }, ACCEPTANCE_TIMEOUT_MS);
    const append = (current, bytes) => current + bytes.toString("utf8").slice(0, MAX_OUTPUT_BYTES - Buffer.byteLength(current));
    child.stdout.on("data", (bytes) => { stdout = append(stdout, bytes); });
    child.stderr.on("data", (bytes) => { stderr = append(stderr, bytes); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

describe("Kubernetes end-to-end lane", () => {
  it("fails closed without fixture images rather than claiming offline platform acceptance", async () => {
    const commands = [];
    const outcome = await runK8sE2e({ namespace: "pforge-claw-e2e-offline", context: "kind-fixture" }, {
      runner: async (...args) => { commands.push(args); throw new Error("cluster forbidden"); },
    });
    expect(outcome.status).toBe("blocked");
    expect(outcome.code).toBe("K8S_E2E_FIXTURE_CONTRACTS_PENDING");
    expect(commands).toEqual([]);
  });

  if (RUN_K8S) {
    it("requires actual Job, PR, canonical application and ACK-fenced cleanup from the configured cluster", async () => {
      const result = await execute(shellInvocation(configuredOptions()));
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).not.toMatch(/SKIPPED:|\"status\":\"(?:blocked|dry-run)\"/);
      const proof = JSON.parse(result.stdout.trim());
      expect(proof.status).toBe("passed");
      expect(proof.scenarioEvidence).toMatchObject({
        approvalConsumed: true, leaseGrantVerified: true, oneShot: true,
        applicationAck: { ok: true }, canonicalL2FileCount: 1, cleanedUp: true,
      });
      expect(proof.scenarioEvidence.jobId).toBeTruthy();
    }, ACCEPTANCE_TIMEOUT_MS);
  }
});
