import { parseArgs } from "node:util";
import { resolveHome } from "../config.mjs";
import { initFromExample, initInteractive } from "../init.mjs";
import { formatDoctorReport, runDoctor } from "./doctor.mjs";

const USAGE = "Usage: pforge claw init [--example <single-host|multi-host|k8s>] --out <dir> [--force] [--no-doctor]";

function writeSecrets(secrets) {
  process.stdout.write("Set these secrets (env var or <home>/secrets.json):\n");
  for (const { name, reason } of secrets) process.stdout.write(`  ${name}: ${reason}\n`);
  if (secrets.length === 0) process.stdout.write("  None required by this configuration.\n");
}

async function run(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        example: { type: "string" },
        out: { type: "string" },
        force: { type: "boolean" },
        "no-doctor": { type: "boolean" },
      },
    });
  } catch {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const { example, out, force = false } = parsed.values;
  const doctor = !parsed.values["no-doctor"];
  const home = out ?? resolveHome();
  if (example && !out) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (!example && !process.stdin.isTTY) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const result = example
    ? await initFromExample({ example, outDir: home, force })
    : await initInteractive({ outDir: home, force });
  if (!result.ok) {
    const errors = result.errors.map(({ code, message }) => `${code}: ${message}`).join("\n");
    process.stderr.write(`${errors || "INIT_FAILED"}\n`);
    return result.errors.some(({ code }) => code === "INIT_EXISTS" || code === "INIT_UNKNOWN_EXAMPLE") ? 2 : 1;
  }
  process.stdout.write(`Configuration created: ${result.configPath}\n`);
  writeSecrets(result.requiredSecrets);
  if (doctor) {
    const report = await runDoctor({ home });
    process.stdout.write(`${formatDoctorReport(report)}\n`);
    if (!report.ok) process.stdout.write("Configuration created, setup incomplete.\n");
  }
  return 0;
}

export default {
  name: "init",
  summary: "Create a Forge-Claw configuration",
  usage: USAGE,
  run,
};
