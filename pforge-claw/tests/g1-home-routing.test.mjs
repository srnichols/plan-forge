import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLaunch, createProjectClients } from "../src/mcp/project-client.mjs";
import { createRegistry } from "../src/registry.mjs";
import { createLaneDirectory } from "../src/lanes/directory.mjs";
import { createRemoteLane } from "../src/lanes/remote-lane.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { resolveForgeHome } from "../src/memory/l2-sync.mjs";
import { HOME_PLAN_RESOLVE_TOOL } from "../src/enums.mjs";
import { createSecrets } from "../src/secrets.mjs";
import { createStore } from "../src/state/store.mjs";
import { createEnrollment } from "../src/protocol/enrollment.mjs";
import { createWorkerServer } from "../src/protocol/ws-server.mjs";
import { createWorkerAgent } from "../src/protocol/worker-agent.mjs";
import { createHttpServer } from "../src/http.mjs";
import { createLocalLane } from "../src/lanes/local-lane.mjs";
import { g1Directory } from "./g1-runner-fixture.mjs";

const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

describe("G1 configured home routing", () => {
  it("uses authenticated RemoteLane.read for a non-literal remote home without a dispatcher checkout", async () => {
    const config = {
      lanes: [{ id: "laptop-home", kind: "remote", enabled: true }],
      projects: [{ id: "project-1", homeLane: "laptop-home", repo: { path: path.join("absent", "remote-checkout") } }],
    };
    const registry = createWorkerRegistry({ requireL2: true });
    cleanup.push(() => registry.close());
    const requests = [];
    registry.connect("registered-home-worker", {
      laneId: "laptop-home",
      capabilities: { projects: ["project-1"] },
      send(packet) {
        if (packet.t !== "lease") return;
        requests.push(packet.request);
        queueMicrotask(() => {
          registry.onAck({ leaseId: packet.leaseId, attempt: packet.attempt, workerId: "registered-home-worker" });
          registry.onEvent({
            leaseId: packet.leaseId, attempt: packet.attempt, workerId: "registered-home-worker",
            event: { v: 1, jobId: packet.request.requestId, seq: 1, ts: new Date(0).toISOString(),
              type: "finished", data: { status: "ok", result: { project: "project-1", home: "remote" } } },
          });
        });
      },
    });
    const directory = createLaneDirectory();
    directory.configure(config.lanes);
    directory.register(createRemoteLane({ id: "laptop-home", registry }));
    const connect = vi.fn();
    const resolveLaunch = vi.fn(() => { throw new Error("must not read a dispatcher checkout"); });
    const clients = createProjectClients({ config, registry: createRegistry(config), directory, connect, resolveLaunch });
    cleanup.push(() => clients.closeAll());
    expect(await clients.call("project-1", "forge_search", { query: "history" }))
      .toEqual({ project: "project-1", home: "remote" });
    expect(requests[0]).toMatchObject({ projectId: "project-1", tool: "forge_search", args: { query: "history" } });
    expect(connect).not.toHaveBeenCalled();
    expect(resolveLaunch).not.toHaveBeenCalled();
  });

  it("runs local homes with arbitrary IDs over stdio using the prepared environment", async () => {
    const root = await g1Directory("g1-home-");
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, ".vscode"));
    await writeFile(path.join(root, ".vscode", "mcp.json"), JSON.stringify({
      servers: { "plan-forge": { command: "node", args: ["entry.mjs"], env: { VALUE: "${env:G1_HOME_VALUE}" } } },
    }));
    const config = {
      lanes: [{ id: "desktop-home", kind: "local" }],
      projects: [{ id: "project-1", homeLane: "desktop-home", repo: { path: root } }],
    };
    const launch = await buildLaunch(config.projects[0], config, { env: { G1_HOME_VALUE: "prepared" }, which: async () => true });
    expect(launch.env).toMatchObject({ G1_HOME_VALUE: "prepared", VALUE: "prepared" });
    const observed = [];
    const clients = createProjectClients({
      config, registry: createRegistry(config), env: { G1_HOME_VALUE: "prepared" },
      resolveLaunch: (project, current, options) => buildLaunch(project, current, { ...options, which: async () => true }),
      connect: async (input) => {
        observed.push(input);
        return { call: async () => ({ ok: true }), close: async () => {} };
      },
    });
    cleanup.push(() => clients.closeAll());
    await clients.call("project-1", "forge_search");
    expect(observed[0].env).toMatchObject({ G1_HOME_VALUE: "prepared", VALUE: "prepared" });
  });

  it("fails closed for an unknown home lane and never falls back to dispatcher-local stdio", async () => {
    const connect = vi.fn();
    const config = { lanes: [{ id: "execution-host", kind: "local" }],
      projects: [{ id: "project-1", homeLane: "missing-home", repo: { path: "missing" } }] };
    const clients = createProjectClients({
      config, registry: createRegistry(config), connect, resolveLaunch: async () => ({}),
    });
    cleanup.push(() => clients.closeAll());
    await expect(clients.call("project-1", "forge_search")).rejects.toMatchObject({ code: "HOME_LANE_UNKNOWN" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects an unregistered lane prefix instead of treating it as a local canonical path", () => {
    expect(() => resolveForgeHome({
      project: { homeLane: "execution-host", repo: { path: path.resolve("checkout"), forgeHome: "missing-home:canonical" } },
      config: { lanes: [{ id: "execution-host", kind: "local" }] },
    })).toThrowError(expect.objectContaining({ code: "L2_PATH_REJECTED" }));
  });

  it("launches canonical stdio on the authenticated home worker without synthesizing a local lane", async () => {
    const root = await g1Directory("g1-worker-home-");
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, ".vscode"));
    await writeFile(path.join(root, ".vscode", "mcp.json"), JSON.stringify({
      servers: { "plan-forge": { command: "node", args: ["entry.mjs"] } },
    }));
    const config = {
      lanes: [{ id: "authenticated-home", kind: "remote" }],
      projects: [{ id: "project-1", homeLane: "authenticated-home", repo: { path: root } }],
    };
    const launch = await buildLaunch(config.projects[0], config, {
      currentLaneId: "authenticated-home", which: async () => true,
    });
    expect(launch.cwd).toBe(root);
    const connected = [];
    const clients = createProjectClients({
      config, registry: createRegistry(config), currentLaneId: "authenticated-home",
      resolveLaunch: (project, current, options) => buildLaunch(project, current, { ...options, which: async () => true }),
      connect: async (input) => {
        connected.push(input);
        return { call: async () => ({ home: "authenticated-home" }), close: async () => {} };
      },
    });
    cleanup.push(() => clients.closeAll());
    expect(await clients.call("project-1", "forge_search")).toEqual({ home: "authenticated-home" });
    expect(connected).toHaveLength(1);
    expect(config.lanes).toEqual([{ id: "authenticated-home", kind: "remote" }]);
  });

  it("does not trust home-worker selectors from config or environment", async () => {
    const config = {
      worker: { laneId: "remote-home" },
      lanes: [{ id: "remote-home", kind: "remote" }],
      projects: [{ id: "project-1", homeLane: "remote-home", repo: { path: path.resolve("absent", "checkout") } }],
    };
    const connect = vi.fn();
    const clients = createProjectClients({
      config, registry: createRegistry(config), connect,
      env: { PFORGE_CLAW_CURRENT_LANE: "remote-home" },
    });
    cleanup.push(() => clients.closeAll());
    await expect(clients.call("project-1", "forge_search")).rejects.toMatchObject({ code: "HOME_LANE_UNAVAILABLE" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("requires explicit home-lane qualification when a Windows drive letter is also a registered lane", () => {
    const canonical = path.win32.join("C:\\canonical", ".forge");
    const config = { lanes: [{ id: "C", kind: "remote" }, { id: "desktop-home", kind: "local" }] };
    expect(resolveForgeHome({
      project: { homeLane: "desktop-home", repo: { path: "C:\\checkout", forgeHome: canonical } },
      config,
    })).toEqual({ laneId: "C", path: canonical.slice(2) });
    expect(resolveForgeHome({
      project: { homeLane: "desktop-home", repo: { path: "C:\\checkout", forgeHome: `desktop-home:${canonical}` } },
      config,
    })).toEqual({ laneId: "desktop-home", path: canonical });
    expect(resolveForgeHome({
      project: { homeLane: "desktop-home", repo: { path: "C:\\checkout", forgeHome: canonical } },
      config: { lanes: [{ id: "desktop-home", kind: "local" }] },
    })).toEqual({ laneId: "desktop-home", path: canonical });
  });
});

async function homePlanFixture({ kind = "local", currentLaneId = null, count = 1 } = {}) {
  const root = await g1Directory("g1-plan-home-");
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const checkout = path.join(root, "canonical");
  await mkdir(path.join(checkout, "docs", "plans"), { recursive: true });
  const names = Array.from({ length: count }, (_, index) => `Phase-${String(index + 1).padStart(2, "0")}-MATCH-PLAN.md`);
  await Promise.all(names.map((name) => writeFile(path.join(checkout, "docs", "plans", name), "private plan body\n")));
  const config = {
    lanes: [{ id: "actual-home", kind, enabled: true }],
    projects: [{ id: "project-1", homeLane: "actual-home", repo: { path: checkout } }],
  };
  const connect = vi.fn(async () => { throw new Error("internal plan reads must never reach public MCP"); });
  const clients = createProjectClients({ config, registry: createRegistry(config), currentLaneId, connect });
  cleanup.push(() => clients.closeAll());
  return { root, checkout, names, config, connect, clients };
}

async function remotePlanFixture(options = {}) {
  const home = await homePlanFixture({ ...options, kind: "remote", currentLaneId: "actual-home" });
  const store = createStore(path.join(home.root, "worker-state"));
  const unlock = store.lock();
  cleanup.push(unlock);
  const secret = "owned-home-reader-fixture-key";
  const secrets = await createSecrets({ env: {}, file: path.join(home.root, "secrets.json") });
  const enrollment = createEnrollment({ store, secrets, secretFile: path.join(home.root, "secrets.json") });
  await enrollment.register({ workerId: "registered-plan-home", laneId: "actual-home", secret });
  const registry = createWorkerRegistry({ requireL2: true });
  const http = createHttpServer({ bind: "127.0.0.1", port: 0 });
  const server = createWorkerServer({ registry, enrollment, secrets, allowedLanes: ["actual-home"] });
  server.attach(http);
  const { port } = await http.listen();
  const requests = [];
  const worker = createWorkerAgent({
    url: `ws://127.0.0.1:${port}/claw/workers`, workerId: "registered-plan-home", laneId: "actual-home", secret,
    capabilities: { os: process.platform, arch: process.arch, macos: false, toolchains: [], projects: ["project-1"] },
    localLane: createLocalLane({ runtime: { run: async () => { throw new Error("read must not run a task"); } } }),
    readHandler(request, options) {
      requests.push(request);
      return home.clients.call(request.projectId, request.tool, request.args, options);
    },
  });
  const directory = createLaneDirectory();
  const config = {
    ...home.config,
    projects: [{ ...home.config.projects[0], repo: { path: path.join(home.root, "absent-dispatcher-checkout") } }],
  };
  directory.configure(config.lanes);
  directory.register(createRemoteLane({ id: "actual-home", registry }));
  const clients = createProjectClients({ config, registry: createRegistry(config), directory, connect: home.connect });
  cleanup.push(async () => {
    await clients.closeAll();
    worker.stop();
    await worker.drain();
    server.close();
    registry.close();
    await http.close();
  });
  worker.start();
  await vi.waitFor(() => expect(registry.snapshot().byLane["actual-home"]?.connected).toBe(1));
  return { ...home, clients, homeClients: home.clients, store, requests, registry };
}

describe("G1 internal canonical home plan read", () => {
  it.each(["local", "trusted-worker"])("resolves an exact physical plan on the %s without public MCP recursion", async (host) => {
    const f = await homePlanFixture({
      kind: host === "local" ? "local" : "remote",
      currentLaneId: host === "trusted-worker" ? "actual-home" : null,
    });
    const result = await f.clients.call("project-1", HOME_PLAN_RESOLVE_TOOL, {
      input: "docs\\plans\\Phase-01-MATCH-PLAN.md",
    });
    expect(result).toEqual({
      kind: "exact", candidates: ["docs/plans/Phase-01-MATCH-PLAN.md"],
      total: 1, truncated: false, limit: 20, message: "Resolved 1 plan.",
    });
    expect(f.connect).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(f.checkout);
    expect(JSON.stringify(result)).not.toContain("private plan body");
  });

  it("uses the actual configured canonical root even when an injected registry offers another checkout", async () => {
    const f = await homePlanFixture();
    const registry = { byId: () => ({ ...f.config.projects[0], repo: { path: path.join(f.root, "wrong") } }) };
    const clients = createProjectClients({ config: f.config, registry, connect: f.connect });
    cleanup.push(() => clients.closeAll());
    expect(await clients.call("project-1", HOME_PLAN_RESOLVE_TOOL, { input: "match" }))
      .toMatchObject({ kind: "unique", candidates: ["docs/plans/Phase-01-MATCH-PLAN.md"] });
    expect(f.connect).not.toHaveBeenCalled();
  });

  it("uses authenticated remote worker routing with no dispatcher checkout or public MCP process", async () => {
    const f = await remotePlanFixture();
    const controller = new AbortController();
    const result = await f.clients.call("project-1", HOME_PLAN_RESOLVE_TOOL, { input: "match" }, { signal: controller.signal });
    expect(result).toMatchObject({ kind: "unique", candidates: ["docs/plans/Phase-01-MATCH-PLAN.md"], total: 1 });
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]).toMatchObject({
      projectId: "project-1", tool: HOME_PLAN_RESOLVE_TOOL, args: { input: "match", exact: false, limit: 20 },
    });
    expect(f.requests[0].args).not.toHaveProperty("signal");
    expect(f.connect).not.toHaveBeenCalled();
    expect([...f.store.read("jobs")]).toEqual([]);
    expect([...f.store.read("approvals")]).toEqual([]);
  });

  it("retains multiple/truncation semantics over the authenticated remote read", async () => {
    const f = await remotePlanFixture({ count: 3 });
    const result = await f.clients.call("project-1", HOME_PLAN_RESOLVE_TOOL, { input: "MATCH", limit: 1 });
    expect(result).toEqual({
      kind: "multiple", candidates: ["docs/plans/Phase-01-MATCH-PLAN.md"],
      total: 3, truncated: true, limit: 1,
      message: "More plans match than can be shown; narrow the name or provide an exact repository-relative path.",
    });
    expect(JSON.stringify(result)).not.toContain(f.checkout);
  });

  it("revalidates exact selections on the home and never falls back by name", async () => {
    const f = await homePlanFixture();
    expect(await f.clients.call("project-1", HOME_PLAN_RESOLVE_TOOL, { input: "MATCH", exact: true }))
      .toMatchObject({ kind: "none", total: 0, candidates: [], truncated: false });
    await rm(path.join(f.checkout, "docs", "plans", f.names[0]));
    expect(await f.clients.call("project-1", HOME_PLAN_RESOLVE_TOOL, {
      input: "docs/plans/Phase-01-MATCH-PLAN.md", exact: true,
    })).toMatchObject({ kind: "none", total: 0, candidates: [] });
  });

  it.each(["local", "remote"])("rejects pre-aborted %s reads before transport or filesystem work", async (host) => {
    const f = host === "local" ? await homePlanFixture() : await remotePlanFixture();
    const controller = new AbortController();
    controller.abort();
    await expect(f.clients.call("project-1", HOME_PLAN_RESOLVE_TOOL, { input: "match" }, { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(f.connect).not.toHaveBeenCalled();
    if (f.requests) expect(f.requests).toEqual([]);
  });

  it.each([
    { input: "MATCH", root: "injected-root" },
    { input: "MATCH", signal: {} },
    { input: "MATCH", projectId: "other" },
    { input: "MATCH", limit: 51 },
    { input: "" },
    { input: "../escape.md" },
    { input: "C:\\private\\plan.md" },
  ])("rejects invalid/injected read DTO %j", async (request) => {
    const f = await homePlanFixture();
    await expect(f.clients.call("project-1", HOME_PLAN_RESOLVE_TOOL, request)).rejects.toMatchObject({ code: expect.stringMatching(/^PLAN_/) });
    expect(f.connect).not.toHaveBeenCalled();
  });

  it("rejects real junction escape and never exposes another directory's content", async () => {
    const f = await homePlanFixture();
    const outside = path.join(f.root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "secret-PLAN.md"), "must never return");
    await symlink(outside, path.join(f.checkout, "escape"), process.platform === "win32" ? "junction" : "dir");
    await expect(f.clients.call("project-1", HOME_PLAN_RESOLVE_TOOL, { input: "escape/secret-PLAN.md", exact: true }))
      .rejects.toMatchObject({ code: "PLAN_PATH_ESCAPE" });
    expect(await readFile(path.join(outside, "secret-PLAN.md"), "utf8")).toBe("must never return");
  });

  it("fails closed for a disabled local home rather than reading its existing checkout", async () => {
    const f = await homePlanFixture();
    f.config.lanes[0].enabled = false;
    await expect(f.clients.call("project-1", HOME_PLAN_RESOLVE_TOOL, { input: "match" }))
      .rejects.toMatchObject({ code: "HOME_LANE_UNAVAILABLE" });
    expect(f.connect).not.toHaveBeenCalled();
  });

  it("refuses unknown and missing home roots without substituting a dispatcher directory", async () => {
    const f = await homePlanFixture();
    await expect(f.clients.call("missing-project", HOME_PLAN_RESOLVE_TOOL, { input: "match" }))
      .rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    const original = f.config.projects[0].homeLane;
    f.config.projects[0].homeLane = "unknown-home";
    await expect(f.clients.call("project-1", HOME_PLAN_RESOLVE_TOOL, { input: "match" }))
      .rejects.toMatchObject({ code: "HOME_LANE_UNKNOWN" });
    f.config.projects[0].homeLane = original;
    f.config.projects[0].repo.path = path.join(f.root, "missing-home-checkout");
    await expect(f.clients.call("project-1", HOME_PLAN_RESOLVE_TOOL, { input: "match" }))
      .rejects.toMatchObject({ code: "PLAN_ROOT_UNAVAILABLE" });
    expect(f.connect).not.toHaveBeenCalled();
  });

  it("passes missing selection, invalid DTO and junction refusal through actual remote worker routing", async () => {
    const f = await remotePlanFixture();
    await expect(f.clients.call("project-1", HOME_PLAN_RESOLVE_TOOL, {
      input: "match", root: f.checkout,
    })).rejects.toMatchObject({ code: "PLAN_RESOLVE_INVALID" });
    expect(f.requests).toEqual([]);
    await rm(path.join(f.checkout, "docs", "plans", f.names[0]));
    expect(await f.clients.call("project-1", HOME_PLAN_RESOLVE_TOOL, {
      input: "docs/plans/Phase-01-MATCH-PLAN.md", exact: true,
    })).toMatchObject({ kind: "none", candidates: [], total: 0 });
    const outside = path.join(f.root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "foreign-PLAN.md"), "foreign body");
    await symlink(outside, path.join(f.checkout, "escape"), process.platform === "win32" ? "junction" : "dir");
    await expect(f.clients.call("project-1", HOME_PLAN_RESOLVE_TOOL, { input: "escape/foreign-PLAN.md", exact: true }))
      .rejects.toMatchObject({ code: "PLAN_PATH_ESCAPE" });
    expect(f.requests).toHaveLength(2);
    expect(f.requests.every((request) => !Object.hasOwn(request.args, "root"))).toBe(true);
    expect(f.connect).not.toHaveBeenCalled();
  });

  it("pins public runner resolver identity to the one canonical C2 policy module", async () => {
    const canonical = await import("../src/jobs/plan-resolution.mjs");
    const runners = await import("../src/jobs/runners.mjs");
    expect(runners.resolvePlan).toBe(canonical.resolvePlan);
    const source = await readFile(path.resolve("src", "jobs", "runners.mjs"), "utf8");
    expect(source).toContain('export { resolvePlan } from "./plan-resolution.mjs"');
    expect(source).not.toContain("function exactPlan(");
    expect(source).not.toContain("function matchingPlans(");
  });
});
