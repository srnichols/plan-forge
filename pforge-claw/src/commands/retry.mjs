import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "retry", aliases: [], args: "<job-id>", summary: "Retry a failed job",
  details: "Create a retry for a retryable job.", examples: ["/retry job-123", "/retry latest"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: true,
  available: false, sinceSlice: 12, group: "Work",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 12 }); },
});
