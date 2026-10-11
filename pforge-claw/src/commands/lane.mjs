import { ROLES } from "../enums.mjs";
import { getPlacementService } from "../placement.mjs";

const UNKNOWN_LANE_PREVIEW_CHARS = 64;

export default Object.freeze({
  name: "lane", aliases: [], args: "<id> <on|off>", summary: "Change lane availability",
  details: "Enable or disable a configured opt-in lane. Turning a lane off prevents new assignments; it does not cancel running jobs.",
  examples: ["/lane worker on", "/lane worker off"],
  roles: [ROLES[0]], scope: "general", mutating: true,
  available: true, sinceSlice: 23, group: "Admin",
  async handle(_context = {}, input = {}) {
    if (input.caller?.role !== ROLES[0]) return { text: "FORBIDDEN" };
    const args = input.args;
    if (!Array.isArray(args) || args.length !== 2
      || args.some((argument) => typeof argument !== "string")
      || !["on", "off"].includes(args[1])) {
      return { text: "Usage: /lane <id> <on|off>" };
    }
    const laneId = args[0].trim();
    const service = getPlacementService();
    if (!service) return { text: "SERVICE_UNAVAILABLE: placement" };
    const lane = service.findLane(laneId);
    if (!lane) return { text: `Unknown lane: ${laneId.slice(0, UNKNOWN_LANE_PREVIEW_CHARS)}` };
    if (!lane.optIn) return { text: `Lane ${laneId}: toggle via \`enabled\` in config` };
    const on = args[1] === "on";
    service.setOptIn({ laneId, on, by: input.caller.userId });
    return {
      text: `Lane ${laneId} is ${on ? "on" : "off"} for new jobs. Running jobs are not cancelled.`,
    };
  },
});
