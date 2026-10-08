import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLaunch, connectProject, createProjectClients, isMasterStub, probeForgeMaster } from "../src/mcp/project-client.mjs";

const directories = [];

async function projectDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claw-mcp-client-"));
  directories.push(directory);
  await mkdir(path.join(directory, ".vscode"), { recursive: true });
  return directory;
}

function project(id, repoPath = `C:\\projects\\${id}`) {
  return { id, homeLane: "local", repo: { path: repoPath } };
}

function clientRegistry(projects) {
  const byId = new Map(projects.map((item) => [item.id, item]));
  return { byId: (id) => byId.get(id) };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("project MCP client", () => {
  it("builds an expanded launch with safe argument resolution, port isolation, and server extras", async () => {
    const repoPath = await projectDirectory();
    await writeFile(path.join(repoPath, ".vscode", "mcp.json"), JSON.stringify({
      servers: {
        "plan-forge": {
          command: "node",
          args: ["${workspaceFolder}/entry.mjs", "./relative.mjs", "../parent.mjs", "--flag", "--port", "5"],
          env: { MCP_HOME: "${env:PF_TEST_HOME}" },
          cwd: "${workspaceFolder}/nested",
        },
      },
    }));
    const launch = await buildLaunch(project("p1", repoPath), { mcp: { idleMinutes: 3 } }, {
      env: { PATH: "fake-path", PF_TEST_HOME: "expanded-home" },
      which: async () => true,
    });
    expect(launch.command).toBe(process.execPath);
    expect(launch.args).toEqual([
      path.join(repoPath, "entry.mjs"),
      path.resolve(repoPath, "./relative.mjs"),
      path.resolve(repoPath, "../parent.mjs"),
      "--flag",
      "--port",
      "0",
    ]);
    expect(launch.cwd).toBe(path.join(repoPath, "nested"));
    expect(launch.env.MCP_HOME).toBe("expanded-home");
    expect(launch.env.PFORGE_TOOL_PROFILE).toBe("full");

    const override = await buildLaunch(project("p1", repoPath), { mcp: { toolProfile: "core" } }, {
      env: { PATH: "fake-path", PF_TEST_HOME: "expanded-home" },
      which: async () => true,
    });
    expect(override.env.PFORGE_TOOL_PROFILE).toBe("core");
  });

  it("rejects a remote lane and propagates resolver failures", async () => {
    await expect(buildLaunch({ ...project("remote"), homeLane: "cluster" }, {}))
      .rejects.toMatchObject({ code: "HOME_LANE_REMOTE" });
    await expect(buildLaunch(project("p1"), {}, {
      registry: { resolveMcpLaunch: async () => ({ ok: false, code: "MCP_UNRESOLVED_VAR", hint: "Set X." }) },
    })).rejects.toMatchObject({ code: "MCP_UNRESOLVED_VAR", details: { hint: "Set X." } });
  });

  it("shares concurrent connections and keeps project clients isolated", async () => {
    const projects = [project("p1"), project("p2")];
    const gate = deferred();
    const connected = [];
    const manager = createProjectClients({
      config: {},
      registry: clientRegistry(projects),
      resolveLaunch: async (target) => ({ command: target.id }),
      connect: async (launch) => {
        connected.push(launch.command);
        await gate.promise;
        return { call: async () => launch.command, close: vi.fn() };
      },
    });
    const simultaneous = Array.from({ length: 10 }, () => manager.get("p1"));
    const other = manager.get("p2");
    gate.resolve();
    const clients = await Promise.all([...simultaneous, other]);
    expect(connected.sort()).toEqual(["p1", "p2"]);
    expect(clients.slice(0, 10).every((item) => item === clients[0])).toBe(true);
    expect(clients[10]).not.toBe(clients[0]);
    await manager.closeAll();
  });

  it("closes an idle client and reconnects on the next call", async () => {
    vi.useFakeTimers();
    const connected = [];
    const manager = createProjectClients({
      config: { mcp: { idleMinutes: 0.001 } },
      registry: clientRegistry([project("p1")]),
      resolveLaunch: async () => ({}),
      connect: async () => {
        const client = { call: vi.fn(async () => "ok"), close: vi.fn() };
        connected.push(client);
        return client;
      },
    });
    await manager.call("p1", "test");
    await vi.advanceTimersByTimeAsync(61);
    expect(connected[0].close).toHaveBeenCalledOnce();
    await manager.call("p1", "test");
    expect(connected).toHaveLength(2);
    await manager.closeAll();
  });

  it("never spawns a project MCP process after closeAll (shutdown race with late callers)", async () => {
    const connected = [];
    const manager = createProjectClients({
      config: {},
      registry: clientRegistry([project("p1"), project("p2")]),
      resolveLaunch: async (target) => ({ command: target.id }),
      connect: async (launch) => {
        const client = { call: vi.fn(async () => "ok"), close: vi.fn() };
        connected.push({ id: launch.command, client });
        return client;
      },
    });
    await manager.call("p1", "test");
    await manager.closeAll();
    // A background caller (e.g. the startup doctor) arriving after shutdown must be refused.
    await expect(manager.call("p2", "test")).rejects.toMatchObject({ code: "MCP_TRANSPORT_CLOSED" });
    await expect(manager.call("p1", "test")).rejects.toMatchObject({ code: "MCP_TRANSPORT_CLOSED" });
    expect(connected.map(({ id }) => id)).toEqual(["p1"]);
    expect(connected[0].client.close).toHaveBeenCalledOnce();
  });

  it("does not close a client while a call is in flight", async () => {
    vi.useFakeTimers();
    const gate = deferred();
    const client = { call: () => gate.promise, close: vi.fn() };
    const manager = createProjectClients({
      config: { mcp: { idleMinutes: 0.001 } },
      registry: clientRegistry([project("p1")]),
      resolveLaunch: async () => ({}),
      connect: async () => client,
    });
    const running = manager.call("p1", "slow");
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.close).not.toHaveBeenCalled();
    gate.resolve("done");
    await running;
    await vi.advanceTimersByTimeAsync(61);
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("translates MCP tool errors and bounds their redacted text", async () => {
    class FakeTransport {
      constructor() { this.stderr = new EventEmitter(); }
      async close() {}
    }
    class FakeClient {
      async connect() {}
      async callTool() {
        return { isError: true, content: [{ type: "text", text: "x".repeat(800) }] };
      }
      async close() {}
    }
    const client = await connectProject({}, {
      ClientClass: FakeClient,
      TransportClass: FakeTransport,
      redact: (text) => text,
    });
    await expect(client.call("tool", {})).rejects.toMatchObject({
      code: "MCP_TOOL_ERROR",
      details: { tool: "tool", text: "x".repeat(500) },
    });
  });

  it("retries after a failed connection and reports Forge-Master probe results", async () => {
    let attempts = 0;
    const manager = createProjectClients({
      config: {},
      registry: clientRegistry([project("p1")]),
      resolveLaunch: async () => ({}),
      connect: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("connection failed");
        return { call: async () => ({ error: "pforge-master not installed" }), close: vi.fn() };
      },
    });
    await expect(manager.get("p1")).rejects.toThrow("connection failed");
    expect(await manager.get("p1")).toBeTruthy();
    expect(attempts).toBe(2);
    expect(isMasterStub({ error: "pforge-master not installed" })).toBe(true);
    expect(await probeForgeMaster(manager, "p1")).toEqual({ ok: false, code: "FORGE_MASTER_STUB" });
    expect(await probeForgeMaster({ call: async () => ({ reply: "ready" }) }, "p1"))
      .toEqual({ ok: true, code: "FORGE_MASTER_OK" });
    expect(await probeForgeMaster({ call: async () => {
      const error = new Error("MCP_TOOL_ERROR");
      error.code = "MCP_TOOL_ERROR";
      throw error;
    } }, "p1"))
      .toEqual({ ok: false, code: "MCP_TOOL_ERROR" });
    await manager.closeAll();
  });
});
