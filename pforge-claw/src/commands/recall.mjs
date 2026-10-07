import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "recall", aliases: [], args: "<query>", summary: "Search saved memories",
  details: "Search saved project and shared memories.", examples: ["/recall deployment", "/recall API decisions"],
  roles: [ROLES[0], ROLES[1]], scope: "both", mutating: false,
  available: false, sinceSlice: 7, group: "Ask & memory",
  async handle() { throw new ClawError("NOT_AVAILABLE", { slice: 7 }); },
});
