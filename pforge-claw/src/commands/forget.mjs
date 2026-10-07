import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "forget", aliases: [], args: "<memory-id>", summary: "Forget a saved memory",
  details: "Remove a saved memory after confirmation.", examples: ["/forget memory-123", "/forget latest"],
  roles: [ROLES[0]], scope: "project", mutating: true,
  available: false, sinceSlice: 24, group: "Ask & memory",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 24 }); },
});
