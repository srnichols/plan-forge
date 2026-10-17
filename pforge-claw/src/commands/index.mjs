import { ROLES } from "../enums.mjs";
import help from "./help.mjs";
import ask from "./ask.mjs";
import newCommand from "./new.mjs";
import run from "./run.mjs";
import skill from "./skill.mjs";
import task from "./task.mjs";
import status from "./status.mjs";
import jobs from "./jobs.mjs";
import budget from "./budget.mjs";
import remember from "./remember.mjs";
import recall from "./recall.mjs";
import idea from "./idea.mjs";
import bug from "./bug.mjs";
import abort from "./abort.mjs";
import retry from "./retry.mjs";
import lane from "./lane.mjs";
import lanes from "./lanes.mjs";
import fanout from "./fanout.mjs";
import forget from "./forget.mjs";

const SCOPES = Object.freeze(["project", "general", "both"]);
const GROUPS = Object.freeze(["Ask & memory", "Work", "Status & budget", "Admin"]);
const REQUIRED_FIELDS = Object.freeze([
  "name", "aliases", "args", "summary", "details", "examples", "roles", "scope",
  "mutating", "available", "sinceSlice", "group", "handle",
]);

export const COMMANDS = Object.freeze([
  help, ask, newCommand, run, skill, task, status, jobs, budget, remember, recall,
  idea, bug, abort, retry, lane, lanes, fanout, forget,
]);

export function validateRegistry(commands) {
  const tokens = new Set();
  for (const command of commands) {
    if (!command || REQUIRED_FIELDS.some((field) => !Object.hasOwn(command, field))) {
      throw new Error("Invalid command registry entry: missing field");
    }
    for (const token of [command.name, ...command.aliases]) {
      if (typeof token !== "string" || token.length === 0 || tokens.has(token.toLowerCase())) {
        throw new Error(`Invalid or duplicate command token: ${token}`);
      }
      tokens.add(token.toLowerCase());
    }
    if (!Array.isArray(command.roles) || command.roles.some((role) => !ROLES.includes(role))) {
      throw new Error(`Invalid roles for command: ${command.name}`);
    }
    if (!SCOPES.includes(command.scope) || !GROUPS.includes(command.group)) {
      throw new Error(`Invalid scope or group for command: ${command.name}`);
    }
    if (!Array.isArray(command.examples) || command.examples.length < 2 || command.examples.length > 3) {
      throw new Error(`Invalid examples for command: ${command.name}`);
    }
    if (command.available && typeof command.handle !== "function") {
      throw new Error(`Available command has no handler: ${command.name}`);
    }
  }
  return commands;
}

validateRegistry(COMMANDS);

export function findCommand(token) {
  if (typeof token !== "string") return undefined;
  const normalized = token.replace(/^\/+/, "").replace(/@[^@/]+$/, "").toLowerCase();
  return COMMANDS.find((command) =>
    command.name.toLowerCase() === normalized
    || command.aliases.some((alias) => alias.toLowerCase() === normalized));
}

function parseHelpText(text) {
  const match = /^(?:help|-help|--help)(?:\s+(.+))?$/i.exec(text);
  return match ? { kind: "help-text", ...(match[1] ? { topic: match[1].trim() } : {}) } : null;
}

export function parseText(value, { botUsername } = {}) {
  if (typeof value !== "string" || value.trim().length === 0) return { kind: "empty" };
  const text = value.trim();
  const helpText = parseHelpText(text);
  if (helpText) return helpText;
  if (!text.startsWith("/")) return { kind: "free", text };
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) return { kind: "unknown", token: text.split(/\s/, 1)[0] };
  const [rawName, mention] = match[1].split("@");
  if (mention && (!botUsername || mention.toLowerCase() !== botUsername.replace(/^@/, "").toLowerCase())) {
    return { kind: "other-bot" };
  }
  const command = findCommand(rawName);
  if (!command) return { kind: "unknown", token: `/${rawName}` };
  const argsText = match[2] ?? "";
  return {
    kind: "command",
    name: command.name,
    token: `/${rawName}`,
    argsText,
    args: argsText.trim() ? argsText.trim().split(/\s+/) : [],
  };
}

export function visibleCommands({ role, scope, commands = COMMANDS }) {
  return commands.filter((command) => command.available
    && command.roles.includes(role)
    && (command.scope === scope || command.scope === "both"));
}

function editDistance(left, right) {
  let prior = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        prior[column] + 1,
        prior[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    prior = current;
  }
  return prior[right.length];
}

export function suggest(token, pool = COMMANDS) {
  const normalized = String(token ?? "").replace(/^\/+/, "").toLowerCase();
  if (!normalized) return null;
  const matches = pool.flatMap((command) => [
    { name: command.name, token: command.name, isAlias: false },
    ...command.aliases.map((alias) => ({ name: command.name, token: alias, isAlias: true })),
  ].map((entry) => ({
    ...entry,
    distance: editDistance(normalized, entry.token.toLowerCase()),
  })))
    .filter((entry) => entry.distance <= 2)
    .sort((left, right) => left.distance - right.distance
      || Number(left.isAlias) - Number(right.isAlias)
      || left.name.localeCompare(right.name));
  if (matches.length) return matches[0].name;
  return pool.map((command) => command.name)
    .filter((name) => name.toLowerCase().startsWith(normalized))
    .sort((left, right) => left.localeCompare(right))[0] ?? null;
}

export function toMetadata(command) {
  return Object.fromEntries(Object.entries(command).filter(([key]) => key !== "handle"));
}
