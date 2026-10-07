import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "abort", aliases: [], args: "<job-id>", summary: "Abort a running job",
  details: "Request cancellation of a running job.", examples: ["/abort job-123", "/abort latest"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: true,
  available: false, sinceSlice: 12, group: "Work",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 12 }); },
});
