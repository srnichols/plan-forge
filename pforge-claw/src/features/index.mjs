import chat from "./chat.mjs";
import approvals from "./approvals.mjs";
import budget from "./budget.mjs";
import progress from "./progress.mjs";
import scheduler from "./scheduler.mjs";
import alerts from "./alerts.mjs";
import capture from "./capture.mjs";
import crossproject from "./crossproject.mjs";
import workers from "./workers.mjs";
import webhook from "./webhook.mjs";
import memory from "./memory.mjs";

export const FEATURES = Object.freeze([
  chat,
  approvals,
  budget,
  progress,
  scheduler,
  alerts,
  capture,
  crossproject,
  workers,
  webhook,
  memory,
]);
