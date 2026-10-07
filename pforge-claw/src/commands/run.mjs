import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "run", aliases: [], args: "<plan> [quorum]", summary: "Run a plan",
  details: "Execute a hardened plan for the current project.", examples: ["/run Phase-1-PLAN.md", "/run cleanup speed"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: true,
  available: false, sinceSlice: 9, group: "Work",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 9 }); },
});
