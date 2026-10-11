import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".execution-e2e-work",
);

export async function createExecutionHome(name) {
  if (!/^[a-z-]+$/.test(name)) throw new TypeError("execution fixture name must be kebab-case");
  await mkdir(FIXTURE_ROOT, { recursive: true });
  return mkdtemp(path.join(FIXTURE_ROOT, `${name}-`));
}

export function createExecutionTimers() {
  const pending = new Map();
  let current = 0;
  return {
    setTimeoutFn(callback, delay) {
      const timer = { unref() {} };
      pending.set(timer, { callback, at: current + delay });
      return timer;
    },
    clearTimeoutFn: (timer) => pending.delete(timer),
    async advance(milliseconds) {
      const target = current + milliseconds;
      for (;;) {
        const due = [...pending].filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!due) break;
        const [handle, timer] = due;
        current = timer.at;
        pending.delete(handle);
        timer.callback();
        await Promise.resolve();
      }
      current = target;
    },
  };
}

function signalFor(signals, jobId) {
  if (!signals.has(jobId)) signals.set(jobId, Promise.withResolvers());
  return signals.get(jobId);
}

export function createExecutionProbe(runtime) {
  const active = new Map();
  const entered = new Map();
  const left = new Map();
  const windows = [];
  const projectPeaks = new Map();
  let peakActive = 0;
  let order = 0;

  return {
    active,
    windows,
    projectPeaks,
    get peakActive() { return peakActive; },
    entered: (jobId) => signalFor(entered, jobId).promise,
    left: (jobId) => signalFor(left, jobId).promise,
    runtime: {
      ...runtime,
      async run(turn) {
        const jobId = path.basename(turn.cwd);
        const projectId = path.basename(path.dirname(turn.cwd));
        const window = { jobId, projectId, cwd: turn.cwd, enteredOrder: ++order, leftOrder: null };
        active.set(jobId, window);
        windows.push(window);
        peakActive = Math.max(peakActive, active.size);
        const projectActive = [...active.values()].filter((entry) => entry.projectId === projectId).length;
        projectPeaks.set(projectId, Math.max(projectPeaks.get(projectId) ?? 0, projectActive));
        signalFor(entered, jobId).resolve(window);
        try {
          return await runtime.run(turn);
        } finally {
          window.leftOrder = ++order;
          active.delete(jobId);
          signalFor(left, jobId).resolve(window);
        }
      },
    },
  };
}

export async function readPublishedFixture({ project, jobId, relativePath }) {
  if (!project?.originPath || !jobId || path.isAbsolute(relativePath)
    || relativePath.split(/[\\/]/).includes("..")) {
    throw new TypeError("an isolated fixture origin and repository-relative path are required");
  }
  const repositoryPath = relativePath.split(path.sep).join(path.posix.sep);
  return new Promise((resolve, reject) => {
    const child = spawn("git", [
      "--git-dir", project.originPath, "show", `claw/${jobId}:${repositoryPath}`,
    ], { shell: false, windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.resume();
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) reject(new Error("FIXTURE_PUBLISHED_ARTIFACT_MISSING"));
      else resolve(stdout);
    });
  });
}
