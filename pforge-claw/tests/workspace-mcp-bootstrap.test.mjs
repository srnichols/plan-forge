import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapWorktree, collectCopySet } from "../src/jobs/bootstrap.mjs";
import { addWorktree, run } from "../src/jobs/worktree.mjs";
import { buildWorktreeLaunch, connectProject, createProjectClients } from "../src/mcp/project-client.mjs";
import { collectMcpBootstrap, HOME_MCP_BOOTSTRAP_TOOL, MCP_BOOTSTRAP_FILE, parseMcpBootstrap } from "../src/jobs/bootstrap-mcp.mjs";
import * as bootstrapMcp from "../src/jobs/bootstrap-mcp.mjs";
import { openRunnerMcp } from "../src/jobs/runner-mcp.mjs";
import { createRunners } from "../src/jobs/runners.mjs";
import { currentJobs, JOBS_STREAM, transition } from "../src/jobs/model.mjs";
import { createApprovalService } from "../src/approvals.mjs";
import { createL2Receiver } from "../src/protocol/l2-receiver.mjs";
import { applicationIdentity, matchesApplicationAck } from "../src/protocol/l2-ack.mjs";
import { approveJob } from "./g1-runner-fixture.mjs";
import { createRegistry } from "../src/registry.mjs";
import { createSecrets } from "../src/secrets.mjs";
import { runPodJob } from "../src/lanes/k8s-job-lane.mjs";
import { createLaneDirectory } from "../src/lanes/directory.mjs";
import { createRemoteLane } from "../src/lanes/remote-lane.mjs";
import { createLocalLane } from "../src/lanes/local-lane.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { createWorkerAgent } from "../src/protocol/worker-agent.mjs";
import { createWorkerServer } from "../src/protocol/ws-server.mjs";
import { createEnrollment, SECRET_PREFIX } from "../src/protocol/enrollment.mjs";
import { createHttpServer } from "../src/http.mjs";
import { createStore } from "../src/state/store.mjs";
import { buildLeaseGrant, signGrant, verifyGrant } from "../src/protocol/lease-grant.mjs";
import { snapshotExecutionChoices } from "../src/jobs/execution-choices.mjs";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), ".workspace-mcp-bootstrap-fixtures");
const PROJECT_ID = "project-1";
const HOME_LANE = "registered-bootstrap-home";
const WORKER_LANE = "registered-bootstrap-executor";
const MCP_BOOTSTRAP_TOOL = HOME_MCP_BOOTSTRAP_TOOL;
const FIXTURE_REMOTE = "https://example.test/bootstrap.git";
const cleanup = [];
const digest = (value) => createHash("sha256").update(value).digest("hex");

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function bootstrapCommand(commandName, args, options = {}) {
  if (args.at(-1) === "smith") {
    return { code: 0, stdout: "MCP configuration warning only", stderr: "" };
  }
  if (commandName !== "git" || args.some((argument) => ["push", "fetch", "pull"].includes(argument))) {
    throw new Error("External fixture command is not allowed");
  }
  return run(commandName, args, { ...options, timeoutMs: 15_000 });
}

async function command(commandName, args, options = {}) {
  const result = await bootstrapCommand(commandName, args, options);
  if (result.code !== 0) throw new Error(`Fixture command failed: ${result.stderr}`);
  return result;
}

async function writeProbeRuntime(root) {
  await mkdir(path.join(root, "pforge-mcp"), { recursive: true });
  const sdk = new URL("../../node_modules/@modelcontextprotocol/sdk/dist/esm/", import.meta.url);
  const source = `
import { createHash } from "node:crypto";
import { Server } from ${JSON.stringify(new URL("server/index.js", sdk).href)};
import { StdioServerTransport } from ${JSON.stringify(new URL("server/stdio.js", sdk).href)};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${JSON.stringify(new URL("types.js", sdk).href)};
const server = new Server({name:"bootstrap-workspace-probe",version:"1.0.0"},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools:[{name:"workspace_probe",description:"Inspect the inert fixture process",inputSchema:{type:"object",properties:{}}}],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({
  content:[{type:"text",text:JSON.stringify({
    cwd:process.cwd(), project:process.env.PLAN_FORGE_PROJECT,
    keyDigest:createHash("sha256").update(process.env.MCP_VALUE ?? "").digest("hex"),
    tokenDigest:createHash("sha256").update(process.env.API_TOKEN ?? "").digest("hex"),
    profile:process.env.PFORGE_TOOL_PROFILE, args:process.argv.slice(2),
  })}],
}));
await server.connect(new StdioServerTransport());
`;
  await writeFile(path.join(root, "pforge-mcp", "server.mjs"), source);
}

