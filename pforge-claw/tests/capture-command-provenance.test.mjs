import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import ideaCommand from "../src/commands/idea.mjs";
import bugCommand from "../src/commands/bug.mjs";
import { createCaptureService } from "../src/handlers/capture-commands.mjs";
import { currentJobs } from "../src/jobs/model.mjs";
import { createStore } from "../src/state/store.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const NOW = 1_800_000_000_000;
const directories = [];
const commands = [ideaCommand, bugCommand];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(TEST_DIRECTORY, ".capture-command-provenance-"));
  directories.push(directory);
  const project = { id: "p1", displayName: "Fixture project" };
  const store = createStore(path.join(directory, "state"), { now: () => new Date(NOW) });
  const mcp = { call: vi.fn(async (_projectId, tool) => {
    if (tool === "forge_crucible_submit") return { id: "fixture-smelt" };
    if (tool === "forge_bug_register") return { bugId: "BUG-1" };
    throw new Error("Unexpected fixture MCP tool");
  }) };
  let sequence = 0;
  const service = createCaptureService({
    config: { instanceId: "fixture-instance", projects: [project] },
    store, mcp, now: () => NOW, idFactory: () => (++sequence).toString(16).padStart(8, "0"),
    secrets: { redact: (text) => text },
    channel: { send: async () => [] },
  });
  return { project, store, mcp, service };
}

describe.each(commands)("$name actual capture command provenance", (command) => {
  it.each(["origin", "context"])("retains untrusted %s through the real capture service", async (provenance) => {
    const { project, store, mcp, service } = await fixture();
    const input = {
      argsText: "Captured third-party data",
      caller: { userId: "owner", role: "owner", channel: "telegram" },
      chatId: "chat", threadId: "topic", updateId: `proposal:${command.name}`,
      adapter: "telegram", messageId: "message",
      ...(provenance === "origin" ? { origin: "untrusted" }
        : { untrustedContext: [{ kind: "forward", text: "Captured third-party data" }] }),
    };
    const replies = await command.handle.call({ service }, { project }, input);
    expect(replies.length).toBeGreaterThan(0);
    const jobs = Object.values(currentJobs(store));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ state: "succeeded", meta: { origin: "untrusted" } });
    const audit = [...store.read("audit")].map(({ record }) => record);
    expect(audit).toContainEqual(expect.objectContaining({ command: command.name, origin: "untrusted" }));
    const [, tool, args] = mcp.call.mock.calls[0];
    if (command.name === "bug") {
      expect(tool).toBe("forge_bug_register");
      expect(args.evidence.origin).toBe("untrusted");
    } else {
      expect(tool).toBe("forge_crucible_submit");
      expect(args.source).toBe("human");
      expect(args).not.toHaveProperty("origin");
    }
  });
});
