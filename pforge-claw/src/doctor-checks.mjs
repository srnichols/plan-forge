/**
 * Feature doctor seam: each feature may expose `doctorChecks(ctx)` returning
 * `Array<{ name, status: "ok"|"warn"|"error"|"skip", detail, code? }>`.
 *
 * `ctx.live` is false for the offline `pforge claw doctor` (config only, no project
 * clients) and true inside a running dispatcher (features started, `ctx.mcp` live).
 * Features must return `skip` items for checks they cannot run offline.
 */

export const FEATURE_DOCTOR_TIMEOUT_MS = 5000;
const STATUS_MAP = Object.freeze({ ok: "ok", warn: "warn", error: "fail", fail: "fail", skip: "skip" });
const TIMED_OUT = Symbol("timed-out");

function normalizeItem(feature, item) {
  const status = STATUS_MAP[item?.status] ?? "warn";
  const name = typeof item?.name === "string" && item.name ? item.name : feature.name;
  return {
    id: `feature.${name}`,
    status,
    code: typeof item?.code === "string" && item.code ? item.code : `FEATURE_CHECK_${status.toUpperCase()}`,
    message: String(item?.detail ?? item?.message ?? `${feature.name} reported ${status}.`),
  };
}

function failureItem(feature, code) {
  return {
    id: `feature.${feature.name}`,
    status: "warn",
    code,
    message: code === "FEATURE_DOCTOR_TIMEOUT"
      ? `${feature.name} doctor checks did not finish in time.`
      : `${feature.name} doctor checks failed to run.`,
  };
}

async function withTimeout(promise, timeoutMs, setTimer, clearTimer) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimer(() => resolve(TIMED_OUT), timeoutMs); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimer(timer);
  }
}

/**
 * Run every available feature's `doctorChecks(ctx)` and normalize the results to
 * doctor report checks (`{ id, status: ok|warn|fail|skip, code, message }`). Never throws.
 */
export async function runFeatureDoctorChecks({
  features = [],
  ctx = {},
  timeoutMs = FEATURE_DOCTOR_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const checks = [];
  for (const feature of features) {
    if (!feature?.available || typeof feature.doctorChecks !== "function") continue;
    try {
      const items = await withTimeout(Promise.resolve(feature.doctorChecks(ctx)), timeoutMs, setTimer, clearTimer);
      if (items === TIMED_OUT) {
        checks.push(failureItem(feature, "FEATURE_DOCTOR_TIMEOUT"));
        continue;
      }
      for (const item of Array.isArray(items) ? items : []) checks.push(normalizeItem(feature, item));
    } catch {
      checks.push(failureItem(feature, "FEATURE_DOCTOR_FAILED"));
    }
  }
  return checks;
}
