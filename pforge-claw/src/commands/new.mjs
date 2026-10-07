import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "new", aliases: [], args: "<idea>", summary: "Start a new plan",
  details: "Capture a feature idea and prepare a plan.", examples: ["/new add exports", "/new improve onboarding"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: false,
  available: false, sinceSlice: 6, group: "Ask & memory",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 6 }); },
});
