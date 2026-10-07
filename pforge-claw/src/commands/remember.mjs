import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "remember", aliases: [], args: "<fact>", summary: "Save a project memory",
  details: "Save a fact to project memory.", examples: ["/remember API uses cursors", "/remember tests run with vitest"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: false,
  available: false, sinceSlice: 7, group: "Ask & memory",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 7 }); },
});
