import path from "node:path";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectClients } from "../src/mcp/project-client.mjs";
import { createRegistry } from "../src/registry.mjs";
import { prepareRun } from "../src/commands/run.mjs";
import { selectPlan } from "../src/callbacks/s.mjs";
import { currentJobs } from "../src/jobs/model.mjs";
import { HOME_PLAN_RESOLVE_TOOL } from "../src/enums.mjs";
import { c2Fixture, cleanupC2Fixtures } from "./c2-fixtures.mjs";

const managers = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.closeAll()));
  await cleanupC2Fixtures();
});

async function homeRig(names) {
  const f = await c2Fixture({ names });
  const homeProject = { ...f.project, homeLane: "actual-home", repo: { ...f.project.repo } };
  const homeConfig = {
    ...f.config, projects: [homeProject], lanes: [{ id: "actual-home", kind: "local", enabled: true }],
  };
  const publicCall = vi.fn(async (tool) => {
    if (tool === "forge_estimate_quorum") return { recommended: "auto", verifiedHomeEstimate: true };
    throw new Error("No invented public plan inventory exists");
  });
  const manager = createProjectClients({
    config: homeConfig, registry: createRegistry(homeConfig),
    connect: async () => ({ call: publicCall, close: async () => {} }),
    resolveLaunch: async () => ({ command: "fixture-command", args: [], env: {}, cwd: homeProject.repo.path }),
  });
  managers.push(manager);
  const dispatcherProject = {
    ...f.project, homeLane: "actual-home",
    repo: { path: path.join(f.root, "absent-dispatcher-checkout") },
  };
  f.config.projects = [dispatcherProject];
  f.config.lanes = [{ id: "actual-home", kind: "remote", enabled: true }];
  const mcp = { call: (tool, args, options) => manager.call(homeProject.id, tool, args, options) };
  return { ...f, homeProject, manager, publicCall, dispatcherProject, deps: { ...f.deps, project: dispatcherProject, mcp } };
}

describe("C2 /run actual home-read manager contract", () => {
  it("uses real canonical-home resolution for unique names with no dispatcher checkout or status inventory", async () => {
    const f = await homeRig(["Phase-One-PLAN.md", "Phase-Two-PLAN.md"]);
    const result = await prepareRun(f.deps, { argsText: "oNe speed", updateId: "home-unique" });
    expect(result).toMatchObject({ jobId: expect.any(String), state: "awaiting-approval" });
    expect(currentJobs(f.store)[result.jobId]).toMatchObject({
      planPath: "docs/plans/Phase-One-PLAN.md", quorum: "speed",
    });
    expect(f.publicCall.mock.calls.map(([tool]) => tool)).toEqual(["forge_estimate_quorum"]);
  });

  it("preserves exact/ambiguous paths and revalidates the original selection on actual home", async () => {
    const f = await homeRig(["Phase-One-PLAN.md", "Phase-Two-PLAN.md"]);
    const input = {
      argsText: "Phase power", updateId: "home-original", caller: f.caller,
      chatId: f.deps.chatId, threadId: f.deps.threadId, adapter: "telegram",
    };
    const multiple = await prepareRun(f.deps, input);
    expect(multiple.keyboard.inline_keyboard).toHaveLength(2);
    const payload = multiple.keyboard.inline_keyboard[0][0].callback_data.slice(2);
    const selected = await selectPlan(f.deps, { ...input, payload, updateId: "new-tap" });
    expect(selected).toMatchObject({ jobId: expect.any(String), state: "awaiting-approval" });
    expect(currentJobs(f.store)[selected.jobId]).toMatchObject({
      planPath: "docs/plans/Phase-One-PLAN.md", updateId: "home-original", quorum: "power",
    });
    expect(f.publicCall.mock.calls.map(([tool]) => tool)).toEqual(["forge_estimate_quorum"]);
  });

  it("does not autochoose a truncated home result or accept legacy fake inventory data", async () => {
    const f = await homeRig(Array.from({ length: 25 }, (_, index) => `Phase-${String(index).padStart(2, "0")}-PLAN.md`));
    const result = await prepareRun(f.deps, { argsText: "Phase" });
    expect(result).toMatchObject({ jobId: null, state: null, text: expect.stringMatching(/narrow|exact/i) });
    expect(result.keyboard).toBeUndefined();
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
    expect(f.publicCall).not.toHaveBeenCalled();
    const malformedMcp = { call: vi.fn(async () => ({ plans: ["docs/plans/Phase-Fake-PLAN.md"] })) };
    expect(await prepareRun({ ...f.deps, mcp: malformedMcp }, { argsText: "Fake" }))
      .toMatchObject({ jobId: null, state: null, text: expect.stringContaining("PLAN_RESOLVE") });
    expect(malformedMcp.call).toHaveBeenCalledWith(HOME_PLAN_RESOLVE_TOOL, expect.any(Object), expect.any(Object));
  });

  it("keeps cancellation outside the serialized home DTO and never creates an aborted request", async () => {
    const f = await homeRig(["Phase-One-PLAN.md"]);
    const controller = new AbortController();
    controller.abort();
    expect(await prepareRun(f.deps, { argsText: "One", signal: controller.signal }))
      .toMatchObject({ jobId: null, state: null });
    expect(f.publicCall).not.toHaveBeenCalled();
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
  });
});

describe("Guard: plan controllers never read dispatcher checkouts", () => {
  it("moves filesystem resolution only to the configured-home service", async () => {
    const command = await readFile(new URL("../src/commands/run.mjs", import.meta.url), "utf8");
    const selection = await readFile(new URL("../src/callbacks/s.mjs", import.meta.url), "utf8");
    const service = await readFile(new URL("../src/jobs/plan-resolution.mjs", import.meta.url), "utf8");
    for (const source of [command, selection]) {
      expect(source).not.toContain("node:fs");
      expect(source).not.toContain("jobs/runners.mjs");
      expect(source).not.toContain("isInside");
    }
    expect(command).toContain("mcp.call(HOME_PLAN_RESOLVE_TOOL");
    expect(service).toContain('from "node:fs/promises"');
    expect(service).toContain("await isInside(root, target)");
  });
});
