import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "lane", aliases: [], args: "<lane> <on|off>", summary: "Change lane availability",
  details: "Enable or disable a configured lane.", examples: ["/lane worker on", "/lane worker off"],
  roles: [ROLES[0]], scope: "general", mutating: true,
  available: false, sinceSlice: 23, group: "Admin",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 23 }); },
});
