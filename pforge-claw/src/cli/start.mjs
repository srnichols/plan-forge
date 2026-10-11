import { parseArgs } from "node:util";
import { ClawError } from "../errors.mjs";

const USAGE = "Usage: pforge claw start [--home <dir>]";

export async function bootDispatcher(opts = {}) {
  const runtime = await import("../dispatcher-startup.mjs");
  return runtime.bootDispatcher(opts);
}

function startupError(error) {
  if (error instanceof ClawError) return error;
  return new ClawError("STARTUP_FAILED");
}

async function run(argv = []) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: { home: { type: "string" } },
    });
  } catch {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  let handles;
  try {
    handles = await bootDispatcher({ home: parsed.values.home });
    await new Promise((resolve) => {
      let stopping = false;
      const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        try {
          await handles.stop();
          process.exitCode = 0;
        } finally {
          resolve();
        }
      };
      const onSignal = () => {
        void shutdown().catch((error) => {
          handles.logger.error("Dispatcher shutdown failed", { code: error?.code ?? "STOP_FAILED" });
          process.exitCode = 1;
          resolve();
        });
      };
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
    });
    return process.exitCode ?? 0;
  } catch (error) {
    const failure = startupError(error);
    process.stderr.write(`${failure.code}${failure.details?.hint ? `: ${failure.details.hint}` : ""}\n`);
    if (error instanceof AggregateError) {
      for (const cleanupError of error.errors.slice(1)) {
        process.stderr.write(`Cleanup failed: ${cleanupError?.code ?? "STOP_FAILED"}\n`);
      }
    }
    return 1;
  }
}

export default {
  name: "start",
  summary: "Start the Forge-Claw dispatcher",
  usage: USAGE,
  run,
};
