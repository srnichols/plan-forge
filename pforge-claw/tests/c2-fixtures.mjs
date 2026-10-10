import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { vi } from "vitest";
import { createStore } from "../src/state/store.mjs";
import { createRegistry } from "../src/registry.mjs";
import { createRouter } from "../src/router.mjs";
import { resolvePlan } from "../src/jobs/plan-resolution.mjs";
import { HOME_PLAN_RESOLVE_TOOL } from "../src/enums.mjs";

const directories = [];

export function c2Authority(project, caller = { channel: "telegram", userId: "u1", role: "owner" }) {
  return {
    caller,
    config: {
      projects: [project], allowlist: [caller], lanes: [],
      policy: { ghcpRoles: ["owner"], nonOwnerRuntime: "byok-only" },
      runtimes: { default: "copilot-sdk" },
    },
  };
}

export async function c2Fixture({ role = "owner", names = ["Phase-1-PLAN.md"], runtime } = {}) {
  const root = path.resolve(".forge", "c2-fixtures", randomUUID());
  directories.push(root);
  const repo = path.join(root, "repo");
  await mkdir(path.join(repo, "docs", "plans"), { recursive: true });
  for (const name of names) await writeFile(path.join(repo, "docs", "plans", name), "# Plan\n");
  const project = {
    id: "fixture-project", repo: { path: repo }, homeLane: "fixture-lane",
    channel: { adapter: "telegram", chatId: "fixture-chat", topicId: "fixture-topic" },
    ...(runtime ? { runtime } : {}),
  };
  const caller = { channel: "telegram", userId: "fixture-caller", role };
  const config = {
    projects: [project], allowlist: [caller],
    channels: { telegram: { generalChat: { chatId: "fixture-chat", topicId: "general-topic" } } },
    policy: { ghcpRoles: ["owner"], nonOwnerRuntime: "byok-only" },
    lanes: [{ id: "fixture-lane", kind: "local", enabled: true }],
    runtimes: {
      default: "copilot-sdk",
      byok: { openai: { keySecret: "FIXTURE_MODEL_KEY", endpoint: "https://example.com/v1" } },
    },
  };
  const stateDirectory = path.join(root, "state");
  const store = createStore(stateDirectory);
  const channel = {
    id: "telegram",
    send: vi.fn(async () => [{ messageId: "fixture-message" }]),
    edit: vi.fn(async () => {}),
    typing: vi.fn(async () => {}),
    answerCallback: vi.fn(async () => {}),
    setMenu: vi.fn(async () => {}),
  };
  const clients = { call: vi.fn(async (_projectId, tool, args) => {
    if (tool === HOME_PLAN_RESOLVE_TOOL) return resolvePlan({ root: repo, ...args });
    if (tool === "forge_run_skill") return { status: "dry-run", skillName: args.skill, readOnly: false };
    if (tool === "forge_estimate_quorum") return { modes: ["auto"] };
    return { reply: "Fixture answer" };
  }) };
  const secrets = { get: () => "fixture-key", redact: String };
  const registry = createRegistry(config);
  const pending = new Map();
  const services = { store, config, registry, pending, secrets };
  const mcp = { call: (tool, args) => clients.call(project.id, tool, args) };
  const deps = {
    ...services, mcp, project, caller, adapter: "telegram", chatId: "fixture-chat", threadId: "fixture-topic",
  };
  const context = { scope: "project", project, services: { ...services, mcp }, mcp };
  const router = createRouter({ config, registry, store, channel, clients, services });
  const update = (overrides = {}) => ({
    kind: "message", adapter: "telegram", updateId: "fixture-update",
    userId: caller.userId, chatId: deps.chatId, threadId: deps.threadId,
    messageId: "fixture-message", text: "/task inspect the fixture", ...overrides,
  });
  return {
    root, stateDirectory, project, caller, config, registry, store, channel, clients, secrets, pending,
    deps, context, router, services, update,
    askContext: { config, registry, store, channel, secrets, mcp: clients, services, pending },
  };
}

export async function cleanupC2Fixtures() {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
}
