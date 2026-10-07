import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "ask", aliases: [], args: "<question>", summary: "Ask about the current project",
  details: "Ask a question about the configured project.", examples: ["/ask what changed", "/ask explain this failure"],
  roles: [...ROLES], scope: "project", mutating: false,
  available: false, sinceSlice: 6, group: "Ask & memory",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 6 }); },
});
