import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RUN_K8S = process.env.PFORGE_CLAW_E2E_K8S === "1";
const run = RUN_K8S ? it : it.skip;
const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function execute(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PACKAGE_ROOT,
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

describe("Kubernetes end-to-end lane", () => {
  run(RUN_K8S
    ? "runs the K8sJobLane egress and TTL validation twins"
    : "runs the K8sJobLane egress and TTL validation twins (set PFORGE_CLAW_E2E_K8S=1 to run)",
  async (context) => {
    const result = process.platform === "win32"
      ? await execute("powershell.exe", ["-NoProfile", "-File", "scripts/e2e-k8s.ps1"])
      : await execute("bash", ["scripts/e2e-k8s.sh"]);
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    if (result.stdout.includes("SKIPPED:")) context.skip(result.stdout.trim());
    expect(result.stdout).toMatch(/job|egress/i);
  });

});
