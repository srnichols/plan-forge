import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createE2EWorkerServer } from "../helpers/e2e-worker.mjs";

let temporary;
let server;

afterEach(async () => {
  await server?.stop();
  server = undefined;
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

describe("scenario requeue worker transport recovery", () => {
  it("re-authenticates a disconnected enrolled worker without replacing its identity", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "claw-requeue-e2e-"));
    server = await createE2EWorkerServer({
      home: path.join(temporary, "dispatcher"),
      lanes: ["worker-a"],
      leaseMs: 1000,
    });
    const worker = await server.startWorker({
      id: "worker-a",
      laneId: "worker-a",
      workerHome: path.join(temporary, "worker-a"),
      capabilities: {
        os: "linux",
        arch: "x64",
        macos: false,
        toolchains: ["node"],
        projects: ["fixture-1"],
      },
      config: { lanes: [{ id: "worker-a", kind: "local", maxHeavy: 1 }] },
      runtimeFactory: ({ id }) => ({ id, async run() { return { status: "succeeded" }; } }),
    });
    const enrolledId = worker.workerId;

    await worker.killWorker();
    expect(server.registry.current(enrolledId)).toBeFalsy();
    await worker.reconnectWorker();

    expect(server.registry.current(enrolledId)).toBeTruthy();
    expect(worker.workerId).toBe(enrolledId);
    expect(worker.sockets.length).toBeGreaterThan(1);
  });
});