async function fixture() {
  await mkdir(FIXTURES, { recursive: true });
  const root = await mkdtemp(path.join(FIXTURES, "fr03-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const processHome = path.join(root, "process-home");
  await mkdir(processHome);
  const env = {
    PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot,
    HOME: processHome, USERPROFILE: processHome, TEMP: processHome, TMP: processHome,
    GIT_CONFIG_GLOBAL: path.join(processHome, "unused.gitconfig"), GIT_CONFIG_NOSYSTEM: "1",
  };
  const repo = path.join(root, "canonical-checkout");
  await mkdir(path.join(repo, ".vscode"), { recursive: true });
  await mkdir(path.join(repo, ".forge"), { recursive: true });
  await writeFile(path.join(repo, ".gitignore"), ".forge.json\n.forge/\n.vscode/mcp.json\npforge-mcp/\n");
  await writeFile(path.join(repo, "tracked.txt"), "fixture application");
  await command("git", ["init", "--initial-branch=main", repo], { env });
  await command("git", ["-C", repo, "add", ".gitignore", "tracked.txt"], { env });
  await command("git", ["-C", repo, "-c", "user.name=Bootstrap Fixture", "-c", "user.email=bootstrap@example.test",
    "-c", "core.hooksPath=" + path.join(root, "no-hooks"), "commit", "-m", "inert fixture"], { env });
  await writeFile(path.join(repo, ".forge.json"), '{"v":1}');
  await writeFile(path.join(repo, ".forge", "fm-prefs.json"), '{"v":1}');
  await writeFile(path.join(repo, ".vscode", "mcp.json"), JSON.stringify({
    servers: {
      "plan-forge": {
        type: "stdio", command: "node", args: ["pforge-mcp/server.mjs", "--port", "3100"],
        cwd: "${workspaceFolder}",
        env: { MCP_VALUE: "${env:FR03_KEY}", API_TOKEN: "home-inline-token-canary" },
      },
      unrelated: { command: "private-home-command", env: { PRIVATE_KEY: "unrelated-secret-canary" } },
    },
  }));
  await writeProbeRuntime(repo);
  const secretEnv = { FR03_KEY: "executing-lane-key-canary", API_TOKEN: "executing-lane-token-canary" };
  const secrets = await createSecrets({ env: secretEnv, trackNames: Object.keys(secretEnv) });
  const project = {
    id: PROJECT_ID, homeLane: HOME_LANE,
    repo: { path: repo, url: repo, baseBranch: "main", defaultBranch: "main" },
    models: { work: "approved-fixture-model" },
  };
  const config = {
    projects: [project], lanes: [{ id: HOME_LANE, kind: "local" }],
    bootstrap: { env: [], install: "none" },
    runtimes: { pforgeCommand: ["fixture-smith"] },
    mcp: { serverName: "plan-forge", toolProfile: "full" },
  };
  const job = { id: "bootstrap-job", projectId: PROJECT_ID, type: "task", mutating: true };
  return { root, repo, env, secretEnv, secrets, project, config, job };
}

function clientsFor(f, options = {}) {
  const clients = createProjectClients({
    config: f.config, registry: createRegistry(f.config), env: f.env, secrets: f.secrets, ...options,
  });
  cleanup.push(() => clients.closeAll());
  return clients;
}

function approvedDescriptor() {
  return {
    v: 1, serverName: "plan-forge", command: "node",
    args: ["${workspaceFolder}/pforge-mcp/server.mjs", "--port", "3100"],
    cwd: "${workspaceFolder}", env: { MCP_VALUE: "${env:FR03_KEY}", API_TOKEN: "${env:API_TOKEN}" },
    toolProfile: "full",
  };
}

function signedJob(f, mcpBootstrap, {
  laneId = WORKER_LANE, subject = "bootstrap-worker", key = "fixture-grant-canary",
} = {}) {
  const payload = {
    ...f.job, runtime: "copilot-sdk", mcpBootstrap,
    project: {
      id: PROJECT_ID, repo: { url: FIXTURE_REMOTE, defaultBranch: "main" },
      models: f.project.models, bootstrap: { copy: [".forge.json", ".forge/fm-prefs.json"], env: [], install: "none" },
    },
  };
  payload.leaseGrant = signGrant({
    grant: buildLeaseGrant({
      leaseJob: payload, laneId, now: () => 0,
      proof: { kind: "consumed", ref: "approved-bootstrap-fixture", decidedAt: 0 },
    }),
    subject, key,
  });
  verifyGrant({
    grant: payload.leaseGrant, job: payload, laneId, subject, key, now: () => 1,
  });
  return snapshotExecutionChoices(payload);
}

async function remoteHome(f) {
  const homeConfig = { ...f.config, lanes: [{ id: HOME_LANE, kind: "remote" }] };
  const homeClients = clientsFor({ ...f, config: homeConfig }, { currentLaneId: HOME_LANE });
  const store = createStore(path.join(f.root, "reader-state"));
  const unlock = store.lock();
  cleanup.push(unlock);
  const workerId = "bootstrap-home-reader";
  const authSecret = "bootstrap-protocol-canary";
  store.append("enrollment", { v: 1, op: "registered", workerId, laneId: HOME_LANE });
  const secrets = await createSecrets({ env: { [`${SECRET_PREFIX}${workerId}`]: authSecret } });
  const enrollment = createEnrollment({ store, secrets });
  const registry = createWorkerRegistry({ requireL2: true });
  const http = createHttpServer({ bind: "127.0.0.1", port: 0 });
  const server = createWorkerServer({ registry, enrollment, secrets, allowedLanes: [HOME_LANE] });
  server.attach(http);
  const { port } = await http.listen();
  const requests = [];
  const worker = createWorkerAgent({
    url: `ws://127.0.0.1:${port}/claw/workers`, workerId, laneId: HOME_LANE, secret: authSecret,
    capabilities: { os: process.platform, arch: process.arch, macos: false, toolchains: [], projects: [PROJECT_ID] },
    localLane: createLocalLane({ runtime: { run: async () => { throw new Error("No mutating read jobs"); } } }),
    readHandler(request, options) {
      requests.push(request);
      return homeClients.call(request.projectId, request.tool, request.args, options);
    },
  });
  const directory = createLaneDirectory();
  directory.configure(homeConfig.lanes);
  directory.register(createRemoteLane({ id: HOME_LANE, registry }));
  cleanup.push(async () => {
    worker.stop();
    await worker.drain();
    server.close();
    registry.close();
    await http.close();
  });
  worker.start();
  await vi.waitFor(() => expect(registry.snapshot().byLane[HOME_LANE]?.connected).toBe(1));
  const remoteConfig = {
    ...homeConfig, projects: [{ ...f.project, repo: { path: path.join(f.root, "absent-dispatcher-checkout") } }],
  };
  return {
    clients: clientsFor({ ...f, config: remoteConfig }, { directory }), requests, config: remoteConfig, directory,
    homeClients, homeConfig, workerId, authSecret,
  };
}

describe("FR-03 physical ignored MCP bootstrap", () => {
  it("completes the real default workspace runner only after canonical application ACK and transport cleanup", async () => {
    const f = await fixture();
    f.config.allowlist = [
      { channel: "telegram", userId: "requester-owner", role: "owner" },
      { channel: "telegram", userId: "owner", role: "owner" },
    ];
    const store = createStore(path.join(f.root, "job-state"));
    const unlock = store.lock();
    cleanup.push(unlock);
    const bus = new EventEmitter();
    const approvals = createApprovalService({ store, bus, config: f.config });
    const localJobId = "a1000001";
    const approved = await approveJob({ store, approvals }, {
      id: localJobId, fields: { description: "Validate ignored MCP bootstrap in the physical workspace" },
    });
    const leased = transition(approved, "leased", { lane: HOME_LANE });
    store.append(JOBS_STREAM, leased.event);
    const opened = [];
    const clients = clientsFor(f, {
      connect: async (launch, options) => {
        const client = await connectProject(launch, options);
        opened.push({ launch, client });
        return client;
      },
    });
    const worktree = path.join(f.root, "runner-home", "worktrees", PROJECT_ID, localJobId);
    let probe;
    const result = await createRunners({
      home: path.join(f.root, "runner-home"), config: f.config, store, bus, features: [],
      runner: bootstrapCommand, secrets: f.secrets, env: f.env, projectClients: clients,
      l2Receiver: createL2Receiver({ config: f.config, currentLaneId: HOME_LANE }),
      runtime: {
        async run(turn) {
          expect(turn.cwd).toBe(worktree);
          expect(turn.model).toBe(f.project.models.work);
          probe = await opened[0].client.call("workspace_probe", {});
          const artifact = path.join(turn.cwd, ".forge", "runs", "bootstrap-run", "run.json");
          await mkdir(path.dirname(artifact), { recursive: true });
          await writeFile(artifact, '{"id":"bootstrap-run"}\n');
          return { ok: true, status: "succeeded", usage: { tokensIn: null, tokensOut: null } };
        },
      },
    }).runJob(leased.job);
    expect(result.status, result.error).toBe("succeeded");
    expect(probe).toMatchObject({
      cwd: worktree, project: worktree, keyDigest: digest(f.secretEnv.FR03_KEY), tokenDigest: digest(f.secretEnv.API_TOKEN),
    });
    expect(opened).toHaveLength(1);
    expect(matchesApplicationAck(applicationIdentity(result.l2), result.l2)).toBe(true);
    expect(result.l2.ok).toBe(true);
    expect(await readFile(path.join(f.repo, ".forge", "runs", "bootstrap-run", "run.json"), "utf8"))
      .toBe('{"id":"bootstrap-run"}\n');
    await expect(lstat(worktree)).rejects.toMatchObject({ code: "ENOENT" });
    expect(currentJobs(store)[localJobId].state).toBe("succeeded");
    expect(JSON.stringify([...store.read("jobs")])).not.toMatch(/executing-lane|home-inline-token/);
  }, 20_000);

  it("launches the actual isolated worktree transport after default ignored-home bootstrap", async () => {
    const f = await fixture();
    const before = { ...process.env };
    const homeConfig = await readFile(path.join(f.repo, ".vscode", "mcp.json"), "utf8");
    const handle = await addWorktree({ home: path.join(f.root, "claw-home"), project: f.project, job: f.job, env: f.env });
    await expect(readFile(path.join(handle.path, ".vscode", "mcp.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(handle.path, "pforge-mcp", "server.mjs"))).rejects.toMatchObject({ code: "ENOENT" });
    const boot = await bootstrapWorktree({
      job: f.job, worktree: handle, homeRepo: f.repo, config: f.config, env: f.env, secrets: f.secrets, runner: command,
    });
    expect(boot.ok, boot.code).toBe(true);
    const clients = clientsFor(f);
    const client = await clients.forWorktree({ projectId: PROJECT_ID, cwd: handle.path, env: boot.env });
    expect(await client.call("workspace_probe", {})).toMatchObject({
      cwd: handle.path, project: handle.path, keyDigest: digest(f.secretEnv.FR03_KEY),
      tokenDigest: digest(f.secretEnv.API_TOKEN), profile: "full", args: ["--port", "0"],
    });
    await client.close();
    expect(await readFile(path.join(handle.path, ".forge.json"), "utf8")).toBe('{"v":1}');
    expect(await readFile(path.join(f.repo, ".vscode", "mcp.json"), "utf8")).toBe(homeConfig);
    await expect(readFile(path.join(handle.path, ".vscode", "mcp.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(process.env).toEqual(before);
  }, 20_000);

  it("derives only bounded reference metadata at the authenticated remote home without a dispatcher checkout", async () => {
    const f = await fixture();
    const remote = await remoteHome(f);
    const controller = new AbortController();
    const descriptor = await remote.clients.call(PROJECT_ID, MCP_BOOTSTRAP_TOOL, {}, { signal: controller.signal });
    expect(descriptor).toEqual(approvedDescriptor());
    expect(Buffer.byteLength(JSON.stringify(descriptor))).toBeLessThanOrEqual(10_240);
    expect(JSON.stringify(descriptor)).not.toMatch(/home-inline-token-canary|unrelated-secret-canary|executing-lane/);
    expect(JSON.stringify(descriptor)).not.toContain(f.repo);
    expect(remote.requests).toHaveLength(1);
    expect(remote.requests[0]).toMatchObject({ projectId: PROJECT_ID, tool: MCP_BOOTSTRAP_TOOL, args: {} });
    expect(remote.requests[0].args).not.toHaveProperty("signal");
  }, 20_000);

  it("launches the physical remote-home worktree on its exact authenticated home worker", async () => {
    const f = await fixture();
    const remote = await remoteHome(f);
    const descriptor = await remote.clients.call(PROJECT_ID, MCP_BOOTSTRAP_TOOL, {});
    const job = signedJob(f, descriptor, { laneId: HOME_LANE, subject: remote.workerId, key: remote.authSecret });
    const handle = await addWorktree({
      home: path.join(f.root, "remote-executing-home"), project: remote.homeConfig.projects[0], job, env: f.env,
    });
    const boot = await bootstrapWorktree({
      job, worktree: handle, homeRepo: f.repo, config: remote.homeConfig, env: f.env, secrets: f.secrets, runner: command,
    });
    expect(boot.ok, boot.code).toBe(true);
    const client = await remote.homeClients.forWorktree({ projectId: PROJECT_ID, cwd: handle.path, env: boot.env });
    expect(await client.call("workspace_probe", {})).toMatchObject({
      cwd: handle.path, project: handle.path, keyDigest: digest(f.secretEnv.FR03_KEY),
      tokenDigest: digest(f.secretEnv.API_TOKEN),
    });
    await expect(readFile(path.join(handle.path, ".vscode", "mcp.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(path.relative(path.join(f.repo, "pforge-mcp", "server.mjs"), client.launch.args[0])).toBe("");
    await client.close();
  }, 20_000);

  it("launches the actual clean-clone pod transport from immutable signed home metadata and executing-lane secrets", async () => {
    const f = await fixture();
    const job = signedJob(f, approvedDescriptor());
    const before = JSON.stringify(job);
    const runtimeRoot = path.join(f.root, "executing-framework");
    await writeProbeRuntime(runtimeRoot);
    const files = await collectCopySet({ repoPath: f.repo });
    const workdir = path.join(f.root, "pod-workspace");
    await mkdir(workdir);
    const boot = await runPodJob({
      job, project: job.project, config: f.config, requestCopySet: async () => files,
      runner: (name, args, options) => command(name,
        args.map((argument) => argument === FIXTURE_REMOTE ? f.repo : argument), options),
      workdir, env: f.env, secrets: f.secrets,
    });
    expect(boot.ok, boot.code).toBe(true);
    await expect(readFile(path.join(boot.repoDir, ".vscode", "mcp.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(boot.repoDir, "pforge-mcp", "server.mjs"))).rejects.toMatchObject({ code: "ENOENT" });
    const project = { ...f.project, repo: { ...f.project.repo, path: boot.repoDir } };
    const config = { ...f.config, projects: [project], lanes: [{ id: HOME_LANE, kind: "remote" }] };
    const clients = clientsFor({ ...f, config }, { currentLaneId: WORKER_LANE, mcpRuntimeRoot: runtimeRoot });
    const client = await clients.forWorktree({ projectId: PROJECT_ID, cwd: boot.repoDir, env: boot.env });
    expect(await client.call("workspace_probe", {})).toMatchObject({
      cwd: boot.repoDir, project: boot.repoDir, keyDigest: digest(f.secretEnv.FR03_KEY),
      tokenDigest: digest(f.secretEnv.API_TOKEN), profile: "full", args: ["--port", "0"],
    });
    expect(JSON.stringify(job)).toBe(before);
    expect(project.models).toEqual(job.project.models);
    await client.close();
  }, 20_000);
});

describe("FR-03 workspace launch boundaries", () => {
  it("preserves opaque approved MCP model and provider identifiers instead of interpreting them as paths", async () => {
    const f = await fixture();
    const file = path.join(f.repo, ".vscode", "mcp.json");
    const config = JSON.parse(await readFile(file, "utf8"));
    const choices = ["--model", "vendor/approved-model", "--provider=vendor/approved-provider"];
    config.servers["plan-forge"].args.push(...choices);
    await writeFile(file, JSON.stringify(config));
    expect((await collectMcpBootstrap({ repoPath: f.repo })).args).toEqual([...approvedDescriptor().args, ...choices]);
  });

  it("preserves approved literal MCP model/provider choices and rebases a relative workspace cwd", async () => {
    const f = await fixture();
    const file = path.join(f.repo, ".vscode", "mcp.json");
    const config = JSON.parse(await readFile(file, "utf8"));
    config.servers["plan-forge"].env.MODEL = "vendor/approved-model";
    config.servers["plan-forge"].env.PROVIDER = "byok:configured-provider";
    config.servers["plan-forge"].cwd = ".";
    await writeFile(file, JSON.stringify(config));
    const descriptor = await collectMcpBootstrap({ repoPath: f.repo });
    expect(descriptor.cwd).toBe("${workspaceFolder}");
    expect(descriptor.env).toMatchObject({ MODEL: "vendor/approved-model", PROVIDER: "byok:configured-provider" });
  });

  it("uses explicit verified launch metadata rather than a modified workspace metadata mirror", async () => {
    const f = await fixture();
    const job = signedJob(f, approvedDescriptor());
    const before = JSON.stringify(job);
    const handle = await addWorktree({ home: path.join(f.root, "sealed-home"), project: f.project, job, env: f.env });
    const boot = await bootstrapWorktree({
      job, worktree: handle, homeRepo: f.repo, config: f.config, env: f.env, secrets: f.secrets, runner: command,
    });
    await writeFile(path.join(handle.path, MCP_BOOTSTRAP_FILE), JSON.stringify({
      ...approvedDescriptor(), toolProfile: "tampered-profile",
    }));
    const client = await openRunnerMcp({
      ctx: { config: f.config, projectClients: clientsFor(f), secrets: f.secrets },
      project: f.project, worktree: handle.path, env: boot.env, mcpBootstrap: job.mcpBootstrap,
    });
    cleanup.push(() => client.close());
    expect(await client.call("workspace_probe", {})).toMatchObject({ cwd: handle.path, profile: "full" });
    expect(JSON.stringify(job)).toBe(before);
  }, 20_000);

  it("rejects an explicit null launch descriptor rather than repairing it from the workspace", async () => {
    const f = await fixture();
    const handle = await addWorktree({ home: path.join(f.root, "null-home"), project: f.project, job: f.job, env: f.env });
    const boot = await bootstrapWorktree({
      job: f.job, worktree: handle, homeRepo: f.repo, config: f.config, env: f.env, secrets: f.secrets, runner: command,
    });
    const connect = vi.fn(async () => ({ call: async () => ({}), close: async () => {} }));
    const clients = clientsFor(f, { connect });
    await expect(clients.forWorktree({
      projectId: PROJECT_ID, cwd: handle.path, env: boot.env, mcpBootstrap: null,
    })).rejects.toMatchObject({ code: "MCP_BOOTSTRAP_INVALID" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("preserves explicitly empty secret settings instead of enabling a provider from the worker store", async () => {
    const f = await fixture();
    const file = path.join(f.repo, ".vscode", "mcp.json");
    const config = JSON.parse(await readFile(file, "utf8"));
    config.servers["plan-forge"].env.API_TOKEN = "";
    await writeFile(file, JSON.stringify(config));
    expect((await collectMcpBootstrap({ repoPath: f.repo })).env.API_TOKEN).toBe("");
  });

  it.each(["local", "remote"])("provides the exact lease bootstrap helper on the registered %s home", async (kind) => {
    const f = await fixture();
    const remote = kind === "remote" ? await remoteHome(f) : null;
    const descriptor = await bootstrapMcp.collectLeaseMcpBootstrap({
      project: { ...f.project, repo: { path: path.join(f.root, "injected-non-home") } },
      config: remote?.config ?? f.config, directory: remote?.directory,
    });
    expect(descriptor).toEqual(approvedDescriptor());
    const job = signedJob(f, descriptor);
    expect(job.mcpBootstrap).toEqual(descriptor);
    expect(Object.isFrozen(job.mcpBootstrap)).toBe(true);
    expect(JSON.stringify(descriptor)).not.toContain(f.repo);
    if (remote) expect(remote.requests[0]).toMatchObject({ projectId: PROJECT_ID, tool: MCP_BOOTSTRAP_TOOL, args: {} });
  }, 20_000);

  it("refuses camel-case inline credential arguments instead of serializing them into home metadata", async () => {
    const f = await fixture();
    const configPath = path.join(f.repo, ".vscode", "mcp.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.servers["plan-forge"].args.push("--apiKey=home-argument-canary");
    await writeFile(configPath, JSON.stringify(config));
    await expect(collectMcpBootstrap({ repoPath: f.repo })).rejects.toMatchObject({ code: "MCP_BOOTSTRAP_CREDENTIAL_REFUSED" });
  });

  it("rejects a workspace-prefix sibling cwd before any launch or file reads", () => {
    expect(() => parseMcpBootstrap({ ...approvedDescriptor(), cwd: "${workspaceFolder}-sibling" }))
      .toThrowError(expect.objectContaining({ code: "MCP_BOOTSTRAP_PATH_REJECTED" }));
  });

  it("resolves executing-lane references for the real explicit worktree-launch callback", async () => {
    const f = await fixture();
    const handle = await addWorktree({ home: path.join(f.root, "callback-home"), project: f.project, job: f.job, env: f.env });
    const boot = await bootstrapWorktree({
      job: f.job, worktree: handle, homeRepo: f.repo, config: f.config, env: f.env, secrets: f.secrets, runner: command,
    });
    expect(boot.ok, boot.code).toBe(true);
    const client = await openRunnerMcp({
      ctx: {
        config: f.config, secrets: f.secrets,
        mcpLaunchForWorktree: ({ project, cwd, env, signal }) => buildWorktreeLaunch({
          project, config: f.config, cwd, env, signal,
        }),
      },
      project: f.project, worktree: handle.path, env: { ...boot.env, PLAN_FORGE_PROJECT: f.repo },
    });
    cleanup.push(() => client.close());
    expect(await client.call("workspace_probe", {})).toMatchObject({
      cwd: handle.path, project: handle.path, keyDigest: digest(f.secretEnv.FR03_KEY),
      tokenDigest: digest(f.secretEnv.API_TOKEN),
    });
    expect(JSON.stringify(JSON.parse(await readFile(path.join(handle.path, MCP_BOOTSTRAP_FILE), "utf8"))))
      .not.toMatch(/home-inline|executing-lane|unrelated-secret/);
  }, 20_000);

  it("preserves immutable signed MCP choices despite a later home edit and stale worker profile", async () => {
    const f = await fixture();
    const metadata = await clientsFor(f).call(PROJECT_ID, MCP_BOOTSTRAP_TOOL, {});
    const descriptor = { ...metadata, serverName: "approved-server", toolProfile: "approved-profile" };
    const job = signedJob(f, descriptor);
    const before = JSON.stringify(job);
    await writeFile(path.join(f.repo, ".vscode", "mcp.json"), '{"servers":{"other":{"command":"not-approved"}}}');
    const handle = await addWorktree({ home: path.join(f.root, "signed-home"), project: f.project, job, env: f.env });
    const config = { ...f.config, mcp: { serverName: "other", toolProfile: "stale-profile" } };
    const boot = await bootstrapWorktree({
      job, worktree: handle, homeRepo: f.repo, config, env: f.env, secrets: f.secrets, runner: command,
    });
    expect(boot.ok, boot.code).toBe(true);
    const client = await clientsFor({ ...f, config }).forWorktree({ projectId: PROJECT_ID, cwd: handle.path, env: boot.env });
    expect(await client.call("workspace_probe", {})).toMatchObject({ profile: "approved-profile", cwd: handle.path });
    expect(JSON.stringify(job)).toBe(before);
    expect(f.project.models).toEqual(job.project.models);
    expect(JSON.parse(await readFile(path.join(handle.path, MCP_BOOTSTRAP_FILE), "utf8"))).toEqual(descriptor);
    await client.close();
  }, 20_000);

  it("reads refreshed executing-lane secrets for every actual workspace transport launch", async () => {
    const f = await fixture();
    const handle = await addWorktree({ home: path.join(f.root, "refresh-home"), project: f.project, job: f.job, env: f.env });
    const boot = await bootstrapWorktree({
      job: f.job, worktree: handle, homeRepo: f.repo, config: f.config, env: f.env, secrets: f.secrets, runner: command,
    });
    const clients = clientsFor(f);
    const first = await clients.forWorktree({ projectId: PROJECT_ID, cwd: handle.path, env: boot.env });
    expect(await first.call("workspace_probe", {})).toMatchObject({ keyDigest: digest(f.secretEnv.FR03_KEY) });
    await first.close();
    f.secretEnv.FR03_KEY = "refreshed-lane-key-canary";
    const second = await clients.forWorktree({ projectId: PROJECT_ID, cwd: handle.path, env: boot.env });
    expect(await second.call("workspace_probe", {})).toMatchObject({ keyDigest: digest(f.secretEnv.FR03_KEY) });
    await second.close();
    expect(JSON.stringify(boot.env)).not.toMatch(/executing-lane|refreshed-lane/);
  }, 20_000);

  it.each([
    { root: "private" }, { paths: [".forge/secrets.json"] }, { serverName: "unrelated" },
    { env: { API_KEY: "input-canary" } }, { projectId: "other" }, { signal: {} }, [], null,
  ])("refuses arbitrary home-read/launch selectors %j before opening MCP", async (request) => {
    const f = await fixture();
    const connect = vi.fn();
    await expect(clientsFor(f, { connect }).call(PROJECT_ID, MCP_BOOTSTRAP_TOOL, request))
      .rejects.toMatchObject({ code: "MCP_BOOTSTRAP_INVALID" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("derives metadata from the actual configured registered home, not an injected registry path", async () => {
    const f = await fixture();
    const connect = vi.fn();
    const clients = clientsFor(f, {
      registry: { byId: () => ({ ...f.project, repo: { path: path.join(f.root, "not-the-home") } }) }, connect,
    });
    expect(await clients.call(PROJECT_ID, MCP_BOOTSTRAP_TOOL, {})).toEqual(approvedDescriptor());
    expect(connect).not.toHaveBeenCalled();
  });

  it("requires an available registered home and ignores environment/config home-lane spoofing", async () => {
    const f = await fixture();
    const config = {
      ...f.config, worker: { laneId: HOME_LANE },
      lanes: [{ id: HOME_LANE, kind: "remote" }],
    };
    const clients = clientsFor({ ...f, config }, { env: { PFORGE_CLAW_CURRENT_LANE: HOME_LANE } });
    await expect(clients.call(PROJECT_ID, MCP_BOOTSTRAP_TOOL, {})).rejects.toMatchObject({ code: "HOME_LANE_UNAVAILABLE" });
    const disabled = clientsFor({ ...f, config: { ...f.config, lanes: [{ id: HOME_LANE, kind: "local", enabled: false }] } });
    await expect(disabled.call(PROJECT_ID, MCP_BOOTSTRAP_TOOL, {})).rejects.toMatchObject({ code: "HOME_LANE_UNAVAILABLE" });
  });

  it.each(["local", "remote"])("refuses pre-aborted %s metadata reads without forwarding or opening MCP", async (kind) => {
    const f = await fixture();
    const connect = vi.fn();
    const remote = kind === "remote" ? await remoteHome(f) : null;
    const clients = remote?.clients ?? clientsFor(f, { connect });
    const controller = new AbortController();
    controller.abort();
    await expect(clients.call(PROJECT_ID, MCP_BOOTSTRAP_TOOL, {}, { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(connect).not.toHaveBeenCalled();
    if (remote) expect(remote.requests).toEqual([]);
  }, 20_000);

  it("returns a safe explicit missing-configuration error and never an empty or fallback launch", async () => {
    const f = await fixture();
    await rm(path.join(f.repo, ".vscode", "mcp.json"));
    await expect(clientsFor(f).call(PROJECT_ID, MCP_BOOTSTRAP_TOOL, {})).rejects.toMatchObject({ code: "MCP_CONFIG_MISSING" });
  });

  it.each([
    { args: ["--api_key=input-canary"] }, { args: ["--token", "input-canary"] },
    { args: ["--api-key=literal-${env:FR03_KEY}"] }, { args: ["https://user:input-canary@example.test"] },
    { args: ["https://example.test?api_key=input-canary"] },
    { args: ["https://example.test?apiKey=input-canary"] },
  ])("refuses inline credentials in selected launch arguments %j", async ({ args }) => {
    const f = await fixture();
    const file = path.join(f.repo, ".vscode", "mcp.json");
    const config = JSON.parse(await readFile(file, "utf8"));
    config.servers["plan-forge"].args = args;
    await writeFile(file, JSON.stringify(config));
    await expect(clientsFor(f).call(PROJECT_ID, MCP_BOOTSTRAP_TOOL, {}))
      .rejects.toMatchObject({ code: "MCP_BOOTSTRAP_CREDENTIAL_REFUSED" });
  });

  it("bounds both home configuration input and the selected descriptor output", async () => {
    const f = await fixture();
    const file = path.join(f.repo, ".vscode", "mcp.json");
    const config = JSON.parse(await readFile(file, "utf8"));
    config.servers["plan-forge"].args = Array.from({ length: 64 }, () => "--choice=" + "v".repeat(240));
    await writeFile(file, JSON.stringify(config));
    await expect(collectMcpBootstrap({ repoPath: f.repo })).rejects.toMatchObject({ code: "MCP_BOOTSTRAP_TOO_LARGE" });
    await writeFile(file, JSON.stringify({ ...config, unrelated: "x".repeat(65_536) }));
    await expect(collectMcpBootstrap({ repoPath: f.repo })).rejects.toMatchObject({ code: "MCP_BOOTSTRAP_TOO_LARGE" });
  });

  it.each([
    { apiKey: "injected-canary" }, { args: ["../private.mjs"] }, { cwd: "C:\\private" },
    { command: "\\\\host\\private\\runner.exe" }, { env: { API_TOKEN: "injected-canary" } },
    { env: { API_TOKEN: "partial-${env:FR03_KEY}" } }, { v: 2 },
  ])("refuses malformed/path/credential wire metadata %j without repairing it", (changes) => {
    expect(() => parseMcpBootstrap({ ...approvedDescriptor(), ...changes })).toThrowError();
  });

  it("refuses unsigned metadata and malformed signed metadata without falling back to the home", async () => {
    const f = await fixture();
    const worktree = path.join(f.root, "bad-metadata-workspace");
    await mkdir(worktree);
    const unsigned = await bootstrapWorktree({
      job: { ...f.job, mcpBootstrap: approvedDescriptor() }, worktree, homeRepo: f.repo,
      config: f.config, env: f.env, secrets: f.secrets, runner: command,
    });
    expect(unsigned).toMatchObject({ ok: false, code: "MCP_BOOTSTRAP_UNTRUSTED" });
    const malformed = await bootstrapWorktree({
      job: signedJob(f, null), worktree, homeRepo: f.repo,
      config: f.config, env: f.env, secrets: f.secrets, runner: command,
    });
    expect(malformed).toMatchObject({ ok: false, code: "MCP_BOOTSTRAP_INVALID" });
  });

  it("refuses missing and failed executing-lane secret resolution before connecting", async () => {
    const f = await fixture();
    const handle = await addWorktree({ home: path.join(f.root, "missing-key-home"), project: f.project, job: f.job, env: f.env });
    await bootstrapWorktree({
      job: f.job, worktree: handle, homeRepo: f.repo, config: f.config, env: f.env, secrets: f.secrets, runner: command,
    });
    const connect = vi.fn();
    const missing = clientsFor(f, { secrets: { get: () => null }, connect });
    await expect(missing.forWorktree({ projectId: PROJECT_ID, cwd: handle.path, env: f.env }))
      .rejects.toMatchObject({ code: "MCP_UNRESOLVED_VAR" });
    const failed = clientsFor(f, { secrets: { get: () => { throw new Error("resolver-canary"); } }, connect });
    const error = await failed.forWorktree({ projectId: PROJECT_ID, cwd: handle.path, env: f.env }).catch((failure) => failure);
    expect(error).toMatchObject({ code: "MCP_BOOTSTRAP_SECRET_FAILED" });
    expect(JSON.stringify({ message: error.message, ...error })).not.toContain("resolver-canary");
    expect(connect).not.toHaveBeenCalled();
  });

  it("awaits connection cleanup when a descriptor-backed transport is aborted while connecting", async () => {
    const f = await fixture();
    const handle = await addWorktree({ home: path.join(f.root, "abort-home"), project: f.project, job: f.job, env: f.env });
    const boot = await bootstrapWorktree({
      job: f.job, worktree: handle, homeRepo: f.repo, config: f.config, env: f.env, secrets: f.secrets, runner: command,
    });
    const started = Promise.withResolvers();
    const connected = Promise.withResolvers();
    const settled = Promise.withResolvers();
    const close = vi.fn(() => settled.promise);
    const clients = clientsFor(f, { connect: async () => { started.resolve(); return connected.promise; } });
    const controller = new AbortController();
    const pending = clients.forWorktree({ projectId: PROJECT_ID, cwd: handle.path, env: boot.env, signal: controller.signal });
    const failure = pending.catch((error) => error);
    await started.promise;
    controller.abort();
    connected.resolve({ call: async () => ({}), close });
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    settled.resolve();
    expect(await failure).toMatchObject({ code: "JOB_CANCELLED" });
    await clients.closeAll();
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects home config, workspace metadata, and runtime symlink escapes before launch", async () => {
    const f = await fixture();
    const outside = path.join(f.root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "mcp.json"), JSON.stringify({ servers: {} }));
    await rm(path.join(f.repo, ".vscode"), { recursive: true });
    await symlink(outside, path.join(f.repo, ".vscode"), process.platform === "win32" ? "junction" : "dir");
    await expect(collectMcpBootstrap({ repoPath: f.repo })).rejects.toMatchObject({ code: "MCP_BOOTSTRAP_PATH_REJECTED" });
    const workspace = path.join(f.root, "escaped-workspace");
    await mkdir(workspace);
    await symlink(outside, path.join(workspace, ".forge"), process.platform === "win32" ? "junction" : "dir");
    await expect(buildWorktreeLaunch({ project: f.project, config: f.config, cwd: workspace, env: f.env, secrets: f.secrets }))
      .rejects.toMatchObject({ code: "MCP_BOOTSTRAP_PATH_REJECTED" });
    await writeProbeRuntime(outside);
    await rm(path.join(f.repo, "pforge-mcp"), { recursive: true });
    await symlink(path.join(outside, "pforge-mcp"), path.join(f.repo, "pforge-mcp"), process.platform === "win32" ? "junction" : "dir");
    const safeWorkspace = path.join(f.root, "safe-workspace");
    await mkdir(safeWorkspace);
    await expect(buildWorktreeLaunch({
      project: f.project, config: f.config, cwd: safeWorkspace, env: f.env, secrets: f.secrets, mcpBootstrap: approvedDescriptor(),
    })).rejects.toMatchObject({ code: "MCP_BOOTSTRAP_PATH_REJECTED" });
  });

  it("rejects executing-environment traversal in workspace paths before connecting", async () => {
    const f = await fixture();
    const workspace = path.join(f.root, "relative-env-workspace");
    await mkdir(workspace);
    await expect(buildWorktreeLaunch({
      project: f.project, config: f.config, cwd: workspace,
      env: { ...f.env, SUBDIR: "../outside" }, secrets: f.secrets,
      mcpBootstrap: { ...approvedDescriptor(), cwd: "${workspaceFolder}/${env:SUBDIR}" },
    })).rejects.toMatchObject({ code: "MCP_BOOTSTRAP_PATH_REJECTED" });
  });
});
