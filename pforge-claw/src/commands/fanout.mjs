import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "fanout", aliases: [], args: "<task>", summary: "Run a task across projects",
  details: "Create a coordinated task across configured projects.", examples: ["/fanout check dependencies", "/fanout update documentation"],
  roles: [ROLES[0], ROLES[1]], scope: "general", mutating: true,
  available: false, sinceSlice: 16, group: "Work",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 16 }); },
});
