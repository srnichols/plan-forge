import { randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createApprovalService } from "../src/approvals.mjs";
import { loadConfig, loadSchema, validateConfig } from "../src/config.mjs";
import { executionConfigFor } from "../src/jobs/execution-choices.mjs";
import { createLeasePreparer, proofFor } from "../src/jobs/lease-payload.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "../src/jobs/model.mjs";
import { resolveForgeHome } from "../src/memory/l2-sync.mjs";
import { placeJob } from "../src/placement.mjs";
import { deltaApplicationIdentity } from "../src/protocol/l2-ack.mjs";
import { createL2Receiver, L2_APPLY_READ } from "../src/protocol/l2-receiver.mjs";
import { signGrant, verifyGrant } from "../src/protocol/lease-grant.mjs";
import { message } from "../src/protocol/messages.mjs";
import { createStore } from "../src/state/store.mjs";

const WIRE_IDENTIFIER_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$";
const NOW = 2_000_000_000_000;
const OWNER = "fixture-owner";
const CHAT = "fixture-chat";
const directories = [];
const fixtureRoot = fileURLToPath(new URL("./.lane-contract-review-fixtures/", import.meta.url));

async function fixtureDirectory() {
  const directory = path.join(fixtureRoot, `boundary-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  directories.push(directory);
  return directory;
}

function configuration({
  laneId = "executor", kind = "remote", projectId = "project-1", repoPath = "/path/to/project",
} = {}) {
  return {
    v: 1,
    instanceId: "lane-contract-fixture",
    timezone: "Etc/UTC",
    allowlist: [{ channel: "telegram", userId: OWNER, role: "owner" }],
    lanes: [
      { id: "control", kind: "local", enabled: true },
      { id: laneId, kind, enabled: true, labels: ["execution"] },
    ],
    projects: [{
      id: projectId,
      homeLane: "control",
      repo: { path: repoPath, remote: "https://example.com/owner/repo.git", baseBranch: "main" },
      channel: { adapter: "telegram", chatId: CHAT },
      placement: { prefer: [laneId], requires: ["execution"] },
      models: { work: "configured-work-model" },
      runtime: "byok:openai",
    }],
    runtimes: { default: "copilot-sdk", byok: {
      openai: { keySecret: "LANE_CONTRACT_PROVIDER_KEY", endpoint: "https://provider.example" },
    } },
    bootstrap: { copy: [], env: ["LANE_CONTRACT_JOB_VALUE"], install: "none" },
    worker: {
      dispatcherUrl: "wss://dispatcher.example/claw/workers",
      laneId,
      secretName: "LANE_CONTRACT_WORKER_KEY",
    },
  };
}

async function approvedFixture(options = {}) {
  const directory = await fixtureDirectory();
  const config = configuration({ ...options, repoPath: directory });
  const store = createStore(path.join(directory, "state"));
  const approvals = createApprovalService({ store, config, bus: new EventEmitter(), now: () => NOW });
  const created = createJob({ id: "a1000001", type: "plan", projectId: config.projects[0].id });
  const requested = {
    ...created.job, callerId: OWNER, callerRole: "owner", adapter: "telegram", chatId: CHAT,
    planPath: "docs/plans/Phase-FIXTURE-PLAN.md", quorum: "auto", resumeFrom: 3,
  };
  store.append(JOBS_STREAM, { ...created.event, job: requested });
  const awaiting = transition(requested, "awaiting-approval");
  store.append(JOBS_STREAM, awaiting.event);
  const approval = approvals.createApproval(awaiting.job);
  approvals.issue(awaiting.job, { approval });
  const decision = await approvals.decide({
    payload: approval.quorum("power").slice(2), caller: { userId: OWNER, role: "owner" }, chatId: CHAT,
  });
  expect(decision).toMatchObject({ ok: true, decision: "approve", quorum: "power" });
  const job = currentJobs(store)[requested.id];
  const prepare = createLeasePreparer({
    ctx: { config, store }, laneConfig: config.lanes[1], directory: {}, now: () => NOW,
  });
  return { directory, config, store, approvals, job, prepare };
}

function signedPayload(payload, laneId) {
  const key = randomBytes(32).toString("hex");
  const subject = "fixture-worker";
  const { leaseGrant, ...job } = payload;
  const grant = signGrant({ grant: leaseGrant, subject, key });
  return { grant, job, subject, laneId, key, now: () => NOW };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("FR-09 registered qualified home precedence", () => {
  it.each([
    ["single-letter POSIX home", "x:/srv/audit/.forge", "x", "/srv/audit/.forge"],
    ["single-letter rooted Windows home", String.raw`x:\audit\.forge`, "x", String.raw`\audit\.forge`],
    ["qualified Windows backslash drive", String.raw`x:C:\audit\.forge`, "x", String.raw`C:\audit\.forge`],
    ["qualified Windows forward-slash drive", "x:C:/audit/.forge", "x", "C:/audit/.forge"],
    ["multi-letter remote home", "executor:/srv/audit/.forge", "executor", "/srv/audit/.forge"],
    ["arbitrary local home ID", "control:/srv/audit/.forge", "control", "/srv/audit/.forge"],
    ["unqualified Windows backslash drive", String.raw`C:\audit\.forge`, "control", String.raw`C:\audit\.forge`],
    ["unqualified Windows forward-slash drive", "C:/audit/.forge", "control", "C:/audit/.forge"],
    ["unqualified lowercase Windows drive", "c:/audit/.forge", "control", "c:/audit/.forge"],
    ["case-sensitive registered IDs", String.raw`X:\audit\.forge`, "control", String.raw`X:\audit\.forge`],
    ["unqualified native POSIX home", "/srv/audit/.forge", "control", "/srv/audit/.forge"],
    ["colon inside a native absolute path", "/srv/audit:archive/.forge", "control", "/srv/audit:archive/.forge"],
    ["colon inside a qualified path", "x:/srv/audit:archive/.forge", "x", "/srv/audit:archive/.forge"],
    ["native UNC home", String.raw`\\server\share\.forge`, "control", String.raw`\\server\share\.forge`],
    ["qualified UNC home", String.raw`x:\\server\share\.forge`, "x", String.raw`\\server\share\.forge`],
    ["native Windows device path", String.raw`\\?\C:\audit\.forge`, "control", String.raw`\\?\C:\audit\.forge`],
  ])("validates and resolves %s without rewriting its path", async (_label, address, laneId, homePath) => {
    const config = configuration();
    config.lanes.push({ id: "x", kind: "remote", enabled: true });
    config.projects[0].repo.forgeHome = address;
    expect(await validateConfig(config, { mode: "runtime" })).toMatchObject({ ok: true, errors: [], warnings: [] });
    expect(resolveForgeHome({ project: config.projects[0], config })).toEqual({ laneId, path: homePath });
  });

  it("documents precedence and lets an explicit lane disambiguate a registered Windows drive letter", async () => {
    const config = configuration({ laneId: "C", kind: "remote" });
    config.projects[0].repo.forgeHome = "C:/audit/.forge";
    expect((await validateConfig(config, { mode: "runtime" })).ok).toBe(true);
    expect(resolveForgeHome({ project: config.projects[0], config })).toEqual({ laneId: "C", path: "/audit/.forge" });
    config.projects[0].repo.forgeHome = "control:C:/audit/.forge";
    expect(resolveForgeHome({ project: config.projects[0], config })).toEqual({ laneId: "control", path: "C:/audit/.forge" });
    const schema = await loadSchema();
    expect(schema.$defs.project.properties.repo.properties.forgeHome.description).toMatch(/registered.*precedence/i);
  });

  it.each(["missing:/srv/audit/.forge", String.raw`missing:C:\audit\.forge`, ":/srv/audit/.forge", "x:"])(
    "keeps unknown or empty qualified homes rejected: %s", (forgeHome) => {
      const config = configuration({ laneId: "x" });
      config.projects[0].repo.forgeHome = forgeHome;
      expect(() => resolveForgeHome({ project: config.projects[0], config }))
        .toThrowError(expect.objectContaining({ code: "L2_PATH_REJECTED" }));
    },
  );

  it("preserves configured paths byte-for-byte instead of resolving traversal or symlinks at the parsing boundary", async () => {
    const config = configuration({ laneId: "x" });
    const homePath = "/srv/audit/../canonical/.forge";
    config.projects[0].repo.forgeHome = `x:${homePath}`;
    expect((await validateConfig(config, { mode: "runtime" })).ok).toBe(true);
    expect(resolveForgeHome({ project: config.projects[0], config })).toEqual({ laneId: "x", path: homePath });
  });

  it("uses a qualified single-letter local home through the actual canonical application boundary", async () => {
    const directory = await fixtureDirectory();
    const config = configuration({ laneId: "x", kind: "local", repoPath: directory });
    const forgeHome = path.join(directory, ".forge");
    config.projects[0].repo.forgeHome = `x:${forgeHome}`;
    expect((await validateConfig(config, { mode: "runtime" })).ok).toBe(true);
    const receiver = createL2Receiver({ config, currentLaneId: "x" });
    const delta = { files: [], jsonl: { "openbrain-queue.jsonl": ['{"id":"qualified-home-note"}\n'] }, maps: {} };
    const identity = deltaApplicationIdentity({ jobId: "a1000002", projectId: "project-1", delta });
    const ack = await receiver.read({
      projectId: "project-1", tool: L2_APPLY_READ, args: { ...identity, forgeHome, delta },
    });
    expect(ack).toEqual({ ...identity, ok: true });
    expect(await readFile(path.join(forgeHome, "openbrain-queue.jsonl"), "utf8"))
      .toBe('{"id":"qualified-home-note"}\n');
  });

  it("does not relax the actual symlink home rejection when the lane ID is a single letter", async () => {
    const directory = await fixtureDirectory();
    const target = path.join(directory, "canonical");
    const forgeHome = path.join(directory, "linked-home");
    await mkdir(target);
    await symlink(target, forgeHome, "junction");
    const config = configuration({ laneId: "x", kind: "local", repoPath: directory });
    config.projects[0].repo.forgeHome = `x:${forgeHome}`;
    expect((await validateConfig(config, { mode: "runtime" })).ok).toBe(true);
    const receiver = createL2Receiver({ config, currentLaneId: "x" });
    const delta = { files: [], jsonl: { "openbrain-queue.jsonl": ['{"id":"must-not-write"}\n'] }, maps: {} };
    const identity = deltaApplicationIdentity({ jobId: "a1000003", projectId: "project-1", delta });
    expect(await receiver.read({
      projectId: "project-1", tool: L2_APPLY_READ, args: { ...identity, forgeHome, delta },
    })).toEqual({ ...identity, ok: false, code: "L2_PATH_REJECTED" });
    await expect(readFile(path.join(target, "openbrain-queue.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("FR-10 configuration and signed lane identity contract", () => {
  it.each([
    ["space", "build lane"], ["slash", "build/lane"], ["backslash", String.raw`build\lane`],
    ["colon", "build:lane"], ["non-ASCII", "équipe"], ["leading dot", ".build"],
    ["leading underscore", "_build"], ["leading hyphen", "-build"],
    ["82 characters", "b".repeat(82)], ["line break", "build\n"], ["NUL", "build\0lane"], ["empty", ""],
  ])("preflights unsupported lane IDs before lease and signature failures: %s", async (_label, laneId) => {
    const fixture = await approvedFixture({ laneId });
    const original = structuredClone(fixture.job);
    expect(() => transition(fixture.job, "leased", { lane: laneId }))
      .toThrowError(expect.objectContaining({ code: "JOB_BAD_META" }));
    expect(fixture.job).toEqual(original);
    const signature = signedPayload(await fixture.prepare(fixture.job), laneId);
    expect(() => verifyGrant(signature)).toThrowError(expect.objectContaining({
      code: "LEASE_GRANT_INVALID", details: { reason: "SHAPE" },
    }));
    const validated = await validateConfig(fixture.config, { mode: "runtime" });
    expect(validated.ok).toBe(false);
    for (const issuePath of ["$.lanes[1].id", "$.projects[0].placement.prefer[0]", "$.worker.laneId"]) {
      const issue = validated.errors.find((error) => error.path === issuePath && error.code === "SCHEMA_PATTERN");
      expect(issue, issuePath).toBeDefined();
      expect(issue.hint).toContain(WIRE_IDENTIFIER_PATTERN);
      expect(issue.hint).toContain("1-81 ASCII");
      expect(issue.hint).toMatch(/rename.*references/i);
    }
    await writeFile(path.join(fixture.directory, "config.json"), JSON.stringify(fixture.config));
    expect(await loadConfig({ home: fixture.directory })).toMatchObject({ ok: false });
    expect(currentJobs(fixture.store)[fixture.job.id]).toEqual(original);
  });

  it.each([
    ["single letter", "x", "remote"], ["numeric", "0", "remote"],
    ["mixed punctuation", "Build_42.v1", "remote"], ["maximum length", "b".repeat(81), "remote"],
    ["local kind with remote name", "remote", "local"], ["remote kind with local name", "local", "remote"],
    ["maximum-length Kubernetes ID", "k".repeat(81), "k8s"],
  ])("preserves arbitrary supported IDs, placement, consumed approval and signed choices: %s", async (_label, laneId, kind) => {
    const fixture = await approvedFixture({ laneId, kind });
    fixture.config.lanes[1].labels.push("free-form label", "équipe");
    expect(await validateConfig(fixture.config, { mode: "runtime" })).toMatchObject({ ok: true, errors: [], warnings: [] });
    const project = fixture.config.projects[0];
    expect(placeJob({
      project, projects: fixture.config.projects, lanes: fixture.config.lanes,
      health: new Map([[laneId, { ok: true, pending: 0, queued: 0 }]]),
    })).toMatchObject({ ok: true, laneId });
    const leased = transition(fixture.job, "leased", { lane: laneId });
    fixture.store.append(JOBS_STREAM, leased.event);
    expect(leased.job.lane).toBe(laneId);
    expect(currentJobs(fixture.store)[fixture.job.id].lane).toBe(laneId);
    const payload = await fixture.prepare(leased.job);
    expect(payload).toMatchObject({
      quorum: "power", resumeFrom: 3, runtime: "openai",
      provider: { type: "openai", keySecret: "LANE_CONTRACT_PROVIDER_KEY", endpoint: "https://provider.example" },
      project: {
        models: { work: "configured-work-model" },
        bootstrap: { ...fixture.config.bootstrap, install: kind === "k8s" ? "ci" : "none" },
      },
      leaseGrant: { laneId, approval: proofFor({ config: fixture.config, store: fixture.store }, leased.job) },
    });
    expect(payload.project.repo).not.toHaveProperty("path");
    expect(Object.isFrozen(payload)).toBe(true);
    const signature = signedPayload(payload, laneId);
    expect(verifyGrant(signature)).toBe(true);
    expect(message("hello", { mode: "job", laneId, jobId: fixture.job.id }).laneId).toBe(laneId);
    const workerConfig = executionConfigFor({
      job: { ...signature.job, leaseGrant: signature.grant }, config: fixture.config,
    });
    expect(workerConfig.projects[0].repo.path).toBe(project.repo.path);
    expect(workerConfig.projects[0].homeLane).toBe("control");
    expect(signature.job.quorum).toBe("power");
    expect(signature.job.resumeFrom).toBe(3);
  });

  it("preflights unsupported project identifiers used by jobs, grants and canonical ACKs", async () => {
    const config = configuration();
    config.projects[0].id = "project name";
    const validated = await validateConfig(config, { mode: "runtime" });
    expect(validated.ok).toBe(false);
    expect(validated.errors).toContainEqual(expect.objectContaining({
      path: "$.projects[0].id", code: "SCHEMA_PATTERN",
    }));
    expect(() => createJob({ id: "a1000004", type: "plan", projectId: "project name" }))
      .toThrowError(expect.objectContaining({ code: "JOB_BAD_FIELD", details: { field: "projectId" } }));
    expect(() => deltaApplicationIdentity({
      jobId: "a1000004", projectId: "project name", delta: { files: [], jsonl: {}, maps: {} },
    })).toThrowError(expect.objectContaining({ code: "L2_SCOPE_REJECTED" }));
  });

  it.each(["p", "p".repeat(81)])("preserves supported project ID boundaries through actual signed grants and ACK identity: %s", async (projectId) => {
    const fixture = await approvedFixture({ laneId: "x", projectId });
    expect((await validateConfig(fixture.config, { mode: "runtime" })).ok).toBe(true);
    const signature = signedPayload(await fixture.prepare(fixture.job), "x");
    expect(verifyGrant(signature)).toBe(true);
    expect(signature.grant.projectId).toBe(projectId);
    expect(deltaApplicationIdentity({
      jobId: fixture.job.id, projectId, delta: { files: [], jsonl: {}, maps: {} },
    })).toMatchObject({ jobId: fixture.job.id, projectId });
  });

  it("keeps lane and project reference schemas on the existing wire identifier grammar", async () => {
    const schema = await loadSchema();
    expect(schema.$defs.identifier.pattern).toBe(WIRE_IDENTIFIER_PATTERN);
    for (const field of [
      schema.$defs.lane.properties.id, schema.$defs.project.properties.id,
      schema.$defs.project.properties.homeLane, schema.$defs.project.properties.placement.properties.prefer.items,
      schema.$defs.schedule.properties.project, schema.properties.worker.properties.laneId,
    ]) expect(field.$ref).toBe("#/$defs/identifier");
  });

  it.each(["lane", "projectId", "state", "mutating", "runtime", "provider", "quorum", "resumeFrom"])(
    "does not let lane changes authorize protected result metadata: %s", async (field) => {
      const fixture = await approvedFixture({ laneId: "x" });
      const leased = transition(fixture.job, "leased", { lane: "x" }).job;
      const running = transition(leased, "running").job;
      const original = structuredClone(running);
      expect(() => transition(running, "succeeded", { result: { [field]: "must-not-authorize" } }))
        .toThrowError(expect.objectContaining({ code: "JOB_BAD_META" }));
      expect(running).toEqual(original);
    },
  );

  it("retains lane binding and approved execution-choice digest verification", async () => {
    const fixture = await approvedFixture({ laneId: "x" });
    const signature = signedPayload(await fixture.prepare(fixture.job), "x");
    expect(() => verifyGrant({ ...signature, laneId: "control" }))
      .toThrowError(expect.objectContaining({ code: "LEASE_GRANT_INVALID", details: { reason: "LANE" } }));
    for (const [field, value] of [
      ["quorum", "speed"], ["resumeFrom", 4], ["runtime", "anthropic"],
      ["provider", { ...signature.job.provider, keySecret: "OTHER_PROVIDER_KEY" }],
      ["project", { ...signature.job.project, models: { work: "other-configured-model" } }],
    ]) {
      expect(() => verifyGrant({ ...signature, job: { ...signature.job, [field]: value } }))
        .toThrowError(expect.objectContaining({ code: "LEASE_GRANT_INVALID", details: { reason: "DIGEST" } }));
    }
  });
});
