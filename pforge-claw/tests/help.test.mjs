import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { COMMANDS, findCommand, parseText, suggest, toMetadata, visibleCommands } from "../src/commands/index.mjs";
import helpCommand from "../src/commands/help.mjs";
import { CALLBACK_PREFIXES } from "../src/callbacks/index.mjs";
import { renderCommandHelp, renderHelp, splitHelp } from "../src/handlers/help.mjs";
import { createRegistry } from "../src/registry.mjs";
import { createStore } from "../src/state/store.mjs";
import { createRouter } from "../src/router.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directories = [];

function exampleCommand(values) {
  return {
    name: values.name,
    aliases: [],
    args: "",
    summary: `${values.name} ${"description ".repeat(3)}`,
    details: `${values.name} details`,
    examples: [`/${values.name}`, `/${values.name} example`],
    roles: values.roles,
    scope: values.scope,
    mutating: values.mutating ?? false,
    available: values.available ?? true,
    sinceSlice: 5,
    group: values.group ?? "Work",
    handle: async () => undefined,
  };
}

describe("help rendering and menu wiring", () => {
  it("filters commands by role and topic and includes the project name", () => {
    const registry = [
      COMMANDS.find((command) => command.name === "help"),
      exampleCommand({ name: "ask", roles: ["owner", "viewer"], scope: "project" }),
      exampleCommand({ name: "lane", roles: ["owner"], scope: "general", group: "Admin" }),
      exampleCommand({ name: "run", roles: ["owner"], scope: "project", mutating: true }),
    ];
    const projectOwner = renderHelp({ role: "owner", scope: "project", project: { name: "Atlas" }, commands: registry });
    const projectViewer = renderHelp({ role: "viewer", scope: "project", project: { name: "Atlas" }, commands: registry });
    const generalOwner = renderHelp({ role: "owner", scope: "general", commands: registry });
    expect(projectOwner).toContain("📁 Atlas — commands");
    expect(projectOwner).toContain("/run");
    expect(projectViewer).toContain("/ask");
    expect(projectViewer).not.toContain("/run");
    expect(generalOwner).toContain("🧭 General — dispatcher & cross-project");
    expect(generalOwner).toContain("/lane");
    expect(generalOwner).not.toContain("/ask");
  });

  it("marks mutating commands and hides unavailable commands", () => {
    const registry = [
      exampleCommand({ name: "run", roles: ["owner"], scope: "project", mutating: true }),
      exampleCommand({ name: "forget", roles: ["owner"], scope: "project", available: false }),
    ];
    const text = renderHelp({ role: "owner", scope: "project", commands: registry });
    expect(text).toContain("🔒 needs approval");
    expect(text).not.toContain("/forget");
  });

  it("keeps unavailable /help <command> details hidden and renders visible metadata directly", () => {
    // Derive the example from the live registry so later slices flipping `available` never break this test.
    let registry = COMMANDS;
    let target = COMMANDS.find((command) => !command.available);
    if (!target) {
      const flipped = COMMANDS.find((command) => command.name !== "help");
      registry = COMMANDS.map((command) => command === flipped ? { ...command, available: false } : command);
      target = registry.find((command) => command.name === flipped.name);
    }
    const role = target.roles[0];
    const scope = target.scope === "general" ? "general" : "project";
    const hiddenMetadata = toMetadata(target);
    const hidden = renderCommandHelp(hiddenMetadata, { role, scope, commands: registry });
    expect(hidden).toContain("Unknown command");
    expect(hidden).not.toContain(hiddenMetadata.details);
    const suggestion = suggest(target.name, visibleCommands({ role, scope, commands: registry }));
    if (suggestion) expect(hidden).toContain(`Did you mean /${suggestion}?`);
    else expect(hidden).not.toContain("Did you mean");
    for (const command of visibleCommands({ role: "owner", scope: "project", commands: registry })) {
      const metadata = toMetadata(command);
      expect(renderCommandHelp(metadata, { role: "owner", scope: "project", commands: registry })).toContain(metadata.details);
    }
  });

  it("recognizes help aliases and /start", async () => {
    expect(parseText("help").kind).toBe("help-text");
    expect(parseText("--help").kind).toBe("help-text");
    expect(parseText("-help").kind).toBe("help-text");
    expect(parseText("/start")).toMatchObject({ kind: "command", name: "help" });
    const result = await helpCommand.handle(
      { scope: "project", project: { name: "Demo" } },
      { caller: { role: "owner" }, argsText: "" },
    );
    expect(result[0].text).toContain("📁 Demo — commands");
  });

  it("splits oversized help output on lines and enforces the raw size limit", () => {
    const registry = Array.from({ length: 180 }, (_value, index) => exampleCommand({
      name: `entry-${index}`,
      roles: ["owner"],
      scope: "project",
    }));
    const chunks = splitHelp(renderHelp({ role: "owner", scope: "project", commands: registry }));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
    expect(chunks.join("\n")).toContain("/entry-179");
  });

  it("passes role-filtered topic-union menus through setMyCommands payloads", async () => {
    const config = {
      channels: { telegram: { generalChat: { chatId: "shared-chat", topicId: "general-topic" } } },
      allowlist: [
        { channel: "telegram", userId: "owner-1", role: "owner" },
        { channel: "telegram", userId: "viewer-1", role: "viewer" },
      ],
      projects: [{
        id: "workspace",
        name: "Workspace",
        channel: { adapter: "telegram", chatId: "shared-chat", topicId: "project-topic" },
        repo: { path: path.join(os.tmpdir(), "claw-menu-project") },
      }],
    };
    const directory = mkdtempSync(path.join(os.tmpdir(), "claw-menu-"));
    directories.push(directory);
    const store = createStore(directory);
    const calls = [];
    const channel = {
      setMenu: async (commands, options) => calls.push({ commands, scope: options.scope }),
      send: async () => {},
      answerCallback: async () => {},
    };
    const router = createRouter({ config, channel, store, registry: createRegistry(config) });
    const menus = router.buildMenus();
    expect(menus.map(({ scope }) => scope.type)).toEqual(["chat", "chat_member"]);
    expect(menus[1].scope).toEqual({ type: "chat_member", chat_id: "shared-chat", user_id: "viewer-1" });
    const topics = ["project", "general"];
    const expectedOwner = COMMANDS.filter((command) => topics.some((scope) =>
      visibleCommands({ role: "owner", scope }).some(({ name }) => name === command.name)))
      .map((command) => command.name);
    const expectedViewer = COMMANDS.filter((command) => topics.some((scope) =>
      visibleCommands({ role: "viewer", scope }).some(({ name }) => name === command.name)))
      .map((command) => command.name);
    expect(menus[0].commands.map(({ command }) => command)).toEqual(expectedOwner);
    expect(menus[1].commands.map(({ command }) => command)).toEqual(expectedViewer);
    const synced = await router.syncMenus();
    expect(synced).toEqual({ ok: true, synced: menus.length, failed: [] });
    expect(calls).toEqual(menus.map(({ commands, scope }) => ({ commands, scope })));
  });

  afterEach(() => {
    directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  });

  it("drift guard keeps command, callback and router dispatch modules in sync", () => {
    const commandFiles = readdirSync(path.join(ROOT, "src", "commands"))
      .filter((file) => file.endsWith(".mjs") && file !== "index.mjs").sort();
    expect(commandFiles).toEqual(COMMANDS.map(({ name }) => `${name}.mjs`).sort());
    for (const command of COMMANDS) {
      expect(commandFiles).toContain(`${command.name}.mjs`);
      expect(typeof command.handle).toBe("function");
      expect(typeof findCommand(command.name).handle).toBe("function");
    }
    for (const name of ["ask", "help"]) expect(findCommand(name)).toBeDefined();
    const callbackFiles = readdirSync(path.join(ROOT, "src", "callbacks"));
    for (const prefix of CALLBACK_PREFIXES) expect(callbackFiles).toContain(`${prefix}.mjs`);
    const routerSource = readFileSync(path.join(ROOT, "src", "router.mjs"), "utf8");
    expect(routerSource).toContain('commandByName(commandRegistry, "ask")');
    expect(routerSource).toContain('commandByName(commandRegistry, "help")');
  });
});
