/**
 * Plan Forge — worker session continuity across slice retries.
 *
 * Each slice pins its worker to one session ID. When an attempt fails (gate
 * red, timeout, launch failure), the retry resumes that session, so the worker
 * keeps what it already read and changed instead of rebuilding context from a
 * cold start. The Copilot CLI takes the ID through `--session-id` (create on
 * first use, resume after); the SDK route uses createSession/resumeSession.
 *
 * Config: `.forge.json` → `resumeOnRetry` (boolean, default true).
 * Override: `PFORGE_RESUME_ON_RETRY=0|1`.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_OVERRIDE = "PFORGE_RESUME_ON_RETRY";
const DEFAULT_RESUME_ON_RETRY = true;

/**
 * @param {string} cwd
 * @returns {boolean}
 */
export function loadResumeOnRetry(cwd) {
  const env = process.env[ENV_OVERRIDE];
  if (env === "0" || env === "false") return false;
  if (env === "1" || env === "true") return true;
  try {
    const path = resolve(cwd, ".forge.json");
    if (!existsSync(path)) return DEFAULT_RESUME_ON_RETRY;
    const value = JSON.parse(readFileSync(path, "utf8")).resumeOnRetry;
    return typeof value === "boolean" ? value : DEFAULT_RESUME_ON_RETRY;
  } catch {
    return DEFAULT_RESUME_ON_RETRY;
  }
}

/**
 * Track one slice's worker session across its attempts.
 *
 * `forAttempt(n)` returns the `{ id, resume }` to hand spawnWorker (null when
 * disabled). `record(workerResult)` reads back the session the worker actually
 * used: a worker that did not pin one (older CLI, non-Copilot worker) gets a
 * fresh ID next time rather than a resume of a session that never existed.
 *
 * @param {{ enabled: boolean }} opts
 */
export function createWorkerSession({ enabled }) {
  let id = randomUUID();
  let established = false;
  return {
    forAttempt(attempt) {
      if (!enabled) return null;
      return { id, resume: attempt > 0 && established };
    },
    record(workerResult) {
      if (!enabled) return;
      if (workerResult?.sessionId) {
        id = workerResult.sessionId;
        established = true;
      } else {
        id = randomUUID();
        established = false;
      }
    },
  };
}
