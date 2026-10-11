import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MockReasoningClient } from "../src/__fixtures__/MockReasoningClient.mjs";
import { classify, LANES } from "../src/intent-router.mjs";
import { appendContextBlocks, OPERATOR_CONTEXT_HEADING, renderContextBlocks } from "../src/context-blocks.mjs";
import { runTurn } from "../src/reasoning.mjs";

const TRUNCATION_MARKER = "\n…(truncated)";
let testDir;

function makeTestDir() {
  testDir = mkdtempSync(join(tmpdir(), "forge-master-context-blocks-"));
  return testDir;
}

function makeDeps(client, overrides = {}) {
  const config = {
    reasoningModel: "test-model",
    reasoningProvider: "anthropic",
    reasoningProviderExplicit: true,
    routerModel: "test-router",
    maxToolCalls: 5,
    ceilingToolCalls: 10,
    l3Enabled: false,
    discoverExtensionTools: true,
    sessionRetentionDays: 14,
  };
  return {
    provider: client,
    skipPlanner: true,
    forceKeywordOnly: true,
    dispatcher: async () => ({ result: "ok" }),
    hub: null,
    toolMetadata: {},
    recall: async () => null,
    config,
    getForgeMasterConfig: () => config,
    ...overrides,
  };
}

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("renderContextBlocks", () => {
  it("renders each block once, in order, with safe single-line titles and multiline text", () => {
    const rendered = renderContextBlocks([
      { title: "First\nblock", text: "line one\nline two" },
      { title: "Second", text: "other context" },
    ]);

    expect(rendered.truncated).toBe(false);
    expect(rendered.text).toBe(
      `${OPERATOR_CONTEXT_HEADING}\n\n### First block\nline one\nline two\n\n### Second\nother context`,
    );
    expect(rendered.text.split(OPERATOR_CONTEXT_HEADING)).toHaveLength(2);
  });

  it.each([undefined, []])("renders no section for %s", (blocks) => {
    expect(renderContextBlocks(blocks)).toEqual({ text: "", truncated: false });
  });

  it("returns empty text when normalization rejects a block", () => {
    expect(renderContextBlocks([{ title: 1, text: "invalid" }])).toEqual({ text: "", truncated: false });
  });

  it.each([4095, 4096, 4097])("caps combined block text at the 4 KB boundary (%i bytes)", (byteCount) => {
    const rendered = renderContextBlocks([{ title: "Context", text: "x".repeat(byteCount) }]);

    expect(Buffer.byteLength(rendered.text.slice(rendered.text.indexOf("\n\n### Context\n") + "\n\n### Context\n".length), "utf8"))
      .toBeLessThanOrEqual(4096);
    expect(rendered.truncated).toBe(byteCount > 4096);
    if (byteCount > 4096) expect(rendered.text.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("caps bytes across multiple blocks and cuts multibyte text on a valid UTF-8 boundary", () => {
    const contentLimit = 4096 - Buffer.byteLength(TRUNCATION_MARKER, "utf8");
    const rendered = renderContextBlocks([
      { title: "First", text: "a".repeat(1500) },
      { title: "Second", text: `${"b".repeat(contentLimit - 1501)}😀${"c".repeat(100)}` },
    ]);
    const roundTrip = Buffer.from(rendered.text, "utf8").toString("utf8");

    expect(rendered.truncated).toBe(true);
    expect(rendered.text.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(roundTrip).toBe(rendered.text);
    expect(roundTrip).not.toContain("\uFFFD");
  });
});

describe("appendContextBlocks", () => {
  it("preserves the original context string reference when there are no blocks", () => {
    const context = "memory context";
    expect(appendContextBlocks(context, undefined)).toBe(context);
  });

  it("uses only the operator section when memory context is empty", () => {
    expect(appendContextBlocks("", [{ title: "Queue", text: "2 held jobs" }]))
      .toBe(`${OPERATOR_CONTEXT_HEADING}\n\n### Queue\n2 held jobs`);
  });
});

describe("runTurn context block integration", () => {
  it("places operator context after memory and also renders it without memory", async () => {
    const cwd = makeTestDir();
    const input = {
      message: "what is my plan status?",
      cwd,
      sessionId: "ephemeral",
      contextBlocks: [{ title: "Forge-Claw state", text: "queue depth: 2" }],
    };
    const memoryClient = new MockReasoningClient([{ type: "reply", content: "Status ready." }]);
    await runTurn(input, makeDeps(memoryClient, {
      recall: async (key) => key === "session.context" ? "memory context marker" : null,
    }));
    const memoryPrompt = memoryClient.calls[0].messages[0].content;
    expect(memoryPrompt.indexOf("memory context marker")).toBeLessThan(memoryPrompt.indexOf(OPERATOR_CONTEXT_HEADING));
    expect(memoryPrompt).toContain("queue depth: 2");

    const emptyClient = new MockReasoningClient([{ type: "reply", content: "Status ready." }]);
    await runTurn(input, makeDeps(emptyClient));
    const emptyMemoryPrompt = emptyClient.calls[0].messages[0].content;
    expect(emptyMemoryPrompt).toContain(OPERATOR_CONTEXT_HEADING);
    expect(emptyMemoryPrompt).not.toContain("(no context available)");
  });

  it("keeps the system prompt byte-identical when context blocks are omitted or empty", async () => {
    const cwd = makeTestDir();
    const clientA = new MockReasoningClient([{ type: "reply", content: "Status ready." }]);
    const clientB = new MockReasoningClient([{ type: "reply", content: "Status ready." }]);
    const input = { message: "what is my plan status?", cwd, sessionId: "ephemeral" };

    await runTurn(input, makeDeps(clientA));
    await runTurn({ ...input, contextBlocks: [] }, makeDeps(clientB));

    const promptA = clientA.calls[0].messages[0].content;
    expect(clientB.calls[0].messages[0].content).toBe(promptA);
    expect(promptA).not.toContain(OPERATOR_CONTEXT_HEADING);
  });

  it("preserves replacement tokens literally and reports normalized input truncation", async () => {
    const cwd = makeTestDir();
    const payload = "$& and $'";
    const client = new MockReasoningClient([{ type: "reply", content: "Status ready." }]);
    const result = await runTurn({
      message: "what is my plan status?",
      cwd,
      sessionId: "ephemeral",
      contextBlocks: [{ title: "Literal payload", text: payload }],
    }, makeDeps(client));
    expect(client.calls[0].messages[0].content).toContain(payload);

    const oversizedClient = new MockReasoningClient([{ type: "reply", content: "Status ready." }]);
    const oversizedResult = await runTurn({
      message: "what is my plan status?",
      cwd,
      sessionId: "ephemeral",
      contextBlocks: [{ title: "Large payload", text: "x".repeat(4097) }],
    }, makeDeps(oversizedClient));
    expect(oversizedResult.truncated.context).toBe(true);
    expect(result.truncated.context).toBe(false);
  });
});

describe("claw-ops intent classification", () => {
  it.each([
    ["what's in the bot's queue?", LANES.OPERATIONAL],
    ["any held jobs?", LANES.OPERATIONAL],
    ["which jobs are on hold?", LANES.OPERATIONAL],
    ["how many jobs are queued?", LANES.OPERATIONAL],
    ["how many workers are busy?", LANES.OPERATIONAL],
    ["which workers are available?", LANES.OPERATIONAL],
    ["which lanes are free?", LANES.OPERATIONAL],
    ["how much budget is left today?", LANES.OPERATIONAL],
    ["what's waiting for approval?", LANES.OPERATIONAL],
    ["forge-claw worker pool status", LANES.OPERATIONAL],
    ["why did the worker crash?", LANES.TROUBLESHOOT],
    ["I want to implement a job queue", LANES.BUILD],
  ])("%s → %s", async (message, expectedLane) => {
    const cwd = makeTestDir();
    const result = await classify(message, {
      keywordOnly: true,
      embeddingFallback: false,
      cwd,
    });
    expect(result.lane).toBe(expectedLane);
  });
});
