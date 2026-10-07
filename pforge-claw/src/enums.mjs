export const JOB_TYPES = Object.freeze(["ask", "capture", "skill", "plan", "task", "fanout"]);

export const JOB_STATES = Object.freeze([
  "queued",
  "awaiting-approval",
  "approved",
  "rejected",
  "expired",
  "held-budget",
  "leased",
  "running",
  "needs-input",
  "succeeded",
  "failed",
  "cancelled",
]);

export const LANE_KINDS = Object.freeze(["local", "remote", "k8s"]);
export const VISIBILITY = Object.freeze(["normal", "restricted"]);
export const ROLES = Object.freeze(["owner", "approver", "viewer"]);
export const LANE_EVENT_TYPES = Object.freeze([
  "started",
  "progress",
  "log",
  "slice",
  "cost",
  "artifact",
  "needs-input",
  "finished",
]);
export const SUBCOMMANDS = Object.freeze([
  "init",
  "doctor",
  "status",
  "start",
  "worker",
  "service",
  "dev",
  "commands",
]);
