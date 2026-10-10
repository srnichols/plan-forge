import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import skillCommand, { prepareSkill } from "../../src/commands/skill.mjs";
import { currentJobs } from "../../src/jobs/model.mjs";
import { createStore } from "../../src/state/store.mjs";
import { c2Authority } from "../c2-fixtures.mjs";
import { connectProject } from "../../src/mcp/project-client.mjs";

const executeNode = promisify(execFile);
const NATIVE_METADATA_TIMEOUT_MS = 30_000;

const directories = [];
async function store() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claw-skill-command-"));
  directories.push(directory);
  return createStore(directory);
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function nativeDryRun(content) {
  const root = await mkdtemp(path.join(os.tmpdir(), "claw-native-skill-"));
  directories.push(root);
  const file = path.join(root, "SKILL.md");
  await writeFile(file, content);
  const nativeModule = fileURLToPath(new URL("../../../pforge-mcp/skill-runner.mjs", import.meta.url));
  const script = `
    import {pathToFileURL} from "node:url";
    const {parseSkill}=await import(pathToFileURL(process.argv[1]).href);
    const skill=parseSkill(process.argv[2]);
    const result={
      status:"dry-run",skillName:skill.meta.name,description:skill.meta.description,tools:skill.meta.tools,
      stepCount:skill.stepCount,steps:skill.steps.map(s=>({number:s.number,name:s.name,hasConditional:!!s.conditional})),
      safetyRules:skill.safetyRules,
    };
    process.stdout.write(JSON.stringify({meta:skill.meta,result}));
  `;
  const output = await executeNode(process.execPath, ["--input-type=module", "-e", script, nativeModule, file], {
    cwd: root, timeout: NATIVE_METADATA_TIMEOUT_MS, windowsHide: true,
  });
  return { root, ...JSON.parse(output.stdout) };
}

async function nativeWire(response) {
  class EdgeTransport { async close() {} }
  class EdgeClient {
    async connect() {}
    async close() {}
    async callTool() { return { content: [{ type: "text", text: JSON.stringify(response) }] }; }
  }
  return connectProject({ command: "fixture-command", args: [], env: {} }, { ClientClass: EdgeClient, TransportClass: EdgeTransport });
}

