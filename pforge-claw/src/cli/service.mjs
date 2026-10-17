import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHome } from "../config.mjs";
import { ClawError } from "../errors.mjs";
import { createSecrets } from "../secrets.mjs";
import { planServiceCommand, runServiceAction } from "../../service/service-manager.mjs";
import { collectStatus, formatStatus } from "./status.mjs";

const SERVICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "service");
const USAGE = "Usage: pforge claw service <install|uninstall|status> [--home <dir>] [--dry-run] [--json]";
const ACTIONS = new Set(["install", "uninstall", "status"]);

function parseServiceArgs(argv) {
  try {
    return parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: {
        home: { type: "string" },
        "dry-run": { type: "boolean" },
        json: { type: "boolean" },
      },
    });
  } catch {
    return null;
  }
}

async function performServiceAction({ action, plan, home, json }) {
  const secrets = await createSecrets({ file: path.join(home, "secrets.json") });
  const result = await runServiceAction(plan);
  const childOutput = secrets.redact(`${result.stdout}${result.stderr}`);
  if (result.code !== 0) {
    process.stderr.write(childOutput);
    return Number.isInteger(result.code) && result.code >= 0 ? result.code : 1;
  }
  if (action === "status") {
    const report = await collectStatus({ home });
    const output = json
      ? JSON.stringify({ service: childOutput.trim(), status: report })
      : `${childOutput.trim()}\n${formatStatus(report)}`;
    process.stdout.write(`${secrets.redact(output)}\n`);
  } else if (json) {
    process.stdout.write(`${JSON.stringify({ action, output: childOutput.trim() })}\n`);
  } else {
    process.stdout.write(childOutput);
  }
  return 0;
}

function reportServiceFailure(error) {
  const failure = error instanceof ClawError ? error : new ClawError("SERVICE_ACTION_FAILED");
  process.stderr.write(`${failure.code}\n`);
  return ["SERVICE_PLATFORM_UNSUPPORTED", "SERVICE_ACTION_INVALID"].includes(failure.code) ? 2 : 1;
}

async function run(argv = []) {
  const parsed = parseServiceArgs(argv);
  if (!parsed) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const [action, ...extra] = parsed.positionals;
  if (!ACTIONS.has(action) || extra.length) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const home = parsed.values.home ?? resolveHome();
  try {
    const plan = planServiceCommand({
      action,
      home,
      nodePath: process.execPath,
      cliPath: path.resolve(SERVICE_ROOT, "..", "cli.mjs"),
    });
    if (parsed.values["dry-run"]) {
      plan.args.push(process.platform === "win32" ? "-DryRun" : "--dry-run");
    }
    return await performServiceAction({
      action, plan, home, json: parsed.values.json === true,
    });
  } catch (error) {
    return reportServiceFailure(error);
  }
}

export default {
  name: "service",
  summary: "Install, remove, or inspect the Forge-Claw system service",
  usage: USAGE,
  run,
};
