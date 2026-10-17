#!/usr/bin/env node
import { ClawError } from "./src/errors.mjs";
import { SUBCOMMANDS } from "./src/enums.mjs";

const LOADERS = {
  init: () => import("./src/cli/init.mjs"),
  doctor: () => import("./src/cli/doctor.mjs"),
  status: () => import("./src/cli/status.mjs"),
  start: () => import("./src/cli/start.mjs"),
  worker: () => import("./src/cli/worker.mjs"),
  service: () => import("./src/cli/service.mjs"),
  dev: () => import("./src/cli/dev.mjs"),
  commands: () => import("./src/cli/commands.mjs"),
};

const loaderNames = Object.keys(LOADERS).sort();
if (loaderNames.length !== SUBCOMMANDS.length || loaderNames.some((name, index) => name !== [...SUBCOMMANDS].sort()[index])) {
  throw new Error("CLI loader map does not match SUBCOMMANDS");
}

function usage(modules) {
  const lines = ["Usage: pforge claw <command> [options]", "", "Commands:"];
  for (const command of modules) {
    lines.push(`  ${command.name.padEnd(10)} ${command.summary}`);
  }
  lines.push("", "Run 'pforge claw <command> --help' for command details.");
  return lines.join("\n");
}

async function main(argv) {
  const [subcommand, ...rest] = argv;
  if (!subcommand || ["help", "-h", "--help"].includes(subcommand)) {
    const modules = await Promise.all(SUBCOMMANDS.map((name) => LOADERS[name]()));
    process.stdout.write(`${usage(modules.map((module) => module.default))}\n`);
    return 0;
  }

  if (!Object.hasOwn(LOADERS, subcommand)) {
    const modules = await Promise.all(SUBCOMMANDS.map((name) => LOADERS[name]()));
    process.stderr.write(`${usage(modules.map((module) => module.default))}\n`);
    return 1;
  }

  const mod = (await LOADERS[subcommand]()).default;
  if (rest.some((argument) => argument === "--help" || argument === "-h")) {
    process.stdout.write(`${mod.usage}\n`);
    return 0;
  }
  return mod.run(rest);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof ClawError)) throw error;
  process.stderr.write(`error: ${error.code}\n`);
  process.exitCode = 1;
}
