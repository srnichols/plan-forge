import { ClawError } from "../errors.mjs";
import { assertLane } from "./lane.mjs";
import { READ_ERRORS } from "../protocol/messages.mjs";

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

  async function read(request, { timeoutMs = 30_000, signal } = {}) {
    if (signal?.aborted) throw new ClawError(READ_ERRORS.CANCELLED);
    const { jobId, iterator } = registry.enqueue(id, { kind: "read", request });
    const source = iterator[Symbol.asyncIterator]();
    let timer;
    let onAbort;
    try {
      const completed = await Promise.race([
        (async () => {
          while (true) {
            const next = await source.next();
            if (next.done) throw new ClawError(READ_ERRORS.FAILED);
            if (next.value.type === "finished") {
              if (next.value.data.status !== "ok") {
                throw new ClawError(next.value.data.code ?? READ_ERRORS.FAILED);
              }
              return next.value.data.result;
            }
          }
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new ClawError(READ_ERRORS.TIMEOUT)), timeoutMs);
          timer?.unref?.();
          onAbort = () => reject(new ClawError(READ_ERRORS.CANCELLED));
          signal?.addEventListener("abort", onAbort, { once: true });
          if (signal?.aborted) onAbort();
        }),
      ]);
      if (signal?.aborted) throw new ClawError(READ_ERRORS.CANCELLED);
      return completed;
    } catch (error) {
      if (error instanceof ClawError && [READ_ERRORS.TIMEOUT, READ_ERRORS.CANCELLED].includes(error.code)) registry.cancel(jobId);
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
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
