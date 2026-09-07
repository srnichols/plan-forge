import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

const WORKER_TYPE = "parallel-gate-check";
const MAX_FAILURE_OUTPUT = 1200;

class WorktreeGateError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorktreeGateError";
  }
}

async function evaluateGates({ slices, cwd }) {
  const { coalesceGateLines, runGate } = await import("./gate-runner.mjs");
  let checked = 0;
  for (const slice of slices) {
    for (const command of coalesceGateLines(slice.validationGate)) {
      const outcome = runGate(command, cwd);
      checked++;
      if (!outcome.success) {
        return {
          success: false, checked, sliceId: slice.number, failedCommand: command,
          output: String(outcome.error || outcome.output || "Gate exited unsuccessfully").slice(-MAX_FAILURE_OUTPUT),
        };
      }
    }
  }
  return { success: true, checked };
}

if (!isMainThread && workerData?.type === WORKER_TYPE) {
  try {
    parentPort.postMessage(await evaluateGates(workerData));
  } catch (error) {
    parentPort.postMessage({ success: false, output: error.message });
  } finally {
    parentPort.close();
  }
}

/**
 * Reuse the synchronous gate runner off the orchestrator's event loop.
 * @param {{ slices: object[], cwd: string, abortSignal?: AbortSignal }} options
 * @returns {Promise<{ success: boolean, checked?: number, skipped?: boolean, sliceId?: string, failedCommand?: string, output?: string }>}
 */
export async function checkWorktreeGates({ slices, cwd, abortSignal }) {
  abortSignal?.throwIfAborted();
  const gates = slices.filter((slice) => slice.validationGate)
    .map(({ number, validationGate }) => ({ number, validationGate }));
  if (gates.length === 0) return { success: true, checked: 0, skipped: true };
  return new Promise((fulfill, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { type: WORKER_TYPE, slices: gates, cwd },
    });
    let report;
    const onAbort = () => { worker.terminate().catch(reject); };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (message) => { report = message; });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      abortSignal?.removeEventListener("abort", onAbort);
      if (abortSignal?.aborted) {
        reject(new WorktreeGateError("Run aborted during integrated validation; worktrees retained."));
      } else if (code !== 0 || !report) {
        reject(new WorktreeGateError(`Integrated gate worker exited ${code} without a successful completion.`));
      } else {
        fulfill(report);
      }
    });
    if (abortSignal?.aborted) onAbort();
  });
}
