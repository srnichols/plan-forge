import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "skill", aliases: [], args: "<skill> [args]", summary: "Run a Plan Forge skill",
  details: "Run a configured Plan Forge skill.", examples: ["/skill code-review", "/skill test-sweep"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: true,
  available: false, sinceSlice: 9, group: "Work",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 9 }); },
});
