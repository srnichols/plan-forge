import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "bug", aliases: [], args: "<description>", summary: "Capture a project bug",
  details: "Record a bug for the current project.", examples: ["/bug login fails on retry", "/bug export omits empty values"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: false,
  available: false, sinceSlice: 7, group: "Ask & memory",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 7 }); },
});
