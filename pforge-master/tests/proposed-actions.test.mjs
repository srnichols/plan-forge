import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MockReasoningClient } from "../src/__fixtures__/MockReasoningClient.mjs";
import { runTurn } from "../src/reasoning.mjs";
import {
  ACTION_TYPES,
  ARGS_SCHEMA,
  EMPTY_MESSAGE,
  buildProposalInstruction,
  extractFencedJson,
  finalizeProposals,
  proposedActionsMessage,
  validateArgs,
  validateProposals,
} from "../src/proposed-actions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FENCE = "`".repeat(3);
let testDir;

function makeTestDir() {
  testDir = mkdtempSync(join(tmpdir(), "forge-master-proposed-actions-"));
  return testDir;
}

function makeDeps(client, overrides = {}) {
  const dispatcher = vi.fn(async () => ({ result: "ok" }));
  return {
    deps: {
      provider: client,
      skipPlanner: true,
      forceKeywordOnly: true,
      dispatcher,
      hub: null,
      toolMetadata: {},
      recall: async () => null,
      config: {
        reasoningModel: "test-model",
        reasoningProvider: "anthropic",
        reasoningProviderExplicit: true,
        routerModel: "test-router",
        maxToolCalls: 5,
        ceilingToolCalls: 10,
        l3Enabled: false,
        discoverExtensionTools: true,
        sessionRetentionDays: 14,
      },
      getForgeMasterConfig: () => ({
        reasoningModel: "test-model",
        reasoningProvider: "anthropic",
        reasoningProviderExplicit: true,
        routerModel: "test-router",
        maxToolCalls: 5,
        ceilingToolCalls: 10,
        l3Enabled: false,
        discoverExtensionTools: true,
        sessionRetentionDays: 14,
      }),
      ...overrides,
    },
    dispatcher,
  };
}

function proposal(type, args, fields = {}) {
  return { type, args, rationale: "Useful next step", ...fields };
}

function actionBlock(actions) {
  return `${FENCE}forge-actions\n${JSON.stringify(actions, null, 2)}\n${FENCE}`;
}

async function runReply(reply, input = {}, depsOverrides = {}) {
  const cwd = makeTestDir();
  const client = new MockReasoningClient([{ type: "reply", content: reply }]);
  const { deps, dispatcher } = makeDeps(client, depsOverrides);
  const result = await runTurn({
    message: "what is my plan status?",
    cwd,
    sessionId: "ephemeral",
    proposeActions: true,
    ...input,
  }, deps);
  return { result, client, dispatcher };
}

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("extractFencedJson", () => {
  it("parses a valid tagged JSON block and strips it", () => {
    const extracted = extractFencedJson(`Answer.\n\n${actionBlock([{ type: "idea" }])}`, "forge-actions");
    expect(extracted.data).toEqual([{ type: "idea" }]);
    expect(extracted.reply).toBe("Answer.");
    expect(extracted.found).toBe(true);
  });

  it("parses CRLF blocks", () => {
    const extracted = extractFencedJson(`${FENCE}forge-actions\r\n[1]\r\n${FENCE}`, "forge-actions");
    expect(extracted.data).toEqual([1]);
    expect(extracted.reply).toBe("");
    expect(extracted.found).toBe(true);
  });

  it("parses only the first complete block and strips every complete block", () => {
    const reply = `before\n${FENCE}forge-actions\n[1]\n${FENCE}\nmiddle\n${FENCE}forge-actions\n[2]\n${FENCE}\nafter`;
    const extracted = extractFencedJson(reply, "forge-actions");
    expect(extracted.data).toEqual([1]);
    expect(extracted.reply).toBe("before\n\nmiddle\n\nafter");
  });

  it("strips an unfinished tagged block through the end of the reply", () => {
    const extracted = extractFencedJson(`Answer.\n${FENCE}forge-actions\n[{"type":"idea"}`, "forge-actions");
    expect(extracted.data).toBeUndefined();
    expect(extracted.reply).toBe("Answer.");
    expect(extracted.found).toBe(true);
  });

  it("does not parse an oversized body", () => {
    const oversized = " ".repeat(8193);
    const extracted = extractFencedJson(`${FENCE}forge-actions\n${oversized}\n${FENCE}`, "forge-actions");
    expect(extracted.data).toBeUndefined();
    expect(extracted.reply).toBe("");
    expect(extracted.found).toBe(true);
  });

  it("leaves other tagged fences untouched", () => {
    const other = `${FENCE}json\n{"hello":"world"}\n${FENCE}`;
    const extracted = extractFencedJson(other, "forge-actions");
    expect(extracted.reply).toBe(other);
    expect(extracted.found).toBe(false);
  });
});

describe("validateArgs", () => {
  it("rejects missing required keys and values of the wrong type", () => {
    expect(validateArgs("retry", {})).toBeNull();
    expect(validateArgs("task", { description: 5 })).toBeNull();
    expect(validateArgs("toString", {})).toBeNull();
  });

  it("rejects an oversized job identifier", () => {
    expect(validateArgs("retry", { jobId: "j".repeat(201) })).toBeNull();
  });

  it("drops unknown and prototype-related keys while copying valid arguments", () => {
    const raw = JSON.parse('{"description":"  Investigate  ","preApproved":true,"__proto__":{"polluted":true}}');
    expect(validateArgs("task", raw)).toEqual({ description: "Investigate" });
    expect(Object.getPrototypeOf(validateArgs("task", raw))).toBe(Object.prototype);
  });
});

describe("validateProposals", () => {
  it("filters invalid items before applying the maximum and only keeps three valid proposals", () => {
    const input = [
      proposal("unknown", { text: "x" }),
      proposal("task", {}),
      proposal("idea", { text: "x" }),
      proposal("bug", { text: "x" }),
      proposal("remember", { text: "x" }),
      proposal("idea", { text: "fourth" }),
      proposal("bug", { text: "fifth" }),
    ];
    const validated = validateProposals(input);
    expect(validated.actions).toHaveLength(3);
    expect(validated.actions.map(({ type }) => type)).toEqual(["idea", "bug", "remember"]);
    expect(validated.dropped).toBe(2);
  });

  it("derives mutability and provenance, defaults confidence, caps rationale, and selects project id", () => {
    const validated = validateProposals([
      proposal("task", { description: "Build it" }, {
        mutating: false,
        origin: "trusted",
        confidence: "invalid",
        rationale: "r".repeat(220),
        projectId: "  project-a  ",
      }),
    ], { untrusted: true, projectId: "caller-project" });
    expect(validated.actions[0]).toMatchObject({
      type: "task",
      projectId: "project-a",
      confidence: "low",
      rationale: "r".repeat(200),
      origin: "untrusted",
      mutating: true,
    });
  });

  it("uses the caller project id when the model id is blank or too long", () => {
    const result = validateProposals([
      proposal("idea", { text: "x" }, { projectId: " ".repeat(3) }),
      proposal("idea", { text: "y" }, { projectId: "p".repeat(81) }),
    ], { projectId: " caller-project " });
    expect(result.actions.map(({ projectId }) => projectId)).toEqual(["caller-project", "caller-project"]);
  });

  it("fails closed for an unrecognized role", () => {
    const validated = validateProposals([
      proposal("task", { description: "Do it" }),
      proposal("bug", { text: "Issue" }),
    ], { role: "unexpected" });
    expect(validated.actions.map(({ type }) => type)).toEqual(["bug"]);
    expect(validated.dropped).toBe(1);
  });
});

describe("proposal instruction and result messages", () => {
  it("keeps restricted action names out of the viewer instruction", () => {
    const instruction = buildProposalInstruction({ role: "viewer" });
    expect(instruction).not.toContain("task");
    expect(instruction).not.toContain("retry");
    expect(instruction).not.toContain("abort");
    const ownerInstruction = buildProposalInstruction({ role: "owner" });
    for (const type of ACTION_TYPES) expect(ownerInstruction).toContain(`- ${type}:`);
  });

  it("keeps the schema aligned with the supported action types", () => {
    expect(Object.keys(ARGS_SCHEMA)).toEqual(ACTION_TYPES);
  });

  it("formats empty, dropped, and populated states", () => {
    expect(proposedActionsMessage({ count: 0 })).toBe(EMPTY_MESSAGE);
    expect(proposedActionsMessage({ count: 0, dropped: 2, role: "viewer" })).toBe(
      `${EMPTY_MESSAGE} (2 proposal(s) dropped: invalid, unknown type, or not permitted for role viewer.)`,
    );
    expect(proposedActionsMessage({ count: 2, dropped: 1 })).toBe(
      "2 action(s) proposed. Forge-Master does not execute them; the caller decides.",
    );
  });
});

describe("runTurn structured proposed actions", () => {
  it("returns validated items, strips the block, and adds instructions to the provider prompt", async () => {
    const { result, client } = await runReply(`Here is the next step.\n${actionBlock([
      proposal("task", { description: "Review phase 61" }),
    ])}`);
    expect(result.proposedActions[0]).toMatchObject({ type: "task", mutating: true });
    expect(result.reply).not.toContain("forge-actions");
    expect(client.calls[0].messages[0].content).toContain("forge-actions");
  });

  it("drops malformed JSON while stripping the block", async () => {
    const { result } = await runReply(`Answer.\n${FENCE}forge-actions\n{"broken":\n${FENCE}`);
    expect(result.proposedActions).toEqual([]);
    expect(result.proposedActionsMessage.startsWith(EMPTY_MESSAGE)).toBe(true);
    expect(result.proposedActionsMessage).toContain("1 proposal(s) dropped");
    expect(result.reply).toBe("Answer.");
  });

  it("drops unknown types and limits accepted proposals to three", async () => {
    const items = [
      proposal("unlisted", { text: "unknown" }),
      proposal("idea", { text: "one" }),
      proposal("bug", { text: "two" }),
      proposal("remember", { text: "three" }),
      proposal("idea", { text: "four" }),
    ];
    const { result } = await runReply(actionBlock(items));
    expect(result.proposedActions).toHaveLength(3);
    expect(result.proposedActions.map(({ type }) => type)).toEqual(["idea", "bug", "remember"]);
  });

  it("filters viewer proposals and allows approver mutating proposals", async () => {
    const block = actionBlock([
      proposal("task", { description: "Change something" }),
      proposal("bug", { text: "Found a bug" }),
    ]);
    const viewer = await runReply(block, { caller: { role: "viewer", channel: "chat" } });
    const approver = await runReply(block, { caller: { role: "approver", channel: "chat" } });
    expect(viewer.result.proposedActions.map(({ type }) => type)).toEqual(["bug"]);
    expect(approver.result.proposedActions.map(({ type }) => type)).toEqual(["task", "bug"]);
  });

  it("marks every action untrusted when the turn includes untrusted context", async () => {
    const { result } = await runReply(actionBlock([
      proposal("idea", { text: "Review this" }),
      proposal("bug", { text: "Potential issue" }),
    ]), {
      untrustedContext: [{ kind: "other", text: "Quoted external content" }],
    });
    expect(result.proposedActions.map(({ origin }) => origin)).toEqual(["untrusted", "untrusted"]);
  });

  it("returns the exact empty message when there is no block", async () => {
    const { result } = await runReply("This answer is informational.");
    expect(result.proposedActions).toEqual([]);
    expect(result.proposedActionsMessage).toBe(EMPTY_MESSAGE);
  });

  it("extracts proposals before response character truncation", async () => {
    const { result } = await runReply(`${"x".repeat(250)}\n${actionBlock([
      proposal("idea", { text: "Still retained" }),
    ])}`, { responseFormat: { maxChars: 200 } });
    expect(result.proposedActions).toHaveLength(1);
    expect(result.reply).toHaveLength(200);
    expect(result.truncated.reply).toBe(true);
  });

  it("preserves the legacy result and prompt when proposal requests are absent or false", async () => {
    for (const flag of [undefined, false]) {
      const cwd = makeTestDir();
      const client = new MockReasoningClient([{ type: "reply", content: actionBlock([
        proposal("idea", { text: "not requested" }),
      ]) }]);
      const { deps } = makeDeps(client);
      const result = await runTurn({
        message: "what is my plan status?",
        cwd,
        sessionId: "ephemeral",
        ...(flag === undefined ? {} : { proposeActions: flag }),
      }, deps);
      expect(result).not.toHaveProperty("proposedActions");
      expect(result).not.toHaveProperty("proposedActionsMessage");
      expect(result.reply).toContain("forge-actions");
      expect(client.calls[0].messages[0].content).not.toContain("forge-actions");
    }
  });

  it("adds empty proposals to no-provider results without losing error details", async () => {
    const cwd = makeTestDir();
    const config = {
      reasoningModel: "test-model",
      reasoningProvider: "unsupported",
      reasoningProviderExplicit: true,
      routerModel: "test-router",
      maxToolCalls: 5,
      ceilingToolCalls: 10,
      l3Enabled: false,
      discoverExtensionTools: true,
      sessionRetentionDays: 14,
    };
    const { deps } = makeDeps(null, { config, getForgeMasterConfig: () => config });
    const result = await runTurn({
      message: "what is my plan status?",
      cwd,
      sessionId: "ephemeral",
      proposeActions: true,
    }, deps);
    expect(result.proposedActions).toEqual([]);
    expect(result.proposedActionsMessage).toBe(EMPTY_MESSAGE);
    expect(result.error).toBe("no provider available");
    expect(result.suggestion).toBeTruthy();
  });

  it("never invokes a tool for a mutating proposal", async () => {
    const { result, dispatcher } = await runReply(actionBlock([
      proposal("task", { description: "Run a suggested task" }),
    ]));
    expect(result.proposedActions[0].mutating).toBe(true);
    expect(dispatcher).not.toHaveBeenCalled();
  });
});

describe("Guard: Forge-Master never executes proposals", () => {
  it("keeps proposal handling isolated from execution surfaces", () => {
    const proposedActionsSource = readFileSync(join(__dirname, "../src/proposed-actions.mjs"), "utf8");
    const reasoningSource = readFileSync(join(__dirname, "../src/reasoning.mjs"), "utf8");
    for (const forbidden of ["dispatcher", "invokeForgeTool", "invokeAllowlisted", "tool-bridge", "plan-executor"]) {
      expect(proposedActionsSource).not.toContain(forbidden);
    }
    expect(reasoningSource).toContain("./proposed-actions.mjs");
  });
});