describe("/skill", () => {
  it("creates a read job only for explicit readOnly metadata", async () => {
    const jobsStore = await store();
    const metadata = { status: "dry-run", skillName: "inspect", readOnly: true };
    const mcp = { call: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify(metadata) }] })) };
    const project = { id: "p1", repo: { path: "C:\\repo" } };
    const result = await prepareSkill({ store: jobsStore, mcp, project, ...c2Authority(project) }, {
      args: ["inspect", "the", "diff"],
    });
    expect(mcp.call).toHaveBeenCalledWith("forge_run_skill", {
      skill: "inspect", dryRun: true, path: project.repo.path,
    });
    expect(result.text).toContain("queued");
    expect(result).toMatchObject({ jobId: expect.any(String), state: "queued" });
    expect(Object.values(currentJobs(jobsStore))[0]).toMatchObject({
      type: "skill", skill: "inspect", args: "the diff", readOnly: true, state: "queued",
    });
  });

  it("requires approval for all other skills and handles unknown or unavailable metadata", async () => {
    const jobsStore = await store();
    const metadata = { status: "dry-run", skillName: "review", readOnly: false };
    const mcp = {
      call: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify(metadata) }] })),
    };
    const project = { id: "p1", repo: { path: path.resolve(".forge", "skill-fixture") } };
    const dependencies = { store: jobsStore, mcp, project, ...c2Authority(project) };
    await prepareSkill(dependencies, { args: ["review"] });
    expect(Object.values(currentJobs(jobsStore))[0].state).toBe("awaiting-approval");
    expect(await prepareSkill(dependencies, { args: ["missing"] }))
      .toMatchObject({ text: expect.stringContaining("Unknown skill") });
    expect(await prepareSkill({ store: jobsStore, project: { id: "p1" } }, { args: ["review"] }))
      .toMatchObject({ text: expect.stringContaining("SERVICE_UNAVAILABLE") });
    expect(Object.values(currentJobs(jobsStore))).toHaveLength(1);
  });

  it("binds a chat-issued skill job to the requesting chat, topic and caller", async () => {
    const jobsStore = await store();
    const metadata = { status: "dry-run", skillName: "review", readOnly: false };
    const mcp = { call: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify(metadata) }] })) };
    const project = { id: "p1", repo: { path: path.resolve(".forge", "skill-fixture") } };
    const context = { services: { store: jobsStore, mcp, ...c2Authority(project) }, project };
    const result = await skillCommand.handle(context, {
      args: ["review"], caller: { userId: "u1", role: "owner" }, chatId: "42", threadId: "101",
    });
    expect(result.text).toContain("awaiting approval");
    expect(Object.values(currentJobs(jobsStore))[0]).toMatchObject({
      callerId: "u1", chatId: "42", threadId: "101", state: "awaiting-approval",
    });
  });

  it("keeps actual native dry-run metadata mutating even when the source frontmatter claims readOnly", async () => {
    const native = await nativeDryRun("---\nname: inspect\ndescription: Inspect only\nreadOnly: true\n---\n### 1. Inspect\nRead the project.\n");
    expect(native.meta).not.toHaveProperty("readOnly");
    expect(native.result).not.toHaveProperty("readOnly");
    const jobsStore = await store();
    const project = { id: "p1", repo: { path: native.root } };
    const mcp = await nativeWire(native.result);
    try {
      const result = await prepareSkill({ store: jobsStore, project, mcp, ...c2Authority(project) }, { args: ["inspect"] });
      expect(result).toMatchObject({ jobId: expect.any(String), state: "awaiting-approval" });
      expect(currentJobs(jobsStore)[result.jobId]).toMatchObject({ readOnly: false, mutating: true });
    } finally { await mcp.close(); }
  }, NATIVE_METADATA_TIMEOUT_MS);

  it("allows a found native skill with unknown/missing metadata only as an approval-pending mutation", async () => {
    const native = await nativeDryRun("# Generic skill\n### 1. Work\nPerform the requested task.\n");
    expect(native.result.skillName).toBe("unknown");
    const jobsStore = await store();
    const project = { id: "p1", repo: { path: native.root } };
    const mcp = await nativeWire(native.result);
    try {
      const result = await prepareSkill({ store: jobsStore, project, mcp, ...c2Authority(project) }, { args: ["generic"] });
      expect(result).toMatchObject({ jobId: expect.any(String), state: "awaiting-approval" });
      expect(currentJobs(jobsStore)[result.jobId]).toMatchObject({ readOnly: false, mutating: true, skill: "generic" });
    } finally { await mcp.close(); }
  }, NATIVE_METADATA_TIMEOUT_MS);

  it("pins the native dry-run projection and registered input types without assuming readOnly exists", async () => {
    const definitions = await readFile(new URL("../../../pforge-mcp/server/tool-definitions.mjs", import.meta.url), "utf8");
    const schema = definitions.slice(definitions.indexOf('name: "forge_run_skill"'), definitions.indexOf('name: "forge_org_rules"'));
    expect(schema).toContain('skill: { type: "string"');
    expect(schema).toContain('args: { type: "string"');
    expect(schema).toContain('dryRun: { type: "boolean"');
    expect(schema).toContain('path: { type: "string"');
    const source = await readFile(new URL("../../../pforge-mcp/server/tool-handlers/memory.mjs", import.meta.url), "utf8");
    const start = source.indexOf("if (args.dryRun)");
    const end = source.indexOf("// Execute with hub", start);
    const dryRun = source.slice(start, end);
    expect(dryRun).toContain("skillName: skill.meta.name");
    expect(dryRun).toContain("steps: skill.steps.map");
    expect(dryRun).not.toContain("readOnly");
  });
});
