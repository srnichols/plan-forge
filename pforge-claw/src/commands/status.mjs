import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "status", aliases: [], args: "", summary: "Show dispatcher and job status",
  details: "Show the configured dispatcher and current job status.", examples: ["/status", "/status jobs"],
  roles: [...ROLES], scope: "both", mutating: false,
  available: false, sinceSlice: 16, group: "Status & budget",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 16 }); },
});
