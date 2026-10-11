import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { policyFor } from "../src/jobs/permission-policy.mjs";
import { createCopilotRuntime } from "../src/runtime/copilot-session.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
let root;
let worktree;
let outside;

beforeEach(async () => {
  root = await mkdtemp(path.join(TEST_DIRECTORY, ".claw-policy-"));
  worktree = path.join(root, "worktree");
  outside = path.join(root, "outside");
  await mkdir(path.join(worktree, "inside"), { recursive: true });
  await mkdir(outside);
  symlinkSync(outside, path.join(worktree, "escape"), process.platform === "win32" ? "junction" : "dir");
});

afterEach(async () => rm(root, { recursive: true, force: true }));

const request = (kind, properties = {}) => ({
  kind, ...(kind === "read" ? { path: "inside" } : {}), ...properties,
});
const allowed = { kind: "approved" };
const denied = { kind: "denied-by-rules" };

describe("job permission policy", () => {
  it.each([
    ["ask", false, "read", true],
    ["ask", false, "write", false],
    ["ask", false, "shell", false],
    ["ask", false, "mcp", true],
    ["capture", false, "url", false],
    ["skill", true, "read", true],
    ["skill", true, "write", false],
    ["skill", false, "read", true],
    ["task", false, "read", true],
    ["plan", false, "read", false],
    ["fanout", false, "read", false],
    ["unknown", false, "read", false],
  ])("%s readOnly=%s permission %s is %s", async (type, readOnly, kind, isAllowed) => {
    const result = await policyFor({ type, readOnly }, { worktree, project: {} })(request(kind));
    expect(result.kind === "approved").toBe(isAllowed);
  });

  it.each([
    ["inside/file.txt", true],
    ["../outside/file.txt", false],
    ["<absolute-outside-file>", false],
    ["escape/file.txt", false],
    ["escape/new-file.txt", false],
    ["", false],
  ])("validates worktree write target %s", async (fileName, isAllowed) => {
    const result = await policyFor({ type: "task" }, { worktree, project: {} })(
      request("write", { fileName: fileName === "<absolute-outside-file>" ? path.join(outside, "file.txt") : fileName }),
    );
    expect(result.kind === "approved").toBe(isAllowed);
  });

  it.each([
    ["git status", true],
    ["git status; rm -rf x", false],
    ["./git status", false],
    ["curl", false],
    ["gh pr create", false],
    ["npm test", true],
    ["node -e '$(bad)'", false],
    ["Invoke-WebRequest", false],
  ])("checks shell command %s", async (command, isAllowed) => {
    const result = await policyFor({ type: "task" }, {
      worktree,
      project: { testCommands: [["npm", "test"]] },
    })(request("shell", { command }));
    expect(result.kind === "approved").toBe(isAllowed);
  });

  it("permits only the Plan Forge MCP server and denies remote access kinds", async () => {
    const policy = policyFor({ type: "task" }, { worktree, project: {} });
    await expect(policy(request("mcp", { serverName: "plan-forge" }))).resolves.toEqual(allowed);
    await expect(policy(request("mcp", { serverName: "other" }))).resolves.toMatchObject(denied);
    await expect(policy(request("url"))).resolves.toMatchObject(denied);
    await expect(policy(request("fetch"))).resolves.toMatchObject(denied);
    await expect(policy(request("unknown"))).resolves.toMatchObject(denied);
  });

  it("never approves every permission kind for any job type", async () => {
    for (const type of ["ask", "capture", "skill", "task", "plan", "fanout", "unknown"]) {
      const policy = policyFor({ type }, { worktree, project: {} });
      const outcomes = await Promise.all([
        "read", "write", "shell", "url", "fetch", "mcp", "unknown",
      ].map((kind) => policy(request(kind, { fileName: "inside/file", command: "git status", serverName: "plan-forge" }))));
      expect(outcomes.some((outcome) => outcome.kind === "denied-by-rules")).toBe(true);
    }
  });
});

function sdkShell(fullCommandText, properties = {}) {
  return {
    kind: "shell",
    fullCommandText,
    commands: [{ identifier: fullCommandText.split(" ")[0], readOnly: false }],
    possiblePaths: [],
    possibleUrls: [],
    hasWriteFileRedirection: false,
    canOfferSessionApproval: false,
    intention: "Run the approved job's validation command.",
    ...properties,
  };
}

async function installedDecision(permission, { type = "task", project = {} } = {}) {
  let decision;
  const runtime = createCopilotRuntime({
    createSession: async ({ sessionConfig }) => ({
      client: { stop: async () => [] },
      session: {
        sendAndWait: async () => {
          decision = await sessionConfig.onPermissionRequest(permission, { sessionId: "fixture-session" });
        },
        disconnect: async () => {},
      },
    }),
  });
  const result = await runtime.run({
    model: "configured-model",
    prompt: "Validate the approved job.",
    cwd: worktree,
    mcpServers: { "plan-forge": { type: "stdio", command: process.execPath, args: [] } },
    onPermissionRequest: policyFor({ type }, { worktree, project }),
  });
  expect(result.status).toBe("succeeded");
  return decision;
}

