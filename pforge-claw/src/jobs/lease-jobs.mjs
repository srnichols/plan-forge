import path from "node:path";
import { ClawError } from "../errors.mjs";
import { transition } from "./model.mjs";
import { addWorktree, removeWorktree, run } from "./worktree.mjs";
import { applyCopySet, bootstrapWorktree, collectCopySet } from "./bootstrap.mjs";
import { computeDelta, snapshotForge } from "../memory/l2-sync.mjs";

export function createLeaseJobSource(job) {
  let current = {
    ...job, state: "leased",
    readOnly: job.type === "skill" && job.mutating === false,
    description: job.prompt ?? job.description,
    planPath: job.plan ?? job.planPath,
  };
  return {
    get: (id) => id === current.id ? current : null,
    append(expected, state, meta = {}) {
      if (expected.id !== current.id) throw new ClawError("JOB_UNKNOWN");
      if (expected.state !== current.state) throw new ClawError("JOB_REPLAY_MISMATCH");
      const updated = transition(current, state, meta);
      current = updated.job;
      return updated;
    },
  };
}

export function deferredWorktreeWorkspace({
  repoPath, jobId, bootstrapFiles, home, project, config = {}, secrets, runner = run,
}) {
  let handle;
  let snapshot;
  let success = false;
  return {
    async prepare(job, { signal } = {}) {
      if (job.id !== jobId) throw new ClawError("JOB_UNKNOWN");
      const workspaceRunner = (command, args, options = {}) => {
        signal?.throwIfAborted();
        return runner(command, args, { ...options, signal });
      };
      handle = { ...(await addWorktree({
        home, project: { ...project, repo: { ...project.repo, path: repoPath } }, job, runner: workspaceRunner,
      })), repoPath };
      try {
        const files = bootstrapFiles ?? await collectCopySet({ repoPath, paths: project.bootstrap?.copy });
        await applyCopySet({ repoPath: handle.path, files });
        const boot = await bootstrapWorktree({
          job, worktree: handle.path, homeRepo: repoPath, forgeHome: home,
          config: { ...config, bootstrap: { ...config.bootstrap, ...project.bootstrap, copy: [] } }, secrets, runner: workspaceRunner,
        });
        if (!boot.ok) throw new ClawError(boot.code, { reason: "bootstrap" });
        snapshot = await snapshotForge({ forgeDir: path.join(handle.path, ".forge") });
        return { handle, env: boot.env };
      } catch (error) {
        error.worktreeHandle = handle;
        throw error;
      }
    },
    forgeDirFor: () => handle ? path.join(handle.path, ".forge") : null,
    delta: () => handle && snapshot ? computeDelta({ forgeDir: path.join(handle.path, ".forge"), snapshot }) : null,
    release(_handle, outcome) { success = outcome?.success === true; },
    async settle({ ok }) {
      if (!ok || !success || !handle) return;
      const removed = await removeWorktree({ repoPath, path: handle.path, runner });
      if (!removed.ok) throw new ClawError(removed.code);
    },
  };
}

export function clonedWorkspace({ repoDir, env, jobId }) {
  return {
    prepare: async () => ({ handle: { path: repoDir, branch: `claw/${jobId}` }, env }),
    release() {},
  };
}
