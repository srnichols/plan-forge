import { COMMANDS, suggest, visibleCommands } from "../commands/index.mjs";

const GROUP_ORDER = Object.freeze(["Ask & memory", "Work", "Status & budget", "Admin"]);

function commandName(value) {
  return String(value ?? "").replace(/^\/+/, "").toLowerCase();
}

function unknownHelp(name, { role, scope, commands = COMMANDS }) {
  const pool = visibleCommands({ role, scope, commands });
  const suggestion = suggest(name, pool) ?? "help";
  return `Unknown command \`/${name}\` — try /help\nDid you mean /${suggestion}?`;
}

export function renderHelp({ role, scope, project, commands: registry = COMMANDS } = {}) {
  const commands = visibleCommands({ role, scope, commands: registry });
  const heading = scope === "project"
    ? `📁 ${project?.name ?? project?.displayName ?? project?.id ?? "Project"} — commands`
    : "🧭 General — dispatcher & cross-project";
  const lines = [heading];
  for (const group of GROUP_ORDER) {
    const members = commands.filter((command) => command.group === group);
    if (members.length === 0) continue;
    lines.push("", group);
    for (const command of members) {
      lines.push(`/${command.name}${command.args ? ` ${command.args}` : ""} — ${command.summary}${command.mutating ? " 🔒 needs approval" : ""}`);
    }
  }
  lines.push("", "/help <command> for details");
  return lines.join("\n");
}

export function renderCommandHelp(command, { role, scope, commands: registry = COMMANDS } = {}) {
  const visible = visibleCommands({ role, scope, commands: registry });
  const matched = visible.find((item) => item.name === command?.name);
  if (!matched) return unknownHelp(commandName(command?.name), { role, scope, commands: registry });
  const location = matched.scope === "both" ? "anywhere"
    : matched.scope === "project" ? "project topics" : "#general";
  return [
    `/${matched.name}${matched.args ? ` ${matched.args}` : ""}`,
    matched.details,
    "",
    "Examples:",
    ...matched.examples.map((example) => `  ${example}`),
    "",
    `Roles: ${matched.roles.join(", ")}`,
    `Approval: ${matched.mutating ? "required" : "not required"}`,
    `Available in: ${location}`,
  ].join("\n");
}

export function splitHelp(text, limit = 4096) {
  const chunks = [];
  let chunk = "";
  for (const line of String(text).split("\n")) {
    if (chunk && chunk.length + line.length + 1 > limit) {
      chunks.push(chunk);
      chunk = "";
    }
    if (line.length > limit) {
      for (let offset = 0; offset < line.length; offset += limit) {
        const part = line.slice(offset, offset + limit);
        if (part.length === limit) chunks.push(part);
        else chunk = part;
      }
    } else {
      chunk = chunk ? `${chunk}\n${line}` : line;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
