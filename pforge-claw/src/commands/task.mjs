import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "task", aliases: [], args: "<description>", summary: "Start an ad-hoc task",
  details: "Create a task in an isolated worktree.", examples: ["/task fix the parser", "/task add a dashboard filter"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: true,
  available: false, sinceSlice: 9, group: "Work",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 9 }); },
});
