import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createLeasePreparer } from "../src/jobs/lease-payload.mjs";
import { createJob } from "../src/jobs/model.mjs";
import { createStore } from "../src/state/store.mjs";
import { signGrant, verifyGrant } from "../src/protocol/lease-grant.mjs";
import { g1Directory } from "./g1-runner-fixture.mjs";

const roots = [];
const FIXTURE_SECRET_VALUE = "lease-mcp-bootstrap-private-fixture-value";

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await g1Directory("lease-mcp-bootstrap-");
  roots.push(root);
  await mkdir(path.join(root, ".vscode"));
  await writeFile(path.join(root, ".vscode", "mcp.json"), JSON.stringify({
    servers: {
      "plan-forge": {
        command: "node",
        args: ["${workspaceFolder}/pforge-mcp/server.mjs", "--port", "3100"],
        env: { API_TOKEN: FIXTURE_SECRET_VALUE },
      },
    },
  }));
  const config = {
    allowlist: [{ channel: "telegram", userId: "owner", role: "owner" }],
    lanes: [{ id: "canonical-home", kind: "local" }, { id: "remote-runner", kind: "remote" }],
    projects: [{
      id: "project-one", homeLane: "canonical-home",
      repo: { path: root, remote: "https://example.org/project.git", baseBranch: "main" },
    }],
  };
  const store = createStore(path.join(root, "state"));
  const created = createJob({ id: "a1234567", projectId: "project-one", type: "skill", readOnly: true });
  const job = { ...created.job, skill: "fixture-check", adapter: "telegram", callerId: "owner" };
  store.append("jobs", { ...created.event, job });
  const prepare = createLeasePreparer({ ctx: { store, config }, laneConfig: config.lanes[1] });
  return { job, prepare };
}

describe("Guard: approved leases carry safe canonical MCP bootstrap metadata", () => {
  it("projects the selected home server into the signed payload without serializing credential values", async () => {
    const { job, prepare } = await fixture();
    const payload = await prepare(job);
    expect(payload.mcpBootstrap).toMatchObject({
      v: 1, serverName: "plan-forge", command: "node",
      args: ["${workspaceFolder}/pforge-mcp/server.mjs", "--port", "3100"],
      env: { API_TOKEN: "${env:API_TOKEN}" },
    });
    expect(JSON.stringify(payload)).not.toContain(FIXTURE_SECRET_VALUE);
    expect(Object.isFrozen(payload.mcpBootstrap)).toBe(true);
    expect(Object.isFrozen(payload.mcpBootstrap.args)).toBe(true);
  });

  it("covers MCP execution choices with the actual lease signature", async () => {
    const { job, prepare } = await fixture();
    const payload = await prepare(job);
    expect(payload.mcpBootstrap).toBeDefined();
    const key = randomBytes(32).toString("hex");
    const grant = signGrant({ grant: payload.leaseGrant, subject: "worker-one", key });
    const signed = { ...payload, leaseGrant: grant };
    expect(() => verifyGrant({ grant, job: signed, subject: "worker-one", laneId: "remote-runner", key })).not.toThrow();
    const changed = {
      ...signed,
      mcpBootstrap: { ...signed.mcpBootstrap, args: [...signed.mcpBootstrap.args, "--different-choice"] },
    };
    expect(() => verifyGrant({ grant, job: changed, subject: "worker-one", laneId: "remote-runner", key }))
      .toThrowError("LEASE_GRANT_INVALID");
  });

  it("forwards the verified job descriptor to the actual workspace MCP consumer", async () => {
    const source = await readFile(fileURLToPath(new URL("../src/jobs/runners.mjs", import.meta.url)), "utf8");
    expect(source).toMatch(/openRunnerMcp\(\{[\s\S]*?mcpBootstrap:\s*prepared\.job\.mcpBootstrap[\s\S]*?\}\)/);
  });
});
