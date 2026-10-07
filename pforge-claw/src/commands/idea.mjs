import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "idea", aliases: [], args: "<idea>", summary: "Capture a project idea",
  details: "Capture an idea for later planning.", examples: ["/idea add export support", "/idea improve startup time"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: false,
  available: false, sinceSlice: 7, group: "Ask & memory",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 7 }); },
});
