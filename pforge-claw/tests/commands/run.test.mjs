import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentJobs } from "../../src/jobs/model.mjs";
import { prepareRun } from "../../src/commands/run.mjs";
import { createStore } from "../../src/state/store.mjs";
import { c2Authority } from "../c2-fixtures.mjs";
import { buildApprovalCard, QUORUM_MODES } from "../../src/approvals.mjs";
import { connectProject, createProjectClients } from "../../src/mcp/project-client.mjs";
import { createRegistry } from "../../src/registry.mjs";
import { resolvePlan } from "../../src/jobs/plan-resolution.mjs";
import { HOME_PLAN_RESOLVE_TOOL } from "../../src/enums.mjs";

const executeNode = promisify(execFile);
const NATIVE_ESTIMATE_TIMEOUT_MS = 30_000;

const directories = [];
async function fixture(names = ["Phase-1-PLAN.md"]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "claw-run-command-"));
  directories.push(root);
  const repo = path.join(root, "repo");
  await mkdir(path.join(repo, "docs", "plans"), { recursive: true });
  for (const name of names) await writeFile(path.join(repo, "docs", "plans", name), "# Plan");
  const project = { id: "p1", repo: { path: repo } };
  return {
    project, ...c2Authority(project),
    store: createStore(path.join(root, "state")),
    pending: new Map(),
    mcp: { call: vi.fn(async (tool, args, options) => tool === HOME_PLAN_RESOLVE_TOOL
      ? resolvePlan({ root: repo, ...args, signal: options?.signal })
      : ({ modes: ["auto"] })) },
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

async function nativeWire({ project, response, requests = [] }) {
  class EdgeTransport {
    async close() {}
  }
  class EdgeClient {
    async connect() {}
    async close() {}
    async callTool(request) {
      requests.push(request);
      return response;
    }
  }
  const connection = await connectProject({ command: "fixture-command", args: [], cwd: project.repo.path, env: {} }, {
    ClientClass: EdgeClient, TransportClass: EdgeTransport,
  });
  const homeProject = { ...project, homeLane: "native-home" };
  const config = { projects: [homeProject], lanes: [{ id: "native-home", kind: "local", enabled: true }] };
  const manager = createProjectClients({
    config, registry: createRegistry(config), connect: async () => connection,
    resolveLaunch: async () => ({ command: "fixture-command", args: [], env: {}, cwd: project.repo.path }),
  });
  return { call: (tool, args, options) => manager.call(project.id, tool, args, options), close: () => manager.closeAll() };
}

describe("/run", () => {
  it("estimates a unique exact match and queues it for approval only", async () => {
    const f = await fixture();
    const result = await prepareRun(f, {
      argsText: "docs/plans/Phase-1-PLAN.md power",
      caller: { userId: "u1" },
      chatId: "c1",
    });
    expect(result.text).toContain("awaiting approval");
    expect(f.mcp.call).toHaveBeenCalledWith("forge_estimate_quorum", {
      planPath: path.posix.join("docs", "plans", "Phase-1-PLAN.md"),
      path: f.project.repo.path,
    });
    const jobs = Object.values(currentJobs(f.store));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ state: "awaiting-approval", type: "plan", quorum: "power" });
  });

  it("reports no match and stores bounded selection callbacks for multiple matches", async () => {
    const f = await fixture(["Phase-1-PLAN.md", "Phase-2-PLAN.md"]);
    expect(await prepareRun(f, { args: ["not-a-plan"] })).toMatchObject({ text: expect.stringContaining("No plan found") });
    const result = await prepareRun(f, { args: ["Phase"], caller: { userId: "u1" }, chatId: "c1" });
    const id = result.keyboard.inline_keyboard[0][0].callback_data.split(":")[1];
    expect(f.pending.get(id)).toMatchObject({ callerId: "u1", projectId: "p1", chatId: "c1" });
    for (const row of result.keyboard.inline_keyboard) {
      for (const button of row) expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
    }
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
  });

  it("fails explicitly when core services are missing or estimate is unavailable", async () => {
    const f = await fixture();
    expect(await prepareRun({}, { args: ["Plan"] })).toMatchObject({ text: expect.stringContaining("SERVICE_UNAVAILABLE") });
    let shouldThrow = false;
    f.mcp.call.mockImplementation(async (tool, args, options) => {
      if (tool === HOME_PLAN_RESOLVE_TOOL) return resolvePlan({ root: f.project.repo.path, ...args, signal: options?.signal });
      if (shouldThrow) throw new Error("offline");
      return { isError: true };
    });
    const rejectedEstimate = await prepareRun(f, { args: ["docs/plans/Phase-1-PLAN.md"] });
    expect(rejectedEstimate.text).toContain("ESTIMATE_UNAVAILABLE");
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
    shouldThrow = true;
    const result = await prepareRun(f, { args: ["docs/plans/Phase-1-PLAN.md"] });
    expect(result.text).toContain("ESTIMATE_UNAVAILABLE");
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
  });

  it("conforms to the native quorum producer and real MCP decoding through the actual approval card", async () => {
    const f = await fixture();
    const nativeModule = fileURLToPath(new URL("../../../pforge-mcp/cost-service.mjs", import.meta.url));
    const script = `
      import { pathToFileURL } from "node:url";
      const { estimateQuorum } = await import(pathToFileURL(process.argv[1]).href);
      const plan = {
        slices: [{number:1,title:"Fixture scope validation",depends:[],parallel:false,scope:["src/fixture.mjs"],tasks:[]}],
        dag: {order:["1"]},
      };
      process.stdout.write(JSON.stringify(estimateQuorum({plan,cwd:null})));
    `;
    const output = await executeNode(process.execPath, ["--input-type=module", "-e", script, nativeModule], {
      cwd: f.project.repo.path, timeout: NATIVE_ESTIMATE_TIMEOUT_MS, windowsHide: true,
    });
    const nativeEstimate = JSON.parse(output.stdout);
    expect(QUORUM_MODES).toContain(nativeEstimate.recommended);
    expect(nativeEstimate.generatedAt).toEqual(expect.any(String));
    const requests = [];
    const mcp = await nativeWire({
      project: f.project, requests,
      response: { content: [{ type: "text", text: JSON.stringify(nativeEstimate) }] },
    });
    try {
      const prepared = await prepareRun({ ...f, mcp }, {
        argsText: "Phase-1 power", chatId: "c1", threadId: "t1", updateId: "native-estimate-request",
      });
      expect(prepared).toMatchObject({ jobId: expect.any(String), state: "awaiting-approval" });
      const job = currentJobs(f.store)[prepared.jobId];
      expect(requests.find((request) => request.name === "forge_estimate_quorum")).toEqual({
        name: "forge_estimate_quorum",
        arguments: { planPath: path.posix.join("docs", "plans", "Phase-1-PLAN.md"), path: f.project.repo.path },
      });
      expect(job.estimate).toEqual(nativeEstimate);
      const card = await buildApprovalCard({ job, project: f.project, mcp });
      expect(card).toMatchObject({ text: expect.any(String), keyboard: { inline_keyboard: expect.any(Array) } });
      expect(card.text).toContain(`Estimated cost: $${nativeEstimate.power.estimatedCostUSD}`);
      const labels = card.keyboard.inline_keyboard.flat().map((button) => button.text);
      for (const mode of QUORUM_MODES) {
        expect(nativeEstimate[mode]).toMatchObject({
          mode, estimatedCostUSD: expect.any(Number), baseCostUSD: expect.any(Number),
          overheadUSD: expect.any(Number), totalSliceCount: expect.any(Number),
          quorumSliceCount: expect.any(Number), slices: expect.any(Array),
        });
        expect(labels).toContain(`${mode}: $${nativeEstimate[mode].estimatedCostUSD}`);
      }
      expect(requests.filter((request) => request.name === "forge_estimate_quorum")[1])
        .toEqual({ name: "forge_estimate_quorum", arguments: { planPath: job.planPath } });
    } finally {
      await mcp.close();
    }
  }, NATIVE_ESTIMATE_TIMEOUT_MS);

  it("refuses native MCP estimate error envelopes instead of creating a plan", async () => {
    const f = await fixture();
    const mcp = await nativeWire({
      project: f.project,
      response: { content: [{ type: "text", text: "PLAN_NOT_FOUND: fixture plan" }], isError: true },
    });
    try {
      expect(await prepareRun({ ...f, mcp }, { argsText: "Phase-1" }))
        .toMatchObject({ text: expect.stringContaining("ESTIMATE_UNAVAILABLE"), jobId: null, state: null });
      expect(Object.values(currentJobs(f.store))).toHaveLength(0);
    } finally {
      await mcp.close();
    }
  });

  it("guards the native estimate handler input and text-envelope contract without companion source imports", async () => {
    const definitions = await readFile(new URL("../../../pforge-mcp/server/tool-definitions.mjs", import.meta.url), "utf8");
    const definitionStart = definitions.indexOf('name: "forge_estimate_quorum"');
    const definitionEnd = definitions.indexOf('name: "forge_estimate_slice"', definitionStart);
    const schema = definitions.slice(definitionStart, definitionEnd);
    expect(definitionStart).toBeGreaterThanOrEqual(0);
    expect(definitionEnd).toBeGreaterThan(definitionStart);
    for (const name of ["planPath", "path", "resumeFrom"]) expect(schema).toContain(`${name}: { type: "string"`);
    expect(schema).toContain('required: ["planPath"]');
    const source = await readFile(new URL("../../../pforge-mcp/server/tool-handlers/orch.mjs", import.meta.url), "utf8");
    const start = source.indexOf("async function _callToolHandler_006_forge_estimate_quorum");
    const end = source.indexOf("async function _callToolHandler_007_forge_estimate_slice", start);
    const handler = source.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(handler).toContain("args.path ? findProjectRoot(resolve(args.path))");
    expect(handler).toContain("resolve(cwd, args.planPath)");
    expect(handler).toContain('const { estimateQuorum } = await import("../../cost-service.mjs")');
    expect(handler).toMatch(/return\s+\{\s*content:\s*\[\s*\{\s*type:\s*"text",\s*text:\s*JSON\.stringify\(result/);
  });
});
