import { ClawError } from "../errors.mjs";

const CLEANUP_TIMEOUT_MS = 5_000;

async function boundedCleanup(operation) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ClawError("SDK_CLEANUP_TIMEOUT")), CLEANUP_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function stopSdkClient({ client, onCleanupFailure }) {
  if (!client) return true;
  let stopped;
  try {
    const errors = await boundedCleanup(() => client.stop());
    stopped = !Array.isArray(errors) || errors.length === 0;
  } catch {
    stopped = false;
  }
  if (stopped) return true;
  onCleanupFailure("SDK_STOP_FAILED");
  try {
    if (typeof client.forceStop !== "function") throw new ClawError("SDK_FORCE_STOP_FAILED");
    await boundedCleanup(() => client.forceStop());
    return true;
  } catch {
    onCleanupFailure("SDK_FORCE_STOP_FAILED");
    return false;
  }
}

export async function disconnectSdkSession({ session, onCleanupFailure }) {
  if (typeof session?.disconnect !== "function") return;
  try {
    await boundedCleanup(() => session.disconnect());
  } catch {
    onCleanupFailure("SDK_DISCONNECT_FAILED");
  }
}
