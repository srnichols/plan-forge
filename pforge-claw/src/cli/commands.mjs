import { COMMANDS, toMetadata } from "../commands/index.mjs";

const USAGE = "Usage: pforge claw commands [--markdown | --json]";
const COLUMNS = Object.freeze(["name", "aliases", "args", "scope", "roles", "🔒", "available", "sinceSlice"]);

function textRows(commands) {
  return commands.map((command) => [
    command.name,
    command.aliases.join(","),
    command.args,
    command.scope,
    command.roles.join(","),
    command.mutating ? "yes" : "",
    String(command.available),
    String(command.sinceSlice),
  ]);
}

function renderText(commands) {
  const rows = textRows(commands);
  const widths = COLUMNS.map((column, index) => Math.max(column.length, ...rows.map((row) => row[index].length)));
  const format = (row) => row.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd();
  return [format(COLUMNS), ...rows.map(format)].join("\n");
}

function renderMarkdown(commands) {
  const header = `| ${COLUMNS.join(" | ")} |`;
  const divider = `| ${COLUMNS.map(() => "---").join(" | ")} |`;
  const rows = textRows(commands).map((row) =>
    `| ${row.map((value) => value.replace(/\|/g, "\\|")).join(" | ")} |`);
  return [header, divider, ...rows].join("\n");
}

export default {
  name: "commands",
  summary: "List registered chat commands",
  usage: USAGE,
  run(argv = []) {
    const options = new Set(argv);
    if (options.size !== argv.length || argv.some((flag) => !["--markdown", "--json"].includes(flag))
      || (options.has("--markdown") && options.has("--json"))) {
      process.stderr.write(`${USAGE}\n`);
      return 1;
    }
    const commands = COMMANDS.map(toMetadata);
    const output = options.has("--json") ? JSON.stringify(commands, null, 2)
      : options.has("--markdown") ? renderMarkdown(commands)
        : renderText(commands);
    process.stdout.write(`${output}\n`);
    return 0;
  },
};
