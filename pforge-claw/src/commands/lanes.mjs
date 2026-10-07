import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "lanes", aliases: [], args: "", summary: "List configured lanes",
  details: "Show configured execution lanes.", examples: ["/lanes", "/lanes status"],
  roles: [ROLES[0], ROLES[1]], scope: "general", mutating: false,
  available: false, sinceSlice: 23, group: "Admin",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 23 }); },
});