describe("runtime-installed policy with SDK 1.0.16 request shapes", () => {
  it.each(["git status", "npm test", 'git status "inside/file.txt"'])(
    "permits the legitimate SDK shell command %s",
    async (command) => {
      await expect(installedDecision(sdkShell(command))).resolves.toEqual(allowed);
    },
  );

  it.each([
    "git status; npm test",
    "git status && npm test",
    "git status | npm test",
    "git status > inside/output",
    "git status $(npm test)",
    "git status `npm test`",
    "git status\nnpm test",
    "./git status",
    "curl https://example.org",
    "git -C ../outside status",
    "git -C../outside status",
    'git -C"../outside" status',
    "git -c core.worktree=../outside status",
    "npm --prefix=../outside test",
    "node ../outside/script.mjs",
    "node -r../outside/script.mjs",
    "git status %OUTSIDE%",
    "git status ^& npm test",
    "git status \"unterminated",
  ])("denies unsafe SDK shell command %s", async (command) => {
    await expect(installedDecision(sdkShell(command))).resolves.toMatchObject(denied);
  });

  it("treats SDK fullCommandText as authoritative over legacy command and argv", async () => {
    await expect(installedDecision(sdkShell("curl https://example.org", {
      command: "git status", argv: ["npm", "test"],
    }))).resolves.toMatchObject(denied);
  });

  it.each([
    { possiblePaths: ["../outside/file.txt"] },
    { possiblePaths: ["escape/new-file.txt"] },
    { possiblePaths: [null] },
    { possiblePaths: ["inside/file.txt"], resolvedPaths: { "inside/file.txt": "../outside/file.txt" } },
    { resolvedWorkingDirectory: "../outside" },
    { hasWriteFileRedirection: true },
    { managedApprovalRequired: true },
    { requestSandboxBypass: true },
    { requestSandboxPermissive: true },
  ])("rejects SDK shell escalation or worktree escape %j", async (properties) => {
    await expect(installedDecision(sdkShell("git status", properties))).resolves.toMatchObject(denied);
  });

  it("accepts SDK paths that resolve inside the worktree", async () => {
    await expect(installedDecision(sdkShell("npm test", {
      possiblePaths: ["inside/file.txt"],
      resolvedPaths: { "inside/file.txt": path.join(worktree, "inside", "file.txt") },
      resolvedWorkingDirectory: worktree,
    }))).resolves.toEqual(allowed);
  });

  it.each(process.platform === "win32"
    ? ["C:\\foreign\\file.txt"]
    : ["C:\\foreign\\file.txt", "\\\\foreign\\share\\file.txt"])(
    "rejects foreign Windows paths rather than treating them as a native worktree path: %s",
    async (foreignPath) => {
      await expect(installedDecision(sdkShell("npm test", {
        possiblePaths: [foreignPath], resolvedWorkingDirectory: worktree,
      }))).resolves.toMatchObject(denied);
    },
  );

  it.each([
    ["read", { path: "inside/file.txt" }, true],
    ["read", { path: "../outside/file.txt" }, false],
    ["read", { path: "escape/file.txt" }, false],
    ["read", { path: "inside/file.txt", resolvedPath: "../outside/file.txt" }, false],
    ["read", { path: "" }, false],
    ["write", { fileName: "inside/file.txt", diff: "", canOfferSessionApproval: false }, true],
    ["write", { fileName: "../outside/file.txt", diff: "" }, false],
    ["write", { fileName: "inside/file.txt", resolvedPath: "../outside/file.txt" }, false],
    ["write", { fileName: "inside/file.txt", managedApprovalRequired: true }, false],
    ["write", { fileName: "inside/file.txt", requestSandboxBypass: true }, false],
  ])("checks the SDK %s request's actual path fields", async (kind, properties, isAllowed) => {
    const decision = await installedDecision({ kind, intention: "Inspect the job.", ...properties });
    expect(decision.kind === "approved").toBe(isAllowed);
  });

  it("does not grant SDK shell or writes to read-only jobs", async () => {
    await expect(installedDecision(sdkShell("git status"), { type: "ask" })).resolves.toMatchObject(denied);
    await expect(installedDecision({
      kind: "write", fileName: "inside/file.txt", diff: "", intention: "Edit",
    }, { type: "capture" })).resolves.toMatchObject(denied);
  });

  it("checks legacy argv paths instead of granting executable-name-only escapes", async () => {
    const policy = policyFor({ type: "task" }, { worktree, project: {} });
    await expect(policy({ kind: "shell", argv: ["git", "-C", outside, "status"] }))
      .resolves.toMatchObject(denied);
  });
});
