import { ClawError } from "../errors.mjs";
import { assertLane } from "./lane.mjs";

export function createRemoteLane({ id, registry, capabilities = {} } = {}) {
  if (typeof id !== "string" || !id || !registry) throw new ClawError("LANE_BAD_CONFIG");

  async function* submit(job) {
    const { iterator } = registry.enqueue(id, { kind: "job", job });
    const source = iterator[Symbol.asyncIterator]();
    try {
      while (true) {
        const next = await source.next();
        if (next.done) return;
        yield next.value;
        if (next.value.type === "finished") return;
      }
    } finally {
      await source.return?.();
    }
  }

  async function read(request, { timeoutMs = 30_000 } = {}) {
    const { jobId, iterator } = registry.enqueue(id, { kind: "read", request });
    const source = iterator[Symbol.asyncIterator]();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          while (true) {
            const next = await source.next();
            if (next.done) throw new ClawError("READ_FAILED");
            if (next.value.type === "finished") {
              if (next.value.data.status !== "ok") {
                throw new ClawError(next.value.data.code ?? "READ_FAILED");
              }
              return next.value.data.result;
            }
          }
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new ClawError("READ_TIMEOUT")), timeoutMs);
          timer?.unref?.();
        }),
      ]);
    } catch (error) {
      if (error instanceof ClawError && error.code === "READ_TIMEOUT") registry.cancel(jobId);
      throw error;
    } finally {
      clearTimeout(timer);
      await source.return?.();
    }
  }

  function cancel(jobId) {
    return Promise.resolve(registry.cancel(jobId));
  }

  function health() {
    const lane = registry.snapshot().byLane[id] ?? { connected: 0, pending: 0, active: 0 };
    const { connected, pending, active } = lane;
    return {
      ok: connected > 0, kind: "remote", id, workers: connected, pending, active,
      ...(connected ? {} : { code: "NO_WORKER" }),
    };
  }

  return assertLane({ kind: "remote", id, capabilities, submit, read, cancel, health });
}
