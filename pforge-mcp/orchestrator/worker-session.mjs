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
const MAX_SESSION_NAME = 80;
/** Characters cmd.exe would interpret (`cmd /c` launches) and quotes; dropped from session names. */
const UNSAFE_NAME_CHARS = /[^A-Za-z0-9 ._:#-]/g;

/**
 * The name the worker's session shows in VS Code's Sessions view and
 * `copilot --resume`: "pforge <plan> - slice <n>: <title>". Restricted to
 * characters that are inert on a Windows command line, since slice titles
 * come from plan text.
 *
 * @param {{ planName: string, slice: { number: string|number, title?: string } }} opts
 */
export function workerSessionName({ planName, slice }) {
  const raw = `pforge ${planName} - slice ${slice.number}: ${slice.title || ""}`;
  return raw.replace(UNSAFE_NAME_CHARS, "").replace(/\s+/g, " ").trim().slice(0, MAX_SESSION_NAME).trim();
}

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
 * @param {{ enabled: boolean, name?: string|null }} opts
 */
export function createWorkerSession({ enabled, name = null }) {
  let id = randomUUID();
  let established = false;
  return {
    forAttempt(attempt) {
      if (!enabled) return null;
      return { id, resume: attempt > 0 && established, ...(name && { name }) };
    },
    record(workerResult) {
      if (!enabled) return;
      if (!workerResult?.sessionId) {
        this.reset();
        return;
      }
      id = workerResult.sessionId;
      established = true;
    },
    /** Start the next attempt in a fresh session (e.g. after a blocked response). */
    reset() {
      id = randomUUID();
      established = false;
    },
  };
}
