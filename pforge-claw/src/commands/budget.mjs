import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "budget", aliases: [], args: "", summary: "Show budget usage",
  details: "Show configured and current budget usage.", examples: ["/budget", "/budget today"],
  roles: [ROLES[0], ROLES[1]], scope: "both", mutating: false,
  available: false, sinceSlice: 11, group: "Status & budget",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 11 }); },
});
