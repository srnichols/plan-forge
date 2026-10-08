import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCopilotRuntime } from "../../src/runtime/copilot-session.mjs";
import { startFakeOpenBrain } from "../helpers/fake-openbrain.mjs";
import { createFakeClock } from "../helpers/fake-clock.mjs";
import { createFixtureRepos } from "../helpers/fixture-repos.mjs";
import { createSessionFactory } from "../helpers/scripted-copilot.mjs";

let temporary;
let openbrain;
let fixtures;

afterEach(async () => {
  await openbrain?.close();
  openbrain = undefined;
  await fixtures?.cleanup();
  fixtures = undefined;
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

describe("scenario test-harness contracts", () => {
  it("keeps fixture repository opt-ins isolated and supports paths with spaces", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "claw harness with spaces-"));
    const directory = path.join(temporary, "caller-owned fixtures");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "keep.txt"), "owned by the test");
    fixtures = await createFixtureRepos(1, {
      directory,
      withForge: true,
      ghShim: true,
      visibility: "restricted",
    });

    const [project] = fixtures.projects;
    expect(project.visibility).toBe("restricted");
    expect(await readFile(path.join(project.repoPath, ".forge.json"), "utf8")).toContain('"v": 1');
    expect(await readFile(path.join(project.repoPath, ".forge", "fm-prefs.json"), "utf8")).toContain('"v": 1');
    expect(fixtures.ghShim.command).toHaveLength(2);

    await fixtures.cleanup();
    fixtures = undefined;
    expect(await readFile(path.join(directory, "keep.txt"), "utf8")).toBe("owned by the test");
  });

  it("deduplicates OpenBrain writes by idempotency key and exposes offline failure", async () => {
    openbrain = await startFakeOpenBrain();
    const first = await fetch(openbrain.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "capture-1" },
      body: JSON.stringify({ text: "fixture note" }),
    }).then((response) => response.json());
    const replay = await fetch(openbrain.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "capture-1" },
      body: JSON.stringify({ text: "fixture note" }),
    }).then((response) => response.json());
    expect(replay.item.id).toBe(first.item.id);
    expect(openbrain.items).toHaveLength(1);
    expect(openbrain.requests).toHaveLength(2);

    openbrain.setOnline(false);
    await expect(fetch(openbrain.endpoint)).rejects.toThrow();
  });

  it("injects a fake clock and scripts real SDK-event mapping with nullable usage", async () => {
    const clock = createFakeClock("2026-02-01T00:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(clock.advance(1000).toISOString()).toBe("2026-02-01T00:00:01.000Z");

    const sessions = createSessionFactory({
      defaultEvents: [
        { type: "assistant.message_delta", data: { deltaContent: "fixture progress" } },
        { type: "assistant.usage", data: { inputTokens: 4, outputTokens: null } },
      ],
    });
    const runtime = createCopilotRuntime({ createSession: sessions.createSession });
    const emitted = [];
    const result = await runtime.run({
      model: "fixture-model",
      prompt: "fixture prompt",
      cwd: process.cwd(),
      mcpServers: { fixture: { command: process.execPath, args: [] } },
      emit: (type, data) => emitted.push({ type, data }),
    });
    expect(result).toMatchObject({
      ok: true,
      usage: { tokensIn: 4, tokensOut: null, model: null },
    });
    expect(emitted).toContainEqual({ type: "progress", data: { text: "fixture progress" } });
    expect(sessions.seq).toBe(2);
  });
});
