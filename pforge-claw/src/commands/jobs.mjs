import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "jobs", aliases: [], args: "[filter]", summary: "List recent jobs",
  details: "List jobs visible to this dispatcher.", examples: ["/jobs", "/jobs running"],
  roles: [ROLES[0], ROLES[1]], scope: "both", mutating: false,
  available: false, sinceSlice: 9, group: "Status & budget",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 9 }); },
});
