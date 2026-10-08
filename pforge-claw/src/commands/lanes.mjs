import { ROLES } from "../enums.mjs";
import { getPlacementService } from "../placement.mjs";

const MAX_LANES = 25;

export default Object.freeze({
  name: "lanes", aliases: [], args: "", summary: "List configured lanes",
  details: "Show configured execution lanes.", examples: ["/lanes", "/lanes status"],
  roles: [ROLES[0], ROLES[1]], scope: "general", mutating: false,
  available: true, sinceSlice: 23, group: "Admin",
  async handle(_context = {}, input = {}) {
    if (![ROLES[0], ROLES[1]].includes(input.caller?.role)) return { text: "FORBIDDEN" };
    const args = input.args ?? [];
    if (!Array.isArray(args) || (args.length > 0 && !(args.length === 1 && args[0] === "status"))) {
      return { text: "Usage: /lanes [status]" };
    }
    const service = getPlacementService();
    if (!service) return { text: "SERVICE_UNAVAILABLE: placement" };
    const statuses = service.listStatuses();
    if (statuses.length === 0) return { text: "No lanes configured — add `lanes[]` to config.json" };
    const shown = statuses.slice(0, MAX_LANES).map(({ id, kind, labels, status, queueDepth }) => (
      `${id}  ${kind}  labels: ${labels.join(", ") || "none"}  ${status}  queue: ${queueDepth ?? "?"}`
    ));
    if (statuses.length > shown.length) shown.push(`+${statuses.length - shown.length} more`);
    return { text: shown.join("\n") };
  },
});
