import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeFixtureRuntimeArtifacts } from "./k8s-runtime-artifacts.mjs";
import { assertFixturePath, FIXTURE_RECEIPT_FILE } from "./k8s-fixture-common.mjs";

async function runPlan(args, cwd) {
  const receipt = JSON.parse(await readFile(path.join(path.dirname(cwd), FIXTURE_RECEIPT_FILE), "utf8"));
  const plan = await assertFixturePath(cwd, path.resolve(cwd, args[1]));
  await readFile(plan);
  const quorumArgument = args.find((argument) => argument.startsWith("--quorum="));
  const quorum = quorumArgument?.slice("--quorum=".length);
  const resumeIndex = args.indexOf("--resume-from");
  const resumeFrom = resumeIndex < 0 ? undefined : Number(args[resumeIndex + 1]);
  if (quorum !== receipt.choices.quorum || resumeFrom !== receipt.choices.resumeFrom || !args.includes("--foreground")) {
    throw new Error("K8S_E2E_SIGNED_PLAN_ARGS_CHANGED");
  }
  await writeFixtureRuntimeArtifacts({
    cwd, receipt, workdir: path.dirname(cwd), execution: { quorum, ...(resumeFrom !== undefined ? { resumeFrom } : {}) },
  });
  return { code: 0, stdout: '{"status":"completed"}\n', stderr: "" };
}

/** External pforge/gh fixture commands never execute Git or contact providers. */
export async function runFixtureCommand(args, { cwd = process.cwd() } = {}) {
  await readFile(path.join(cwd, ".vscode", "mcp.json"));
  if (args[0] === "smith") return { code: 0, stdout: '{"ok":true}\n', stderr: "" };
  if (args[0] === "drain-memory") return { code: 0, stdout: '{"queued":true}\n', stderr: "" };
  if (args[0] === "run-plan") return runPlan(args, cwd);
  if (args[0] === "gh" && args[1] === "pr" && args[2] === "create") {
    const index = args.indexOf("--head");
    const branch = args[index + 1];
    if (index < 0 || !/^claw\/[A-Za-z0-9._-]+$/.test(branch ?? "")) throw new Error("K8S_E2E_PR_ARGS_INVALID");
    return { code: 0, stdout: `https://example.com/pr/${branch.slice("claw/".length)}\n`, stderr: "" };
  }
  throw new Error("K8S_E2E_EXTERNAL_COMMAND_REFUSED");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const completed = await runFixtureCommand(process.argv.slice(2));
    process.stdout.write(completed.stdout);
    process.exitCode = completed.code;
  } catch {
    process.stderr.write("K8S_E2E_EXTERNAL_COMMAND_REFUSED\n");
    process.exitCode = 1;
  }
}
